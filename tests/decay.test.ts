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

  it('should expire stale instincts', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare(
      "INSERT INTO instincts (id, topic, value, last_hit, status) VALUES (?, ?, ?, datetime('now', '-60 days'), 'pending')"
    ).run('i1', 'framework', 'fastapi');

    const engine = new DecayEngine(db, { decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 } } as any);
    engine.run();

    const row = db.prepare("SELECT status FROM instincts WHERE id = ?").get('i1') as any;
    expect(row.status).toBe('expired');
  });

  it('should keep recent instincts pending', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare(
      "INSERT INTO instincts (id, topic, value, last_hit, status) VALUES (?, ?, ?, datetime('now'), 'pending')"
    ).run('i1', 'framework', 'fastapi');

    const engine = new DecayEngine(db, { decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 } } as any);
    engine.run();

    const row = db.prepare("SELECT status FROM instincts WHERE id = ?").get('i1') as any;
    expect(row.status).toBe('pending');
  });

  it('should clean old working memories', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare(
      "INSERT INTO working_memories (id, session_id, source, content, created_at) VALUES (?, ?, ?, ?, datetime('now', '-10 days'))"
    ).run('w1', 'sess-1', 'tool_use', 'old memory');
    db.prepare(
      "INSERT INTO working_memories (id, session_id, source, content, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
    ).run('w2', 'sess-2', 'tool_use', 'recent memory');

    const engine = new DecayEngine(db, { decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 } } as any);
    engine.run();

    const remaining = db.prepare('SELECT id FROM working_memories').all() as any[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('w2');
  });

  it('should clean low-confidence profile entries', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare(
      "INSERT INTO profile (key, value, confidence) VALUES (?, ?, ?)"
    ).run('code_style.language', 'python', 0.05);

    const engine = new DecayEngine(db, { decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.2, instinct_ttl_days: 30 } } as any);
    engine.run();

    const remaining = db.prepare('SELECT COUNT(*) as c FROM profile').get() as any;
    expect(remaining.c).toBe(0);
  });

  it('should clean stale low-confidence profile entries with old updated_at', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare(
      "INSERT INTO profile (key, value, confidence, updated_at) VALUES (?, ?, ?, datetime('now', '-100 days'))"
    ).run('code_style.quotes', 'single', 0.2);

    const engine = new DecayEngine(db, { decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 } } as any);
    engine.run();

    const remaining = db.prepare('SELECT COUNT(*) as c FROM profile').get() as any;
    expect(remaining.c).toBe(0);
  });

  it('should keep high-confidence profile entries', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare("INSERT INTO profile (key, value, confidence) VALUES (?, ?, ?)").run('tech_stack.database', 'asyncpg', 0.8);

    const engine = new DecayEngine(db, { decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 } } as any);
    engine.run();

    const remaining = db.prepare('SELECT COUNT(*) as c FROM profile').get() as any;
    expect(remaining.c).toBe(1);
  });
});
