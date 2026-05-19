import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from './storage/database.js';
import { startIpcServer } from './ipc/server.js';
import { loadConfig, ensureClioHome, getClioHome } from './config.js';
import type { IpcRequest, IpcResponse } from './ipc/protocol.js';
import { EmbeddingService } from './storage/embedding.js';
import { CaptureEngine, detectPreferences } from './engines/capture.js';
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
      case 'detect_preferences': {
        const result = detectPreferences(payload['text'] as string);
        if (result) {
          capture.capturePreference(
            payload['text'] as string,
            result.patternType!,
            payload['sessionId'] as string | undefined,
          );
        }
        return { id: req.id, success: true, data: result };
      }
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

  // Start MCP server
  const server = new Server({ name: 'clio', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'memorize', description: 'Manually write a memory', inputSchema: { type: 'object', properties: { content: { type: 'string' }, memoryType: { type: 'string' }, topic: { type: 'string' }, value: { type: 'string' } }, required: ['content', 'memoryType'] } },
      { name: 'recall', description: 'Search memories by query', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'forget', description: 'Delete a memory by id', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
      { name: 'get_profile', description: 'Get user profile summary', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_instincts', description: 'List pending instincts', inputSchema: { type: 'object', properties: {} } },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    switch (name) {
      case 'memorize': {
        const { content, memoryType, topic, value } = args as any;
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO semantic_memories (id, content, memory_type, topic, value, confidence)
          VALUES (?, ?, ?, ?, ?, 0.7)`).run(id, content, memoryType, topic ?? null, value ?? null);
        return { content: [{ type: 'text', text: `memory saved: ${id}` }] };
      }
      case 'recall': {
        const { query } = args as any;
        const results = await recall.recallRelevant(query);
        return { content: [{ type: 'text', text: results }] };
      }
      case 'forget': {
        const { id } = args as any;
        db.prepare('DELETE FROM semantic_memories WHERE id = ?').run(id);
        return { content: [{ type: 'text', text: 'deleted' }] };
      }
      case 'get_profile': {
        const rows = db.prepare('SELECT * FROM profile ORDER BY confidence DESC').all();
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
      }
      case 'list_instincts': {
        const rows = db.prepare("SELECT * FROM instincts WHERE status = 'pending' ORDER BY confidence DESC").all();
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('mcp server ready');
}

main().catch((err) => {
  logger.error('fatal:', err);
  process.exit(1);
});
