import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';

describe('Database schema', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
  });

  afterAll(() => { db.close(); });

  it('should create semantic_memories table', () => {
    const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='semantic_memories'").get();
    expect(result).toBeTruthy();
  });

  it('should insert and read a semantic memory', () => {
    db.prepare(`INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence)
      VALUES ('test-1', 'uses asyncpg for database', 'preference', 'database-driver', 'asyncpg', 0.7)`).run();
    const row = db.prepare('SELECT * FROM semantic_memories WHERE id = ?').get('test-1') as any;
    expect(row.content).toBe('uses asyncpg for database');
    expect(row.confidence).toBe(0.7);
  });

  it('should create working_memories with index', () => {
    db.prepare(`INSERT INTO working_memories (id, session_id, source, content)
      VALUES ('w-1', 'sess-1', 'tool_use', 'some output')`).run();
    const row = db.prepare('SELECT * FROM working_memories WHERE session_id = ?').get('sess-1') as any;
    expect(row.content).toBe('some output');
  });

  it('should create instincts table', () => {
    db.prepare(`INSERT INTO instincts (id, topic, value, hit_count) VALUES ('inst-1', 'framework', 'fastapi', 1)`).run();
    const row = db.prepare('SELECT * FROM instincts WHERE id = ?').get('inst-1') as any;
    expect(row.topic).toBe('framework');
  });

  it('should create profile table', () => {
    db.prepare(`INSERT INTO profile (key, value, confidence) VALUES ('code_style.quotes', 'single', 0.7)`).run();
    const row = db.prepare('SELECT * FROM profile WHERE key = ?').get('code_style.quotes') as any;
    expect(row.value).toBe('single');
  });
});
