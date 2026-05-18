import { sendToClio } from './ipc-client.js';

async function main() {
  const ctx = await sendToClio('recall_initial_context');
  if (ctx) process.stdout.write(ctx as string);
}

main().catch(() => process.exit(0));
