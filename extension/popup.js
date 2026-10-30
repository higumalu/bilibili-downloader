import { loadLanguage, language, t, translatePage, messageText } from './i18n.js';
const $ = id => document.getElementById(id);
let state, settings;
let history = [];
let ready = false, sending = false;
function render() {
  const running = sending || state?.type === 'progress';
  const choosing = Boolean(settings?.choosing);
  $('download').disabled = running || choosing;
  $('quality').disabled = running;
  $('choose_directory').disabled = running || choosing;
  $('choose_directory').textContent = t(choosing ? 'choosingFolder' : 'chooseFolder');
  $('directory').textContent = settings?.outputDirectory || t('reading');
  $('directory-error').textContent = settings?.errorKey ? t(settings.errorKey, settings.args) : settings?.error || '';
  $('title').textContent = state?.title || t(state ? 'appName' : 'idleTitle');
  $('status').textContent = state ? messageText(state) : t(ready ? 'connected' : 'checking');
  $('path').textContent = state?.path || '';
  $('progress').value = state?.percent || 0;
  $('progress').setAttribute('aria-label', t('progressLabel'));
  $('metrics').textContent = state?.stage === 'downloading' && state.speedMB > 0
    ? t('metrics', { speed: state.speedMB.toFixed(2), eta: formatEta(state.etaSeconds) }) : '';
  $('cancel').hidden = !running;
  $('retry').hidden = !['error', 'cancelled', 'interrupted'].includes(state?.type);
  $('retry').disabled = running || choosing;
  $('reveal').hidden = state?.type !== 'done';
  renderHistory();
}
function formatEta(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? t('minutes', { count: minutes }) : t('hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}
function renderHistory() {
  $('history').replaceChildren();
  for (const item of history) {
    const li = document.createElement('li'), title = document.createElement('div'), info = document.createElement('small');
    title.textContent = item.title || t('appName');
    info.textContent = `${new Date(item.timestamp).toLocaleString(language === 'zh_TW' ? 'zh-TW' : 'en')} · ${t(item.type === 'done' ? 'historyDone' : 'historyInterrupted')}`;
    li.append(title, info);
    if (item.type === 'done') {
      const button = document.createElement('button');
      button.textContent = t('reveal');
      button.addEventListener('click', () => command('reveal', { path: item.path }));
      li.append(button);
    }
    $('history').append(li);
  }
  if (!history.length) {
    const empty = document.createElement('li'); empty.textContent = t('historyEmpty'); $('history').append(empty);
  }
  $('clear_history').disabled = !history.length;
}
async function command(name, extra = {}) {
  try {
    const result = await chrome.runtime.sendMessage({ command: name, language, height: Number($('quality').value), ...extra });
    if (!result?.ok) {
      const error = result?.errorKey ? t(result.errorKey) : result?.error || t('errorConnection');
      $('status').textContent = error;
      return error;
    }
    return null;
  } catch {
    $('status').textContent = t('errorConnection');
    return t('errorConnection');
  }
}
for (const name of ['download', 'retry', 'cancel', 'reveal', 'choose_directory', 'clear_history']) {
  $(name).addEventListener('click', async () => {
    if (['download', 'retry'].includes(name)) { sending = true; render(); }
    const error = await command(name);
    sending = false;
    render();
    if (error) $('status').textContent = error;
  });
}
$('quality').addEventListener('change', () => chrome.storage.local.set({ quality: Number($('quality').value) }));
$('language').addEventListener('change', async () => {
  await loadLanguage($('language').value);
  await chrome.storage.local.set({ language });
  translatePage(); render();
});
const saved = await chrome.storage.local.get(['state', 'settings', 'language', 'history', 'quality', 'hostReady']);
await loadLanguage(saved.language);
$('language').value = language;
$('quality').value = String(saved.quality || 0);
state = saved.state; settings = saved.settings; history = saved.history || []; ready = saved.hostReady;
translatePage(); render();
chrome.storage.onChanged.addListener(changes => {
  if (changes.state) state = changes.state.newValue;
  if (changes.settings) settings = changes.settings.newValue;
  if (changes.history) history = changes.history.newValue || [];
  if (changes.hostReady) ready = changes.hostReady.newValue;
  render();
});
await command('get_settings');
await command('ping');
