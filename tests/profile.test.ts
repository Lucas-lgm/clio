import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { ProfileEngine } from '../src/engines/profile.js';

function createEngine(db?: Database.Database): { db: Database.Database; engine: ProfileEngine } {
  if (!db) {
    db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
  }
  return { db, engine: new ProfileEngine(db) };
}

describe('ProfileEngine', () => {
  it('should sync preferences to profile table', () => {
    const { db, engine } = createEngine();
    db.prepare(
      "INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('m1', 'uses asyncpg', 'preference', 'database', 'asyncpg', 0.8);

    engine.sync();

    // 'database' is in KEY_MAP → mapped to 'tech_stack.database'
    const profile = db.prepare('SELECT * FROM profile WHERE key = ?').get('tech_stack.database') as any;
    expect(profile).toBeTruthy();
    expect(profile.value).toBe('asyncpg');
  });

  it('should fall back to memory_type.topic for unmapped keys', () => {
    const { db, engine } = createEngine();
    db.prepare(
      "INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('m1', 'design doc review', 'preference', 'review_style', 'thorough', 0.8);

    engine.sync();

    // 'review_style' is NOT in KEY_MAP → falls back to 'preference.review_style'
    const profile = db.prepare('SELECT * FROM profile WHERE key = ?').get('preference.review_style') as any;
    expect(profile).toBeTruthy();
    expect(profile.value).toBe('thorough');
  });

  it('should respect project_path in sync', () => {
    const { db, engine } = createEngine();
    db.prepare(
      "INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence, project_path) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run('m1', 'uses asyncpg', 'preference', 'database', 'asyncpg', 0.8, '/proj/a');

    engine.sync('/proj/a');

    const profile = db.prepare(
      'SELECT * FROM profile WHERE key = ? AND project_path = ?'
    ).get('tech_stack.database', '/proj/a') as any;
    expect(profile).toBeTruthy();
    expect(profile.source).toBe('sync');
  });

  it('should extract direct profile entry', () => {
    const { db, engine } = createEngine();
    engine.extract('tech_stack.framework', 'fastapi');
    const row = db.prepare('SELECT * FROM profile WHERE key = ?').get('tech_stack.framework') as any;
    expect(row).toBeTruthy();
    expect(row.value).toBe('fastapi');
    expect(row.confidence).toBe(0.6);
    expect(row.source).toBe('llm_extracted');
  });

  it('should increase confidence on extract with same value', () => {
    const { db, engine } = createEngine();
    engine.extract('tech_stack.framework', 'fastapi');
    engine.extract('tech_stack.framework', 'fastapi');
    const row = db.prepare('SELECT * FROM profile WHERE key = ?').get('tech_stack.framework') as any;
    expect(row.confidence).toBeCloseTo(0.7);
  });

  it('should update value on extract with different value', () => {
    const { db, engine } = createEngine();
    engine.extract('tech_stack.framework', 'fastapi');
    engine.extract('tech_stack.framework', 'django');
    const row = db.prepare('SELECT * FROM profile WHERE key = ?').get('tech_stack.framework') as any;
    expect(row.value).toBe('django');
    // extract always increments confidence
    expect(row.confidence).toBeGreaterThan(0.6);
  });

  it('should handle project-scoped extract', () => {
    const { db, engine } = createEngine();
    engine.extract('code_style.language', 'typescript', '/proj/web');
    const row = db.prepare(
      'SELECT * FROM profile WHERE key = ? AND project_path = ?'
    ).get('code_style.language', '/proj/web') as any;
    expect(row).toBeTruthy();
    expect(row.value).toBe('typescript');
  });

  it('should keep global and project-scoped entries separate', () => {
    const { db, engine } = createEngine();
    engine.extract('code_style.language', 'python');
    engine.extract('code_style.language', 'typescript', '/proj/web');
    const global = db.prepare(
      "SELECT * FROM profile WHERE key = 'code_style.language' AND project_path = ''"
    ).get() as any;
    const project = db.prepare(
      "SELECT * FROM profile WHERE key = 'code_style.language' AND project_path = '/proj/web'"
    ).get() as any;
    expect(global.value).toBe('python');
    expect(project.value).toBe('typescript');
  });
});
