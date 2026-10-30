import { loadLanguage, language, t, translatePage, messageText } from './i18n.js';
const $ = id => document.getElementById(id);
let state, settings;
let jobs = [];
let history = [];
let ready = false, sending = false;
function render() {
  const running = sending || state?.type === 'progress';
  const choosing = Boolean(settings?.choosing);
  const pending = jobs.some(job => ['queued', 'progress'].includes(job.type));
  $('download').disabled = sending || choosing;
  $('quality').disabled = sending;
  $('choose_directory').disabled = pending || choosing;
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
  renderQueue();
  renderHistory();
}
function renderQueue() {
  const running = jobs.filter(job => job.type === 'progress').length;
  const waiting = jobs.filter(job => job.type === 'queued').length;
  $('queue-summary').textContent = t('queueSummary', { running, waiting });
  $('resume_queue').disabled = !jobs.some(job => job.type === 'interrupted') || Boolean(settings?.choosing);
  $('clear_finished').disabled = !jobs.some(job => ['done', 'error', 'cancelled'].includes(job.type));
  $('queue').replaceChildren();
  for (const job of jobs) {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.textContent = job.title || job.url;
    const description = document.createElement('p');
    description.textContent = messageText(job);
    if (job.stage === 'downloading' && job.type === 'progress' && job.speedMB > 0) {
      description.textContent += ' · ' + t('metrics', { speed: job.speedMB.toFixed(2), eta: formatEta(job.etaSeconds) });
    }
    li.append(title, description);
    if (job.type === 'progress') {
      const progress = document.createElement('progress');
      progress.max = 100; progress.value = job.percent || 0;
      progress.setAttribute('aria-label', t('progressLabel'));
      li.append(progress);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    const name = ['queued', 'progress'].includes(job.type) ? 'cancel'
      : job.type === 'done' ? 'reveal' : 'retry';
    const button = document.createElement('button');
    button.textContent = t(name);
    button.disabled = name === 'retry' && Boolean(settings?.choosing);
    button.addEventListener('click', () => command(name, { id: job.id }));
    actions.append(button); li.append(actions); $('queue').append(li);
  }
  if (!jobs.length) {
    const empty = document.createElement('li'); empty.textContent = t('queueEmpty'); $('queue').append(empty);
  }
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
for (const name of ['download', 'retry', 'cancel', 'reveal', 'choose_directory', 'clear_history', 'resume_queue', 'clear_finished']) {
  $(name).addEventListener('click', async () => {
    if (['download', 'retry'].includes(name)) { sending = true; render(); }
    const error = await command(name, { id: state?.id });
    sending = false;
    render();
    if (error) $('status').textContent = error;
  });
}
$('quality').addEventListener('change', () => chrome.storage.local.set({ quality: Number($('quality').value) }));
$('concurrency').addEventListener('change', () => command('set_concurrency', { value: Number($('concurrency').value) }));
$('language').addEventListener('change', async () => {
  await loadLanguage($('language').value);
  await chrome.storage.local.set({ language });
  translatePage(); render();
});
const saved = await chrome.storage.local.get(['state', 'settings', 'language', 'history', 'quality', 'hostReady', 'queue', 'queueConcurrency']);
await loadLanguage(saved.language);
$('language').value = language;
$('quality').value = String(saved.quality || 0);
state = saved.state; settings = saved.settings; history = saved.history || []; ready = saved.hostReady;
jobs = saved.queue || [];
if (jobs.length) state = jobs.find(job => job.type === 'progress') || jobs[jobs.length - 1];
$('concurrency').value = String(saved.queueConcurrency || 2);
translatePage(); render();
chrome.storage.onChanged.addListener(changes => {
  if (changes.state) state = changes.state.newValue;
  if (changes.settings) settings = changes.settings.newValue;
  if (changes.history) history = changes.history.newValue || [];
  if (changes.hostReady) ready = changes.hostReady.newValue;
  if (changes.queue) {
    jobs = changes.queue.newValue || [];
    state = jobs.find(job => job.type === 'progress') || jobs[jobs.length - 1];
  }
  if (changes.queueConcurrency) $('concurrency').value = String(changes.queueConcurrency.newValue);
  render();
});
await command('get_settings');
await command('ping');
