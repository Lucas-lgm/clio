import type Database from 'better-sqlite3';
import type { ClioConfig } from '../config.js';

export class DecayEngine {
  constructor(private db: Database.Database, private config: ClioConfig) {}

  run(): void {
    this.db.prepare(`
      UPDATE semantic_memories
      SET confidence = MAX(0, confidence - ? * CAST(
        (julianday('now') - julianday(last_accessed)) / 30 AS INTEGER
      ))
      WHERE is_archived = 0
        AND julianday('now') - julianday(last_accessed) > 30
    `).run(this.config.decay.confidence_decay_per_30d);

    this.db.prepare(`
      UPDATE semantic_memories
      SET is_archived = 1
      WHERE confidence < ?
         OR (confidence < 0.3 AND last_accessed < datetime('now', '-90 days'))
    `).run(this.config.decay.archive_threshold);

    this.db.prepare(`
      UPDATE instincts
      SET status = 'expired'
      WHERE status = 'pending'
        AND last_hit < datetime('now', ?)
    `).run(`-${this.config.decay.instinct_ttl_days} days`);

    this.db.prepare(`
      DELETE FROM working_memories
      WHERE created_at < datetime('now', '-7 days')
    `).run();
  }
}
