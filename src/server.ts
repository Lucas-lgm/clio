import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from './storage/database.js';
import { startIpcServer } from './ipc/server.js';
import { loadConfig, ensureClioHome, getClioHome } from './config.js';
import type { IpcRequest, IpcResponse } from './ipc/protocol.js';
import { EmbeddingService } from './storage/embedding.js';
import { CaptureEngine } from './engines/capture.js';
import { RecallEngine } from './engines/recall.js';
import { InstinctEngine } from './engines/instinct.js';
import { DecayEngine } from './engines/decay.js';
import { ProfileEngine } from './engines/profile.js';
import { SessionPipeline } from './engines/pipeline.js';
import { logger } from './logger.js';

const config = loadConfig();
ensureClioHome();

// Lock: kill any existing daemon, then start fresh
const clioHome = getClioHome();
const pidFile = join(clioHome, 'clio.pid');
const socketFile = join(clioHome, 'clio.sock');
try {
  const existing = readFileSync(pidFile, 'utf-8').trim();
  if (existing) {
    try { process.kill(parseInt(existing, 10), 'SIGTERM'); } catch { /* stale */ }
  }
} catch { /* no pid file */ }
// Clean up stale socket
if (existsSync(socketFile)) unlinkSync(socketFile);
// Write our PID
writeFileSync(pidFile, String(process.pid));
// Don't clean up pidFile on exit — a replacement daemon will overwrite it
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

const db = getDb();

logger.info('starting...');

const embedding = new EmbeddingService();
const capture = new CaptureEngine(db, config, embedding);
const recall = new RecallEngine(db, config, embedding);
const instinct = new InstinctEngine(db);
const decay = new DecayEngine(db, config);
const profile = new ProfileEngine(db);
const pipeline = new SessionPipeline(capture, instinct, decay, profile);

async function handleIpcRequest(req: IpcRequest): Promise<IpcResponse> {
  try {
    const { type, payload } = req;
    const projectPath = payload['projectPath'] as string | undefined;
    switch (type) {
      case 'capture_observation':
        capture.observe(payload['toolName'] as string, payload['toolOutput'] as string, payload['sessionId'] as string | undefined);
        return { id: req.id, success: true };
      case 'capture_user_prompt':
        capture.captureUserPrompt(payload['text'] as string, payload['sessionId'] as string | undefined);
        return { id: req.id, success: true };
      case 'recall_initial_context':
        return { id: req.id, success: true, data: recall.getInitialContext(projectPath) };
      case 'recall_relevant':
        return { id: req.id, success: true, data: await recall.recallRelevant(payload['text'] as string, projectPath) };
      case 'summarize_session':
        await pipeline.processSession(payload['sessionId'] as string, projectPath);
        return { id: req.id, success: true };
      case 'save_session_snapshot':
        capture.saveSnapshot({ ...payload as any, projectPath });
        return { id: req.id, success: true };
      default:
        return { id: req.id, success: false, error: 'unknown request type' };
    }
  } catch (err: any) {
    return { id: req.id, success: false, error: err.message };
  }
}

async function main() {
  // Start IPC for hook scripts
  const socketPath = await startIpcServer(handleIpcRequest);
  logger.info(`ipc socket ready: ${socketPath}`);

  // Load embedding model (async, non-fatal on failure)
  logger.info('loading embedding model...');
  try {
    await embedding.load();
  } catch (err) {
    logger.warn('embedding model load failed (vector search disabled):', err);
  }
}

main().catch((err) => {
  logger.error('fatal:', err);
  process.exit(1);
});
