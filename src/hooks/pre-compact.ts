import { sendToClio } from './ipc-client.js';

async function main() {
  const sessionId = process.env.CLAUDE_SESSION_ID ?? 'unknown';
  await sendToClio('save_session_snapshot', { sessionId });
}

main().catch(() => process.exit(0));
