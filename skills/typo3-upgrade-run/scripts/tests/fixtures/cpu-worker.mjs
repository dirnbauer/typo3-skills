import { parentPort, threadId } from 'node:worker_threads';
parentPort.on('message', async ({ id, input }) => {
  if (input.crash) process.exit(2);
  if (input.hang) return;
  await new Promise(resolve => setTimeout(resolve, input.delay ?? 10));
  parentPort.postMessage({ id, value: { threadId, value: input.value } });
});
