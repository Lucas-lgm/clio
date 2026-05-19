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

  it('should filter by projectPath in getInitialContext', () => {
    const db = createDb();
    // Add a project-scoped memory
    db.prepare(
      "INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence, project_path) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run('m5', 'project specific config', 'preference', 'editor', 'vscode', 0.9, '/proj/web');
    const rowid = (db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get('m5') as any).rowid;
    db.prepare('INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)').run(rowid, 'project specific config', 'editor', 'vscode');

    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, { isLoaded: () => false } as any);

    // With project scope — should see project memory
    const ctxWithScope = recall.getInitialContext('/proj/web');
    expect(ctxWithScope).toContain('project specific config');
    expect(ctxWithScope).toContain('asyncpg'); // global memories also included

    // With different project scope — should NOT see /proj/web memories
    const ctxOtherScope = recall.getInitialContext('/proj/other');
    expect(ctxOtherScope).not.toContain('project specific config');
  });

  it('should filter by projectPath in recallRelevant', async () => {
    const db = createDb();
    db.prepare(
      "INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence, project_path) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run('m6', 'specific to web project', 'fact', 'domain', 'web', 0.9, '/proj/web');
    const rowid = (db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get('m6') as any).rowid;
    db.prepare('INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)').run(rowid, 'specific to web project', 'domain', 'web');

    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, { isLoaded: () => false } as any);

    const webResult = await recall.recallRelevant('specific', '/proj/web');
    expect(webResult).toContain('specific to web project');

    const otherResult = await recall.recallRelevant('specific', '/proj/other');
    expect(otherResult).not.toContain('specific to web project');
  });

  it('should return empty for short queries', async () => {
    const db = createDb();
    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, { isLoaded: () => false } as any);

    expect(await recall.recallRelevant('ab')).toBe('');
  });

  it('should escape double quotes in FTS5 queries', async () => {
    const db = createDb();
    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, { isLoaded: () => false } as any);

    const result = await recall.recallRelevant('"pytest');
    expect(result).toContain('pytest');
  });
});

describe('RecallEngine - hybrid RRF fusion', () => {
  function makeVec(dim0: number, dim1: number): Float32Array {
    const v = new Float32Array(384);
    v[0] = dim0;
    v[1] = dim1;
    const norm = Math.sqrt(dim0 * dim0 + dim1 * dim1);
    if (norm > 0) { v[0] /= norm; v[1] /= norm; }
    return v;
  }

  function setupHybridDb(): { db: Database.Database; queryVec: Float32Array } {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);

    // m1: only BM25 matches (content has "database", vector orthogonal to query)
    db.prepare(
      'INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('m1', 'use asyncpg for database', 'preference', 'database', 'asyncpg', 0.8);
    const r1 = db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get('m1') as any;
    db.prepare('INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)').run(r1.rowid, 'use asyncpg for database', 'database', 'asyncpg');

    // m2: only vector matches (content has no "database", vector identical to query)
    db.prepare(
      'INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('m2', 'prefer FastAPI framework', 'preference', 'framework', 'fastapi', 0.9);
    const r2 = db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get('m2') as any;
    db.prepare('INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)').run(r2.rowid, 'prefer FastAPI framework', 'framework', 'fastapi');

    // m3: both BM25 and vector match
    db.prepare(
      'INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('m3', 'database design with postgres', 'decision', 'database', 'postgres', 0.75);
    const r3 = db.prepare('SELECT rowid FROM semantic_memories WHERE id = ?').get('m3') as any;
    db.prepare('INSERT INTO memories_fts (rowid, content, topic, value) VALUES (?, ?, ?, ?)').run(r3.rowid, 'database design with postgres', 'database', 'postgres');

    // Query along axis 0
    const queryVec = makeVec(1, 0);

    // m1: axis 1 (orthogonal, far from query)
    db.prepare('INSERT INTO memories_vec (id, embedding) VALUES (?, ?)').run('m1', Buffer.from(makeVec(0, 1).buffer));
    // m2: axis 0 (identical to query)
    db.prepare('INSERT INTO memories_vec (id, embedding) VALUES (?, ?)').run('m2', Buffer.from(makeVec(1, 0).buffer));
    // m3: diagonal (partially aligned)
    db.prepare('INSERT INTO memories_vec (id, embedding) VALUES (?, ?)').run('m3', Buffer.from(makeVec(0.707, 0.707).buffer));

    return { db, queryVec };
  }

  it('should include results from both BM25 and vector search', async () => {
    const { db, queryVec } = setupHybridDb();
    const mockEmbedding = { isLoaded: () => true, embed: async () => queryVec };

    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, mockEmbedding as any);

    const result = await recall.recallRelevant('database');

    // BM25-only (m1), vector-only (m2), and both (m3) all present
    expect(result).toContain('asyncpg');
    expect(result).toContain('FastAPI');
    expect(result).toContain('postgres');
  });

  it('should not duplicate memories appearing in both result sets', async () => {
    const { db, queryVec } = setupHybridDb();
    const mockEmbedding = { isLoaded: () => true, embed: async () => queryVec };

    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, mockEmbedding as any);

    const result = await recall.recallRelevant('database');
    const lines = result.split('\n').filter(Boolean);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('should rank dual-match memories above single-source matches', async () => {
    const { db, queryVec } = setupHybridDb();
    const mockEmbedding = { isLoaded: () => true, embed: async () => queryVec };

    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, mockEmbedding as any);

    const result = await recall.recallRelevant('database');
    const lines = result.split('\n').filter(Boolean);

    // Both dual-match (m1, m3) rank above vector-only (m2) — m2 is last
    expect(lines[lines.length - 1]).toContain('FastAPI');
  });

  it('should fall back to BM25-only when vector search fails', async () => {
    const { db } = setupHybridDb();
    // embedding loaded but embed() will fail
    const failingEmbedding = {
      isLoaded: () => true,
      embed: async () => { throw new Error('model not available'); },
    };

    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, failingEmbedding as any);

    const result = await recall.recallRelevant('database');
    // Fallback to pure BM25 — only m1 and m3 (containing "database") should appear
    expect(result).toContain('asyncpg');
    expect(result).toContain('postgres');
    expect(result).not.toContain('fastapi');
  });
});
