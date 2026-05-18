import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { ProfileEngine } from '../src/engines/profile.js';

describe('ProfileEngine', () => {
  it('should sync preferences to profile table', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    db.prepare(
      "INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('m1', 'uses asyncpg', 'preference', 'database-driver', 'asyncpg', 0.8);

    const engine = new ProfileEngine(db);
    engine.sync();

    // 'database-driver' is not in KEY_MAP → falls back to 'preference.database-driver'
    const profile = db.prepare('SELECT * FROM profile WHERE key = ?').get('preference.database-driver') as any;
    expect(profile).toBeTruthy();
    expect(profile.value).toBe('asyncpg');
  });
});
