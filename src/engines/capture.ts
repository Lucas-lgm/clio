import { createHash, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { ClioConfig } from '../config.js';
import type { InstinctEngine } from './instinct.js';
import type { DecayEngine } from './decay.js';
import type { ProfileEngine } from './profile.js';
import { Anthropic } from '@anthropic-ai/sdk';

const SKIP_TOOLS = new Set(['Read', 'Glob', 'listFiles', 'Bash', 'TaskList', 'TaskGet']);

const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/api[_-]?key["']?\s*[:=]\s*["']?[\w-]{16,}/gi, 'API_KEY_REDACTED'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS_KEY_REDACTED'],
  [/sk-[a-zA-Z0-9]{20,}/g, 'OPENAI_KEY_REDACTED'],
  [/ghp_[A-Za-z0-9_]{36}/g, 'GITHUB_TOKEN_REDACTED'],
  [/\/Users\/[^/\s]+\//g, '/Users/[USER]/'],
];

const CORRECTION_PATTERNS = [
  /(不对|不是这样|错了|不应该|不要用|stop|wrong|incorrect)/i,
  /(should be|should use|ought to be|better to use)/i,
  /(不用\w+用|不要\w+要)/i,
];

const PREFERENCE_PATTERNS = [
  /(我喜欢用|prefer|always use|习惯用|i like|i use)/i,
  /(best practice|recommend|建议使用|推荐)/i,
  /(用\w+就好|用\w+就行)/i,
];

const DECISION_PATTERNS = [
  /(选择\s*\w+\s*因为|决定用|choose|decided|migrate|upgrade|downgrade)/i,
  /(use\s+\w+\s+because|migrating\s+(from|to)|switched\s+(from|to))/i,
  /(原因|理由|because|due to|目的是)/i,
];

export class CaptureEngine {
  private recentHashes: string[] = [];
  private anthropic: Anthropic;

  constructor(private db: Database.Database, private config: ClioConfig) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  observe(toolName: string, toolOutput: string): void {
    if (SKIP_TOOLS.has(toolName)) return;

    const content = this.redact(toolOutput.slice(0, this.config.capture.max_tool_output_chars));
    if (content.length < 10) return;

    const hash = createHash('sha256').update(content).digest('hex');
    if (this.recentHashes.includes(hash)) return;
    this.recentHashes.push(hash);
    if (this.recentHashes.length > 100) this.recentHashes.shift();

    const sessionId = process.env.CLAUDE_SESSION_ID ?? 'unknown';
    this.db.prepare(
      'INSERT INTO working_memories (id, session_id, source, content, pattern_type) VALUES (?, ?, ?, ?, NULL)'
    ).run(randomUUID(), sessionId, 'tool_use', content);
  }

  redact(text: string): string {
    let result = text;
    for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  detectPreferences(text: string): { matched: boolean; patternType: string | null; confidence: number } | null {
    for (const pattern of CORRECTION_PATTERNS) {
      if (pattern.test(text)) {
        return { matched: true, patternType: 'correction', confidence: 0.7 };
      }
    }
    for (const pattern of PREFERENCE_PATTERNS) {
      if (pattern.test(text)) {
        return { matched: true, patternType: 'preference', confidence: 0.5 };
      }
    }
    for (const pattern of DECISION_PATTERNS) {
      if (pattern.test(text)) {
        return { matched: true, patternType: 'decision', confidence: 0.5 };
      }
    }
    return null;
  }

  async summarizeSession(
    sessionId: string,
    instinct: InstinctEngine,
    decay: DecayEngine,
    profile: ProfileEngine,
  ): Promise<void> {
    const rows = this.db.prepare(
      'SELECT content FROM working_memories WHERE session_id = ? ORDER BY created_at'
    ).all(sessionId) as { content: string }[];

    if (rows.length === 0) return;

    const conversationText = rows.map(r => r.content).join('\n').slice(0, 10000);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `从以下对话记录中提取 1-5 条关键信息。只包含:\n` +
            `1. 用户明确的技术偏好\n` +
            `2. 重要的技术决策（含理由）\n` +
            `3. 纠正过 Claude 的内容\n` +
            `请以 JSON 数组格式输出，每条包含 content, type (fact|preference|decision|pattern), topic, value。\n\n对话记录:\n${conversationText}`,
        }],
      });

      const textBlock = response.content[0];
      if (textBlock.type !== 'text') return;
      const parsed = JSON.parse(textBlock.text);
      const facts = Array.isArray(parsed) ? parsed : [parsed];

      for (const fact of facts) {
        if (!fact.content || fact.content.length < 20) continue;

        const dup = this.db.prepare(
          "SELECT id FROM semantic_memories WHERE content = ?"
        ).get(fact.content);
        if (dup) continue;

        const id = randomUUID();
        this.db.prepare(
          'INSERT INTO semantic_memories (id, content, memory_type, topic, value, source_session, confidence) VALUES (?, ?, ?, ?, ?, ?, 0.5)'
        ).run(id, this.redact(fact.content), fact.type ?? 'fact', fact.topic ?? null, fact.value ?? null, sessionId);

        // Index in FTS5
        const row = this.db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get(id) as any;
        if (row) {
          this.db.prepare(
            'INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)'
          ).run(row.rowid, fact.content, fact.topic ?? '', fact.value ?? '');
        }
      }
    } catch (err) {
      console.error('[clio] summarize error (non-fatal):', err);
    }

    instinct.detect(sessionId);
    decay.run();
    profile.sync();

    this.db.prepare('DELETE FROM working_memories WHERE session_id = ?').run(sessionId);
  }

  saveSnapshot(data: { sessionId: string; toolCount?: number }): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO sessions (id, tool_count) VALUES (?, ?)'
    ).run(data.sessionId, data.toolCount ?? 0);
  }
}
