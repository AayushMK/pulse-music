import { db } from './db.js';
import { parseMetadata } from './meta.js';
import { I } from './icons.js';

/* =====================================================================
   Utilities
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rj = (o) => esc(JSON.stringify(o));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const cmp = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base', numeric: true });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (sec) => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const fmtLong = (sec) => {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
};
const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
function shuffleArr(a, rnd = Math.random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function seeded(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* =====================================================================
   State
   ===================================================================== */
const DEFAULT_SETTINGS = {
  accent: '#f43f5e', theme: 'system', speed: 1,
  eqOn: false, eqPreset: 'Flat', eqGains: Array(10).fill(0),
  songSort: 'title', albumSort: 'title', installHint: true,
};

const S = {
  tracks: new Map(),
  playlists: new Map(),
  ver: 0, // bumps whenever library changes
  queue: [], original: null, index: -1, shuffle: false, repeat: 'off', context: null,
  tab: 'home',
  stacks: { home: [{ v: 'home' }], library: [{ v: 'library' }], search: [{ v: 'search' }] },
  settings: { ...DEFAULT_SETTINGS },
  recentSearches: [],
  query: '',
  npMode: 'art',
  sleep: null,
  lrc: null, lrcIdx: -1,
};
window.__pulse = { S }; // handy for debugging

const albumKey = (t) => `${norm(t.albumArtist || t.artist || 'Unknown Artist')}|${norm(t.album || 'Unknown Album')}`;
const curId = () => S.queue[S.index];
const curTrack = () => S.tracks.get(curId());

/* Derived library (albums / artists / genres), memoised on S.ver */
let D = null, Dver = -1;
function lib() {
  if (Dver === S.ver && D) return D;
  const albums = new Map(), artists = new Map(), genres = new Map();
  for (const t of S.tracks.values()) {
    const ak = albumKey(t);
    let a = albums.get(ak);
    if (!a) albums.set(ak, (a = { key: ak, title: t.album || 'Unknown Album', artist: t.albumArtist || t.artist || 'Unknown Artist', tracks: [], addedAt: 0, lastPlayed: 0, plays: 0 }));
    a.tracks.push(t);
    a.artKey ||= t.artKey; a.year ||= t.year; a.genre ||= t.genre;
    a.addedAt = Math.max(a.addedAt, t.addedAt || 0);
    a.lastPlayed = Math.max(a.lastPlayed, t.lastPlayed || 0);
    a.plays += t.playCount || 0;

    const names = new Set([t.artist || 'Unknown Artist']);
    if (t.albumArtist) names.add(t.albumArtist);
    for (const name of names) {
      const k = norm(name);
      let ar = artists.get(k);
      if (!ar) artists.set(k, (ar = { key: k, name, tracks: [], albums: new Set(), plays: 0, lastPlayed: 0 }));
      ar.tracks.push(t); ar.albums.add(ak); ar.artKey ||= t.artKey;
      ar.plays += t.playCount || 0; ar.lastPlayed = Math.max(ar.lastPlayed, t.lastPlayed || 0);
    }
    if (t.genre) {
      const gk = norm(t.genre);
      let g = genres.get(gk);
      if (!g) genres.set(gk, (g = { key: gk, name: t.genre, tracks: [] }));
      g.tracks.push(t); g.artKey ||= t.artKey;
    }
  }
  for (const a of albums.values()) a.tracks.sort((x, y) => (x.disc || 1) - (y.disc || 1) || (x.track || 999) - (y.track || 999) || cmp(x.title, y.title));
  D = {
    albums: [...albums.values()].sort((x, y) => cmp(x.title, y.title)),
    albumMap: albums,
    artists: [...artists.values()].sort((x, y) => cmp(x.name, y.name)),
    artistMap: artists,
    genres: [...genres.values()].sort((x, y) => cmp(x.name, y.name)),
    genreMap: genres,
  };
  Dver = S.ver;
  return D;
}

/* Auto-generated mixes */
let mixCache = { ver: -1, day: -1, list: [] };
function mixes() {
  const day = Math.floor(Date.now() / 864e5);
  if (mixCache.ver === S.ver && mixCache.day === day) return mixCache.list;
  const all = [...S.tracks.values()];
  const ids = (arr) => arr.map((t) => t.id);
  const rnd = seeded(day);
  const list = [];
  if (all.length >= 2) list.push({ id: 'daily', title: 'Daily Mix', sub: 'A fresh mix every day', ids: shuffleArr(ids(all), rnd).slice(0, 50) });
  const rep = all.filter((t) => t.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, 40);
  if (rep.length >= 3) list.push({ id: 'repeat', title: 'On Repeat', sub: 'Songs you love right now', ids: ids(rep) });
  const fresh = all.filter((t) => !t.playCount);
  if (fresh.length >= 3) list.push({ id: 'fresh', title: 'Unplayed', sub: "Songs you haven't heard yet", ids: shuffleArr(ids(fresh), rnd).slice(0, 50) });
  const old = all.filter((t) => t.playCount && t.lastPlayed < Date.now() - 14 * 864e5);
  if (old.length >= 3) list.push({ id: 'rediscover', title: 'Rediscover', sub: "Haven't heard these in a while", ids: shuffleArr(ids(old), rnd).slice(0, 50) });
  const topGenres = [...lib().genres].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 4);
  for (const g of topGenres) if (g.tracks.length >= 3) list.push({ id: 'g:' + g.key, title: `${g.name} Mix`, sub: `The best of your ${g.name}`, ids: shuffleArr(ids(g.tracks), rnd).slice(0, 50) });
  const topArtists = [...lib().artists].filter((a) => a.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 3);
  for (const a of topArtists) if (a.tracks.length >= 3) list.push({ id: 'a:' + a.key, title: `${a.name} Mix`, sub: `All about ${a.name}`, ids: shuffleArr(ids(a.tracks), rnd).slice(0, 50) });
  mixCache = { ver: S.ver, day, list };
  return list;
}

/* =====================================================================
   Persistence
   ===================================================================== */
const saveSettings = () => db.put('kv', S.settings, 'settings');
const saveTrack = (t) => db.put('tracks', t);
const savePlaylist = (p) => { p.updatedAt = Date.now(); return db.put('playlists', p); };
let lastSessionSave = 0;
function saveSession(force) {
  const now = Date.now();
  if (!force && now - lastSessionSave < 4000) return;
  lastSessionSave = now;
  db.put('kv', {
    queue: S.queue, original: S.original, index: S.index, time: audio.currentTime || 0,
    shuffle: S.shuffle, repeat: S.repeat, context: S.context,
  }, 'session').catch(() => {});
}

/* =====================================================================
   Artwork
   ===================================================================== */
const artCache = new Map();
function artUrl(key) {
  if (!key) return Promise.resolve(null);
  if (!artCache.has(key)) artCache.set(key, db.get('art', key).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
  return artCache.get(key);
}
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); loadImg(e.target, e.target.dataset.art); }
}, { rootMargin: '400px' });
function loadImg(img, key) {
  artUrl(key).then((u) => { if (u && img.dataset.art === key) { img.onload = () => img.classList.add('ok'); img.src = u; } });
}
function observeArt(root = document) {
  root.querySelectorAll('img[data-art]:not([data-obs])').forEach((i) => { i.dataset.obs = '1'; io.observe(i); });
}
function setArt(img, key) {
  img.classList.remove('ok');
  img.dataset.art = key || '';
  if (!key) { img.removeAttribute('src'); return; }
  loadImg(img, key);
}
const artHtml = (key, cls = '') => `<div class="art ${cls}">${I.music}${key ? `<img data-art="${esc(key)}" alt="">` : ''}</div>`;
function mosaicHtml(tracks, cls = '') {
  const keys = [...new Set(tracks.map((t) => t.artKey).filter(Boolean))].slice(0, 4);
  if (keys.length < 4) return artHtml(keys[0], cls);
  return `<div class="art mosaic ${cls}">${keys.map((k) => `<img data-art="${esc(k)}" alt="">`).join('')}</div>`;
}
const mixArt = (m, cls = '') => `<div class="art mixart ${cls}" style="--h:${hue(m.id)}"><span>${esc(m.title)}</span></div>`;

async function makeThumb(blob, size = 600) {
  try {
    let src;
    if (self.createImageBitmap) src = await createImageBitmap(blob);
    else {
      src = new Image(); const u = URL.createObjectURL(blob); src.src = u;
      await src.decode(); URL.revokeObjectURL(u);
    }
    const w = src.width, h = src.height;
    const scale = Math.min(1, size / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || blob), 'image/jpeg', 0.86));
  } catch { return blob; }
}

const colorCache = new Map();
async function artColor(key) {
  if (!key) return null;
  if (colorCache.has(key)) return colorCache.get(key);
  const p = (async () => {
    try {
      const b = await db.get('art', key);
      const bmp = await createImageBitmap(b);
      const c = document.createElement('canvas'); c.width = c.height = 12;
      const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, 12, 12);
      const d = x.getImageData(0, 0, 12, 12).data;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        const w = 1 + (mx - mn) / 32; // favour saturated pixels
        r += d[i] * w; g += d[i + 1] * w; bl += d[i + 2] * w; n += w;
      }
      return [r / n, g / n, bl / n].map(Math.round);
    } catch { return null; }
  })();
  colorCache.set(key, p);
  return p;
}

async function artDataUrl(key) {
  const b = key && (await db.get('art', key).catch(() => null));
  if (!b) return null;
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(b); });
}

/* =====================================================================
   Import
   ===================================================================== */
const EXT_MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', alac: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac', wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm' };

function probeDuration(blob) {
  return new Promise((res) => {
    const a = document.createElement('audio');
    const u = URL.createObjectURL(blob);
    let done = false;
    const fin = (d) => { if (done) return; done = true; URL.revokeObjectURL(u); a.removeAttribute('src'); res(d); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => fin(0);
    setTimeout(() => fin(0), 5000);
    a.src = u;
  });
}

function titleFromName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(?:\d{1,3}[\s.\-_]+)?(.+?)\s+-\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base.replace(/^\d{1,3}[\s.\-_]+/, '') || base };
}

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  navigator.storage?.persist?.().catch(() => {});
  const existing = new Set([...S.tracks.values()].map((t) => `${t.fileName}|${t.size}`));
  const prog = toast(`Importing 0 of ${files.length}…`, { sticky: true });
  let added = 0, skipped = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    prog.update(`Importing ${i + 1} of ${files.length}…`);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const mime = file.type || EXT_MIME[ext] || '';
    if (!(mime.startsWith('audio/') || EXT_MIME[ext] || mime === 'video/mp4')) { skipped++; continue; }
    if (existing.has(`${file.name}|${file.size}`)) { skipped++; continue; }
    try {
      const meta = await parseMetadata(file);
      const fallback = titleFromName(file.name);
      const t = {
        id: uid(),
        title: meta.title || fallback.title,
        artist: meta.artist || fallback.artist || 'Unknown Artist',
        album: meta.album || 'Unknown Album',
        albumArtist: meta.albumArtist || '',
        genre: meta.genre || '',
        year: meta.year || '',
        track: meta.track || 0,
        disc: meta.disc || 0,
        lyrics: meta.lyrics || '',
        duration: meta.duration || 0,
        artKey: null,
        addedAt: Date.now() + i, playCount: 0, lastPlayed: 0, liked: false,
        fileName: file.name, size: file.size, mime: mime === 'video/mp4' ? 'audio/mp4' : mime,
      };
      // Copy into a plain Blob — iOS can lose access to File handles from the picker.
      const blob = new Blob([await file.arrayBuffer()], { type: t.mime });
      if (!t.duration) t.duration = await probeDuration(blob);
      if (meta.picture) {
        const key = t.album !== 'Unknown Album' ? 'a:' + albumKey(t) : 't:' + t.id;
        const has = await db.get('art', key);
        if (!has) {
          const thumb = await makeThumb(new Blob([meta.picture.data], { type: meta.picture.mime }));
          await db.put('art', thumb, key);
        }
        t.artKey = key;
      } else {
        // reuse album art from another track of the same album, if any
        const sib = [...S.tracks.values()].find((x) => x.artKey && albumKey(x) === albumKey(t));
        if (sib) t.artKey = sib.artKey;
      }
      await db.put('audio', blob, t.id);
      await saveTrack(t);
      S.tracks.set(t.id, t);
      existing.add(`${file.name}|${file.size}`);
      added++;
      if (added % 10 === 0) { S.ver++; render(); }
    } catch (e) {
      console.error('import failed', file.name, e);
      failed++;
    }
  }
  S.ver++;
  render();
  const parts = [`Added ${plural(added, 'song')}`];
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  prog.update(parts.join(' · '));
  prog.close(2600);
}

/* =====================================================================
   Audio engine
   ===================================================================== */
const audio = $('#audio');
let curUrl = null, counted = false, loadSeq = 0, unlocked = false, pendingSeek = 0;

// A tiny silent WAV used to unlock the <audio> element inside the first tap (iOS rule).
const SILENT = (() => {
  const n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
})();

function unlock() {
  if (S.settings.eqOn) ensureEQ();
  actx?.resume?.();
  if (unlocked) return;
  unlocked = true;
  if (!audio.src) audio.src = SILENT;
  audio.muted = true;
  audio.play().catch(() => { unlocked = false; });
}

async function loadTrack(i, autoplay = true, startAt = 0) {
  const id = S.queue[i];
  const t = S.tracks.get(id);
  if (!t) return;
  const seq = ++loadSeq;
  S.index = i; counted = false; S.lrcIdx = -1;
  updateNP();
  let blob = null;
  try { blob = await db.get('audio', id); } catch {}
  if (seq !== loadSeq) return;
  if (!blob) { toast(`Can't find the file for “${t.title}”`); return; }
  const old = curUrl;
  curUrl = URL.createObjectURL(blob);
  audio.muted = false;
  audio.src = curUrl;
  if (old) URL.revokeObjectURL(old);
  audio.defaultPlaybackRate = audio.playbackRate = S.settings.speed;
  audio.preservesPitch = audio.webkitPreservesPitch = true;
  pendingSeek = startAt > 0 ? startAt : 0;
  if (autoplay) {
    try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') console.warn('play failed', e); }
  } else audio.load();
  setMediaSession(t);
  saveSession(true);
}

function playIds(ids, start = 0, ctx = null, opt = {}) {
  ids = ids.filter((id) => S.tracks.has(id));
  if (!ids.length) return;
  start = Math.max(0, Math.min(start, ids.length - 1));
  unlock();
  if (opt.shuffle !== undefined) S.shuffle = opt.shuffle;
  S.context = ctx;
  if (S.shuffle) {
    S.original = [...ids];
    const first = opt.shuffle ? null : ids[start];
    const rest = shuffleArr(first ? ids.filter((_, i) => i !== start) : [...ids]);
    S.queue = first ? [first, ...rest] : rest;
    S.index = 0;
  } else {
    S.original = null; S.queue = [...ids]; S.index = start;
  }
  loadTrack(S.index, true);
  updateControls();
}

function togglePlay() {
  if (!S.queue.length) { if (S.tracks.size) shuffleAll(); return; }
  if (S.settings.eqOn) ensureEQ();
  actx?.resume?.();
  if (!curUrl) { unlock(); loadTrack(S.index, true, pendingSeek); return; }
  if (audio.paused) {
    audio.muted = false; unlocked = true;
    audio.play().catch((e) => console.warn(e));
  } else audio.pause();
}

function next(auto = false) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  if (S.index < S.queue.length - 1) loadTrack(S.index + 1, true);
  else if (S.repeat !== 'off') loadTrack(0, true);
  else if (auto) { audio.pause(); audio.currentTime = 0; updatePlayState(); }
  else loadTrack(0, false);
}
function prev() {
  if (!S.queue.length) return;
  if (audio.currentTime > 3 || S.index === 0 && S.repeat === 'off') { audio.currentTime = 0; return; }
  loadTrack(S.index > 0 ? S.index - 1 : S.queue.length - 1, true);
}

function setShuffle(on) {
  const cur = curId();
  S.shuffle = on;
  if (!S.queue.length) { updateControls(); return; }
  if (on) {
    S.original = [...S.queue];
    const rest = shuffleArr(S.queue.filter((_, i) => i !== S.index));
    S.queue = [cur, ...rest]; S.index = 0;
  } else if (S.original) {
    S.queue = S.original.filter((id) => S.tracks.has(id));
    S.index = Math.max(0, S.queue.indexOf(cur));
    S.original = null;
  }
  updateControls(); renderQueue(); saveSession(true);
}
function cycleRepeat() {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  updateControls(); saveSession(true);
}

function addNext(ids) {
  ids = ids.filter((id) => S.tracks.has(id));
  if (!ids.length) return;
  if (!S.queue.length) { S.queue = [...ids]; S.index = 0; loadTrack(0, false); }
  else {
    S.queue.splice(S.index + 1, 0, ...ids);
    if (S.original) { const p = S.original.indexOf(curId()); S.original.splice(p + 1, 0, ...ids); }
  }
  toast(ids.length > 1 ? `${plural(ids.length, 'song')} will play next` : 'Playing next');
  renderQueue(); saveSession(true);
}
function addLater(ids) {
  ids = ids.filter((id) => S.tracks.has(id));
  if (!ids.length) return;
  if (!S.queue.length) { S.queue = [...ids]; S.index = 0; loadTrack(0, false); }
  else { S.queue.push(...ids); S.original?.push(...ids); }
  toast(ids.length > 1 ? `Added ${plural(ids.length, 'song')} to queue` : 'Added to queue');
  renderQueue(); saveSession(true);
}
function shuffleAll() { playIds([...S.tracks.keys()], 0, { label: 'Library', r: { v: 'songs' } }, { shuffle: true }); }

/* Equalizer (Web Audio). Only created after the user turns it on. */
const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Bass Reducer': [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0],
  'Treble Boost': [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Pop: [-1, 0, 2, 4, 5, 4, 2, 0, -1, -1],
  Rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
  'Hip-Hop': [5, 4, 1, 3, -1, -1, 1, -1, 2, 3],
  Electronic: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5],
  Jazz: [4, 3, 1, 2, -2, -2, 0, 1, 3, 4],
  Classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  Acoustic: [4, 4, 3, 1, 2, 2, 3, 3, 3, 2],
  'Late Night': [3, 2, 1, 0, -1, 0, 1, 2, 2, 1],
  Loudness: [6, 4, 0, 0, -2, 0, -1, -4, 4, 1],
};
let actx = null, eqNodes = [], preamp = null;
function ensureEQ() {
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    const src = actx.createMediaElementSource(audio);
    eqNodes = EQ_FREQS.map((fq, i) => {
      const n = actx.createBiquadFilter();
      n.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      n.frequency.value = fq; n.Q.value = 1.1; return n;
    });
    preamp = actx.createGain();
    [src, ...eqNodes, preamp, actx.destination].reduce((a, b) => (a.connect(b), b));
    applyEQ();
  } catch (e) { console.warn('EQ unavailable', e); actx = null; }
}
function applyEQ() {
  if (!actx) return;
  const g = S.settings.eqOn ? S.settings.eqGains : EQ_PRESETS.Flat;
  eqNodes.forEach((n, i) => n.gain.setTargetAtTime(g[i], actx.currentTime, 0.05));
  const peak = Math.max(0, ...g);
  preamp.gain.setTargetAtTime(Math.pow(10, -peak / 2 / 20), actx.currentTime, 0.05);
}

/* Media Session (lock screen, Control Center, headphones) */
async function setMediaSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  const base = { title: t.title, artist: t.artist, album: t.album };
  navigator.mediaSession.metadata = new MediaMetadata(base);
  const data = await artDataUrl(t.artKey);
  if (data && curId() === t.id) navigator.mediaSession.metadata = new MediaMetadata({ ...base, artwork: [{ src: data, sizes: '600x600', type: 'image/jpeg' }] });
}
function setPosition() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = audio.duration;
  if (!isFinite(d) || d <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, d) }); } catch {}
}
if ('mediaSession' in navigator) {
  const h = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
  h('play', () => { audio.muted = false; actx?.resume?.(); audio.play().catch(() => {}); });
  h('pause', () => audio.pause());
  h('nexttrack', () => next());
  h('previoustrack', () => prev());
  h('seekto', (d) => { if (d.seekTime != null) { audio.currentTime = d.seekTime; setPosition(); } });
  h('stop', () => audio.pause());
}

/* Audio events */
audio.addEventListener('loadedmetadata', () => {
  if (audio.src === SILENT) return;
  if (pendingSeek) { try { audio.currentTime = pendingSeek; } catch {} pendingSeek = 0; }
  const t = curTrack();
  if (t && isFinite(audio.duration) && Math.abs((t.duration || 0) - audio.duration) > 1) { t.duration = audio.duration; saveTrack(t); }
  setPosition();
});
audio.addEventListener('play', () => { if (audio.src !== SILENT) updatePlayState(); });
audio.addEventListener('pause', () => { updatePlayState(); saveSession(true); });
audio.addEventListener('ratechange', setPosition);
audio.addEventListener('timeupdate', () => {
  if (audio.src === SILENT) return;
  updateProgress();
  const t = curTrack();
  if (t && !counted && audio.currentTime >= Math.min(30, (audio.duration || 60) * 0.5)) {
    counted = true;
    t.playCount = (t.playCount || 0) + 1; t.lastPlayed = Date.now();
    saveTrack(t); S.ver++;
  }
  saveSession();
  checkSleep();
});
audio.addEventListener('ended', () => {
  if (audio.src === SILENT) return;
  if (S.sleep?.eot) { S.sleep = null; updateSleepLabel(); audio.currentTime = 0; toast('Sleep timer ended'); return; }
  next(true);
});
audio.addEventListener('error', () => {
  if (!audio.src || audio.src === SILENT || !curUrl) return;
  const t = curTrack();
  toast(`Can't play “${t?.title || 'this file'}” — format not supported`);
  if (S.queue.length > 1 && S.index < S.queue.length - 1) setTimeout(() => next(true), 800);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveSession(true);
  else if (!audio.paused) actx?.resume?.();
});

/* Sleep timer */
function setSleep(v) {
  if (!v) S.sleep = null;
  else if (v === 'eot') S.sleep = { eot: true };
  else S.sleep = { at: Date.now() + v * 60000 };
  updateSleepLabel();
  toast(!v ? 'Sleep timer off' : v === 'eot' ? 'Stopping at end of song' : `Stopping in ${v} min`);
}
function checkSleep() {
  if (S.sleep?.at && Date.now() >= S.sleep.at) { S.sleep = null; audio.pause(); toast('Sleep timer ended'); }
  updateSleepLabel();
}
function updateSleepLabel() {
  const el = $('#np-timer-lbl');
  const btn = $('#np-timer');
  if (!S.sleep) { el.textContent = ''; btn.classList.remove('on'); return; }
  btn.classList.add('on');
  el.textContent = S.sleep.eot ? 'End' : fmt(Math.max(0, (S.sleep.at - Date.now()) / 1000));
}
setInterval(() => { if (S.sleep?.at) checkSleep(); }, 1000);

/* =====================================================================
   Now playing UI
   ===================================================================== */
const player = $('#player');
let seeking = false;

function updateNP() {
  const t = curTrack();
  $('#mini').hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  if (!t) return;
  $('#mini-title').textContent = t.title;
  $('#mini-artist').textContent = t.artist;
  setArt($('#mini-art'), t.artKey);
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = t.artist + (t.album && t.album !== 'Unknown Album' ? ` — ${t.album}` : '');
  $('#np-from').textContent = S.context?.label || 'Library';
  setArt($('#np-art'), t.artKey);
  setArt($('#np-bg'), t.artKey);
  $('#np-like').innerHTML = t.liked ? I.heartFill : I.heart;
  $('#np-like').classList.toggle('on', !!t.liked);
  artColor(t.artKey).then((c) => {
    if (curTrack() !== t) return;
    player.style.setProperty('--tint', c ? `rgb(${c.map((x) => Math.round(x * 0.55)).join(',')})` : '#2a2a35');
  });
  if (S.npMode === 'lyrics') renderLyrics();
  renderQueue();
  markPlaying();
  updateProgress();
}

function updatePlayState() {
  const playing = !audio.paused && audio.src !== SILENT;
  document.body.classList.toggle('paused', !playing);
  $('#mini-play').innerHTML = playing ? I.pause : I.play;
  $('#np-play').innerHTML = playing ? I.pause : I.play;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  setPosition();
}

function updateControls() {
  $('#np-shuffle').classList.toggle('on', S.shuffle);
  $('#np-repeat').classList.toggle('on', S.repeat !== 'off');
  $('#np-repeat').innerHTML = S.repeat === 'one' ? I.repeat1 : I.repeat;
}

function updateProgress() {
  const d = audio.duration || curTrack()?.duration || 0;
  const c = pendingSeek || audio.currentTime || 0;
  const p = d ? Math.min(1, c / d) : 0;
  $('#mini-bar').style.width = `${p * 100}%`;
  if (!seeking) {
    const r = $('#np-seek');
    r.value = Math.round(p * 1000);
    r.style.setProperty('--p', `${p * 100}%`);
    $('#np-cur').textContent = fmt(c);
    $('#np-rem').textContent = '-' + fmt(d - c);
  }
  syncLyrics();
}

function openPlayer() {
  if (!curTrack()) return;
  player.classList.add('open');
  player.setAttribute('aria-hidden', 'false');
  document.body.classList.add('np-open');
  updateNP();
}
function closePlayer() {
  player.classList.remove('open');
  player.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('np-open');
}
function setNpMode(mode) {
  S.npMode = S.npMode === mode ? 'art' : mode;
  $('#np-stage').dataset.mode = S.npMode;
  $('#np-b-lyrics').classList.toggle('on', S.npMode === 'lyrics');
  $('#np-b-queue').classList.toggle('on', S.npMode === 'queue');
  if (S.npMode === 'lyrics') { S.lrcIdx = -1; renderLyrics(); syncLyrics(); }
  if (S.npMode === 'queue') renderQueue();
}

/* Seek bar */
{
  const r = $('#np-seek');
  r.addEventListener('input', () => {
    seeking = true;
    const d = audio.duration || curTrack()?.duration || 0;
    const c = (r.value / 1000) * d;
    r.style.setProperty('--p', `${r.value / 10}%`);
    $('#np-cur').textContent = fmt(c);
    $('#np-rem').textContent = '-' + fmt(d - c);
  });
  const commit = () => {
    if (!seeking) return;
    const d = audio.duration || 0;
    if (d) { audio.currentTime = (r.value / 1000) * d; setPosition(); }
    seeking = false;
  };
  r.addEventListener('change', commit);
  r.addEventListener('pointerup', commit);
  r.addEventListener('touchend', commit);
}

/* Swipe down to close, swipe sideways on artwork to skip */
{
  let g = null;
  player.addEventListener('pointerdown', (e) => {
    const zone = e.target.closest('.np-drag');
    if (!zone || e.target.closest('button') && !zone.classList.contains('np-art-wrap')) return;
    g = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, dy: 0, art: zone.id === 'np-art-wrap', axis: null };
  });
  window.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    g.dx = e.clientX - g.x; g.dy = e.clientY - g.y;
    if (!g.axis && Math.hypot(g.dx, g.dy) > 8) g.axis = Math.abs(g.dy) > Math.abs(g.dx) ? 'y' : 'x';
    if (g.axis === 'y' && g.dy > 0) { player.style.transition = 'none'; player.style.transform = `translateY(${g.dy}px)`; }
    if (g.axis === 'x' && g.art) $('#np-art-wrap').style.transform = `translateX(${g.dx * 0.6}px)`;
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    player.style.transition = ''; player.style.transform = '';
    $('#np-art-wrap').style.transform = '';
    if (g.axis === 'y' && g.dy > 110) closePlayer();
    if (g.axis === 'x' && g.art && Math.abs(g.dx) > 70) { unlock(); g.dx < 0 ? next() : (audio.currentTime = 0, prev()); }
    g = null;
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

/* Lyrics (plain or time-synced LRC) */
function parseLRC(text) {
  if (!text) return null;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text: words });
  }
  return out.length >= 2 ? out.sort((a, b) => a.t - b.t) : null;
}
function renderLyrics() {
  const el = $('#np-lyrics');
  const t = curTrack();
  S.lrc = t ? parseLRC(t.lyrics) : null;
  S.lrcIdx = -1;
  if (!t || !t.lyrics) {
    el.innerHTML = `<div class="lyrics-empty"><p>No lyrics for this song.</p><button class="btn-pill sm" data-act="editCurrent">${I.edit}Add Lyrics</button><p class="muted sm">Paste plain lyrics or synced .lrc lyrics with [mm:ss] timestamps.</p></div>`;
  } else if (S.lrc) {
    el.innerHTML = `<div class="lrc-pad"></div>${S.lrc.map((l) => `<p class="lrc" data-act="seekLine" data-t="${l.t}">${esc(l.text) || '♪'}</p>`).join('')}<div class="lrc-pad"></div>`;
  } else {
    el.innerHTML = `<div class="lyrics-plain">${esc(t.lyrics).replace(/\n/g, '<br>')}</div>`;
  }
  el.scrollTop = 0;
}
function syncLyrics() {
  if (S.npMode !== 'lyrics' || !S.lrc || !player.classList.contains('open')) return;
  const ct = audio.currentTime + 0.25;
  let idx = -1;
  for (let i = 0; i < S.lrc.length; i++) { if (S.lrc[i].t <= ct) idx = i; else break; }
  if (idx === S.lrcIdx) return;
  S.lrcIdx = idx;
  const el = $('#np-lyrics');
  const lines = $$('.lrc', el);
  lines.forEach((l, i) => { l.classList.toggle('on', i === idx); l.classList.toggle('past', i < idx); });
  const cur = lines[idx];
  if (cur) el.scrollTo({ top: cur.offsetTop - el.clientHeight * 0.4, behavior: 'smooth' });
}

/* Queue panel */
function renderQueue() {
  if (S.npMode !== 'queue') return;
  const el = $('#np-queue');
  const up = S.queue.slice(S.index + 1);
  const row = (id, i) => {
    const t = S.tracks.get(id);
    if (!t) return '';
    return `<div class="q-row" data-qi="${S.index + 1 + i}">
      <button class="q-main" data-act="qJump" data-qi="${S.index + 1 + i}">${artHtml(t.artKey, 'xs')}<div class="row-text"><div class="row-title ellipsis">${esc(t.title)}</div><div class="row-sub ellipsis">${esc(t.artist)}</div></div></button>
      <button class="icon-btn q-x" data-act="qRemove" data-qi="${S.index + 1 + i}" aria-label="Remove">${I.minus}</button>
      <div class="q-handle" aria-label="Reorder">${I.grip}</div></div>`;
  };
  el.innerHTML = `
    <div class="q-head"><div><b>Playing Next</b><div class="muted sm">${S.shuffle ? 'Shuffled · ' : ''}${S.repeat !== 'off' ? `Repeat ${S.repeat} · ` : ''}${plural(up.length, 'song')}</div></div>
      ${up.length ? `<button class="link" data-act="qClear">Clear</button>` : ''}</div>
    <div class="q-list">${up.length ? up.slice(0, 300).map(row).join('') : `<p class="muted q-empty">Nothing up next.</p>`}</div>`;
  observeArt(el);
}
/* Drag to reorder queue */
$('#np-queue').addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.q-handle');
  if (!h) return;
  e.preventDefault();
  const row = h.closest('.q-row');
  const rows = $$('.q-row', $('#np-queue'));
  const from = rows.indexOf(row);
  const hgt = row.getBoundingClientRect().height;
  const startY = e.clientY;
  let to = from;
  row.classList.add('dragging');
  h.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dy = ev.clientY - startY;
    row.style.transform = `translateY(${dy}px)`;
    to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / hgt)));
    rows.forEach((r, i) => {
      if (r === row) return;
      const shift = from < to && i > from && i <= to ? -hgt : from > to && i < from && i >= to ? hgt : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const up = () => {
    h.removeEventListener('pointermove', move);
    const a = S.index + 1 + from, b = S.index + 1 + to;
    if (a !== b) { const [id] = S.queue.splice(a, 1); S.queue.splice(b, 0, id); saveSession(true); }
    renderQueue();
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up, { once: true });
  h.addEventListener('pointercancel', up, { once: true });
});

function markPlaying() {
  const id = curId();
  $$('.row.song').forEach((r) => r.classList.toggle('playing', r.dataset.id === id));
}

/* =====================================================================
   Overlays: toast, sheet, modal forms
   ===================================================================== */
function toast(msg, { sticky = false } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = (delay = 0) => setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, delay);
  if (!sticky) close(2200);
  return { update: (m) => { el.textContent = m; }, close };
}

function sheet({ title, sub, artKey, head, items = [], body = '', onMount }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    const header = head ?? (title ? `<div class="sheet-head">${artKey !== undefined ? artHtml(artKey, 'sm') : ''}<div class="sheet-head-text"><div class="ellipsis"><b>${esc(title)}</b></div>${sub ? `<div class="muted sm ellipsis">${esc(sub)}</div>` : ''}</div></div>` : '');
    wrap.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet" role="dialog">${header}${body}
      ${items.filter(Boolean).length ? `<div class="sheet-items">${items.filter(Boolean).map((it) => `<button class="sheet-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}" data-k="${esc(it.k)}"><span>${esc(it.label)}</span>${it.checked ? I.check : it.icon || ''}</button>`).join('')}</div>` : ''}
      <button class="sheet-cancel" data-k="">${body && !items.length ? 'Done' : 'Cancel'}</button></div>`;
    $('#sheet-root').appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    const close = (k) => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 280); resolve(k); };
    wrap.addEventListener('click', (e) => {
      if (e.target.classList.contains('sheet-backdrop')) return close(null);
      const b = e.target.closest('[data-k]');
      if (b) close(b.dataset.k || null);
    });
    observeArt(wrap);
    onMount?.(wrap, close);
  });
}
const confirmSheet = (title, sub, label = 'Delete') => sheet({ title, sub, items: [{ k: 'yes', label, danger: true, icon: I.trash }] }).then((k) => k === 'yes');

function ask({ title, fields, ok = 'Save' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    const field = (f) => {
      const v = esc(f.value ?? '');
      if (f.type === 'textarea') return `<label class="field"><span>${esc(f.label)}</span><textarea name="${f.name}" rows="${f.rows || 6}" placeholder="${esc(f.placeholder || '')}">${v}</textarea></label>`;
      if (f.type === 'file') return `<label class="field file"><span>${esc(f.label)}</span><input type="file" name="${f.name}" accept="${f.accept || 'image/*'}"></label>`;
      return `<label class="field"><span>${esc(f.label)}</span><input name="${f.name}" type="${f.type || 'text'}" value="${v}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'number' ? 'inputmode="numeric"' : ''} autocomplete="off"></label>`;
    };
    wrap.innerHTML = `<div class="sheet-backdrop"></div><form class="sheet modal" novalidate>
      <div class="modal-head"><button type="button" class="link" data-x>Cancel</button><b>${esc(title)}</b><button type="submit" class="link strong">${esc(ok)}</button></div>
      <div class="modal-body">${fields.map(field).join('')}</div></form>`;
    $('#sheet-root').appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    const form = $('form', wrap);
    const close = (v) => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 280); resolve(v); };
    wrap.addEventListener('click', (e) => { if (e.target.classList.contains('sheet-backdrop') || e.target.closest('[data-x]')) close(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        out[f.name] = f.type === 'file' ? el.files[0] || null : f.type === 'number' ? parseInt(el.value, 10) || 0 : el.value.trim();
      }
      close(out);
    });
  });
}

function pickSongs(title, exclude = new Set()) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    const tracks = [...S.tracks.values()].filter((t) => !exclude.has(t.id)).sort((a, b) => cmp(a.title, b.title));
    const sel = new Set();
    wrap.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet modal tall">
      <div class="modal-head"><button type="button" class="link" data-x>Cancel</button><b>${esc(title)}</b><button class="link strong" data-done>Add</button></div>
      <div class="search-field in-sheet">${I.search}<input type="search" placeholder="Search songs" autocomplete="off"></div>
      <div class="modal-body pick-list">${tracks.map((t) => `<button class="row pick" data-id="${t.id}" data-s="${esc(norm(`${t.title} ${t.artist} ${t.album}`))}">${artHtml(t.artKey, 'sm')}<div class="row-text"><div class="row-title ellipsis">${esc(t.title)}</div><div class="row-sub ellipsis">${esc(t.artist)}</div></div><span class="pick-check">${I.check}</span></button>`).join('') || '<p class="muted pad">No songs to add.</p>'}</div></div>`;
    $('#sheet-root').appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    observeArt(wrap);
    const close = (v) => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 280); resolve(v); };
    const done = $('[data-done]', wrap);
    wrap.addEventListener('click', (e) => {
      if (e.target.classList.contains('sheet-backdrop') || e.target.closest('[data-x]')) return close(null);
      if (e.target.closest('[data-done]')) return close([...sel]);
      const r = e.target.closest('.pick');
      if (r) {
        const id = r.dataset.id;
        sel.has(id) ? sel.delete(id) : sel.add(id);
        r.classList.toggle('on', sel.has(id));
        done.textContent = sel.size ? `Add (${sel.size})` : 'Add';
      }
    });
    $('input', wrap).addEventListener('input', (e) => {
      const q = norm(e.target.value);
      $$('.pick', wrap).forEach((r) => { r.style.display = !q || r.dataset.s.includes(q) ? '' : 'none'; });
    });
  });
}

/* =====================================================================
   Menus & editing
   ===================================================================== */
async function choosePlaylist(ids) {
  const pls = [...S.playlists.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const k = await sheet({
    title: 'Add to Playlist', sub: plural(ids.length, 'song'),
    items: [{ k: '__new', label: 'New Playlist…', icon: I.plus }, ...pls.map((p) => ({ k: p.id, label: p.name, icon: I.playlist }))],
  });
  if (!k) return;
  let p = S.playlists.get(k);
  if (k === '__new') { p = await createPlaylist(); if (!p) return; }
  const before = p.ids.length;
  for (const id of ids) if (!p.ids.includes(id)) p.ids.push(id);
  await savePlaylist(p); S.ver++;
  const n = p.ids.length - before;
  toast(n ? `Added ${plural(n, 'song')} to ${p.name}` : `Already in ${p.name}`);
  render();
}

async function createPlaylist(ids = []) {
  const v = await ask({ title: 'New Playlist', ok: 'Create', fields: [{ name: 'name', label: 'Name', placeholder: 'My Playlist' }, { name: 'desc', label: 'Description', placeholder: 'Optional' }] });
  if (!v) return null;
  const p = { id: uid(), name: v.name || 'My Playlist', desc: v.desc || '', ids: [...ids], createdAt: Date.now(), updatedAt: Date.now() };
  S.playlists.set(p.id, p);
  await savePlaylist(p); S.ver++;
  render();
  return p;
}

function toggleLike(t) {
  t.liked = !t.liked;
  saveTrack(t); S.ver++;
  if (curTrack() === t) { $('#np-like').innerHTML = t.liked ? I.heartFill : I.heart; $('#np-like').classList.toggle('on', t.liked); }
  toast(t.liked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
  render();
}

async function storeArtwork(file) {
  const thumb = await makeThumb(file);
  const key = 'c:' + uid();
  await db.put('art', thumb, key);
  return key;
}

async function editTrack(t) {
  const v = await ask({
    title: 'Edit Info',
    fields: [
      { name: 'title', label: 'Title', value: t.title },
      { name: 'artist', label: 'Artist', value: t.artist },
      { name: 'album', label: 'Album', value: t.album },
      { name: 'albumArtist', label: 'Album Artist', value: t.albumArtist },
      { name: 'genre', label: 'Genre', value: t.genre },
      { name: 'year', label: 'Year', value: t.year, type: 'number' },
      { name: 'track', label: 'Track #', value: t.track || '', type: 'number' },
      { name: 'art', label: 'Artwork', type: 'file' },
      { name: 'lyrics', label: 'Lyrics (plain or .lrc synced)', value: t.lyrics, type: 'textarea', rows: 8, placeholder: '[00:12.50] First line…' },
    ],
  });
  if (!v) return;
  Object.assign(t, { title: v.title || t.title, artist: v.artist || 'Unknown Artist', album: v.album || 'Unknown Album', albumArtist: v.albumArtist, genre: v.genre, year: v.year ? String(v.year) : '', track: v.track, lyrics: v.lyrics });
  if (v.art) t.artKey = await storeArtwork(v.art);
  await saveTrack(t); S.ver++;
  render(); if (curTrack() === t) { updateNP(); setMediaSession(t); }
  toast('Saved');
}

async function deleteTracks(ids) {
  const set = new Set(ids);
  const wasCurrent = set.has(curId());
  const orphanArt = new Set(ids.map((id) => S.tracks.get(id)?.artKey).filter(Boolean));
  for (const id of ids) {
    S.tracks.delete(id);
    await db.del('tracks', id); await db.del('audio', id);
  }
  // drop artwork no other song uses
  const used = new Set([...S.tracks.values()].map((t) => t.artKey));
  for (const key of orphanArt) if (!used.has(key)) { await db.del('art', key); artCache.delete(key); }
  for (const p of S.playlists.values()) {
    const n = p.ids.length; p.ids = p.ids.filter((id) => !set.has(id));
    if (p.ids.length !== n) await savePlaylist(p);
  }
  if (S.queue.length) {
    const cur = curId();
    const before = S.queue.slice(0, S.index).filter((id) => set.has(id)).length;
    S.queue = S.queue.filter((id) => !set.has(id));
    if (S.original) S.original = S.original.filter((id) => !set.has(id));
    if (wasCurrent) {
      audio.pause(); audio.removeAttribute('src'); if (curUrl) URL.revokeObjectURL(curUrl); curUrl = null;
      S.index = Math.min(S.index - before, S.queue.length - 1);
      if (S.queue.length) loadTrack(Math.max(0, S.index), false); else { S.index = -1; closePlayer(); }
    } else S.index = S.queue.indexOf(cur);
  }
  S.ver++;
  render(); updateNP(); saveSession(true);
  toast(`Deleted ${plural(ids.length, 'song')}`);
}

async function songMenu(id, ctx = '') {
  const t = S.tracks.get(id);
  if (!t) return;
  const inPl = ctx.startsWith('pl:') ? ctx.split(':') : null;
  const isNp = ctx === 'np';
  const k = await sheet({
    title: t.title, sub: `${t.artist} — ${t.album}`, artKey: t.artKey,
    items: [
      !isNp && { k: 'next', label: 'Play Next', icon: I.playNext },
      !isNp && { k: 'later', label: 'Play Last', icon: I.playLast },
      { k: 'pl', label: 'Add to Playlist…', icon: I.playlist },
      { k: 'like', label: t.liked ? 'Remove from Liked Songs' : 'Love', icon: t.liked ? I.heartFill : I.heart },
      { k: 'album', label: 'Go to Album', icon: I.album },
      { k: 'artist', label: 'Go to Artist', icon: I.artist },
      isNp && { k: 'speed', label: `Playback Speed (${S.settings.speed}×)`, icon: I.speed },
      isNp && { k: 'eq', label: `Equalizer${S.settings.eqOn ? ` (${S.settings.eqPreset})` : ''}`, icon: I.eq },
      isNp && { k: 'sleep', label: 'Sleep Timer', icon: I.moon },
      { k: 'edit', label: 'Edit Info & Lyrics', icon: I.edit },
      inPl && { k: 'rmpl', label: 'Remove from Playlist', icon: I.minus, danger: true },
      { k: 'del', label: 'Delete from Library', icon: I.trash, danger: true },
    ],
  });
  switch (k) {
    case 'next': addNext([id]); break;
    case 'later': addLater([id]); break;
    case 'pl': choosePlaylist([id]); break;
    case 'like': toggleLike(t); break;
    case 'album': closePlayer(); go({ v: 'album', key: albumKey(t) }); break;
    case 'artist': closePlayer(); go({ v: 'artist', key: norm(t.artist || 'Unknown Artist') }); break;
    case 'speed': speedSheet(); break;
    case 'eq': eqSheet(); break;
    case 'sleep': sleepSheet(); break;
    case 'edit': editTrack(t); break;
    case 'rmpl': {
      const p = S.playlists.get(inPl[1]);
      if (p) { p.ids.splice(+inPl[2], 1); await savePlaylist(p); S.ver++; render(); toast('Removed from playlist'); }
      break;
    }
    case 'del':
      if (await confirmSheet(`Delete “${t.title}”?`, 'This removes the song from this device. It cannot be undone.')) deleteTracks([id]);
      break;
  }
}

async function collectionMenu(kind, key) {
  let ids = [], title = '', sub = '', artKey, extra = [];
  const L = lib();
  if (kind === 'album') {
    const a = L.albumMap.get(key); if (!a) return;
    ids = a.tracks.map((t) => t.id); title = a.title; sub = a.artist; artKey = a.artKey;
    extra = [{ k: 'editAlbum', label: 'Edit Album Info', icon: I.edit }, { k: 'artAlbum', label: 'Change Artwork', icon: I.image }, { k: 'delAll', label: 'Delete Album', icon: I.trash, danger: true }];
  } else if (kind === 'artist') {
    const a = L.artistMap.get(key); if (!a) return;
    ids = a.tracks.map((t) => t.id); title = a.name; sub = plural(ids.length, 'song'); artKey = a.artKey;
  } else if (kind === 'playlist') {
    const p = S.playlists.get(key); if (!p) return;
    ids = p.ids; title = p.name; sub = plural(ids.length, 'song');
    extra = [{ k: 'addSongs', label: 'Add Songs', icon: I.plus }, { k: 'editPl', label: 'Edit Name & Description', icon: I.edit }, { k: 'delPl', label: 'Delete Playlist', icon: I.trash, danger: true }];
  } else if (kind === 'list') {
    ids = lists[key]?.ids || []; title = lists[key]?.ctx?.label || 'Songs'; sub = plural(ids.length, 'song');
  }
  const k = await sheet({
    title, sub, artKey,
    items: [
      { k: 'next', label: 'Play Next', icon: I.playNext },
      { k: 'later', label: 'Play Last', icon: I.playLast },
      { k: 'pl', label: 'Add to Playlist…', icon: I.playlist },
      kind !== 'playlist' && { k: 'newpl', label: 'Save as New Playlist', icon: I.plus },
      ...extra,
    ],
  });
  if (!k) return;
  if (k === 'next') addNext(ids);
  else if (k === 'later') addLater(ids);
  else if (k === 'pl') choosePlaylist(ids);
  else if (k === 'newpl') { const p = await createPlaylist(ids); if (p) toast(`Created ${p.name}`); }
  else if (k === 'editAlbum') {
    const a = L.albumMap.get(key);
    const v = await ask({ title: 'Edit Album', fields: [
      { name: 'album', label: 'Album', value: a.title }, { name: 'albumArtist', label: 'Album Artist', value: a.artist },
      { name: 'genre', label: 'Genre', value: a.genre || '' }, { name: 'year', label: 'Year', value: a.year || '', type: 'number' }] });
    if (!v) return;
    for (const t of a.tracks) {
      t.album = v.album || 'Unknown Album'; t.albumArtist = v.albumArtist; if (v.genre) t.genre = v.genre; if (v.year) t.year = String(v.year);
      await saveTrack(t);
    }
    S.ver++;
    const r = route(); if (r.v === 'album') r.key = albumKey(a.tracks[0]);
    render(); updateNP(); toast('Album updated');
  } else if (k === 'artAlbum') {
    const v = await ask({ title: 'Album Artwork', ok: 'Save', fields: [{ name: 'art', label: 'Choose an image', type: 'file' }] });
    if (!v?.art) return;
    const nk = await storeArtwork(v.art);
    for (const t of L.albumMap.get(key).tracks) { t.artKey = nk; await saveTrack(t); }
    S.ver++; render(); updateNP(); toast('Artwork updated');
  } else if (k === 'delAll') {
    if (await confirmSheet(`Delete “${title}”?`, `Removes ${plural(ids.length, 'song')} from this device.`)) { deleteTracks(ids); back(); }
  } else if (k === 'addSongs') addSongsToPlaylist(key);
  else if (k === 'editPl') {
    const p = S.playlists.get(key);
    const v = await ask({ title: 'Edit Playlist', fields: [{ name: 'name', label: 'Name', value: p.name }, { name: 'desc', label: 'Description', value: p.desc }] });
    if (!v) return;
    p.name = v.name || p.name; p.desc = v.desc; await savePlaylist(p); S.ver++; render();
  } else if (k === 'delPl') {
    if (await confirmSheet(`Delete “${title}”?`, 'The songs stay in your library.')) {
      S.playlists.delete(key); await db.del('playlists', key); S.ver++; back();
    }
  }
}

async function addSongsToPlaylist(id) {
  const p = S.playlists.get(id);
  if (!p) return;
  const ids = await pickSongs(`Add to ${p.name}`, new Set(p.ids));
  if (!ids?.length) return;
  p.ids.push(...ids); await savePlaylist(p); S.ver++; render();
  toast(`Added ${plural(ids.length, 'song')}`);
}

async function speedSheet() {
  const speeds = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const k = await sheet({ title: 'Playback Speed', items: speeds.map((s) => ({ k: String(s), label: `${s}×`, checked: s === S.settings.speed })) });
  if (!k) return;
  S.settings.speed = +k;
  audio.defaultPlaybackRate = audio.playbackRate = +k;
  saveSettings(); render();
}

async function sleepSheet() {
  const k = await sheet({
    title: 'Sleep Timer', sub: S.sleep ? (S.sleep.eot ? 'Stopping at end of song' : `${fmt((S.sleep.at - Date.now()) / 1000)} left`) : 'Stop playback after…',
    items: [
      S.sleep && { k: 'off', label: 'Turn Off Timer', danger: true, icon: I.close },
      ...[5, 10, 15, 30, 45, 60, 90].map((m) => ({ k: String(m), label: `${m} minutes`, icon: I.clock })),
      { k: 'eot', label: 'End of Current Song', icon: I.music },
    ],
  });
  if (!k) return;
  setSleep(k === 'off' ? null : k === 'eot' ? 'eot' : +k);
}

function eqSheet() {
  const st = S.settings;
  const lbl = (f) => (f >= 1000 ? `${f / 1000}k` : f);
  const body = `<div class="eq">
    <div class="eq-head"><div><b>Equalizer</b><div class="muted sm" id="eq-preset-lbl">${esc(st.eqPreset)}</div></div>
      <label class="switch"><input type="checkbox" id="eq-on" ${st.eqOn ? 'checked' : ''}><span></span></label></div>
    <div class="chips">${Object.keys(EQ_PRESETS).map((p) => `<button class="chip ${p === st.eqPreset ? 'on' : ''}" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <div class="eq-bands">${EQ_FREQS.map((f, i) => `<label class="eq-band"><span class="eq-f">${lbl(f)}</span><input type="range" min="-12" max="12" step="0.5" value="${st.eqGains[i]}" data-b="${i}"><span class="eq-db">${st.eqGains[i] > 0 ? '+' : ''}${st.eqGains[i]}</span></label>`).join('')}</div>
    <p class="muted sm">The equalizer runs through Web Audio. If music stops when your phone locks, turn it off and reopen the app.</p></div>`;
  sheet({
    body,
    onMount(w) {
      const sync = () => {
        $$('.eq-band input', w).forEach((r, i) => { r.value = st.eqGains[i]; r.nextElementSibling.textContent = `${st.eqGains[i] > 0 ? '+' : ''}${st.eqGains[i]}`; });
        $$('.chip', w).forEach((c) => c.classList.toggle('on', c.dataset.p === st.eqPreset));
        $('#eq-preset-lbl', w).textContent = st.eqPreset;
        w.querySelector('.eq').classList.toggle('off', !st.eqOn);
      };
      sync();
      $('#eq-on', w).addEventListener('change', (e) => {
        st.eqOn = e.target.checked;
        if (st.eqOn) { ensureEQ(); actx?.resume?.(); }
        applyEQ(); saveSettings(); sync();
      });
      w.addEventListener('click', (e) => {
        const c = e.target.closest('.chip'); if (!c) return;
        st.eqPreset = c.dataset.p; st.eqGains = [...EQ_PRESETS[c.dataset.p]];
        if (!st.eqOn) { st.eqOn = true; $('#eq-on', w).checked = true; ensureEQ(); actx?.resume?.(); }
        applyEQ(); saveSettings(); sync();
      });
      w.addEventListener('input', (e) => {
        const r = e.target.closest('.eq-band input'); if (!r) return;
        st.eqGains[+r.dataset.b] = +r.value; st.eqPreset = 'Custom';
        r.nextElementSibling.textContent = `${+r.value > 0 ? '+' : ''}${r.value}`;
        $('#eq-preset-lbl', w).textContent = 'Custom';
        $$('.chip', w).forEach((c) => c.classList.remove('on'));
        applyEQ(); saveSettings();
      });
    },
  });
}

/* =====================================================================
   Navigation
   ===================================================================== */
const route = () => { const st = S.stacks[S.tab]; return st[st.length - 1]; };
function go(r) {
  route().scroll = window.scrollY;
  S.stacks[S.tab].push(r);
  render(); window.scrollTo(0, 0);
}
function back() {
  const st = S.stacks[S.tab];
  if (st.length > 1) { st.pop(); render(); window.scrollTo(0, route().scroll || 0); }
}
function switchTab(t) {
  if (S.tab === t) {
    const st = S.stacks[t];
    if (st.length > 1) { st.length = 1; render(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (t === 'search') $('#search-input')?.focus();
    return;
  }
  route().scroll = window.scrollY;
  S.tab = t; render();
  window.scrollTo(0, route().scroll || 0);
}

/* Registry of rendered song lists, so taps can play the right context */
let lists = {}, listSeq = 0;
function reg(ids, ctx) { const k = 'l' + ++listSeq; lists[k] = { ids, ctx }; return k; }

/* =====================================================================
   View helpers
   ===================================================================== */
const eqBars = '<span class="eqbars"><i></i><i></i><i></i></span>';
function songRow(t, listId, i, o = {}) {
  const lead = o.num ? `<div class="num">${eqBars}<span>${t.track || i + 1}</span></div>` : `<div class="art-wrap">${artHtml(t.artKey, 'sm')}${eqBars}</div>`;
  const sub = o.sub !== undefined ? o.sub : `${t.artist}${o.showAlbum && t.album !== 'Unknown Album' ? ` · ${t.album}` : ''}`;
  return `<div class="row song" data-id="${t.id}">
    <button class="row-main" data-act="playFrom" data-list="${listId}" data-i="${i}">${lead}
      <div class="row-text"><div class="row-title ellipsis">${esc(t.title)}${t.liked ? `<span class="liked">${I.heartFill}</span>` : ''}</div>${sub ? `<div class="row-sub ellipsis">${esc(sub)}</div>` : ''}</div>
      ${o.time ? `<span class="row-time">${fmt(t.duration)}</span>` : ''}</button>
    <button class="icon-btn row-more" data-act="songMenu" data-id="${t.id}" data-ctx="${esc(o.ctx ? o.ctx(i) : '')}" aria-label="More">${I.more}</button></div>`;
}
function songList(tracks, ctx, o = {}) {
  const ids = tracks.map((t) => t.id);
  const L = reg(ids, ctx);
  return { L, html: `<div class="list">${tracks.map((t, i) => songRow(t, L, i, o)).join('')}</div>` };
}
const playBtns = (L) => `<div class="col-btns"><button class="btn-pill" data-act="playList" data-list="${L}">${I.play}Play</button><button class="btn-pill" data-act="shuffleList" data-list="${L}">${I.shuffle}Shuffle</button></div>`;
const goAttr = (r) => `data-act="go" data-r="${rj(r)}"`;
const albumCard = (a) => `<button class="card" ${goAttr({ v: 'album', key: a.key })}>${artHtml(a.artKey, 'lg')}<div class="card-title ellipsis">${esc(a.title)}</div><div class="card-sub ellipsis">${esc(a.artist)}</div></button>`;
const artistCard = (a) => `<button class="card round" ${goAttr({ v: 'artist', key: a.key })}>${artHtml(a.artKey, 'lg round')}<div class="card-title ellipsis">${esc(a.name)}</div></button>`;
const playlistCard = (p) => `<button class="card" ${goAttr({ v: 'playlist', id: p.id })}>${mosaicHtml(p.ids.map((id) => S.tracks.get(id)).filter(Boolean), 'lg')}<div class="card-title ellipsis">${esc(p.name)}</div><div class="card-sub">${plural(p.ids.length, 'song')}</div></button>`;
const mixCard = (m) => `<button class="card" ${goAttr({ v: 'mix', id: m.id })}>${mixArt(m, 'lg')}<div class="card-title ellipsis">${esc(m.title)}</div><div class="card-sub ellipsis">${esc(m.sub)}</div></button>`;
const section = (title, inner, more) => `<section class="sec"><div class="sec-head"><h2>${esc(title)}</h2>${more ? `<button class="link" ${goAttr(more)}>See All</button>` : ''}</div>${inner}</section>`;
const carousel = (cards) => `<div class="hscroll">${cards.join('')}</div>`;
const navRow = (icon, label, r, value = '') => `<button class="nav-row" ${goAttr(r)}><span class="nav-ico">${icon}</span><span class="nav-lbl">${esc(label)}</span><span class="nav-val">${esc(value)}</span>${I.chevR}</button>`;
const empty = (title, text, btn = '') => `<div class="empty"><div class="empty-ico">${I.music}</div><h3>${esc(title)}</h3><p>${text}</p>${btn}</div>`;
const importBtn = `<button class="btn-pill accent" data-act="import">${I.import}Import Music</button>`;

function installBanner() {
  if (isStandalone() || !S.settings.installHint) return '';
  return `<div class="banner"><div class="banner-ico">${I.sparkle}</div><div class="banner-text"><b>Install Pulse on your Home Screen</b>
    <p>In Safari tap <b>Share</b> → <b>Add to Home Screen</b>. Then open Pulse from the Home Screen and import your music there — Safari tabs and the installed app keep separate libraries.</p></div>
    <button class="icon-btn" data-act="hideInstall" aria-label="Dismiss">${I.close}</button></div>`;
}

/* =====================================================================
   Views
   ===================================================================== */
const V = {};

V.home = () => {
  const h = new Date().getHours();
  const title = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const actions = `<button class="icon-btn" ${goAttr({ v: 'settings' })} aria-label="Settings">${I.settings}</button>`;
  if (!S.tracks.size) return { title, actions, html: installBanner() + empty('Your music, your phone', 'Import songs from the Files app — MP3, M4A/AAC, ALAC, FLAC and WAV. Everything stays on this device and plays offline.', importBtn) };
  const L = lib();
  const liked = [...S.tracks.values()].filter((t) => t.liked);
  const recentAlbums = [...L.albums].filter((a) => a.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 12);
  const added = [...L.albums].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
  const top = [...S.tracks.values()].filter((t) => t.playCount).sort((a, b) => b.playCount - a.playCount).slice(0, 5);
  const pls = [...S.playlists.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const topArtists = [...L.artists].sort((a, b) => b.plays - a.plays || b.tracks.length - a.tracks.length).slice(0, 12);
  const mx = mixes();

  const tile = (art, label, attr) => `<button class="tile" ${attr}>${art}<span class="ellipsis">${esc(label)}</span></button>`;
  const tiles = [
    tile(`<div class="art xs heart-art">${I.heartFill}</div>`, 'Liked Songs', goAttr({ v: 'liked' })),
    tile(`<div class="art xs shuffle-art">${I.shuffle}</div>`, 'Shuffle All', 'data-act="shuffleAll"'),
    ...mx.slice(0, 2).map((m) => tile(mixArt(m, 'xs'), m.title, goAttr({ v: 'mix', id: m.id }))),
    ...pls.slice(0, 2).map((p) => tile(mosaicHtml(p.ids.map((id) => S.tracks.get(id)).filter(Boolean), 'xs'), p.name, goAttr({ v: 'playlist', id: p.id }))),
  ].slice(0, 6);

  let html = installBanner() + `<div class="tiles">${tiles.join('')}</div>`;
  if (recentAlbums.length) html += section('Recently Played', carousel(recentAlbums.map(albumCard)));
  if (mx.length) html += section('Made for You', carousel(mx.map(mixCard)));
  html += section('Recently Added', carousel(added.map(albumCard)), { v: 'recent' });
  if (top.length) { const { html: h2 } = songList(top, { label: 'Top Songs' }, { showAlbum: true }); html += section('Your Top Songs', h2); }
  if (pls.length) html += section('Your Playlists', carousel(pls.map(playlistCard)), { v: 'playlists' });
  if (topArtists.length > 1) html += section('Artists', carousel(topArtists.map(artistCard)), { v: 'artists' });
  html += `<p class="footnote">${plural(S.tracks.size, 'song')} · ${plural(L.albums.length, 'album')} · ${plural(L.artists.length, 'artist')}</p>`;
  return { title, actions, html };
};

V.library = () => {
  const L = lib();
  const liked = [...S.tracks.values()].filter((t) => t.liked).length;
  const actions = `<button class="icon-btn" data-act="import" aria-label="Import music">${I.plus}</button>`;
  let html = `<div class="nav-list">
    ${navRow(I.playlist, 'Playlists', { v: 'playlists' }, S.playlists.size || '')}
    ${navRow(I.artist, 'Artists', { v: 'artists' }, L.artists.length || '')}
    ${navRow(I.album, 'Albums', { v: 'albums' }, L.albums.length || '')}
    ${navRow(I.music, 'Songs', { v: 'songs' }, S.tracks.size || '')}
    ${navRow(I.genre, 'Genres', { v: 'genres' }, L.genres.length || '')}
    ${navRow(I.heart, 'Liked Songs', { v: 'liked' }, liked || '')}
    ${navRow(I.clock, 'Recently Added', { v: 'recent' })}
  </div>`;
  if (!S.tracks.size) html += empty('No music yet', 'Tap Import to add songs from the Files app.', importBtn);
  else {
    const added = [...L.albums].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
    html += section('Recently Added', `<div class="grid">${added.map(albumCard).join('')}</div>`);
  }
  return { title: 'Library', actions, html };
};

const SONG_SORTS = {
  title: ['Title', (a, b) => cmp(a.title, b.title)],
  artist: ['Artist', (a, b) => cmp(a.artist, b.artist) || cmp(a.album, b.album) || (a.track || 0) - (b.track || 0)],
  album: ['Album', (a, b) => cmp(a.album, b.album) || (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0)],
  added: ['Recently Added', (a, b) => b.addedAt - a.addedAt],
  plays: ['Most Played', (a, b) => (b.playCount || 0) - (a.playCount || 0) || cmp(a.title, b.title)],
  duration: ['Duration', (a, b) => (b.duration || 0) - (a.duration || 0)],
};
V.songs = () => {
  const sort = SONG_SORTS[S.settings.songSort] || SONG_SORTS.title;
  const tracks = [...S.tracks.values()].sort(sort[1]);
  if (!tracks.length) return { title: 'Songs', html: empty('No songs', 'Import music to get started.', importBtn) };
  const { L, html } = songList(tracks, { label: 'Songs', r: { v: 'songs' } }, { showAlbum: true });
  const sel = `<label class="sort">Sort: <select data-change="songSort">${Object.entries(SONG_SORTS).map(([k, [lbl]]) => `<option value="${k}" ${k === S.settings.songSort ? 'selected' : ''}>${lbl}</option>`).join('')}</select>${I.chevD}</label>`;
  return { title: 'Songs', html: `${playBtns(L)}<div class="list-tools"><span class="muted sm">${plural(tracks.length, 'song')} · ${fmtLong(tracks.reduce((s, t) => s + (t.duration || 0), 0))}</span>${sel}</div>${html}` };
};

V.albums = () => {
  const sorts = { title: (a, b) => cmp(a.title, b.title), artist: (a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title), added: (a, b) => b.addedAt - a.addedAt, year: (a, b) => (b.year || 0) - (a.year || 0) };
  const albums = [...lib().albums].sort(sorts[S.settings.albumSort] || sorts.title);
  if (!albums.length) return { title: 'Albums', html: empty('No albums', 'Import music to get started.', importBtn) };
  const sel = `<label class="sort">Sort: <select data-change="albumSort">${[['title', 'Title'], ['artist', 'Artist'], ['added', 'Recently Added'], ['year', 'Year']].map(([k, l]) => `<option value="${k}" ${k === S.settings.albumSort ? 'selected' : ''}>${l}</option>`).join('')}</select>${I.chevD}</label>`;
  return { title: 'Albums', html: `<div class="list-tools"><span class="muted sm">${plural(albums.length, 'album')}</span>${sel}</div><div class="grid">${albums.map(albumCard).join('')}</div>` };
};

V.artists = () => {
  const artists = lib().artists;
  if (!artists.length) return { title: 'Artists', html: empty('No artists', 'Import music to get started.', importBtn) };
  return { title: 'Artists', html: `<div class="list">${artists.map((a) => `<button class="row" ${goAttr({ v: 'artist', key: a.key })}>${artHtml(a.artKey, 'sm round')}<div class="row-text"><div class="row-title ellipsis">${esc(a.name)}</div><div class="row-sub">${plural(a.albums.size, 'album')} · ${plural(a.tracks.length, 'song')}</div></div>${I.chevR}</button>`).join('')}</div>` };
};

V.genres = () => {
  const g = lib().genres;
  if (!g.length) return { title: 'Genres', html: empty('No genres', 'Songs with a genre tag will show up here.') };
  return { title: 'Genres', html: `<div class="genre-grid">${g.map((x) => `<button class="genre-tile" style="--h:${hue(x.name)}" ${goAttr({ v: 'genre', key: x.key })}><b>${esc(x.name)}</b><span>${plural(x.tracks.length, 'song')}</span></button>`).join('')}</div>` };
};

V.playlists = () => {
  const pls = [...S.playlists.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const liked = [...S.tracks.values()].filter((t) => t.liked);
  return {
    title: 'Playlists',
    html: `<div class="list">
      <button class="row" data-act="newPlaylist"><div class="art sm add-art">${I.plus}</div><div class="row-text"><div class="row-title accent-text">New Playlist…</div></div></button>
      <button class="row" ${goAttr({ v: 'liked' })}><div class="art sm heart-art">${I.heartFill}</div><div class="row-text"><div class="row-title">Liked Songs</div><div class="row-sub">${plural(liked.length, 'song')}</div></div>${I.chevR}</button>
      ${pls.map((p) => `<button class="row" ${goAttr({ v: 'playlist', id: p.id })}>${mosaicHtml(p.ids.map((id) => S.tracks.get(id)).filter(Boolean), 'sm')}<div class="row-text"><div class="row-title ellipsis">${esc(p.name)}</div><div class="row-sub">${plural(p.ids.length, 'song')}</div></div>${I.chevR}</button>`).join('')}
      ${mixes().map((m) => `<button class="row" ${goAttr({ v: 'mix', id: m.id })}>${mixArt(m, 'sm')}<div class="row-text"><div class="row-title ellipsis">${esc(m.title)}</div><div class="row-sub ellipsis">Auto mix · ${esc(m.sub)}</div></div>${I.chevR}</button>`).join('')}
    </div>`,
  };
};

function collectionView({ title, art, subtitle, subAttr = '', meta, tracks, ctx, opts = {}, menu = '', desc = '', after = '', emptyHtml = '' }) {
  const { L, html } = songList(tracks, ctx, opts);
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const actions = `<button class="icon-btn" ${menu || `data-act="listMenu" data-list="${L}"`} aria-label="More">${I.more}</button>`;
  return {
    title, actions, large: false,
    html: `<div class="col-head">${art}<h1 class="col-title">${esc(title)}</h1>
      ${subtitle ? `<button class="col-sub accent-text" ${subAttr}>${esc(subtitle)}</button>` : ''}
      ${meta ? `<div class="col-meta">${esc(meta)}</div>` : ''}${desc ? `<p class="col-desc">${esc(desc)}</p>` : ''}
      ${tracks.length ? playBtns(L) : ''}</div>
      ${tracks.length ? html : emptyHtml}
      ${tracks.length ? `<p class="footnote">${plural(tracks.length, 'song')}, ${fmtLong(total)}</p>` : ''}${after}`,
  };
}

V.album = (r) => {
  const a = lib().albumMap.get(r.key);
  if (!a) return { title: 'Album', html: empty('Album not found', 'It may have been deleted.') };
  const multiDisc = new Set(a.tracks.map((t) => t.disc || 1)).size > 1;
  const res = collectionView({
    title: a.title, art: artHtml(a.artKey, 'xl'), subtitle: a.artist, subAttr: goAttr({ v: 'artist', key: norm(a.artist) }),
    meta: [a.genre, a.year].filter(Boolean).join(' · '), tracks: a.tracks, ctx: { label: a.title, r },
    opts: { num: true, time: true, sub: '' }, menu: `data-act="colMenu" data-kind="album" data-key="${esc(a.key)}"`,
  });
  if (multiDisc) { // insert disc headers
    let lastDisc = null;
    res.html = res.html.replace(/<div class="row song" data-id="([^"]+)">/g, (m, id) => {
      const d = S.tracks.get(id)?.disc || 1;
      if (d === lastDisc) return m;
      lastDisc = d;
      return `<div class="disc">Disc ${d}</div>${m}`;
    });
  }
  return res;
};

V.artist = (r) => {
  const a = lib().artistMap.get(r.key);
  if (!a) return { title: 'Artist', html: empty('Artist not found', 'It may have been deleted.') };
  const albums = [...a.albums].map((k) => lib().albumMap.get(k)).filter(Boolean).sort((x, y) => (y.year || 0) - (x.year || 0) || cmp(x.title, y.title));
  const top = [...a.tracks].sort((x, y) => (y.playCount || 0) - (x.playCount || 0) || cmp(x.album, y.album) || (x.track || 0) - (y.track || 0));
  const { L: L2, html } = songList(top, { label: a.name, r }, { sub: '', showAlbum: false });
  return {
    title: a.name, large: false,
    actions: `<button class="icon-btn" data-act="colMenu" data-kind="artist" data-key="${esc(a.key)}" aria-label="More">${I.more}</button>`,
    html: `<div class="col-head artist-head">${artHtml(a.artKey, 'xl round')}<h1 class="col-title">${esc(a.name)}</h1><div class="col-meta">${plural(albums.length, 'album')} · ${plural(a.tracks.length, 'song')}${a.plays ? ` · ${plural(a.plays, 'play')}` : ''}</div>${playBtns(L2)}</div>
      ${section('Albums', carousel(albums.map(albumCard)))}
      ${section('Songs', html)}`,
  };
};

V.playlist = (r) => {
  const p = S.playlists.get(r.id);
  if (!p) return { title: 'Playlist', html: empty('Playlist not found', 'It may have been deleted.') };
  const tracks = p.ids.map((id) => S.tracks.get(id)).filter(Boolean);
  return collectionView({
    title: p.name, art: mosaicHtml(tracks, 'xl'), desc: p.desc, meta: `Playlist · Updated ${new Date(p.updatedAt || p.createdAt).toLocaleDateString()}`,
    tracks, ctx: { label: p.name, r }, opts: { showAlbum: true, ctx: (i) => `pl:${p.id}:${i}` },
    menu: `data-act="colMenu" data-kind="playlist" data-key="${p.id}"`,
    emptyHtml: empty('This playlist is empty', 'Add songs from your library.', `<button class="btn-pill accent" data-act="addSongs" data-id="${p.id}">${I.plus}Add Songs</button>`),
    after: tracks.length ? `<div class="center"><button class="btn-pill" data-act="addSongs" data-id="${p.id}">${I.plus}Add Songs</button></div>` : '',
  });
};

V.liked = (r) => {
  const tracks = [...S.tracks.values()].filter((t) => t.liked).sort((a, b) => cmp(a.title, b.title));
  return collectionView({ title: 'Liked Songs', art: `<div class="art xl heart-art">${I.heartFill}</div>`, meta: 'Songs you love', tracks, ctx: { label: 'Liked Songs', r }, opts: { showAlbum: true },
    emptyHtml: empty('No liked songs yet', 'Tap the heart on any song to save it here.') });
};

V.recent = (r) => {
  const tracks = [...S.tracks.values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, 200);
  return collectionView({ title: 'Recently Added', art: `<div class="art xl clock-art">${I.clock}</div>`, meta: 'Latest imports', tracks, ctx: { label: 'Recently Added', r }, opts: { showAlbum: true } });
};

V.genre = (r) => {
  const g = lib().genreMap.get(r.key);
  if (!g) return { title: 'Genre', html: empty('Genre not found', '') };
  const tracks = [...g.tracks].sort((a, b) => cmp(a.artist, b.artist) || cmp(a.album, b.album) || (a.track || 0) - (b.track || 0));
  return collectionView({ title: g.name, art: `<div class="art xl mixart" style="--h:${hue(g.name)}"><span>${esc(g.name)}</span></div>`, meta: 'Genre', tracks, ctx: { label: g.name, r }, opts: { showAlbum: true } });
};

V.mix = (r) => {
  const m = mixes().find((x) => x.id === r.id);
  if (!m) return { title: 'Mix', html: empty('Mix unavailable', 'Listen to more music and it will come back.') };
  const tracks = m.ids.map((id) => S.tracks.get(id)).filter(Boolean);
  return collectionView({ title: m.title, art: mixArt(m, 'xl'), meta: m.sub, tracks, ctx: { label: m.title, r }, opts: { showAlbum: true } });
};

V.search = () => ({
  title: 'Search',
  html: `<div class="search-bar"><div class="search-field">${I.search}<input id="search-input" type="search" placeholder="Songs, artists, albums, lyrics" value="${esc(S.query)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></div></div><div id="search-results"></div>`,
  after() {
    const inp = $('#search-input');
    let tm;
    inp.addEventListener('input', () => { S.query = inp.value; clearTimeout(tm); tm = setTimeout(renderSearch, 120); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); saveRecentSearch(); } });
    renderSearch();
  },
});
function saveRecentSearch() {
  const q = S.query.trim();
  if (!q) return;
  S.recentSearches = [q, ...S.recentSearches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10);
  db.put('kv', S.recentSearches, 'recentSearches');
}
function renderSearch() {
  const el = $('#search-results');
  if (!el) return;
  const q = norm(S.query.trim());
  if (!q) {
    const g = lib().genres;
    el.innerHTML = (S.recentSearches.length ? section('Recent Searches', `<div class="list">${S.recentSearches.map((s) => `<button class="row recent" data-act="useSearch" data-q="${esc(s)}">${I.clock}<span class="row-title ellipsis">${esc(s)}</span></button>`).join('')}</div><div class="center"><button class="link" data-act="clearRecent">Clear Recent Searches</button></div>`) : '')
      + (g.length ? section('Browse Genres', `<div class="genre-grid">${g.map((x) => `<button class="genre-tile" style="--h:${hue(x.name)}" ${goAttr({ v: 'genre', key: x.key })}><b>${esc(x.name)}</b><span>${plural(x.tracks.length, 'song')}</span></button>`).join('')}</div>`) : '')
      + (!S.tracks.size ? empty('Nothing to search yet', 'Import some music first.', importBtn) : '');
    observeArt(el);
    return;
  }
  const terms = q.split(/\s+/);
  const matchAll = (s) => terms.every((w) => s.includes(w));
  const L = lib();
  const tracks = [...S.tracks.values()].filter((t) => matchAll(norm(`${t.title} ${t.artist} ${t.album} ${t.albumArtist} ${t.genre}`)))
    .sort((a, b) => (norm(b.title).startsWith(q) - norm(a.title).startsWith(q)) || (b.playCount || 0) - (a.playCount || 0));
  const lyricHits = [...S.tracks.values()].filter((t) => t.lyrics && !tracks.includes(t) && norm(t.lyrics).includes(q)).slice(0, 10);
  const artists = L.artists.filter((a) => matchAll(norm(a.name))).slice(0, 10);
  const albums = L.albums.filter((a) => matchAll(norm(`${a.title} ${a.artist}`))).slice(0, 12);
  const pls = [...S.playlists.values()].filter((p) => matchAll(norm(p.name)));
  let html = '';
  if (artists.length) html += section('Artists', carousel(artists.map(artistCard)));
  if (tracks.length) html += section('Songs', songList(tracks.slice(0, 60), { label: `Search “${S.query.trim()}”` }, { showAlbum: true }).html);
  if (albums.length) html += section('Albums', carousel(albums.map(albumCard)));
  if (pls.length) html += section('Playlists', carousel(pls.map(playlistCard)));
  if (lyricHits.length) html += section('In Lyrics', songList(lyricHits, { label: 'Lyrics search' }, { showAlbum: true }).html);
  el.innerHTML = html || `<div class="empty small"><p>No results for “${esc(S.query.trim())}”.</p></div>`;
  observeArt(el); markPlaying();
}

V.settings = () => {
  const st = S.settings;
  const L = lib();
  const totalSize = [...S.tracks.values()].reduce((s, t) => s + (t.size || 0), 0);
  const totalDur = [...S.tracks.values()].reduce((s, t) => s + (t.duration || 0), 0);
  const swatches = ['#f43f5e', '#ff6b35', '#f59e0b', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899'];
  const row = (label, value, attr = '', icon = '') => `<button class="set-row" ${attr}>${icon ? `<span class="nav-ico">${icon}</span>` : ''}<span class="nav-lbl">${esc(label)}</span><span class="nav-val">${value}</span>${attr ? I.chevR : ''}</button>`;
  return {
    title: 'Settings',
    html: `
    <div class="set-group"><div class="set-title">Library</div>
      ${row('Import Music', '', 'data-act="import"', I.import)}
      ${row('Songs', `${S.tracks.size}`, '', I.music)}
      ${row('Albums', `${L.albums.length}`, '', I.album)}
      ${row('Total length', fmtLong(totalDur), '', I.clock)}
      ${row('Music size', fmtBytes(totalSize), '', I.library)}
      ${row('Device storage', '<span id="st-usage">…</span>', '', I.sparkle)}
    </div>
    <div class="set-group"><div class="set-title">Playback</div>
      ${row('Equalizer', st.eqOn ? esc(st.eqPreset) : 'Off', 'data-act="eq"', I.eq)}
      ${row('Playback Speed', `${st.speed}×`, 'data-act="speed"', I.speed)}
      ${row('Sleep Timer', S.sleep ? (S.sleep.eot ? 'End of song' : 'On') : 'Off', 'data-act="sleep"', I.moon)}
    </div>
    <div class="set-group"><div class="set-title">Appearance</div>
      <div class="set-row static"><span class="nav-lbl">Theme</span>
        <div class="seg">${['system', 'dark', 'light'].map((t) => `<button class="${st.theme === t ? 'on' : ''}" data-act="theme" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <div class="set-row static"><span class="nav-lbl">Accent</span>
        <div class="swatches">${swatches.map((c) => `<button class="swatch ${st.accent === c ? 'on' : ''}" style="--c:${c}" data-act="accent" data-v="${c}" aria-label="Accent ${c}"></button>`).join('')}</div></div>
    </div>
    <div class="set-group"><div class="set-title">Install</div>
      <div class="set-text">${isStandalone() ? 'Pulse is installed. Music you import here stays on this iPhone and plays offline.' : 'In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>, then open Pulse from your Home Screen and import your music there.'}
      <br><br>Lock-screen controls, AirPlay and background playback work once installed. Tip: tap <b>Import Music</b> and choose a whole folder's worth of songs at once in the Files picker (tap <b>Select</b>).</div>
    </div>
    <div class="set-group"><div class="set-title">Danger Zone</div>
      ${row('Delete All Music', '', 'data-act="wipe"', I.trash).replace('set-row', 'set-row danger')}
    </div>
    <p class="footnote">Pulse 1.0 · Everything stays on your device.</p>`,
    after() {
      navigator.storage?.estimate?.().then((e) => {
        const el = $('#st-usage');
        if (el) el.textContent = `${fmtBytes(e.usage || 0)} of ${fmtBytes(e.quota || 0)}`;
      }).catch(() => {});
    },
  };
};

/* =====================================================================
   Render
   ===================================================================== */
function render() {
  lists = {}; listSeq = 0;
  const r = route();
  const res = (V[r.v] || V.home)(r);
  r.title = res.title;
  const st = S.stacks[S.tab];
  const prevTitle = st.length > 1 ? st[st.length - 2].title || 'Back' : '';
  const large = res.large !== false;
  $('#view').innerHTML = `
    <div class="navbar ${large ? '' : 'detail'}">
      <div class="nav-left">${st.length > 1 ? `<button class="nav-back" data-act="back">${I.chevL}<span class="ellipsis">${esc(prevTitle)}</span></button>` : ''}</div>
      <div class="nav-title ellipsis">${esc(res.title)}</div>
      <div class="nav-right">${res.actions || ''}</div>
    </div>
    ${large ? `<h1 class="large-title">${esc(res.title)}</h1>` : ''}
    <div class="content">${res.html}</div>`;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  res.after?.();
  observeArt($('#view'));
  markPlaying();
  onScroll();
}
function onScroll() {
  const nb = $('.navbar');
  if (nb) nb.classList.toggle('scrolled', window.scrollY > (nb.classList.contains('detail') ? 220 : 40));
}
window.addEventListener('scroll', onScroll, { passive: true });

/* =====================================================================
   Event delegation
   ===================================================================== */
const A = {
  back,
  tab: (el) => switchTab(el.dataset.tab),
  go: (el) => go(JSON.parse(el.dataset.r)),
  playFrom: (el) => { const L = lists[el.dataset.list]; if (L) playIds(L.ids, +el.dataset.i, L.ctx); },
  playList: (el) => { const L = lists[el.dataset.list]; if (L) playIds(L.ids, 0, L.ctx, { shuffle: false }); },
  shuffleList: (el) => { const L = lists[el.dataset.list]; if (L) playIds(L.ids, 0, L.ctx, { shuffle: true }); },
  shuffleAll,
  songMenu: (el) => songMenu(el.dataset.id, el.dataset.ctx),
  colMenu: (el) => collectionMenu(el.dataset.kind, el.dataset.key),
  listMenu: (el) => collectionMenu('list', el.dataset.list),
  import: () => $('#file-input').click(),
  newPlaylist: () => createPlaylist(),
  addSongs: (el) => addSongsToPlaylist(el.dataset.id),
  toggle: () => togglePlay(),
  next: () => { unlock(); next(); },
  prev: () => { unlock(); prev(); },
  shuffle: () => setShuffle(!S.shuffle),
  repeat: cycleRepeat,
  openPlayer,
  closePlayer,
  npMenu: () => curId() && songMenu(curId(), 'np'),
  npLike: () => { const t = curTrack(); if (t) toggleLike(t); },
  npArtist: () => { const t = curTrack(); if (t) { closePlayer(); go({ v: 'artist', key: norm(t.artist) }); } },
  fromCtx: () => { if (S.context?.r) { closePlayer(); go(S.context.r); } },
  npMode: (el) => setNpMode(el.dataset.mode),
  airplay: () => {
    if (audio.webkitShowPlaybackTargetPicker) audio.webkitShowPlaybackTargetPicker();
    else toast('Use Control Center to pick an AirPlay or Bluetooth speaker');
  },
  sleep: sleepSheet,
  speed: speedSheet,
  eq: eqSheet,
  seekLine: (el) => { audio.currentTime = +el.dataset.t; if (audio.paused) togglePlay(); },
  editCurrent: () => { const t = curTrack(); if (t) editTrack(t); },
  qJump: (el) => { unlock(); loadTrack(+el.dataset.qi, true); },
  qRemove: (el) => { const i = +el.dataset.qi; const [id] = S.queue.splice(i, 1); if (S.original) { const p = S.original.lastIndexOf(id); if (p >= 0) S.original.splice(p, 1); } renderQueue(); saveSession(true); },
  qClear: () => { S.queue.length = S.index + 1; if (S.original) S.original = [...S.queue]; renderQueue(); saveSession(true); },
  useSearch: (el) => { S.query = el.dataset.q; $('#search-input').value = S.query; renderSearch(); },
  clearRecent: () => { S.recentSearches = []; db.put('kv', [], 'recentSearches'); renderSearch(); },
  hideInstall: () => { S.settings.installHint = false; saveSettings(); render(); },
  theme: (el) => { S.settings.theme = el.dataset.v; applyTheme(); saveSettings(); render(); },
  accent: (el) => { S.settings.accent = el.dataset.v; applyTheme(); saveSettings(); render(); },
  wipe: async () => {
    if (!(await confirmSheet('Delete all music?', `This removes ${plural(S.tracks.size, 'song')}, all playlists and artwork from this device.`, 'Delete Everything'))) return;
    audio.pause(); audio.removeAttribute('src'); curUrl = null;
    await Promise.all(['tracks', 'audio', 'art', 'playlists'].map((s) => db.clear(s)));
    await db.del('kv', 'session');
    S.tracks.clear(); S.playlists.clear(); S.queue = []; S.index = -1; S.original = null; S.ver++;
    artCache.clear(); closePlayer(); updateNP(); render();
    toast('Library cleared');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('.sheet-wrap')) return;
  const fn = A[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  S.settings[el.dataset.change] = el.value;
  saveSettings(); render();
});
$('#file-input').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });

/* Drag & drop import on desktop */
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files); });

/* Keyboard shortcuts (iPad / desktop) */
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) next();
  else if (e.key === 'ArrowLeft' && e.shiftKey) prev();
  else if (e.key === 'Escape') closePlayer();
});

function applyTheme() {
  const st = S.settings;
  document.documentElement.style.setProperty('--accent', st.accent);
  if (st.theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = st.theme;
}

/* =====================================================================
   Boot
   ===================================================================== */
async function init() {
  $$('[data-icon]').forEach((e) => e.insertAdjacentHTML('afterbegin', I[e.dataset.icon] || ''));
  $('#mini-play').innerHTML = I.play; $('#np-play').innerHTML = I.play;
  if (!audio.webkitShowPlaybackTargetPicker && !isIOS()) $('#np-airplay').style.visibility = 'hidden';

  try {
    const [tracks, pls, settings, session, recent] = await Promise.all([
      db.getAll('tracks'), db.getAll('playlists'), db.get('kv', 'settings'), db.get('kv', 'session'), db.get('kv', 'recentSearches'),
    ]);
    for (const t of tracks) S.tracks.set(t.id, t);
    for (const p of pls) S.playlists.set(p.id, p);
    if (settings) S.settings = { ...DEFAULT_SETTINGS, ...settings };
    if (recent) S.recentSearches = recent;
    S.ver++;
    applyTheme();
    updateControls();
    render();
    if (session?.queue?.length) {
      S.queue = session.queue.filter((id) => S.tracks.has(id));
      S.original = session.original ? session.original.filter((id) => S.tracks.has(id)) : null;
      S.shuffle = !!session.shuffle; S.repeat = session.repeat || 'off'; S.context = session.context || null;
      const cur = session.queue[session.index];
      S.index = Math.max(0, S.queue.indexOf(cur));
      if (S.queue.length) { pendingSeek = session.time || 0; updateControls(); updateNP(); loadTrack(S.index, false, session.time || 0); }
    }
  } catch (e) {
    console.error(e);
    render();
    toast('Storage unavailable — private browsing?');
  }
  updatePlayState();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e));
  }
}

window.__pulse.importFiles = importFiles;
window.__pulse.lib = lib;
init();
