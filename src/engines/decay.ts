import type Database from 'better-sqlite3';
import type { ClioConfig } from '../config.js';
import { logger } from '../logger.js';

export class DecayEngine {
  constructor(private db: Database.Database, private config: ClioConfig) {}

  run(): void {
    const decayed = this.db.prepare(`
      UPDATE semantic_memories
      SET confidence = MAX(0, confidence - ? * CAST(
        (julianday('now') - julianday(last_accessed)) / 30 AS INTEGER
      ))
      WHERE is_archived = 0
        AND julianday('now') - julianday(last_accessed) > 30
    `).run(this.config.decay.confidence_decay_per_30d);
    const decayCount = decayed.changes;

    const archived = this.db.prepare(`
      UPDATE semantic_memories
      SET is_archived = 1
      WHERE confidence < ?
         OR (confidence < 0.3 AND last_accessed < datetime('now', '-90 days'))
    `).run(this.config.decay.archive_threshold);
    const archiveCount = archived.changes;

    const expired = this.db.prepare(`
      UPDATE instincts
      SET status = 'expired'
      WHERE status = 'pending'
        AND last_hit < datetime('now', ?)
    `).run(`-${this.config.decay.instinct_ttl_days} days`);
    const expireCount = expired.changes;

    const cleaned = this.db.prepare(`
      DELETE FROM working_memories
      WHERE created_at < datetime('now', '-7 days')
    `).run();
    const cleanCount = cleaned.changes;

    const profileCleaned = this.db.prepare(`
      DELETE FROM profile
      WHERE confidence < ?
         OR (confidence < 0.3 AND updated_at < datetime('now', '-90 days'))
    `).run(this.config.decay.archive_threshold);
    const profileCount = profileCleaned.changes;

    if (decayCount > 0 || archiveCount > 0 || expireCount > 0 || cleanCount > 0 || profileCount > 0) {
      logger.info(`decay: ${decayCount} decayed, ${archiveCount} archived, ${expireCount} instincts expired, ${cleanCount} working memories cleaned, ${profileCount} profile entries removed`);
    }
  }
}
