import type Database from 'better-sqlite3';
import { logger } from '../logger.js';

interface PrefRow {
  topic: string;
  value: string;
  confidence: number;
  memory_type: string;
  project_path: string;
}

const KEY_MAP: Record<string, string> = {
  'language': 'code_style.language',
  'framework': 'tech_stack.framework',
  'database': 'tech_stack.database',
  'testing': 'tech_stack.testing',
  'indent': 'code_style.indent',
  'quotes': 'code_style.quotes',
  'line_width': 'code_style.line_width',
  'formatter': 'code_style.formatter',
  'linter': 'code_style.linter',
  'type_annotations': 'code_style.type_annotations',
};

export class ProfileEngine {
  constructor(private db: Database.Database) {}

  sync(projectPath?: string): void {
    const scope = projectPath ?? '';
    const prefs = this.db.prepare(`
      SELECT topic, value, confidence, memory_type, project_path
      FROM semantic_memories
      WHERE memory_type IN ('preference', 'decision')
        AND confidence >= 0.7
        AND topic IS NOT NULL
        AND value IS NOT NULL
    `).all() as PrefRow[];

    const upsertStmt = this.db.prepare(`
      INSERT INTO profile (key, value, confidence, source, project_path, updated_at)
      VALUES (?, ?, ?, 'sync', ?, datetime('now'))
      ON CONFLICT(key, project_path) DO UPDATE SET
        value = CASE
          WHEN excluded.value = profile.value THEN profile.value
          ELSE excluded.value
        END,
        confidence = CASE
          WHEN excluded.value = profile.value THEN MIN(1.0, profile.confidence + 0.1)
          ELSE MAX(0.1, profile.confidence - 0.2)
        END,
        updated_at = datetime('now')
    `);

    let count = 0;
    for (const p of prefs) {
      const key = KEY_MAP[p.topic] ?? `${p.memory_type}.${p.topic}`;
      upsertStmt.run(key, p.value, p.confidence, p.project_path || '');
      count++;
    }

    if (count > 0) {
      logger.info(`profile: ${count} entries synced`);
    }
  }

  /** Upsert a single profile entry directly (used by capture for LLM-extracted traits). */
  extract(key: string, value: string, projectPath?: string): void {
    this.db.prepare(`
      INSERT INTO profile (key, value, confidence, source, project_path, updated_at)
      VALUES (?, ?, 0.6, 'llm_extracted', ?, datetime('now'))
      ON CONFLICT(key, project_path) DO UPDATE SET
        value = excluded.value,
        confidence = MIN(1.0, profile.confidence + 0.1),
        source = excluded.source,
        updated_at = datetime('now')
    `).run(key, value, projectPath ?? '');
  }
}
