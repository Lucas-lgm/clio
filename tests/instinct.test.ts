import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { InstinctEngine } from '../src/engines/instinct.js';

describe('InstinctEngine', () => {
  it('should create instinct on first detection', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new InstinctEngine(db);

    db.prepare(
      'INSERT INTO semantic_memories (id, content, memory_type, topic, value, source_session) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('m1', 'uses asyncpg', 'preference', 'database', 'asyncpg', 'session-1');

    engine.detect('session-1');

    const inst = db.prepare('SELECT * FROM instincts WHERE topic = ? AND value = ?').get('database', 'asyncpg') as any;
    expect(inst).toBeTruthy();
    expect(inst.hit_count).toBe(1);
    expect(inst.confidence).toBe(0.3);
  });

  it('should increase confidence on repeated detection', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new InstinctEngine(db);

    db.prepare('INSERT INTO semantic_memories (id, content, memory_type, topic, value, source_session) VALUES (?, ?, ?, ?, ?, ?)')
      .run('m1', 'uses asyncpg', 'preference', 'database', 'asyncpg', 'session-1');
    engine.detect('session-1');

    db.prepare('INSERT INTO semantic_memories (id, content, memory_type, topic, value, source_session) VALUES (?, ?, ?, ?, ?, ?)')
      .run('m2', 'uses asyncpg again', 'decision', 'database', 'asyncpg', 'session-2');
    engine.detect('session-2');

    const inst = db.prepare('SELECT * FROM instincts WHERE topic = ? AND value = ?').get('database', 'asyncpg') as any;
    expect(inst.hit_count).toBe(2);
    expect(inst.confidence).toBe(0.3 + 2 * 0.15);
  });

  it('should promote to semantic on confidence >= 0.7', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new InstinctEngine(db);

    for (let i = 0; i < 3; i++) {
      const id = `m${i}`;
      db.prepare('INSERT INTO semantic_memories (id, content, memory_type, topic, value, source_session) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, `hit ${i}`, 'preference', 'framework', 'fastapi', `session-${i}`);
      engine.detect(`session-${i}`);
    }

    const inst = db.prepare("SELECT * FROM instincts WHERE status = 'promoted'").get() as any;
    expect(inst).toBeTruthy();
    expect(inst.topic).toBe('framework');

    const patternMem = db.prepare("SELECT * FROM semantic_memories WHERE memory_type = 'pattern' AND topic = 'framework'").get() as any;
    expect(patternMem).toBeTruthy();
  });
});
