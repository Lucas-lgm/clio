import { createHash, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { ClioConfig } from '../config.js';
import type { InstinctEngine } from './instinct.js';
import type { DecayEngine } from './decay.js';
import type { ProfileEngine } from './profile.js';
import type { EmbeddingService } from '../storage/embedding.js';
import { Anthropic } from '@anthropic-ai/sdk';
import { logger } from '../logger.js';

const SKIP_TOOLS = new Set(['Read', 'Glob', 'listFiles']);

export function parseLooseJson(raw: string): unknown {
  // First try strict parse
  try { return JSON.parse(raw); } catch { /* fall through */ }
  // Strip trailing commas (common LLM mistake)
  const cleaned = raw
    .replace(/,\s*([}\]])/g, '$1')        // remove trailing commas before ] or }
    .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":') // unquoted keys → quoted
    .replace(/'/g, '"');                    // single quotes → double
  return JSON.parse(cleaned);
}

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

export interface ClassificationResult {
  matched: boolean;
  patternType: string | null;
  confidence: number;
}

export class CaptureEngine {
  private recentHashes: string[] = [];
  private anthropic: Anthropic;

  constructor(private db: Database.Database, private config: ClioConfig) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  }

  observe(toolName: string, toolOutput: string, sessionId?: string): void {
    if (SKIP_TOOLS.has(toolName)) return;

    const content = this.redact(toolOutput.slice(0, this.config.capture.max_tool_output_chars));
    if (content.length < 10) return;

    const hash = createHash('sha256').update(content).digest('hex');
    if (this.recentHashes.includes(hash)) return;
    this.recentHashes.push(hash);
    if (this.recentHashes.length > 100) this.recentHashes.shift();

    sessionId ??= process.env.CLAUDE_SESSION_ID ?? 'unknown';
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

  detectPreferences(text: string): ClassificationResult | null {
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
    embedding?: EmbeddingService,
    projectPath?: string,
  ): Promise<void> {
    const rows = this.db.prepare(
      'SELECT content FROM working_memories WHERE session_id = ? ORDER BY created_at'
    ).all(sessionId) as { content: string }[];

    if (rows.length === 0) {
      logger.info(`summarize: no working memories for session ${sessionId}`);
      return;
    }

    logger.info(`summarize: ${rows.length} working memories, extracting facts...`);
    const conversationText = rows.map(r => r.content).join('\n').slice(0, 10000);
    const prjPath = projectPath ?? '';

    try {
      const response = await this.anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Extract 1-5 key facts from this conversation log. Return ONLY valid JSON, no markdown. Example format:\n` +
            `[{"content": "User prefers using asyncpg", "type": "preference", "topic": "database", "value": "asyncpg"}]\n\n` +
            `Only include:\n` +
            `1. Explicit technical preferences\n` +
            `2. Important technical decisions (with reasons)\n` +
            `3. Corrections made to Claude\n\n` +
            `Each item must have: content (string), type (fact|preference|decision|pattern), topic (string), value (string).\n` +
            `If a fact belongs in a profile, add profile_key and profile_value using these prefix patterns:\n` +
            `  code_style.<trait>: language, indent, quotes, formatter, linter, type_annotations\n` +
            `  tech_stack.<trait>: language, framework, database, testing, build_tool\n` +
            `  workflow.<trait>: commit_style, test_approach, branch_naming\n` +
            `  role.<trait>: engineer_type, expertise_level, responsibility\n\nConversation log:\n${conversationText}`,
        }],
      });

      const textBlock = response.content.find(b => b.type === 'text') as any;
      if (!textBlock) return;

      // Strip markdown code fences if present
      let raw = textBlock.text.trim();
      raw = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      const parsed = parseLooseJson(raw);
      const facts = (Array.isArray(parsed) ? parsed : [parsed]).map((f: any) =>
        typeof f === 'string' ? { content: f, type: 'fact', topic: null, value: null } : f
      );
      let savedCount = 0;

      for (const fact of facts) {
        if (!fact.content || fact.content.length < 20) continue;

        const dup = this.db.prepare(
          "SELECT id FROM semantic_memories WHERE content = ?"
        ).get(fact.content);
        if (dup) continue;

        savedCount++;
        const id = randomUUID();
        this.db.prepare(
          'INSERT INTO semantic_memories (id, content, memory_type, topic, value, source_session, confidence, project_path) VALUES (?, ?, ?, ?, ?, ?, 0.7, ?)'
        ).run(id, this.redact(fact.content), fact.type ?? 'fact', fact.topic ?? null, fact.value ?? null, sessionId, prjPath);

        // Index in FTS5
        const row = this.db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get(id) as any;
        if (row) {
          this.db.prepare(
            'INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)'
          ).run(row.rowid, fact.content, fact.topic ?? '', fact.value ?? '');
        }

        // Generate and store vector embedding
        if (embedding?.isLoaded()) {
          try {
            const vector = await embedding.embed(this.redact(fact.content));
            this.db.prepare(
              'INSERT INTO memories_vec (id, embedding) VALUES (?, ?)'
            ).run(id, Buffer.from(vector.buffer));
          } catch {
            // embedding failure is non-fatal
          }
        }

        // Direct profile extraction for LLM-identified traits
        if (fact.profile_key && fact.profile_value) {
          profile.extract(fact.profile_key, fact.profile_value, prjPath);
        }
      }

      logger.info(`summarize: saved ${savedCount} facts, running downstream engines...`);
      this.db.prepare('DELETE FROM working_memories WHERE session_id = ?').run(sessionId);
    } catch (err) {
      logger.error('summarize error (non-fatal):', err);
    }

    instinct.detect(sessionId);
    decay.run();
    profile.sync(prjPath);
  }

  saveSnapshot(data: { sessionId: string; toolCount?: number; projectPath?: string }): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO sessions (id, tool_count, project_path) VALUES (?, ?, ?)'
    ).run(data.sessionId, data.toolCount ?? 0, data.projectPath ?? '');
  }
}
