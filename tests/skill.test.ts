import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { SkillEngine } from '../src/engines/skill.js';

describe('SkillEngine', () => {
  it('should seed 3 default skills on first run', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    const skills = engine.getManifest();
    expect(skills).toHaveLength(3);
    expect(skills.map(s => s.name)).toContain('Git Commit');
    expect(skills.map(s => s.name)).toContain('Shell Audit');
    expect(skills.map(s => s.name)).toContain('PR Description');
  });

  it('should not re-seed if skills already exist', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    // First run seeds
    new SkillEngine(db);
    // Second run should NOT add duplicates
    new SkillEngine(db);
    const count = db.prepare('SELECT COUNT(*) as cnt FROM skills').get() as any;
    expect(count.cnt).toBe(3);
  });

  it('getManifest should return lightweight entries', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    const manifest = engine.getManifest();
    expect(manifest[0]).toHaveProperty('name');
    expect(manifest[0]).toHaveProperty('description');
    expect(manifest[0]).toHaveProperty('keywords');
    expect(manifest[0]).not.toHaveProperty('content');
  });

  it('getSkill should return skill and increment usage_count in db', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    const skill = engine.getSkill('Git Commit');
    expect(skill).toBeTruthy();
    expect(skill!.name).toBe('Git Commit');
    expect(skill!.content).toContain('conventional commit');
    // First access — returned record has old count, db has increment
    const afterFirst = db.prepare('SELECT usage_count FROM skills WHERE name = ?').get('Git Commit') as any;
    expect(afterFirst.usage_count).toBe(1);
    // Second access — db reflects increment
    engine.getSkill('Git Commit');
    const afterSecond = db.prepare('SELECT usage_count FROM skills WHERE name = ?').get('Git Commit') as any;
    expect(afterSecond.usage_count).toBe(2);
  });

  it('getSkill should return null for unknown skill', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    expect(engine.getSkill('Nonexistent')).toBeNull();
  });

  it('recordOutcome should track success', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    engine.getSkill('Git Commit'); // usage +1
    engine.recordOutcome('Git Commit', true);
    const stats = engine.getStats();
    const git = stats.find(s => s.name === 'Git Commit');
    expect(git).toBeTruthy();
    expect(git!.usage).toBe(1);
    expect(git!.success).toBe(1);
  });

  it('getStats should list all skills sorted by usage descending', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const engine = new SkillEngine(db);
    engine.getSkill('PR Description');
    engine.getSkill('Git Commit');
    engine.getSkill('Git Commit');
    const stats = engine.getStats();
    expect(stats[0].name).toBe('Git Commit');
    expect(stats[0].usage).toBe(2);
    expect(stats[1].name).toBe('PR Description');
  });
});
