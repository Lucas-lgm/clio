import { sendToClio } from './ipc-client.js';

async function main() {
  const toolName = process.env.CLAUDE_TOOL_NAME;
  const toolOutput = process.env.CLAUDE_TOOL_OUTPUT ?? '';
  const sessionId = process.env.CLAUDE_SESSION_ID ?? 'unknown';

  if (!toolName) return;

  await sendToClio('capture_observation', { toolName, toolOutput, sessionId });
}

main().catch(() => process.exit(0));
