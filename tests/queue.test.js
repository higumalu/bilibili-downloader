import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DownloadQueue } from '../extension/queue.js';

async function fixture(initial = {}) {
  const data = structuredClone(initial), launched = [], commands = [];
  let next = 0;
  const q = new DownloadQueue({
    storage: {
      async get(keys) { return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(k => [k, structuredClone(data[k])])); },
      async set(values) { Object.assign(data, structuredClone(values)); }
    },
    id: () => `task-${++next}`,
    launch(job, entry) {
      launched.push(job.id);
      entry.port = { postMessage: command => commands.push({ id: job.id, ...command }), disconnect() {} };
    }
  });
  await q.init();
  const add = n => q.transaction(() => q.add({ url: `https://www.bilibili.com/video/BV${n}/?p=1`, title: `Video ${n}`, height: 720 }));
  return { q, data, launched, commands, add };
}

test('two videos start, a third waits, completion fills the available slot', async () => {
  const { q, launched, add } = await fixture();
  await add(1); await add(2); await add(3);
  assert.equal(q.active.size, 2);
  assert.equal(q.jobs[2].type, 'queued');
  assert.deepEqual(launched, ['task-1', 'task-2']);
  await q.transaction(() => q.update('task-1', { type: 'done', path: 'D:\\one.mp4' }));
  assert.equal(q.jobs[2].type, 'progress');
  assert.equal(q.active.size, 2);
  assert.deepEqual(launched, ['task-1', 'task-2', 'task-3']);
});

test('cancelling one active video leaves the other transfer alone', async () => {
  const { q, commands, add } = await fixture();
  await add(1); await add(2); await add(3);
  await q.transaction(() => q.cancel('task-1'));
  assert.deepEqual(commands, [{ id: 'task-1', command: 'cancel' }]);
  assert.equal(q.jobs[1].type, 'progress');
  assert.equal(q.jobs[2].type, 'queued');
  await q.transaction(() => q.update('task-1', { type: 'cancelled' }));
  assert.equal(q.jobs[2].type, 'progress');
});

test('cancelling a waiting task never starts it', async () => {
  const { q, launched, add } = await fixture();
  await add(1); await add(2); await add(3);
  await q.transaction(() => q.cancel('task-3'));
  await q.transaction(() => q.update('task-1', { type: 'done' }));
  assert.equal(q.jobs[2].type, 'cancelled');
  assert.deepEqual(launched, ['task-1', 'task-2']);
});

test('duplicate video is rejected and per-task retry rejoins the queue', async () => {
  const { q, add } = await fixture();
  await add(1);
  await assert.rejects(add(1), { errorKey: 'errorDuplicate' });
  await q.transaction(() => q.update('task-1', { type: 'error', messageKey: 'errorNodes' }));
  await q.transaction(() => q.retry('task-1', 'en'));
  assert.equal(q.jobs.length, 1);
  assert.equal(q.jobs[0].type, 'progress');
});

test('restart pauses both active and queued tasks until explicit resume', async () => {
  const { q, launched } = await fixture({ queue: [
    { id: 'one', url: 'one', type: 'progress' },
    { id: 'two', url: 'two', type: 'queued' },
    { id: 'done', url: 'done', type: 'done' }
  ] });
  assert.deepEqual(q.jobs.map(j => j.type), ['interrupted', 'interrupted', 'done']);
  assert.equal(launched.length, 0);
  await q.transaction(() => q.resume('en'));
  assert.equal(launched.length, 2);
});

test('lowering concurrency keeps existing transfers and delays the next start', async () => {
  const { q, add } = await fixture();
  await add(1); await add(2); await add(3);
  q.concurrency = 1;
  await q.transaction(() => q.pump());
  assert.equal(q.active.size, 2);
  await q.transaction(() => q.update('task-1', { type: 'done' }));
  assert.equal(q.jobs[2].type, 'queued');
  await q.transaction(() => q.update('task-2', { type: 'done' }));
  assert.equal(q.jobs[2].type, 'progress');
});

test('clearing finished jobs keeps running, queued and interrupted work', async () => {
  const { q, add } = await fixture();
  await add(1); await add(2); await add(3);
  await q.transaction(() => q.update('task-1', { type: 'done' }));
  await q.transaction(() => q.clearFinished());
  assert.deepEqual(q.jobs.map(j => j.id), ['task-2', 'task-3']);
});
