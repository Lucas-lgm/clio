import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { ClioConfig } from '../../config.js';
import type { EmbeddingService } from '../../storage/embedding.js';
import { Anthropic } from '@anthropic-ai/sdk';
import { logger } from '../../logger.js';
import { redact, hashContent } from './redact.js';
import { parseLooseJson } from './llm-parser.js';
import { detectPreferences } from './patterns.js';

export { parseLooseJson, redact, detectPreferences };

const SKIP_TOOLS = new Set(['Read', 'Glob', 'listFiles', 'Bash']);
const SHORT_TOOLS = new Set(['Edit', 'Write']);
const SHORT_MAX_CHARS = 500;

export class CaptureEngine {
  private recentHashes: string[] = [];
  private anthropic: Anthropic;

  constructor(
    private db: Database.Database,
    private config: ClioConfig,
    private embedding?: EmbeddingService,
  ) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  }

  observe(toolName: string, toolOutput: string, sessionId?: string): void {
    if (SKIP_TOOLS.has(toolName)) return;

    const maxChars = SHORT_TOOLS.has(toolName) ? SHORT_MAX_CHARS : this.config.capture.max_tool_output_chars;
    const content = redact(toolOutput.slice(0, maxChars));
    if (content.length < 10) return;

    const hash = hashContent(content);
    if (this.recentHashes.includes(hash)) return;
    this.recentHashes.push(hash);
    if (this.recentHashes.length > 100) this.recentHashes.shift();

    sessionId ??= process.env.CLAUDE_SESSION_ID ?? 'unknown';
    this.db.prepare(
      'INSERT INTO working_memories (id, session_id, source, content, pattern_type) VALUES (?, ?, ?, ?, NULL)'
    ).run(randomUUID(), sessionId, 'tool_use', content);
  }

  async summarizeSession(sessionId: string, projectPath?: string): Promise<void> {
    const rows = this.db.prepare(
      'SELECT content FROM working_memories WHERE session_id = ? ORDER BY created_at'
    ).all(sessionId) as { content: string }[];

    if (rows.length === 0) {
      logger.info(`summarize: no working memories for session ${sessionId}`);
      return;
    }

    logger.info(`summarize: ${rows.length} working memories, extracting facts...`);
    const conversationText = rows.map(r => r.content).join('\n').slice(-10000);
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
        ).run(id, redact(fact.content), fact.type ?? 'fact', fact.topic ?? null, fact.value ?? null, sessionId, prjPath);

        const row = this.db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get(id) as any;
        if (row) {
          this.db.prepare(
            'INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)'
          ).run(row.rowid, fact.content, fact.topic ?? '', fact.value ?? '');
        }

        if (this.embedding?.isLoaded()) {
          try {
            const vector = await this.embedding.embed(redact(fact.content));
            this.db.prepare(
              'INSERT INTO memories_vec (id, embedding) VALUES (?, ?)'
            ).run(id, Buffer.from(vector.buffer));
          } catch {
            // embedding failure is non-fatal
          }
        }
      }

      logger.info(`summarize: saved ${savedCount} facts`);
      this.db.prepare('DELETE FROM working_memories WHERE session_id = ?').run(sessionId);
    } catch (err) {
      logger.error('summarize error (non-fatal):', err);
    }
  }

  captureUserPrompt(text: string, sessionId?: string): void {
    sessionId ??= process.env.CLAUDE_SESSION_ID ?? 'unknown';
    this.db.prepare(
      'INSERT INTO working_memories (id, session_id, source, content, pattern_type) VALUES (?, ?, ?, ?, NULL)'
    ).run(randomUUID(), sessionId, 'user_prompt', redact(text));
  }

  saveSnapshot(data: { sessionId: string; toolCount?: number; projectPath?: string }): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO sessions (id, tool_count, project_path) VALUES (?, ?, ?)'
    ).run(data.sessionId, data.toolCount ?? 0, data.projectPath ?? '');
  }
}
