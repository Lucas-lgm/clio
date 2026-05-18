import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { RecallEngine } from '../src/engines/recall.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  loadVec0(db);
  initSchema(db);

  const memories = [
    { id: 'm1', content: 'use asyncpg for database connections', type: 'preference', topic: 'database-driver', value: 'asyncpg', confidence: 0.8 },
    { id: 'm2', content: 'prefer pytest over unittest', type: 'preference', topic: 'test-framework', value: 'pytest', confidence: 0.9 },
    { id: 'm3', content: 'use single quotes for strings', type: 'preference', topic: 'code-style', value: 'single-quotes', confidence: 0.7 },
    { id: 'm4', content: 'select FastAPI for performance', type: 'decision', topic: 'framework', value: 'FastAPI', confidence: 0.75 },
  ];

  for (const m of memories) {
    db.prepare(
      'INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(m.id, m.content, m.type, m.topic, m.value, m.confidence);

    const rowid = (db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get(m.id) as any).rowid;
    db.prepare(
      'INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)'
    ).run(rowid, m.content, m.topic, m.value);
  }

  return db;
}

describe('RecallEngine', () => {
  it('should get initial context with top memories', () => {
    const db = createDb();
    const recall = new RecallEngine(db, { recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 } } as any, { isLoaded: () => false } as any);
    const ctx = recall.getInitialContext();
    expect(ctx).toContain('clio: user profile');
    expect(ctx).toContain('asyncpg');
    expect(ctx).toContain('pytest');
  });

  it('should return empty on no memories', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const recall = new RecallEngine(db, { recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 } } as any, { isLoaded: () => false } as any);
    expect(recall.getInitialContext()).toBe('');
  });

  it('should BM25-search relevant memories', async () => {
    const db = createDb();
    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, { isLoaded: () => false } as any);

    const result = await recall.recallRelevant('database');
    expect(result).toContain('asyncpg');
  });

  it('should update access_count on recall', async () => {
    const db = createDb();
    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, { isLoaded: () => false } as any);

    await recall.recallRelevant('pytest');
    const m2 = db.prepare('SELECT access_count FROM semantic_memories WHERE id = ?').get('m2') as any;
    expect(m2.access_count).toBeGreaterThan(0);
  });
});
