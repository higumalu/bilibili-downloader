const HOST = 'com.local.bilibili_downloader';
let port, messageQueue = Promise.resolve();
let busy = false, choosingDirectory = false, cancelRequested = false;
const save = state => chrome.storage.local.set({ state });
const fail = key => Object.assign(new Error(key), { errorKey: key });

async function record(message) {
  await save(message);
  if (['done', 'cancelled', 'error', 'interrupted'].includes(message.type)) {
    const { history = [], lastDownload } = await chrome.storage.local.get(['history', 'lastDownload']);
    if (lastDownload) await chrome.storage.local.set({ history: [{
      type: message.type, title: message.title || lastDownload.title,
      path: message.path, timestamp: Date.now()
    }, ...history].slice(0, 20) });
  }
}
function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(message => {
    messageQueue = messageQueue.then(async () => {
      if (message.type === 'pong') {
        await chrome.storage.local.set({ hostReady: true }); return;
      }
      if (message.type === 'revealed') return;
      if (message.type === 'action_error') {
        await chrome.storage.local.set({ settings: { ...(await chrome.storage.local.get('settings')).settings, errorKey: message.messageKey } });
        return;
      }
      if (message.type === 'settings') {
        choosingDirectory = Boolean(message.choosing);
        await chrome.storage.local.set({ settings: message, hostReady: true });
        if (!busy && !message.busy) {
          const { state } = await chrome.storage.local.get('state');
          if (state?.type === 'progress') await record({ ...state, type: 'interrupted', messageKey: 'interrupted' });
        }
        return;
      }
      if (['done', 'error', 'cancelled'].includes(message.type)) busy = false;
      await record(message);
    }).catch(() => {});
  });
  port.onDisconnect.addListener(() => {
    // Read lastError to avoid an unchecked Chrome error; do not persist native diagnostics.
    void chrome.runtime.lastError;
    port = null; choosingDirectory = false;
    const wasBusy = busy; busy = false;
    messageQueue = messageQueue.then(async () => {
      await chrome.storage.local.set({ hostReady: false });
      const { state, settings } = await chrome.storage.local.get(['state', 'settings']);
      await chrome.storage.local.set({ settings: { ...settings, choosing: false, errorKey: 'errorHelper' } });
      if (wasBusy || !state) await record({ type: 'error', messageKey: 'errorHelper' });
    });
  });
  return port;
}
function validUrl(value) {
  const url = new URL(value || 'about:blank');
  if (!['https:', 'http:'].includes(url.protocol) || !['www.bilibili.com', 'bilibili.com'].includes(url.hostname)
      || !/^\/video\/BV[a-zA-Z0-9]+\/?$/.test(url.pathname)) throw fail('errorUrl');
  return url;
}
async function startDownload(request, retry = false) {
  if (choosingDirectory) throw fail('errorChoosing');
  if (busy) throw fail('errorBusy');
  busy = true; cancelRequested = false;
  try {
    let url, info = {}, height = request.height;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (retry) {
      const { lastDownload } = await chrome.storage.local.get('lastDownload');
      if (!lastDownload) throw fail('errorNoRetry');
      url = validUrl(lastDownload.url); height = lastDownload.height;
      info.title = lastDownload.title;
    } else { url = validUrl(tab?.url); }
    await save({ type: 'progress', stage: 'extracting', percent: 0, title: info.title, messageKey: 'extracting' });
    // Only reuse browser login context when the active tab is the requested video part.
    if (tab?.url) {
      const active = new URL(tab.url);
      if (active.hostname === url.hostname && active.pathname.replace(/\/$/, '') === url.pathname.replace(/\/$/, '')
          && (active.searchParams.get('p') || '1') === (url.searchParams.get('p') || '1')) {
        try { info = await pageInfo(tab.id); } catch { /* Native extraction remains available. */ }
      }
    }
    const cleanUrl = `https://www.bilibili.com${url.pathname}?p=${encodeURIComponent(url.searchParams.get('p') || '1')}`;
    await chrome.storage.local.set({ lastDownload: { url: cleanUrl, height, title: info.title || '' } });
    if (cancelRequested) {
      busy = false; await record({ type: 'cancelled', messageKey: 'cancelled' }); return;
    }
    connect().postMessage({ command: 'download', url: cleanUrl, info, height, language: request.language });
  } catch (error) {
    busy = false;
    await save({ type: 'error', messageKey: error.errorKey || 'errorUnknown' });
    throw error;
  }
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
  (async () => {
    const native = command => connect().postMessage({ command, language: request.language });
    if (['ping', 'get_settings'].includes(request.command)) native(request.command);
    else if (request.command === 'choose_directory') {
      if (busy) throw fail('errorBusyFolder');
      native('choose_directory');
    } else if (request.command === 'download') await startDownload(request);
    else if (request.command === 'retry') await startDownload(request, true);
    else if (request.command === 'cancel') {
      cancelRequested = true;
      port?.postMessage({ command: 'cancel' });
    } else if (request.command === 'reveal') {
      const { state } = await chrome.storage.local.get('state');
      connect().postMessage({ command: 'reveal', path: request.path || state?.path });
    } else if (request.command === 'clear_history') await chrome.storage.local.set({ history: [] });
    else throw fail('errorCommand');
    return { ok: true };
  })().then(reply, error => reply({ ok: false, errorKey: error.errorKey || 'errorUnknown' }));
  return true;
});
