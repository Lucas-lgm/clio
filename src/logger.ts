import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getClioHome } from './config.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

class Logger {
  private logPath: string | null = null;

  constructor() {
    try {
      const logDir = join(getClioHome(), 'logs');
      mkdirSync(logDir, { recursive: true });
      this.logPath = join(logDir, 'clio.log');
    } catch {
      // No clio home — console only
    }
  }

  private write(level: LogLevel, ...args: unknown[]): void {
    const message = args.map(a => (typeof a === 'object' ? String(a) : a)).join(' ');
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const line = `[${timestamp}] [${level}] ${message}`;

    if (this.logPath) {
      try { appendFileSync(this.logPath, line + '\n'); } catch { /* skip */ }
    }

    console.error(line);
  }

  info(...args: unknown[]): void { this.write('INFO', ...args); }
  warn(...args: unknown[]): void { this.write('WARN', ...args); }
  error(...args: unknown[]): void { this.write('ERROR', ...args); }
}

export const logger = new Logger();
