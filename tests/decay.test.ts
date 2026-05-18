import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { DecayEngine } from '../src/engines/decay.js';

describe('DecayEngine', () => {
  it('should not archive high-confidence recent memories', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare(
      "INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence, last_accessed) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
    ).run('m1', 'test memory', 'fact', 't', 'v', 0.9);

    const engine = new DecayEngine(db, { decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 } } as any);
    engine.run();

    const m = db.prepare('SELECT is_archived FROM semantic_memories WHERE id = ?').get('m1') as any;
    expect(m.is_archived).toBe(0);
  });

  it('should archive low-confidence old memories', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare(
      "INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence, last_accessed) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-100 days'))"
    ).run('m1', 'stale memory', 'fact', 't', 'v', 0.05);

    const engine = new DecayEngine(db, { decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 } } as any);
    engine.run();

    const m = db.prepare('SELECT is_archived FROM semantic_memories WHERE id = ?').get('m1') as any;
    expect(m.is_archived).toBe(1);
  });
});
