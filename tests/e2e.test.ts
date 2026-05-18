import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

const DIST = join(__dirname, '..', 'dist');
const SERVER = join(DIST, 'server.js');

describe('Clio E2E', () => {
  afterAll(() => {
    const sock = '/tmp/clio-test-e2e/clio.sock';
    if (existsSync(sock)) unlinkSync(sock);
  });

  it('should start and respond to IPC requests', async () => {
    const proc = spawn('node', [SERVER], {
      env: { ...process.env, CLIO_HOME: '/tmp/clio-test-e2e', NODE_ENV: 'test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for socket to be ready
    await new Promise<void>((resolve) => {
      proc.stderr!.on('data', (data: Buffer) => {
        const text = data.toString();
        if (text.includes('ipc socket ready')) resolve();
      });
      setTimeout(resolve, 3000);
    });

    const { connect } = await import('net');
    const result = await new Promise((resolve, reject) => {
      const client = connect('/tmp/clio-test-e2e/clio.sock', () => {
        client.write(JSON.stringify({ id: 'test-1', type: 'recall_initial_context', payload: {} }) + '\n');
      });
      let buf = '';
      client.on('data', (chunk) => {
        buf += chunk;
        const nl = buf.indexOf('\n');
        if (nl >= 0) {
          resolve(JSON.parse(buf.slice(0, nl)));
          client.destroy();
        }
      });
      client.on('error', reject);
      setTimeout(() => { client.destroy(); reject(new Error('timeout')); }, 3000);
    });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('id', 'test-1');

    proc.kill();
  });
});
