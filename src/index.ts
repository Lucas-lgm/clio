#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { ensureClioHome, getClioHome } from './config.js';
import { getDb, closeDb } from './storage/database.js';
import { EmbeddingService } from './storage/embedding.js';
import { exportEnvironment } from './export.js';
import { importEnvironment } from './import.js';
import type { CountResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getClaudeConfigPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

async function cmdInstall() {
  const home = getClioHome();
  console.log(`[clio] installing (home: ${home})...`);

  // 1. Create directory structure
  ensureClioHome();

  // 2. Init SQLite database
  const db = getDb();
  console.log('[clio] database initialized');
  closeDb();

  // 3. Bundle bundled embedding model if present
  const bundledModels = join(__dirname, '..', 'bundled-models');
  if (existsSync(bundledModels)) {
    const targetModels = join(home, 'models');
    cpSync(bundledModels, targetModels, { recursive: true, force: false });
    console.log('[clio] bundled models copied');
  }

  // 4. Write default config if not exists
  const configPath = join(home, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify({
      version: '0.1.0',
      recall: { budget_session_start: 500, budget_per_query: 300, top_k_startup: 5, top_k_realtime: 3 },
      capture: { sensitivity: 'medium', max_tool_output_chars: 2048, dedup_window_seconds: 300 },
      decay: { confidence_decay_per_30d: 0.1, archive_threshold: 0.1, instinct_ttl_days: 30 },
      storage: { global_dir: home, max_semantic_memories: 500 },
    }, null, 2));
    console.log('[clio] config created');
  }

  // 5. Update ~/.claude/settings.json
  const claudeConfigPath = getClaudeConfigPath();
  let claudeConfig: Record<string, unknown> = {};

  if (existsSync(claudeConfigPath)) {
    try { claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8')); } catch {}
  }

  const hooksDir = join(__dirname, 'hooks');

  const mcpServers = (claudeConfig.mcpServers as Record<string, unknown>) ?? {};
  mcpServers.clio = {
    command: 'node',
    args: [join(__dirname, 'server.js')],
    env: { CLIO_HOME: home },
  };
  claudeConfig.mcpServers = mcpServers;

  const hooks = (claudeConfig.hooks as Record<string, unknown>) ?? {};
  const hookConfig: Array<{ key: string; name: string }> = [
    { key: 'SessionStart', name: 'session-start' },
    { key: 'UserPromptSubmit', name: 'prompt-submit' },
    { key: 'PostToolUse', name: 'post-tool-use' },
    { key: 'PreCompact', name: 'pre-compact' },
    { key: 'Stop', name: 'stop' },
  ];
  for (const { key, name } of hookConfig) {
    hooks[key] = [
      {
        hooks: [
          {
            type: 'command',
            command: `CLIO_HOME=${home} node ${join(hooksDir, `${name}.js`)}`,
          },
        ],
      },
    ];
  }
  claudeConfig.hooks = hooks;

  const dir = dirname(claudeConfigPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
  console.log('[clio] claude config updated');

  console.log('\n✓ Clio installed successfully');
  console.log('  - Home: ' + home);
  console.log('  - Config: ' + configPath);
  console.log('  - Data: ' + join(home, 'data'));
  console.log('  - Claude settings: ' + claudeConfigPath);
  console.log('\n  Start a new Claude Code session. Memory is automatic.');
}

async function cmdStatus() {
  const home = getClioHome();
  const dbPath = join(home, 'data', 'clio.db');
  if (!existsSync(dbPath)) {
    console.log('Clio is not installed. Run `clio install`');
    return;
  }

  const db = getDb();
  const memCount = (db.prepare('SELECT COUNT(*) as c FROM semantic_memories').get() as CountResult).c;
  const instCount = (db.prepare("SELECT COUNT(*) as c FROM instincts WHERE status = 'pending'").get() as CountResult).c;
  const profileCount = (db.prepare('SELECT COUNT(*) as c FROM profile').get() as CountResult).c;
  const sessionCount = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as CountResult).c;
  closeDb();

  // User skills count
  const userSkillsDir = join(homedir(), '.claude', 'skills');
  let skillCount = 0;
  try { skillCount = readdirSync(userSkillsDir).filter(f => f.endsWith('.md')).length; } catch {}

  const dbSize = existsSync(dbPath) ? (readFileSync(dbPath).length / 1024).toFixed(0) : '0';

  console.log(`Clio status:
  Home:              ${home}
  DB size:           ${dbSize} KB
  Sessions:          ${sessionCount}
  Semantic memories: ${memCount}
  Pending instincts: ${instCount}
  Profile entries:   ${profileCount}
  User skills:       ${skillCount}`);
}

async function cmdExport() {
  const outPath = process.argv[3] || join(process.cwd(), `clio-env-${new Date().toISOString().slice(0, 10)}.tar.gz`);
  console.log(`[clio] exporting environment to ${outPath}...`);
  const result = exportEnvironment(outPath);
  console.log(`\n✓ Exported: ${result}`);
}

async function cmdImport() {
  const inputPath = process.argv[3];
  if (!inputPath) {
    console.error('Usage: clio import <archive.tar.gz> [--dry-run] [--force]');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  try {
    importEnvironment(inputPath, { dryRun, force });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ Import failed: ${message}`);
    process.exit(1);
  }
}

async function cmdStart() {
  const home = getClioHome();
  ensureClioHome();
  const pidFile = join(home, 'clio.pid');
  const socketPath = join(home, 'clio.sock');
  const logFile = join(home, 'logs', 'daemon.log');

  // Check if already running
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0);
      console.log(`[clio] daemon already running (pid ${pid})`);
      return;
    } catch { /* stale pid */ }
    rmSync(pidFile);
  }

  const serverPath = join(dirname(fileURLToPath(import.meta.url)), 'server.js');
  const child = spawn('node', [serverPath], {
    env: { ...process.env, CLIO_HOME: home },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  // Wait for socket to appear (timeout 10s)
  const childPid = child.pid!;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { process.kill(childPid, 0); } catch {
      console.error('[clio] daemon exited immediately');
      process.exit(1);
    }
    if (existsSync(socketPath)) {
      writeFileSync(pidFile, String(childPid));
      console.log(`[clio] daemon started (pid ${childPid})`);
      console.log(`[clio] socket: ${socketPath}`);
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.error('[clio] daemon socket not ready within 10s (check logs)');
  process.exit(1);
}

async function cmdStop() {
  const home = getClioHome();
  const pidFile = join(home, 'clio.pid');
  const socketPath = join(home, 'clio.sock');

  if (!existsSync(pidFile)) {
    console.log('[clio] no running daemon found');
    return;
  }

  const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    // Wait for process to exit
    const maxWait = Date.now() + 5000;
    while (Date.now() < maxWait) {
      try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 100)); } catch { break; }
    }
  } catch {
    console.log('[clio] daemon not running (stale pid)');
  }

  rmSync(pidFile, { force: true });
  rmSync(socketPath, { force: true });
  console.log('[clio] daemon stopped');
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
else if (cmd === 'start') cmdStart().catch(console.error);
else if (cmd === 'stop') cmdStop().catch(console.error);
else if (cmd === 'download-models') cmdDownloadModels().catch(console.error);
else if (cmd === 'export') cmdExport().catch(console.error);
else if (cmd === 'import') cmdImport();
else console.log('Usage: clio install | start | stop | status | download-models | export | import');
