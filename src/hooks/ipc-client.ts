import { connect } from 'net';
import { getSocketPath } from '../ipc/server.js';
import type { IpcRequest, IpcResponse } from '../ipc/protocol.js';
import { logger } from '../logger.js';

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
      logger.error(`ipc error: ${err}`);
      reject(err);
    });
    setTimeout(() => {
      client.destroy();
      logger.error(`ipc timeout: ${type}`);
      reject(new Error('timeout'));
    }, 5000);
  });
}
