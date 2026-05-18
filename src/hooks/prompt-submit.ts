import { sendToClio } from './ipc-client.js';

async function main() {
  const text = process.env.CLAUDE_USER_PROMPT ?? process.env.HOOK_USER_PROMPT ?? '';
  if (!text) return;

  // Detect preferences (fire and forget)
  sendToClio('detect_preferences', { text }).catch(() => {});

  // Recall relevant memories
  const memories = await sendToClio('recall_relevant', { text }) as string | undefined;
  if (memories) process.stdout.write(memories);
}

main().catch(() => process.exit(0));
