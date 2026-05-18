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

  it('should include skills manifest in getInitialContext', () => {
    const db = createDb();
    const recall = new RecallEngine(db, {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: {} as any, decay: {} as any, storage: {} as any,
    } as any, { isLoaded: () => false } as any);

    const ctx = recall.getInitialContext(undefined, [
      { name: 'Git Commit', description: 'Write commit messages', keywords: 'commit' },
    ]);
    expect(ctx).toContain('Available Skills');
    expect(ctx).toContain('Git Commit');
  });
});
