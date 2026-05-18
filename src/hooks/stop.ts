import { sendToClio } from './ipc-client.js';

async function main() {
  const sessionId = process.env.CLAUDE_SESSION_ID ?? 'unknown';
  await sendToClio('summarize_session', { sessionId });
}

main().catch(() => process.exit(0));
