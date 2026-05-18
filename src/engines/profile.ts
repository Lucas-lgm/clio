import type Database from 'better-sqlite3';
import { logger } from '../logger.js';

export class ProfileEngine {
  constructor(private db: Database.Database) {}

  sync(): void {
    const prefs = this.db.prepare(`
      SELECT topic, value, confidence
      FROM semantic_memories
      WHERE memory_type IN ('preference', 'decision')
        AND confidence >= 0.7
        AND topic IS NOT NULL
        AND value IS NOT NULL
    `).all() as any[];

    const upsertStmt = this.db.prepare(`
      INSERT INTO profile (key, value, confidence, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
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
      upsertStmt.run(`tech_stack.${p.topic}`, p.value, p.confidence);
      count++;
    }

    if (count > 0) {
      logger.info(`profile: ${count} entries synced`);
    }
  }
}
