import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { SkillEngine } from '../src/engines/skill.js';

describe('SkillEngine', () => {
  it('getManifest should return empty (no default skills)', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    expect(engine.getManifest()).toEqual([]);
  });

  it('getSkill should return null for any skill', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    expect(engine.getSkill('anything')).toBeNull();
  });

  it('recordOutcome should not throw', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    expect(() => engine.recordOutcome('anything', true)).not.toThrow();
  });
});
