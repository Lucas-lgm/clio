import { createServer, Socket } from 'net';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { getClioHome } from '../config.js';
import type { IpcRequest, IpcResponse } from './protocol.js';

export function getSocketPath(): string {
  return join(getClioHome(), 'clio.sock');
}

export type RequestHandler = (req: IpcRequest) => Promise<IpcResponse>;

export function startIpcServer(handler: RequestHandler): Promise<string> {
  const SOCKET_PATH = getSocketPath();
  return new Promise((resolve, reject) => {
    if (existsSync(SOCKET_PATH)) {
      try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    }

    const server = createServer((socket: Socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx === -1) return;

        const raw = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        try {
          const req: IpcRequest = JSON.parse(raw);
          handler(req).then((resp) => {
            socket.write(JSON.stringify(resp) + '\n');
          }).catch((err) => {
            socket.write(JSON.stringify({ id: req.id, success: false, error: err.message } satisfies IpcResponse) + '\n');
          });
        } catch (err) {
          socket.write(JSON.stringify({ id: '', success: false, error: 'invalid request' } satisfies IpcResponse) + '\n');
        }
      });
    });

    server.on('error', reject);
    server.listen(SOCKET_PATH, () => resolve(SOCKET_PATH));
  });
}
