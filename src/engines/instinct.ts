import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../logger.js';
import type { SemanticMemoryRow, InstinctRow } from '../types.js';

export class InstinctEngine {
  constructor(private db: Database.Database) {}

  detect(sessionId: string): void {
    const newMemories = this.db.prepare(
      'SELECT * FROM semantic_memories WHERE source_session = ?'
    ).all(sessionId) as SemanticMemoryRow[];

    let created = 0, promoted = 0;

    for (const mem of newMemories) {
      if (!mem.topic) continue;

      const existing = this.db.prepare(
        'SELECT * FROM instincts WHERE topic = ? AND value = ?'
      ).get(mem.topic, mem.value) as InstinctRow | undefined;

      if (existing) {
        const hitCount = existing.hit_count + 1;
        const confidence = Math.min(0.7, 0.3 + hitCount * 0.15);

        this.db.prepare(
          'UPDATE instincts SET hit_count = ?, confidence = ?, last_hit = datetime(\'now\') WHERE id = ?'
        ).run(hitCount, confidence, existing.id);

        if (confidence >= 0.7 && existing.status === 'pending') {
          this.promoteToSemantic(existing, sessionId);
          this.db.prepare("UPDATE instincts SET status = 'promoted' WHERE id = ?").run(existing.id);
          promoted++;
        }
      } else {
        this.db.prepare(
          'INSERT INTO instincts (id, topic, value, confidence, hit_count) VALUES (?, ?, ?, 0.3, 1)'
        ).run(randomUUID(), mem.topic, mem.value);
        created++;
      }
    }

    if (created > 0 || promoted > 0) {
      logger.info(`instinct: ${created} created, ${promoted} promoted`);
    }
  }

  private promoteToSemantic(instinct: InstinctRow, sessionId: string): void {
    const existing = this.db.prepare(
      "SELECT id FROM semantic_memories WHERE memory_type = 'pattern' AND topic = ? AND value = ?"
    ).get(instinct.topic, instinct.value);
    if (existing) return;

    const id = randomUUID();
    const content = `recurring pattern: ${instinct.topic} = ${instinct.value}`;
    this.db.prepare(
      'INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence, source_session) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, content, 'pattern', instinct.topic, instinct.value, instinct.confidence, sessionId);
  }
}
