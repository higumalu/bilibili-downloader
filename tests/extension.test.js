import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DownloadQueue } from '../extension/queue.js';

const root = new URL('../', import.meta.url);
const source = (await readFile(new URL('extension/background.js', root), 'utf8')).replace(/^import[^\n]+\n/, '');

function worker(initial = {}, tabUrl = 'https://www.bilibili.com/video/BV123/') {
  const data = { ...initial }, sent = [];
  let listener;
  const ports = [];
  const chrome = {
    storage: { local: {
      async get(keys) {
        return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, data[key]]));
      },
      async set(values) { Object.assign(data, values); }
    } },
    tabs: {
      async query() { return [{ id: 1, url: tabUrl, title: 'Public video' }]; },
      async get() { return { id: 1, url: tabUrl }; }
    },
    scripting: { async executeScript() {
      return [{ result: { title: 'Public video', bvid: 'BV123', page: 1,
        streams: { video: [{ baseUrl: 'https://cdn.bilivideo.com/video?secret=temporary' }] } } }];
    } },
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      connectNative() { const port = {
        messages: [],
        postMessage(message) { sent.push(message); port.messages.push(message); },
        onMessage: { addListener(callback) { port.incoming = callback; } },
        onDisconnect: { addListener(callback) { port.disconnected = callback; } },
        disconnect() { port.disconnected?.(); }
      }; ports.push(port); return port; }
    }
  };
  const context = vm.createContext({ chrome, URL, Date, Boolean, encodeURIComponent, Error, DownloadQueue });
  vm.runInContext(source, context);
  return {
    data, sent, ports,
    setTab(url) { tabUrl = url; },
    request: command => new Promise(resolve => listener(command, {}, resolve)),
    async native(message, index = 0) { ports[index].incoming(message); await vm.runInContext('queue.chain', context); },
    async disconnect() { ports[0].disconnected(); await vm.runInContext('queue.chain', context); },
    async flush() { await new Promise(resolve => setImmediate(resolve)); await vm.runInContext('queue.chain', context); }
  };
}

test('concurrent clicks start only one job, and signed URLs are never persisted', async () => {
  const w = worker();
  const results = await Promise.all([w.request({ command: 'download', height: 720 }), w.request({ command: 'download', height: 720 })]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(w.sent.filter(m => m.command === 'download').length, 1);
  assert.equal(w.data.queue[0].height, 720);
  assert.ok(!JSON.stringify(w.data).includes('secret=temporary'));
});

test('non-Bilibili and lookalike domains cannot start downloads', async () => {
  for (const url of ['https://example.com/video/BV123', 'https://bilibili.com.evil.test/video/BV123']) {
    const w = worker({}, url);
    assert.equal((await w.request({ command: 'download' })).errorKey, 'errorUrl');
    assert.equal(w.sent.length, 0);
  }
});

test('retry refreshes metadata without requiring the original tab', async () => {
  const w = worker({ lastDownload: { url: 'https://www.bilibili.com/video/BV123/?p=2', height: 480, title: 'Saved' } }, 'https://example.com');
  await w.request({ command: 'get_settings' });
  assert.equal((await w.request({ command: 'retry', id: w.data.queue[0].id })).ok, true);
  await w.flush();
  const request = w.sent.find(m => m.command === 'download');
  assert.equal(request.height, 480);
  assert.ok(request.url.endsWith('?p=2'));
  assert.equal(request.info.streams, undefined);
});

test('native settings recover stale progress without restarting automatically', async () => {
  const w = worker({ state: { type: 'progress', title: 'Old task' }, lastDownload: { title: 'Old task', url: 'https://www.bilibili.com/video/BV123/' } });
  await w.request({ command: 'get_settings' });
  await w.native({ type: 'settings', busy: false, choosing: false });
  assert.equal(w.data.queue[0].type, 'interrupted');
  assert.ok(!w.sent.some(m => m.command === 'download'));
});

test('completed history is bounded and clearing it preserves retry metadata', async () => {
  const w = worker({ history: Array(20).fill({ type: 'done' }) });
  await w.request({ command: 'download' });
  await w.flush();
  await w.native({ type: 'done', title: 'Video', path: 'D:\\Videos\\test.mp4' });
  assert.equal(w.data.history.length, 20);
  assert.equal(w.data.history[0].path, 'D:\\Videos\\test.mp4');
  await w.request({ command: 'clear_history' });
  assert.equal(w.data.history.length, 0);
  assert.equal(w.data.queue.length, 1);
});

test('idle helper disconnect preserves completed download information', async () => {
  const w = worker({ state: { type: 'done', path: 'D:\\video.mp4' } });
  await w.request({ command: 'ping' });
  await w.disconnect();
  assert.equal(w.data.state.type, 'done');
  assert.equal(w.data.settings.errorKey, 'errorHelper');
});

test('separate native ports isolate cancellation and start the next queued video', async () => {
  const w = worker();
  await w.request({ command: 'download' }); await w.flush();
  w.setTab('https://www.bilibili.com/video/BV456/');
  await w.request({ command: 'download' }); await w.flush();
  w.setTab('https://www.bilibili.com/video/BV789/');
  await w.request({ command: 'download' }); await w.flush();
  assert.equal(w.ports.length, 2);
  assert.equal(w.data.queue[2].type, 'queued');
  await w.request({ command: 'cancel', id: w.data.queue[0].id });
  assert.equal(w.sent.filter(m => m.command === 'cancel').length, 1);
  assert.equal(w.ports[0].messages.at(-1).command, 'cancel');
  assert.ok(!w.ports[1].messages.some(m => m.command === 'cancel'));
  await w.native({ type: 'cancelled', messageKey: 'cancelled' }, 0);
  await w.flush();
  assert.equal(w.ports.length, 3);
  assert.equal(w.data.queue[1].type, 'progress');
  assert.equal(w.data.queue[2].type, 'progress');
});

test('folder changes are blocked while a different native process is downloading', async () => {
  const w = worker();
  await w.request({ command: 'download' }); await w.flush();
  assert.equal((await w.request({ command: 'choose_directory' })).errorKey, 'errorBusyFolder');
});

test('both catalogs have identical keys and interpolation fields', async () => {
  const read = async locale => JSON.parse(await readFile(new URL(`extension/_locales/${locale}/messages.json`, root), 'utf8'));
  const en = await read('en'), zh = await read('zh_TW');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  const fields = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const key of Object.keys(en)) {
    assert.ok(en[key].message.length && zh[key].message.length, key);
    assert.deepEqual(fields(en[key].message), fields(zh[key].message), key);
  }
  const html = await readFile(new URL('extension/popup.html', root), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n="(\w+)"/g)) assert.ok(en[key], key);
});

test('native error and status keys exist in the UI catalogs', async () => {
  const native = await readFile(new URL('native/host.py', root), 'utf8');
  const en = JSON.parse(await readFile(new URL('extension/_locales/en/messages.json', root), 'utf8'));
  for (const [, key] of native.matchAll(/['"](error[A-Z]\w+)['"]/g)) assert.ok(en[key], key);
});

test('popup switches live status and labels between languages and remembers selection', async () => {
  const previous = { chrome: globalThis.chrome, document: globalThis.document, fetch: globalThis.fetch };
  const nodes = new Map();
  const node = () => ({ textContent: '', value: '', disabled: false, hidden: false, dataset: {},
    handlers: {}, addEventListener(event, callback) { this.handlers[event] = callback; },
    replaceChildren() {}, append() {}, setAttribute() {} });
  const html = await readFile(new URL('extension/popup.html', root), 'utf8');
  const labels = [...html.matchAll(/data-i18n="(\w+)"/g)].map(([, key]) => ({ ...node(), dataset: { i18n: key } }));
  const values = { language: 'en', state: { type: 'done', messageKey: 'done', args: { height: 720, size: '1.0' } } };
  let changed;
  try {
    globalThis.document = {
      documentElement: {}, querySelectorAll: () => labels,
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
      createElement: node
    };
    globalThis.chrome = {
      i18n: { getUILanguage: () => 'en-US' },
      runtime: { getURL: path => path, async sendMessage() { return { ok: true }; } },
      storage: { local: { async get() { return values; }, async set(update) { Object.assign(values, update); } },
        onChanged: { addListener(callback) { changed = callback; } } }
    };
    globalThis.fetch = async path => ({ json: async () => JSON.parse(await readFile(new URL(`extension/${path}`, root), 'utf8')) });
    await import('../extension/popup.js?test=language-switch');
    assert.match(nodes.get('status').textContent, /Completed/);
    nodes.get('language').value = 'zh_TW';
    await nodes.get('language').handlers.change();
    assert.equal(values.language, 'zh_TW');
    assert.match(nodes.get('status').textContent, /下載完成/);
    assert.equal(labels.find(n => n.dataset.i18n === 'download').textContent, '加入下載佇列');
    changed({ state: { newValue: { type: 'error', messageKey: 'errorPermission' } } });
    assert.match(nodes.get('status').textContent, /寫入/);
    nodes.get('language').value = 'en';
    await nodes.get('language').handlers.change();
    assert.match(nodes.get('status').textContent, /Cannot write/);
    assert.equal(nodes.get('retry').hidden, false);
  } finally {
    Object.assign(globalThis, previous);
  }
});
