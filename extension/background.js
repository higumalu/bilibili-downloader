import { DownloadQueue } from './queue.js';
const HOST = 'com.local.bilibili_downloader';
let controlPort;
const queue = new DownloadQueue({ storage: chrome.storage.local, launch });
const initialized = queue.init().then(async () => {
  for (const job of queue.jobs) {
    try { job.url = validUrl(job.url); }
    catch { Object.assign(job, { type: 'error', messageKey: 'errorUrl' }); }
  }
  await queue.persist();
});
const fail = key => queue.error(key);
function connectControl() {
  if (controlPort) return controlPort;
  const port = chrome.runtime.connectNative(HOST);
  controlPort = port;
  port.onMessage.addListener(message => queue.transaction(async () => {
    if (message.type === 'pong') await chrome.storage.local.set({ hostReady: true });
    if (message.type === 'settings') {
      queue.choosing = Boolean(message.choosing);
      await chrome.storage.local.set({ settings: message, hostReady: true });
      if (!queue.choosing) await queue.pump();
    }
    if (message.type === 'action_error') {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, errorKey: message.messageKey } });
    }
  }));
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (controlPort === port) controlPort = null;
    queue.transaction(async () => {
      queue.choosing = false;
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ hostReady: false, settings: { ...settings, choosing: false, errorKey: 'errorHelper' } });
      await queue.pump();
    });
  });
  return port;
}
function validUrl(value) {
  const url = new URL(value || 'about:blank');
  if (!['https:', 'http:'].includes(url.protocol) || !['www.bilibili.com', 'bilibili.com'].includes(url.hostname)
      || !/^\/video\/BV[a-zA-Z0-9]+\/?$/.test(url.pathname)) throw fail('errorUrl');
  const page = Number(url.searchParams.get('p') || 1);
  if (!Number.isSafeInteger(page) || page < 1) throw fail('errorPage');
  return `https://www.bilibili.com${url.pathname.replace(/\/$/, '')}/?p=${page}`;
}
async function launch(job, entry) {
  let info = { title: job.title };
  try {
    const tab = await chrome.tabs.get(job.tabId);
    if (validUrl(tab.url) === job.url) info = await pageInfo(tab.id);
  } catch { /* Closed/navigated tab: fetch fresh metadata through the local extractor. */ }
  if (entry.cancelled || entry.finished) {
    await queue.transaction(() => queue.update(job.id, { type: 'cancelled', messageKey: 'cancelled' }));
    return;
  }
  const port = chrome.runtime.connectNative(HOST);
  entry.port = port;
  port.onMessage.addListener(message => queue.transaction(async () => {
    if (queue.active.get(job.id) !== entry || entry.finished) return;
    if (['progress', 'done', 'error', 'cancelled'].includes(message.type)) await queue.update(job.id, message);
  }));
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (!entry.finished) queue.transaction(async () => {
      if (queue.active.get(job.id) === entry) await queue.update(job.id, { type: 'error', messageKey: 'errorHelper' });
    });
  });
  port.postMessage({ command: 'download', url: job.url, info, height: job.height, language: job.language });
}
async function pageInfo(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: async () => {
      const state = window.__INITIAL_STATE__ || {};
      const page = Number(new URL(location.href).searchParams.get('p') || 1);
      const video = state.videoData || {};
      const selected = video.pages?.find(item => item.page === page);
      const cid = selected?.cid || state.cid || video.cid;
      const bvid = location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1];
      let streams = null;
      // Request fresh metadata: embedded __playinfo__ can be stale after SPA navigation.
      if (cid && video.bvid === bvid) {
        try {
          const query = new URLSearchParams({ bvid, cid: String(cid), fnval: '4048', qn: '127', fourk: '1' });
          const response = await fetch(`https://api.bilibili.com/x/player/playurl?${query}`, {
            credentials: 'include', signal: AbortSignal.timeout(8000)
          });
          const payload = await response.json();
          if (payload.code === 0) streams = payload.data?.dash || null;
        } catch { /* Local extractor supplies the fallback. */ }
      }
      return {
        title: video.title || document.title.replace(/_哔哩哔哩.*$/, ''),
        cid, bvid: video.bvid, page, streams
      };
    }
  });
  return result;
}

chrome.runtime.onMessage.addListener((request, sender, reply) => {
  queue.transaction(async () => {
    await initialized;
    const native = command => connectControl().postMessage({ command, language: request.language });
    if (['ping', 'get_settings'].includes(request.command)) native(request.command);
    else if (request.command === 'choose_directory') {
      if (queue.pending()) throw fail('errorBusyFolder');
      queue.choosing = true;
      try { native('choose_directory'); } catch (error) { queue.choosing = false; throw error; }
    } else if (request.command === 'download') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = validUrl(tab?.url);
      const height = Number(request.height || 0);
      if (![0, 480, 720, 1080].includes(height)) throw fail('errorQuality');
      await queue.add({ url, tabId: tab.id, title: tab.title || url, height, language: request.language });
    } else if (request.command === 'set_concurrency') {
      if (![1, 2, 3].includes(request.value)) throw fail('errorCommand');
      queue.concurrency = request.value; await queue.pump();
    } else if (request.command === 'cancel') await queue.cancel(request.id);
    else if (request.command === 'retry') await queue.retry(request.id, request.language);
    else if (request.command === 'resume_queue') await queue.resume(request.language);
    else if (request.command === 'clear_finished') await queue.clearFinished();
    else if (request.command === 'reveal') {
      const job = queue.jobs.find(item => item.id === request.id);
      connectControl().postMessage({ command: 'reveal', path: request.path || job?.path });
    } else if (request.command === 'clear_history') await chrome.storage.local.set({ history: [] });
    else throw fail('errorCommand');
    return { ok: true };
  }).then(reply, error => reply({ ok: false, errorKey: error.errorKey || 'errorUnknown' }));
  return true;
});
