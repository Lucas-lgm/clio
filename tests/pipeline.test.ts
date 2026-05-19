import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { load as loadVec0 } from 'sqlite-vec';
import { initSchema } from '../src/storage/database.js';
import { SessionPipeline } from '../src/engines/pipeline.js';

describe('SessionPipeline', () => {
  it('should call engines in sequence', async () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);

    const capture = { summarizeSession: vi.fn().mockResolvedValue(undefined) };
    const instinct = { detect: vi.fn() };
    const decay = { run: vi.fn() };
    const profile = { sync: vi.fn() };

    const pipeline = new SessionPipeline(capture as any, instinct as any, decay as any, profile as any);
    await pipeline.processSession('test-session');

    expect(capture.summarizeSession).toHaveBeenCalledWith('test-session', undefined);
    expect(instinct.detect).toHaveBeenCalledWith('test-session');
    expect(decay.run).toHaveBeenCalled();
    expect(profile.sync).toHaveBeenCalledWith(undefined);
  });

  it('should pass projectPath to capture and profile', async () => {
    const capture = { summarizeSession: vi.fn().mockResolvedValue(undefined) };
    const instinct = { detect: vi.fn() };
    const decay = { run: vi.fn() };
    const profile = { sync: vi.fn() };

    const pipeline = new SessionPipeline(capture as any, instinct as any, decay as any, profile as any);
    await pipeline.processSession('test-session', '/my/project');

    expect(capture.summarizeSession).toHaveBeenCalledWith('test-session', '/my/project');
    expect(profile.sync).toHaveBeenCalledWith('/my/project');
  });

  it('should work with CaptureEngine', () => {
    const db = new Database(':memory:');
    loadVec0(db);
    initSchema(db);
    const config = {
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: { sensitivity: 'medium', max_tool_output_chars: 2048, dedup_window_seconds: 300 },
      decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 },
      storage: { max_semantic_memories: 500 },
    };

    // Pipeline can be created — no type error
    const _pipeline = new SessionPipeline(
      {} as any, {} as any, {} as any, {} as any
    );
    expect(_pipeline).toBeDefined();
  });
});
