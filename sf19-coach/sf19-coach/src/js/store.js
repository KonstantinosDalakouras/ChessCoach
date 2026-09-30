// Persistent settings (localStorage) + small helpers.
import { signal, effect } from '@preact/signals';
import { lang } from './i18n.js';
import { defaultThreads } from './engine/manager.js';

const KEY = 'sf19c.settings.v1';

export const DEFAULT_NEW_GAME = {
  color: 'white', // white | black | random
  elo: 2000,
  max: false,
  clock: false,
  base: 10, // minutes
  inc: 5, // seconds
  movetime: 1000, // ms (no clock)
  mode: 'training', // training | normal
  coach: true,
  pause: true,
  evalbar: true,
  hints: true,
  takebacks: true,
  alertOpp: true,
  start: 'standard', // standard | fen | analysis
  fen: '',
};

export const DEFAULT_SETTINGS = {
  lang: 'el',
  theme: 'dark',
  playerName: '',
  boardTheme: 'green',
  coords: true,
  animation: 'normal',
  showDests: true,
  sound: true,
  arrows: true,
  figurine: true,
  variant: 'full',
  threads: 0, // 0 = auto
  hash: 64,
  coachPrecision: 'normal',
  reviewPreset: 'standard',
  multiPv: 3,
  welcomed: false,
  newGame: DEFAULT_NEW_GAME,
};

export const safeStorage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

function load() {
  let saved = {};
  try { saved = JSON.parse(safeStorage.get(KEY) || '{}') || {}; } catch { saved = {}; }
  const s = { ...DEFAULT_SETTINGS, ...saved, newGame: { ...DEFAULT_NEW_GAME, ...(saved.newGame || {}) } };
  if (!['el', 'en'].includes(s.lang)) s.lang = 'el';
  return s;
}

export const settings = signal(load());

export function updateSettings(patch) {
  settings.value = { ...settings.value, ...patch };
  safeStorage.set(KEY, JSON.stringify(settings.value));
}

export function resetSettings() {
  const keep = { welcomed: true, lang: settings.value.lang };
  settings.value = { ...DEFAULT_SETTINGS, ...keep };
  safeStorage.set(KEY, JSON.stringify(settings.value));
}

export const effectiveThreads = () => settings.value.threads || defaultThreads();

// Keep <html lang> and theme in sync.
effect(() => {
  const s = settings.value;
  lang.value = s.lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = s.lang;
    const theme = s.theme === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : s.theme;
    document.documentElement.dataset.theme = theme;
  }
});
