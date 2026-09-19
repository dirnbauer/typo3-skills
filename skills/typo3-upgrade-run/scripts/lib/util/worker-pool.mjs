/** Lazy bounded CPU pool. A crashed/timed-out worker fails outstanding work, never skips it. */
import { Worker } from 'node:worker_threads';

export class WorkerPool {
  constructor(url, { size = 4, timeoutMs = 120_000 } = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 16) throw new Error('Worker pool size must be 1..16');
    this.url = url; this.size = size; this.timeoutMs = timeoutMs;
    this.queue = []; this.workers = []; this.terminations = []; this.failure = null; this.closed = false; this.sequence = 0;
  }
  run(input) {
    if (this.closed || this.failure) return Promise.reject(this.failure ?? new Error('Worker pool closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.sequence, input, resolve, reject });
      this.drain();
    });
  }
  drain() {
    if (this.closed || this.failure) return;
    while (this.queue.length) {
      let slot = this.workers.find(worker => !worker.task);
      if (!slot) {
        if (this.workers.length >= this.size) return;
        try { slot = { worker: new Worker(this.url), task: null }; }
        catch (error) { this.fail(error); return; }
        this.workers.push(slot);
        const current = slot;
        slot.worker.on('message', message => {
          const task = current.task;
          if (!task || message?.id !== task.id) { this.fail(new Error('Worker returned an unexpected job id')); return; }
          clearTimeout(current.timer); current.task = null;
          if (message.error) task.reject(new Error(message.error));
          else if (!Object.hasOwn(message, 'value')) task.reject(new Error('Worker result missing'));
          else task.resolve(message.value);
          this.drain();
        });
        slot.worker.on('error', error => this.fail(error));
        slot.worker.on('exit', code => {
          if (!this.closed && !this.failure) this.fail(new Error(`CPU worker exited unexpectedly (${code})`));
        });
      }
      slot.task = this.queue.shift();
      slot.timer = setTimeout(() => this.fail(new Error('CPU worker timed out')), this.timeoutMs);
      try { slot.worker.postMessage({ id: slot.task.id, input: slot.task.input }); }
      catch (error) { this.fail(error); return; }
    }
  }
  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const task of this.queue.splice(0)) task.reject(error);
    for (const slot of this.workers) {
      clearTimeout(slot.timer); slot.task?.reject(error); slot.task = null;
      this.terminations.push(slot.worker.terminate());
    }
  }
  async close() {
    if (!this.closed) { this.closed = true; this.fail(new Error('Worker pool closed')); }
    await Promise.all(this.terminations);
  }
}
