import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { CaptureEngine } from '../src/engines/capture.js';

function createEngine(): CaptureEngine {
  const db = new Database(':memory:');
  loadVec0(db);
  initSchema(db);
  return new CaptureEngine(db, {
    recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
    capture: { sensitivity: 'medium', max_tool_output_chars: 2048, dedup_window_seconds: 300 },
    decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 },
    storage: { max_semantic_memories: 500 },
  });
}

describe('CaptureEngine', () => {
  it('should redact API keys', () => {
    const engine = createEngine();
    const result = engine.redact('my api_key = sk-abc123def456ghi789jkl012');
    expect(result).not.toContain('sk-abc123');
    expect(result).toContain('API_KEY_REDACTED');
  });

  it('should redact AWS keys', () => {
    const engine = createEngine();
    const result = engine.redact('key is AKIA1234567890123456');
    expect(result).toContain('AWS_KEY_REDACTED');
  });

  it('should redact user home paths', () => {
    const engine = createEngine();
    const result = engine.redact('path is /Users/johndoe/projects/x');
    expect(result).toContain('/Users/[USER]/');
  });

  it('should detect correction patterns', () => {
    const engine = createEngine();
    const r = engine.detectPreferences('不对，这里应该用 async/await');
    expect(r?.patternType).toBe('correction');
  });

  it('should detect preference patterns', () => {
    const engine = createEngine();
    const r = engine.detectPreferences('我喜欢用 pytest');
    expect(r?.patternType).toBe('preference');
  });

  it('should detect decision patterns', () => {
    const engine = createEngine();
    const r = engine.detectPreferences('选择 FastAPI 因为性能好');
    expect(r?.patternType).toBe('decision');
  });

  it('should return null for normal chat', () => {
    const engine = createEngine();
    const r = engine.detectPreferences('帮我写一个排序算法');
    expect(r).toBeNull();
  });

  it('should skip read-only tools in observe', () => {
    const engine = createEngine();
    engine.observe('Read', '/some/file.ts');
    engine.observe('Glob', '**/*.ts');
    const db = (engine as any).db;
    const count = db.prepare('SELECT COUNT(*) as c FROM working_memories').get() as any;
    expect(count.c).toBe(0);
  });

  it('should write working memory for non-skipped tools', () => {
    const engine = createEngine();
    engine.observe('Edit', 'changed function to use async/await');
    const db = (engine as any).db;
    const count = db.prepare('SELECT COUNT(*) as c FROM working_memories').get() as any;
    expect(count.c).toBe(1);
  });
});
