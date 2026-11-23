// Reads tags, artwork, lyrics and duration from audio files without loading them fully.
// Supports ID3v1/v2.2/2.3/2.4 (MP3), MP4/M4A (AAC/ALAC), FLAC and WAV.

const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const u32 = (b, o) => b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216;
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const read = async (file, s, e) => new Uint8Array(await file.slice(s, e).arrayBuffer());
const decode = (enc, b) => { try { return new TextDecoder(enc).decode(b); } catch { return latin1(b); } };

const GENRES = ['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack','Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise','Alternative Rock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta','Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychedelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock & Roll','Hard Rock'];

function normGenre(s) {
  if (!s) return '';
  s = String(s).trim();
  const m = s.match(/^\((\d+)\)(.*)$/);
  if (m) return m[2].trim() || GENRES[+m[1]] || '';
  if (/^\d+$/.test(s)) return GENRES[+s] || '';
  return s;
}

function imageMime(data, hint) {
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png';
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif';
  if (latin1(data.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return hint && hint.includes('/') ? hint : 'image/jpeg';
}

// ---------------- ID3v2 ----------------
function textOf(b, enc) {
  if (!b.length) return '';
  let s;
  if (enc === 0) s = latin1(b);
  else if (enc === 1) {
    if (b[0] === 0xfe && b[1] === 0xff) s = decode('utf-16be', b.subarray(2));
    else if (b[0] === 0xff && b[1] === 0xfe) s = decode('utf-16le', b.subarray(2));
    else s = decode('utf-16le', b);
  } else if (enc === 2) s = decode('utf-16be', b);
  else s = decode('utf-8', b);
  // v2.4 separates multiple values with NUL; also strip BOMs that appear mid-string
  return s.replace(/﻿/g, '').replace(/\0+$/, '').split('\0').filter(Boolean).join(', ').trim();
}
const wide = (enc) => enc === 1 || enc === 2;
function termAt(b, start, enc) {
  if (wide(enc)) { for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i; return b.length; }
  const i = b.indexOf(0, start); return i < 0 ? b.length : i;
}
function unsync(b) {
  const out = new Uint8Array(b.length); let j = 0;
  for (let i = 0; i < b.length; i++) { out[j++] = b[i]; if (b[i] === 0xff && b[i + 1] === 0x00) i++; }
  return out.subarray(0, j);
}

const ID3_MAP = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album',
  TPE2: 'albumArtist', TP2: 'albumArtist', TCON: 'genre', TCO: 'genre', TYER: 'year', TYE: 'year',
  TDRC: 'year', TRCK: 'track', TRK: 'track', TPOS: 'disc', TPA: 'disc', TLEN: 'tlen',
};

function id3Frame(id, d, out) {
  if (ID3_MAP[id]) { const v = textOf(d.subarray(1), d[0]); if (v && !out[ID3_MAP[id]]) out[ID3_MAP[id]] = v; return; }
  if (id === 'USLT' || id === 'ULT') {
    const enc = d[0]; const dEnd = termAt(d, 4, enc);
    const txt = textOf(d.subarray(dEnd + (wide(enc) ? 2 : 1)), enc);
    if (txt && !out.lyrics) out.lyrics = txt;
    return;
  }
  if (id === 'TXXX' || id === 'TXX') {
    const enc = d[0]; const dEnd = termAt(d, 1, enc);
    const desc = textOf(d.subarray(1, dEnd), enc).toUpperCase();
    if (/^(LYRICS|UNSYNCEDLYRICS|UNSYNCED LYRICS|USLT)$/.test(desc) && !out.lyrics) out.lyrics = textOf(d.subarray(dEnd + (wide(enc) ? 2 : 1)), enc);
    return;
  }
  if (id === 'APIC' || id === 'PIC') {
    const enc = d[0]; let p, mime, type;
    if (id === 'APIC') { const mEnd = d.indexOf(0, 1); mime = latin1(d.subarray(1, mEnd)); type = d[mEnd + 1]; p = mEnd + 2; }
    else { mime = 'image/' + latin1(d.subarray(1, 4)).toLowerCase(); type = d[4]; p = 5; }
    const dEnd = termAt(d, p, enc);
    const data = d.slice(dEnd + (wide(enc) ? 2 : 1));
    if (data.length < 64) return;
    if (!out.picture || (type === 3 && out.picture.type !== 3)) out.picture = { data, mime: imageMime(data, mime), type };
  }
}

async function parseID3(file, out) {
  const h = await read(file, 0, 10);
  const ver = h[3], flags = h[5], size = syncsafe(h, 6);
  let b = await read(file, 10, 10 + size);
  if ((flags & 0x80) && ver < 4) b = unsync(b);
  let off = 0;
  if (flags & 0x40) off = ver === 4 ? syncsafe(b, 0) : 4 + u32(b, 0);
  while (off < b.length) {
    let id, fsize, fflags = 0, hdr;
    if (ver === 2) {
      if (off + 6 > b.length) break;
      id = latin1(b.subarray(off, off + 3)); fsize = (b[off + 3] << 16) | (b[off + 4] << 8) | b[off + 5]; hdr = 6;
    } else {
      if (off + 10 > b.length) break;
      id = latin1(b.subarray(off, off + 4)); fsize = ver === 4 ? syncsafe(b, off + 4) : u32(b, off + 4);
      fflags = u16(b, off + 8); hdr = 10;
    }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || fsize <= 0) break;
    let d = b.subarray(off + hdr, off + hdr + fsize);
    off += hdr + fsize;
    if (ver === 4) {
      if (fflags & 0x000c) continue; // compressed / encrypted
      if (fflags & 0x0040) d = d.subarray(1);
      if (fflags & 0x0002) d = unsync(d);
      if (fflags & 0x0001) d = d.subarray(4);
    } else if (ver === 3 && (fflags & 0x00c0)) continue;
    try { id3Frame(id, d, out); } catch { /* skip bad frame */ }
  }
  if (out.tlen && !out.duration) out.duration = +out.tlen / 1000 || 0;
  delete out.tlen;
  return 10 + size + (flags & 0x10 ? 10 : 0);
}

async function parseID3v1(file, out) {
  if (file.size < 128) return;
  const b = await read(file, file.size - 128, file.size);
  if (latin1(b.subarray(0, 3)) !== 'TAG') return;
  const s = (a, e) => latin1(b.subarray(a, e)).replace(/\0.*$/, '').trim();
  out.title ||= s(3, 33); out.artist ||= s(33, 63); out.album ||= s(63, 93); out.year ||= s(93, 97);
  if (b[125] === 0 && b[126]) out.track ||= String(b[126]);
  if (b[127] < GENRES.length) out.genre ||= GENRES[b[127]];
}

// ---------------- MP3 duration ----------------
const BR = {
  '3-3': [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
  '3-2': [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
  '3-1': [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  '2-3': [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
  '2-2': [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

async function mp3Duration(file, start) {
  const b = await read(file, start, start + 131072);
  for (let i = 0; i + 4 < b.length; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
    const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, mono = (b[i + 3] >> 6) === 3;
    if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) continue;
    const kbps = BR[`${ver === 3 ? 3 : 2}-${ver === 3 ? layer : layer === 3 ? 3 : 2}`][bri];
    const sr = SR[ver][sri];
    const spf = layer === 3 ? 384 : layer === 2 ? 1152 : ver === 3 ? 1152 : 576;
    const side = ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = i + 4 + side;
    const tag = latin1(b.subarray(x, x + 4));
    if ((tag === 'Xing' || tag === 'Info') && (u32(b, x + 4) & 1)) return (u32(b, x + 8) * spf) / sr;
    if (latin1(b.subarray(i + 36, i + 40)) === 'VBRI') return (u32(b, i + 36 + 14) * spf) / sr;
    return ((file.size - start - i) * 8) / (kbps * 1000);
  }
  return 0;
}

// ---------------- MP4 / M4A ----------------
function* boxes(b, start = 0, end = b.length) {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o); const type = latin1(b.subarray(o + 4, o + 8)); let hdr = 8;
    if (size === 1) { size = u32(b, o + 8) * 4294967296 + u32(b, o + 12); hdr = 16; }
    else if (size === 0) size = end - o;
    if (size < hdr) return;
    if (o + size > end) size = end - o;
    yield { type, start: o + hdr, end: o + size };
    o += size;
  }
}
const child = (b, box, type) => { for (const c of boxes(b, box.start, box.end)) if (c.type === type) return c; return null; };

async function parseMP4(file, out) {
  let off = 0;
  while (off + 8 <= file.size) {
    const h = await read(file, off, off + 16);
    let size = u32(h, 0); const type = latin1(h.subarray(4, 8)); let hdr = 8;
    if (size === 1) { size = u32(h, 8) * 4294967296 + u32(h, 12); hdr = 16; }
    else if (size === 0) size = file.size - off;
    if (size < 8) break;
    if (type === 'moov') { parseMoov(await read(file, off + hdr, off + size), out); return; }
    off += size;
  }
}

function parseMoov(b, out) {
  const root = { start: 0, end: b.length };
  const mvhd = child(b, root, 'mvhd');
  if (mvhd) {
    const v = b[mvhd.start];
    const ts = v === 1 ? u32(b, mvhd.start + 20) : u32(b, mvhd.start + 12);
    const du = v === 1 ? u32(b, mvhd.start + 24) * 4294967296 + u32(b, mvhd.start + 28) : u32(b, mvhd.start + 16);
    if (ts) out.duration = du / ts;
  }
  const udta = child(b, root, 'udta');
  let meta = udta && child(b, udta, 'meta');
  if (!meta) meta = child(b, root, 'meta');
  if (!meta) return;
  // 'meta' is a full box (4 bytes version/flags) in MP4, but not in QuickTime files
  const mstart = latin1(b.subarray(meta.start + 4, meta.start + 8)) === 'hdlr' ? meta.start : meta.start + 4;
  const ilst = child(b, { start: mstart, end: meta.end }, 'ilst');
  if (!ilst) return;
  const utf8 = (d) => decode('utf-8', d).trim();
  for (const item of boxes(b, ilst.start, ilst.end)) {
    const data = child(b, item, 'data');
    if (!data) continue;
    const kind = u32(b, data.start) & 0xffffff;
    const v = b.subarray(data.start + 8, data.end);
    switch (item.type) {
      case '\xa9nam': out.title = utf8(v); break;
      case '\xa9ART': out.artist = utf8(v); break;
      case '\xa9alb': out.album = utf8(v); break;
      case 'aART': out.albumArtist = utf8(v); break;
      case '\xa9gen': out.genre = utf8(v); break;
      case 'gnre': if (v.length >= 2) out.genre ||= GENRES[u16(v, 0) - 1] || ''; break;
      case '\xa9day': out.year = utf8(v).slice(0, 4); break;
      case 'trkn': if (v.length >= 4) out.track = String(u16(v, 2) || ''); break;
      case 'disk': if (v.length >= 4) out.disc = String(u16(v, 2) || ''); break;
      case '\xa9lyr': out.lyrics = utf8(v); break;
      case 'covr':
        if (!out.picture && v.length > 64) out.picture = { data: v.slice(), mime: kind === 14 ? 'image/png' : imageMime(v) };
        break;
    }
  }
}

// ---------------- FLAC ----------------
async function parseFLAC(file, out, start) {
  let off = start + 4;
  for (let n = 0; n < 128 && off + 4 <= file.size; n++) {
    const h = await read(file, off, off + 4);
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 0 || type === 4 || type === 6) {
      const b = await read(file, off + 4, off + 4 + len);
      if (type === 0) {
        const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
        const total = (b[13] & 0x0f) * 4294967296 + u32(b, 14);
        if (sr) out.duration = total / sr;
      } else if (type === 4) vorbisComments(b, out);
      else flacPicture(b, out);
    }
    off += 4 + len;
    if (last) break;
  }
}

function vorbisComments(b, out) {
  let o = 0; const vlen = le32(b, o); o += 4 + vlen;
  const count = le32(b, o); o += 4;
  const map = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist',
    GENRE: 'genre', DATE: 'year', YEAR: 'year', TRACKNUMBER: 'track', DISCNUMBER: 'disc', LYRICS: 'lyrics', UNSYNCEDLYRICS: 'lyrics' };
  for (let i = 0; i < count && o + 4 <= b.length; i++) {
    const len = le32(b, o); o += 4;
    const s = decode('utf-8', b.subarray(o, o + len)); o += len;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const key = map[s.slice(0, eq).toUpperCase()];
    if (key && !out[key]) out[key] = s.slice(eq + 1).trim();
  }
}

function flacPicture(b, out) {
  let o = 0; const type = u32(b, o); o += 4;
  const ml = u32(b, o); o += 4; const mime = latin1(b.subarray(o, o + ml)); o += ml;
  const dl = u32(b, o); o += 4 + dl + 16;
  const len = u32(b, o); o += 4;
  const data = b.slice(o, o + len);
  if (!out.picture || (type === 3 && out.picture.type !== 3)) out.picture = { data, mime: imageMime(data, mime), type };
}

// ---------------- WAV ----------------
async function parseWAV(file, out) {
  const b = await read(file, 0, Math.min(file.size, 262144));
  let byteRate = 0, dataSize = 0;
  for (let o = 12; o + 8 <= b.length;) {
    const id = latin1(b.subarray(o, o + 4)), len = le32(b, o + 4);
    if (id === 'fmt ') byteRate = le32(b, o + 16);
    else if (id === 'data') { dataSize = len; break; }
    else if (id === 'LIST' && latin1(b.subarray(o + 8, o + 12)) === 'INFO') {
      const map = { INAM: 'title', IART: 'artist', IPRD: 'album', IGNR: 'genre', ICRD: 'year', ITRK: 'track' };
      for (let p = o + 12; p + 8 <= o + 8 + len && p + 8 <= b.length;) {
        const sid = latin1(b.subarray(p, p + 4)), sl = le32(b, p + 4);
        if (map[sid]) out[map[sid]] = latin1(b.subarray(p + 8, p + 8 + sl)).replace(/\0.*$/, '').trim();
        p += 8 + sl + (sl & 1);
      }
    }
    o += 8 + len + (len & 1);
  }
  if (byteRate && dataSize) out.duration = dataSize / byteRate;
}

// ---------------- entry ----------------
export async function parseMetadata(file) {
  const out = {};
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    const head = await read(file, 0, 12);
    const t4 = latin1(head.subarray(0, 4));
    if (t4.startsWith('ID3')) {
      const end = await parseID3(file, out);
      const next = latin1(await read(file, end, end + 4));
      if (next === 'fLaC') await parseFLAC(file, out, end);
      else if (!out.duration) out.duration = await mp3Duration(file, end);
    } else if (latin1(head.subarray(4, 8)) === 'ftyp') await parseMP4(file, out);
    else if (t4 === 'fLaC') await parseFLAC(file, out, 0);
    else if (t4 === 'RIFF' && latin1(head.subarray(8, 12)) === 'WAVE') await parseWAV(file, out);
    else if (ext === 'mp3') out.duration = await mp3Duration(file, 0);
    if (!out.title && ext === 'mp3') await parseID3v1(file, out);
  } catch (e) {
    console.warn('metadata read failed', file.name, e);
  }
  out.genre = normGenre(out.genre);
  if (out.track) out.track = parseInt(out.track, 10) || 0;
  if (out.disc) out.disc = parseInt(out.disc, 10) || 0;
  if (out.year) out.year = (String(out.year).match(/\d{4}/) || [''])[0];
  if (!isFinite(out.duration) || out.duration < 0) out.duration = 0;
  return out;
}
