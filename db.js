// Tiny IndexedDB wrapper. Stores:
//   tracks    – song metadata (keyPath id)
//   playlists – playlists (keyPath id)
//   audio     – audio Blob per track id
//   art       – artwork Blob per art key
//   kv        – settings / session / misc
const DB_NAME = 'pulse';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of ['tracks', 'playlists']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      for (const s of ['audio', 'art', 'kv']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    let out;
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: (s, k) => run(s, 'readonly', (st) => st.get(k)),
  getAll: (s) => run(s, 'readonly', (st) => st.getAll()),
  put: (s, v, k) => run(s, 'readwrite', (st) => (k === undefined ? st.put(v) : st.put(v, k))),
  del: (s, k) => run(s, 'readwrite', (st) => st.delete(k)),
  clear: (s) => run(s, 'readwrite', (st) => st.clear()),
  putMany: (s, vals) => run(s, 'readwrite', (st) => { for (const v of vals) st.put(v); }),
};
