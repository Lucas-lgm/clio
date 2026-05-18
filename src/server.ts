import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getDb } from './storage/database.js';
import { startIpcServer } from './ipc/server.js';
import { loadConfig, ensureClioHome } from './config.js';
import type { IpcRequest, IpcResponse } from './ipc/protocol.js';
import { EmbeddingService } from './storage/embedding.js';
import { CaptureEngine } from './engines/capture.js';
import { RecallEngine } from './engines/recall.js';
import { InstinctEngine } from './engines/instinct.js';
import { DecayEngine } from './engines/decay.js';
import { ProfileEngine } from './engines/profile.js';

const config = loadConfig();
const db = getDb();

console.error('[clio] starting...');
ensureClioHome();

const embedding = new EmbeddingService();
const capture = new CaptureEngine(db, config);
const recall = new RecallEngine(db, config, embedding);
const instinct = new InstinctEngine(db);
const decay = new DecayEngine(db, config);
const profile = new ProfileEngine(db);

async function handleIpcRequest(req: IpcRequest): Promise<IpcResponse> {
  try {
    const { type, payload } = req;
    switch (type) {
      case 'capture_observation':
        capture.observe(payload['toolName'] as string, payload['toolOutput'] as string);
        return { id: req.id, success: true };
      case 'detect_preferences':
        return { id: req.id, success: true, data: capture.detectPreferences(payload['text'] as string) };
      case 'recall_initial_context':
        return { id: req.id, success: true, data: recall.getInitialContext() };
      case 'recall_relevant':
        return { id: req.id, success: true, data: await recall.recallRelevant(payload['text'] as string) };
      case 'summarize_session':
        await capture.summarizeSession(payload['sessionId'] as string, instinct, decay, profile);
        return { id: req.id, success: true };
      case 'save_session_snapshot':
        capture.saveSnapshot(payload as { sessionId: string; toolCount?: number });
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
  console.error(`[clio] ipc socket ready: ${socketPath}`);

  // Load embedding model (async)
  console.error('[clio] loading embedding model...');
  await embedding.load();
  console.error('[clio] embedding model loaded');

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
  console.error('[clio] mcp server ready');
}

main().catch((err) => {
  console.error('[clio] fatal:', err);
  process.exit(1);
});
