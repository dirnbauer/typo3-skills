import { parentPort } from 'node:worker_threads';
import { comparePairPixelmatch } from './image.mjs';

parentPort.on('message', async ({ id, input }) => {
  try {
    const value = await comparePairPixelmatch(input.before, input.after, input.diff, input.options);
    parentPort.postMessage({ id, value });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
