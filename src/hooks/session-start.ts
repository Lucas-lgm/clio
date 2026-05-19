import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { connect } from 'net';
import { sendToClio } from './ipc-client.js';

function getClioHome(): string {
  return process.env.CLIO_HOME ?? join(homedir(), '.clio');
}

function ensureDaemon(): Promise<void> {
  const pidFile = join(getClioHome(), 'clio.pid');
  const sockFile = join(getClioHome(), 'clio.sock');

  // Check if daemon is already running
  try {
    const pid = readFileSync(pidFile, 'utf-8').trim();
    if (pid) {
      try { process.kill(parseInt(pid, 10), 0); return Promise.resolve(); } catch { /* stale */ }
    }
  } catch { /* no pid file */ }

  // Start daemon
  return new Promise((resolve, reject) => {
    const serverPath = join(dirname(fileURLToPath(import.meta.url)), '../../dist/server.js');
    const proc = spawn('node', [serverPath], {
      env: { ...process.env, CLIO_HOME: getClioHome() },
      stdio: 'ignore',
      detached: true,
    });
    proc.unref();

    // Wait for socket to be ready
    const deadline = Date.now() + 5000;
    const poll = () => {
      if (Date.now() > deadline) { resolve(); return; }
      const sock = connect(sockFile, () => { sock.destroy(); resolve(); });
      sock.on('error', () => setTimeout(poll, 200));
    };
    setTimeout(poll, 500);
  });
}

async function main() {
  await ensureDaemon();
  const ctx = await sendToClio('recall_initial_context');
  if (ctx) process.stdout.write(ctx as string);
}

main().catch(() => process.exit(0));
