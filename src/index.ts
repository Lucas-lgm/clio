#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ensureClioHome, CLIO_HOME } from './config.js';
import { getDb, closeDb } from './storage/database.js';
import { EmbeddingService } from './storage/embedding.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getClaudeConfigPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

async function cmdInstall() {
  console.log('[clio] installing...');

  // 1. Create ~/.clio/ structure
  ensureClioHome();

  // 2. Init SQLite database
  const db = getDb();
  console.log('[clio] database initialized');
  closeDb();

  // 3. Bundle bundled embedding model if present
  const bundledModels = join(__dirname, '..', 'bundled-models');
  if (existsSync(bundledModels)) {
    const targetModels = join(CLIO_HOME, 'models');
    cpSync(bundledModels, targetModels, { recursive: true, force: false });
    console.log('[clio] bundled models copied');
  }

  // 4. Write default config if not exists
  const configPath = join(CLIO_HOME, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({
      version: '0.1.0',
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: { sensitivity: 'medium', max_tool_output_chars: 2048, dedup_window_seconds: 300 },
      decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 },
      storage: { global_dir: CLIO_HOME, max_semantic_memories: 500 },
    }, null, 2));
    console.log('[clio] config created');
  }

  // 5. Update ~/.claude/settings.json
  const claudeConfigPath = getClaudeConfigPath();
  let claudeConfig: any = {};

  if (existsSync(claudeConfigPath)) {
    try { claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8')); } catch {}
  }

  const hooksDir = join(__dirname, 'hooks');

  claudeConfig.mcpServers = claudeConfig.mcpServers ?? {};
  claudeConfig.mcpServers.clio = {
    command: 'node',
    args: [process.argv[1].replace('index.js', 'server.js')],
    env: { CLIO_HOME },
  };

  claudeConfig.hooks = claudeConfig.hooks ?? {};
  for (const name of ['session-start', 'prompt-submit', 'post-tool-use', 'pre-compact', 'stop']) {
    claudeConfig.hooks[name === 'session-start' ? 'SessionStart'
      : name === 'prompt-submit' ? 'UserPromptSubmit'
      : name === 'post-tool-use' ? 'PostToolUse'
      : name === 'pre-compact' ? 'PreCompact'
      : 'Stop'] = `node ${join(hooksDir, `${name}.js`)}`;
  }

  const dir = dirname(claudeConfigPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
  console.log('[clio] claude config updated');

  console.log('\n✓ Clio installed successfully');
  console.log('  - Config: ' + configPath);
  console.log('  - Data: ' + join(CLIO_HOME, 'data'));
  console.log('  - Claude settings: ' + claudeConfigPath);
  console.log('\n  Start a new Claude Code session. Memory is automatic.');
}

async function cmdStatus() {
  const dbPath = join(CLIO_HOME, 'data', 'clio.db');
  if (!existsSync(dbPath)) {
    console.log('Clio is not installed. Run `clio install`');
    return;
  }

  const db = getDb();
  const memCount = (db.prepare('SELECT COUNT(*) as c FROM semantic_memories').get() as any).c;
  const instCount = (db.prepare("SELECT COUNT(*) as c FROM instincts WHERE status = 'pending'").get() as any).c;
  const profileCount = (db.prepare('SELECT COUNT(*) as c FROM profile').get() as any).c;
  closeDb();

  console.log(`Clio status:
  Semantic memories: ${memCount}
  Pending instincts: ${instCount}
  Profile entries:   ${profileCount}
  Data path:         ${dbPath}`);
}

async function cmdDownloadModels() {
  ensureClioHome();
  console.log('[clio] downloading embedding model: Xenova/all-MiniLM-L6-v2...');
  const embedding = new EmbeddingService();
  await embedding.load();
  console.log('[clio] embedding model downloaded and cached');
}

const cmd = process.argv[2];
if (cmd === 'install') cmdInstall().catch(console.error);
else if (cmd === 'status') cmdStatus().catch(console.error);
else if (cmd === 'download-models') cmdDownloadModels().catch(console.error);
else console.log('Usage: clio install | status | download-models');
