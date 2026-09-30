// Saved games (IndexedDB, with a localStorage fallback). The list signal holds lightweight metadata;
// full trees are loaded on demand.
import { signal } from '@preact/signals';
import { safeStorage } from './store.js';

const DB = 'sf19coach';
const STORE = 'games';
const LS_KEY = 'sf19c.library.fallback.v1';

export const libraryList = signal([]);
export const libraryReady = signal(false);

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(e => { console.warn('IndexedDB unavailable, using localStorage', e); return null; });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    const r = fn(store);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const lsAll = () => { try { return JSON.parse(safeStorage.get(LS_KEY) || '[]'); } catch { return []; } };
const lsWrite = list => {
  if (!safeStorage.set(LS_KEY, JSON.stringify(list))) throw new Error('quota');
};

export const meta = e => {
  const { tree, ...rest } = e;
  return rest;
};

async function all() {
  const db = await openDb();
  if (!db) return lsAll();
  return (await tx(db, 'readonly', s => s.getAll())) || [];
}

export async function refreshLibrary() {
  try {
    const items = await all();
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    libraryList.value = items.map(meta);
  } catch (e) {
    console.error(e);
  } finally {
    libraryReady.value = true;
  }
}

export async function getGame(id) {
  const db = await openDb();
  if (!db) return lsAll().find(g => g.id === id);
  return tx(db, 'readonly', s => s.get(id));
}

export async function saveGame(entry) {
  const e = { ...entry, id: entry.id || `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
  const db = await openDb();
  if (!db) {
    const list = lsAll().filter(g => g.id !== e.id);
    list.push(e);
    lsWrite(list);
  } else {
    await tx(db, 'readwrite', s => s.put(e));
  }
  await refreshLibrary();
  return e.id;
}

export async function deleteGame(id) {
  const db = await openDb();
  if (!db) lsWrite(lsAll().filter(g => g.id !== id));
  else await tx(db, 'readwrite', s => s.delete(id));
  await refreshLibrary();
}

export async function clearLibrary() {
  const db = await openDb();
  if (!db) lsWrite([]);
  else await tx(db, 'readwrite', s => s.clear());
  await refreshLibrary();
}

export async function allGames() { return all(); }
