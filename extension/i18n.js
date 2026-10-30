export const languages = ['zh_TW', 'en'];
let dictionary = {};
export let language = 'en';
export function detectLanguage(value = chrome.i18n.getUILanguage()) {
  return /^zh/i.test(value) ? 'zh_TW' : 'en';
}
export async function loadLanguage(value) {
  language = languages.includes(value) ? value : detectLanguage();
  const response = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`));
  dictionary = await response.json();
  document.documentElement.lang = language === 'zh_TW' ? 'zh-Hant' : 'en';
  return language;
}
export function t(key, values = {}) {
  return (dictionary[key]?.message || key).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? '—'));
}
export function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.title = t('appName');
}
export function messageText(message) {
  return message?.messageKey ? t(message.messageKey, message.args) : message?.message || '';
}
