import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { CaptureEngine, parseLooseJson, redact, detectPreferences } from '../src/engines/capture.js';

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

describe('parseLooseJson', () => {
  it('should parse valid JSON', () => {
    expect(parseLooseJson('[{"a": 1}]')).toEqual([{ a: 1 }]);
  });

  it('should parse with trailing commas', () => {
    expect(parseLooseJson('[1, 2, 3,]')).toEqual([1, 2, 3]);
    expect(parseLooseJson('{"a": 1,}')).toEqual({ a: 1 });
  });

  it('should parse unquoted keys', () => {
    expect(parseLooseJson('{key: "value"}')).toEqual({ key: 'value' });
  });

  it('should parse single quotes', () => {
    expect(parseLooseJson("{'a': 1}")).toEqual({ a: 1 });
  });

  it('should handle combined issues', () => {
    const result = parseLooseJson("{name: 'asyncpg',}") as any;
    expect(result.name).toBe('asyncpg');
  });

  it('should parse flat string array', () => {
    expect(parseLooseJson('["fact one", "fact two"]')).toEqual(['fact one', 'fact two']);
  });

  it('should throw on truly invalid input', () => {
    expect(() => parseLooseJson('not json at all {{{')).toThrow();
  });

  it('should handle JSON with markdown fences', () => {
    // parseLooseJson doesn't strip fences, that's done upstream — test the actual case
    const cleaned = '```json\n[{"a": 1}]\n```'.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    expect(parseLooseJson(cleaned)).toEqual([{ a: 1 }]);
  });
});

describe('CaptureEngine', () => {
  it('should redact API keys', () => {
    const engine = createEngine();
    const result = redact('my api_key = sk-abc123def456ghi789jkl012');
    expect(result).not.toContain('sk-abc123');
    expect(result).toContain('API_KEY_REDACTED');
  });

  it('should redact AWS keys', () => {
    const engine = createEngine();
    const result = redact('key is AKIA1234567890123456');
    expect(result).toContain('AWS_KEY_REDACTED');
  });

  it('should redact user home paths', () => {
    const engine = createEngine();
    const result = redact('path is /Users/johndoe/projects/x');
    expect(result).toContain('/Users/[USER]/');
  });

  it('should detect correction patterns', () => {
    const engine = createEngine();
    const r = detectPreferences('不对，这里应该用 async/await');
    expect(r?.patternType).toBe('correction');
  });

  it('should detect preference patterns', () => {
    const engine = createEngine();
    const r = detectPreferences('我喜欢用 pytest');
    expect(r?.patternType).toBe('preference');
  });

  it('should detect decision patterns', () => {
    const engine = createEngine();
    const r = detectPreferences('选择 FastAPI 因为性能好');
    expect(r?.patternType).toBe('decision');
  });

  it('should return null for normal chat', () => {
    const engine = createEngine();
    const r = detectPreferences('帮我写一个排序算法');
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

  it('should observe with custom sessionId', () => {
    const engine = createEngine();
    engine.observe('Write', 'some content', 'custom-session-1');
    const db = (engine as any).db;
    const row = db.prepare('SELECT session_id FROM working_memories').get() as any;
    expect(row.session_id).toBe('custom-session-1');
  });

  it('should skip content shorter than 10 chars', () => {
    const engine = createEngine();
    engine.observe('Write', 'short');
    const db = (engine as any).db;
    const count = db.prepare('SELECT COUNT(*) as c FROM working_memories').get() as any;
    expect(count.c).toBe(0);
  });

  it('should deduplicate identical content within window', () => {
    const engine = createEngine();
    engine.observe('Write', 'this is a test observation with enough length');
    engine.observe('Write', 'this is a test observation with enough length');
    const db = (engine as any).db;
    const count = db.prepare('SELECT COUNT(*) as c FROM working_memories').get() as any;
    expect(count.c).toBe(1);
  });

  it('should save session snapshot', () => {
    const engine = createEngine();
    engine.saveSnapshot({ sessionId: 'sess-1', toolCount: 5 });
    const db = (engine as any).db;
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('sess-1') as any;
    expect(row.id).toBe('sess-1');
    expect(row.tool_count).toBe(5);
  });

  it('should update existing session snapshot', () => {
    const engine = createEngine();
    engine.saveSnapshot({ sessionId: 'sess-1', toolCount: 3 });
    engine.saveSnapshot({ sessionId: 'sess-1', toolCount: 7 });
    const db = (engine as any).db;
    const row = db.prepare('SELECT tool_count FROM sessions WHERE id = ?').get('sess-1') as any;
    expect(row.tool_count).toBe(7);
  });

  it('should handle empty session in summarizeSession early return', async () => {
    const engine = createEngine();
    // No working memories for this session → early return
    await engine.summarizeSession('empty-session');
    // Should not throw, should not create semantic memories
    const db = (engine as any).db;
    const mems = db.prepare('SELECT COUNT(*) as c FROM semantic_memories').get() as any;
    expect(mems.c).toBe(0);
  });
});
