import { connect } from 'net';
import { getSocketPath } from '../ipc/server.js';
import type { IpcRequest, IpcResponse } from '../ipc/protocol.js';
import { logger } from '../logger.js';

const REQUEST_TIMEOUT: Partial<Record<IpcRequest['type'], number>> = {
  summarize_session: 120000, // LLM call can take 2 minutes
};

export function sendToClio(type: IpcRequest['type'], payload: Record<string, unknown> = {}, projectPath?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (projectPath) payload.projectPath = projectPath;
    const client = connect(getSocketPath(), () => {
      const req: IpcRequest = { id: crypto.randomUUID(), type, payload };
      client.write(JSON.stringify(req) + '\n');
    });

    let buffer = '';
    client.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      clearTimeout(timer);
      try {
        const resp: IpcResponse = JSON.parse(buffer.slice(0, newlineIdx));
        client.destroy();
        if (resp.success) resolve(resp.data);
        else reject(new Error(resp.error));
      } catch {
        client.destroy();
        reject(new Error('invalid response'));
      }
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      logger.error(`ipc error: ${err}`);
      reject(err);
    });
    const timer = setTimeout(() => {
      client.destroy();
      logger.error(`ipc timeout: ${type}`);
      reject(new Error('timeout'));
    }, REQUEST_TIMEOUT[type] ?? 5000);
  });
}
