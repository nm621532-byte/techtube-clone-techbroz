/* TechTube — original web app (vanilla JS, no framework, no build step).
 * Accounts, likes, comments, history and subscriptions live in localStorage per account;
 * uploads live in IndexedDB on this device. Nothing is sent to a server. */
(() => {
'use strict';

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Device storage is full. Free some space.'); } },
  del(k) { localStorage.removeItem(k); },
};
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function fmtViews(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K views';
  return n + (n === 1 ? ' view' : ' views');
}
function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [sec, name] of units) {
    const n = Math.floor(s / sec);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'channel'; }
function hue(s) { return hashStr(s) % 360; }
function avatarHtml(name, cls = '') {
  const letter = esc((name || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="avatar ${cls}" style="background:linear-gradient(135deg,hsl(${hue(name || '')} 80% 60%),hsl(${(hue(name || '') + 60) % 360} 70% 55%))">${letter}</span>`;
}

// ---------- sample library (generated clips, shipped with the app) ----------
const DAY = 86400000;
const SAMPLES = [
  { id: 's1', title: 'TechTube · Pixel Art Basics in 60 sec', channel: 'Chai Coding Lab', category: 'Coding', ageDays: 2, views: 48213, likes: 2310, desc: 'Pixels, grid aur colours ka chhota sa intro. Sample clip generated for TechTube.' },
  { id: 's2', title: 'Mandelbrot zoom · relaxing 8 sec loop', channel: 'Fractal Vibes', category: 'Music', ageDays: 5, views: 96410, likes: 4120, desc: 'A looping fractal zoom. Good for background focus.' },
  { id: 's3', title: 'Sunrise over the hills (drone test)', channel: 'Travel Diaries', category: 'Travel', ageDays: 9, views: 15870, likes: 980, desc: 'Test clip for the travel category. Generated, not real footage.' },
  { id: 's4', title: 'Game loop explained in 8 seconds', channel: 'Byte Size Games', category: 'Gaming', ageDays: 1, views: 27540, likes: 1644, desc: 'Every game runs update, draw, repeat. That is the whole loop.' },
  { id: 's5', title: 'Morning news ticker demo', channel: 'Desi Newsroom', category: 'News', ageDays: 14, views: 6120, likes: 310, desc: 'A cellular automaton standing in for a live news ticker.' },
  { id: 's6', title: 'Goal highlights · mock reel', channel: 'Sports Garage', category: 'Sports', ageDays: 3, views: 33090, likes: 2011, desc: 'Mock highlight reel for the sports shelf.' },
].map((v) => ({ ...v, isUpload: false, duration: 8, createdAt: Date.now() - v.ageDays * DAY, src: `media/videos/${v.id}.mp4`, thumb: `media/thumbs/${v.id}.jpg`, channelId: slug(v.channel), ownerId: null }));
const CATEGORIES = ['All', 'Coding', 'Music', 'Travel', 'Gaming', 'News', 'Sports', 'Uploads'];
const UPLOAD_CATEGORIES = ['Coding', 'Music', 'Travel', 'Gaming', 'News', 'Sports'];

// ---------- accounts (device-local, PBKDF2-hashed passwords) ----------
const KEYS = { users: 'tt.users', session: 'tt.session', views: 'tt.views' };
let users = LS.get(KEYS.users, {}); // nameKey -> { id, name, salt, hash, created }
let me = null;                      // current account
let st = null;                      // current account state (per user)
let uploads = [];                   // in-memory uploads from IndexedDB (all devices' uploads on this phone)
let viewsLocal = LS.get(KEYS.views, {});

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(pass, saltB64) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: 200000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}
function emptyState() { return { likes: {}, subs: [], watchLater: [], history: [], comments: [], theme: 'dark' }; }
function loadState(id) { return Object.assign(emptyState(), LS.get('tt.state.' + id, {})); }
function saveState() { if (me) LS.set('tt.state.' + me.id, st); }
function userById(id) { return Object.values(users).find((u) => u.id === id); }

async function signUp(name, pass) {
  const key = name.trim().toLowerCase();
  if (users[key]) throw new Error('That name is already on this phone. Try signing in.');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const rec = { id: uid(), name: name.trim(), salt, hash: await derive(pass, salt), created: Date.now() };
  users[key] = rec; LS.set(KEYS.users, users);
  return rec;
}
async function signIn(name, pass) {
  const rec = users[name.trim().toLowerCase()];
  if (!rec) throw new Error('No account with that name on this phone.');
  const h = await derive(pass, rec.salt);
  let diff = h.length ^ rec.hash.length;   // constant-time-ish compare of the two hashes
  for (let i = 0; i < Math.min(h.length, rec.hash.length); i++) diff |= h.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  if (diff !== 0) throw new Error('Wrong password.');
  return rec;
}
function startSession(rec) {
  me = rec; st = loadState(rec.id);
  LS.set(KEYS.session, rec.id);
  applyTheme();
  $('#authGate').hidden = true;
  const av = $('#avatarBtn');
  av.textContent = (rec.name.trim().charAt(0) || '?').toUpperCase();
  av.style.background = `linear-gradient(135deg,hsl(${hue(rec.name)} 80% 60%),hsl(${(hue(rec.name) + 60) % 360} 70% 55%))`;
}
function signOut() {
  LS.del(KEYS.session); me = null; st = null;
  const av = $('#avatarBtn'); av.textContent = '?'; av.style.background = '';
  showAuth(Object.keys(users).length ? 'signin' : 'signup');
  route();
}
let authMode = 'signup';
function showAuth(mode) {
  authMode = mode;
  const up = mode === 'signup';
  $('#authSubmit').textContent = up ? 'Create account' : 'Sign in';
  $('#authSwitch').textContent = up ? 'I already have an account' : 'Make a new account';
  $('#authHint').textContent = up
    ? 'Make a local account on this phone. History, likes and comments stay on this device.'
    : 'Sign in to your local TechTube account on this phone.';
  $('#authPass').autocomplete = up ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
  $('#authGate').hidden = false;
  setTimeout(() => $('#authName').focus(), 50);
}

// ---------- theme ----------
function applyTheme() {
  const t = (st && st.theme) || 'dark';
  document.documentElement.dataset.theme = t;
  $('#themeMeta').content = t === 'light' ? '#f5f6fb' : '#0b0d14';
}

// ---------- IndexedDB uploads (plays offline) ----------
let dbPromise = null;
function openDb() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open('techtube', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('uploads', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}
async function idb(mode, op) {
  const d = await openDb();
  return new Promise((res, rej) => {
    const t = d.transaction('uploads', mode);
    const req = op(t.objectStore('uploads'));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
async function loadUploads() {
  const rows = (await idb('readonly', (s) => s.getAll())) || [];
  for (const u of uploads) { if (u.url) URL.revokeObjectURL(u.url); if (u.thumbUrl) URL.revokeObjectURL(u.thumbUrl); }
  uploads = rows.map((r) => ({
    ...r,
    isUpload: true,
    channelId: 'u-' + r.ownerId,
    src: URL.createObjectURL(r.blob),
    thumb: r.thumbBlob ? URL.createObjectURL(r.thumbBlob) : '',
  })).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- unified video model ----------
function allVideos() { return [...uploads, ...SAMPLES]; }
function findVideo(id) { return allVideos().find((v) => v.id === id); }
function channelName(id) {
  const v = allVideos().find((x) => x.channelId === id);
  if (v) return v.channel || v.channelName;
  const u = Object.values(users).find((x) => 'u-' + x.id === id);
  return u ? u.name : id;
}
function baseLikes(v) { return v.isUpload ? 0 : v.likes; }
function viewCount(v) { return (v.isUpload ? (v.views || 0) : v.views) + (viewsLocal[v.id] || 0); }
function likeCount(v) { return baseLikes(v) + (st && st.likes[v.id] === 1 ? 1 : 0); }
function subsCount(channelId) {
  let n = 0;
  for (const u of Object.values(users)) { if (st && u.id === me.id ? st.subs.includes(channelId) : LS.get('tt.state.' + u.id, emptyState()).subs.includes(channelId)) n++; }
  return n + (channelId.startsWith('u-') ? 0 : 900 + (hashStr(channelId) % 40000));
}
function isSubscribed(channelId) { return st.subs.includes(channelId); }
function allCommentsFor(videoId) {
  const out = [];
  for (const u of Object.values(users)) {
    const s = u.id === me.id ? st : LS.get('tt.state.' + u.id, emptyState());
    for (const c of s.comments) if (c.vid === videoId) out.push({ ...c, authorId: u.id, authorName: u.name });
  }
  return out.sort((a, b) => b.at - a.at);
}
function cardHtml(v, opts = {}) {
  const later = st && st.watchLater.includes(v.id);
  return `<article class="card">
    <a class="thumb" href="#/watch/${esc(v.id)}" aria-label="Play ${esc(v.title)}">
      ${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : ''}
      <span class="dur">${fmtDur(v.duration)}</span>
    </a>
    <button class="later ${later ? 'on' : ''}" data-action="later" data-id="${esc(v.id)}" aria-pressed="${later}" aria-label="Watch later">${later ? '✓ Saved' : '+ Later'}</button>
    <div class="card-meta">
      <a href="#/channel/${esc(v.channelId)}" aria-label="${esc(v.channel || channelName(v.channelId))}">${avatarHtml(v.channel || channelName(v.channelId), 'sm')}</a>
      <a class="txt" href="#/watch/${esc(v.id)}">
        <h3>${esc(v.title)}</h3>
        <p>${esc(v.channel || channelName(v.channelId))}</p>
        <p>${fmtViews(viewCount(v))} · ${timeAgo(v.createdAt)}</p>
      </a>
    </div>
  </article>`;
}
function gridHtml(list, empty = 'Nothing here yet.') {
  if (!list.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="grid">${list.map((v) => cardHtml(v)).join('')}</div>`;
}

// ---------- pages ----------
function renderHome(q) {
  const cat = q.get('c') || 'All';
  let list = allVideos();
  if (cat === 'Uploads') list = uploads;
  else if (cat !== 'All') list = list.filter((v) => v.category === cat);
  const chips = CATEGORIES.map((c) => `<a class="chip ${c === cat ? 'on' : ''}" href="#/?c=${encodeURIComponent(c)}">${esc(c)}</a>`).join('');
  const empty = cat === 'Uploads' ? 'No uploads on this phone yet. Tap + to upload your first video.' : 'No videos in this category yet.';
  return `<div class="chips" role="navigation" aria-label="Categories">${chips}</div>
    ${gridHtml(list, empty)}`;
}
function renderSearch(q) {
  const term = (q.get('q') || '').trim().toLowerCase();
  const type = q.get('type') || 'all';
  const sort = q.get('sort') || 'relevance';
  const hit = (v) => !term || [v.title, v.desc, v.channel, v.category].some((x) => String(x || '').toLowerCase().includes(term));
  let vids = allVideos().filter(hit);
  if (sort === 'views') vids.sort((a, b) => viewCount(b) - viewCount(a));
  if (sort === 'newest') vids.sort((a, b) => b.createdAt - a.createdAt);
  const chans = type === 'uploads' || type === 'videos' ? [] : channelsList().filter((c) => !term || c.name.toLowerCase().includes(term));
  if (type === 'uploads') vids = vids.filter((v) => v.isUpload);
  const sel = (name, val, label) => `<option value="${val}" ${name === val ? 'selected' : ''}>${label}</option>`;
  const title = term ? `Results for “${esc(q.get('q'))}”` : 'Search';
  const head = `<h1 class="page">${title}</h1>
    <form class="search-tools" method="get" action="#/search" id="filterForm">
      <input type="hidden" name="q" value="${esc(q.get('q') || '')}">
      <select name="type" aria-label="Filter">
        ${sel(type, 'all', 'All')}${sel(type, 'videos', 'Videos')}${sel(type, 'uploads', 'Your uploads')}${sel(type, 'channels', 'Channels')}
      </select>
      <select name="sort" aria-label="Sort">
        ${sel(sort, 'relevance', 'Sort: relevance')}${sel(sort, 'views', 'Sort: views')}${sel(sort, 'newest', 'Sort: newest')}
      </select>
    </form>`;
  const chanHtml = chans.map((c) => `<a class="chan-row" href="#/channel/${esc(c.id)}">${avatarHtml(c.name)}<span class="txt"><b>${esc(c.name)}</b><br><span class="muted">${fmtCount(c.subs)} subscribers · ${c.count} videos</span></span></a>`).join('');
  const vidHtml = vids.map((v) => `<a class="row-result" href="#/watch/${esc(v.id)}"><span class="thumb">${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : ''}<span class="dur">${fmtDur(v.duration)}</span></span><span class="txt"><h3>${esc(v.title)}</h3><p class="muted">${fmtViews(viewCount(v))} · ${timeAgo(v.createdAt)}</p><p class="muted">${esc(v.channel || channelName(v.channelId))}</p><p class="muted">${esc((v.desc || '').slice(0, 120))}</p></span></a>`).join('');
  const none = !chanHtml && !vidHtml ? `<div class="empty">No matches. Try another word.</div>` : '';
  return head + chanHtml + vidHtml + none;
}
function channelsList() {
  const map = new Map();
  for (const v of allVideos()) {
    const name = v.channel || channelName(v.channelId);
    if (!map.has(v.channelId)) map.set(v.channelId, { id: v.channelId, name, count: 0, subs: subsCount(v.channelId) });
    map.get(v.channelId).count++;
  }
  return [...map.values()];
}
function renderWatch(id) {
  const v = findVideo(id);
  if (!v) return `<div class="empty">That video is not on this phone any more. <a class="btn" href="#/">Go home</a></div>`;
  const chName = v.channel || channelName(v.channelId);
  const subbed = isSubscribed(v.channelId);
  const liked = st.likes[v.id] === 1, disliked = st.likes[v.id] === -1;
  const later = st.watchLater.includes(v.id);
  const related = allVideos().filter((x) => x.id !== v.id)
    .sort((a, b) => (b.category === v.category) - (a.category === v.category) || b.createdAt - a.createdAt).slice(0, 14);
  const relHtml = related.map((r) => `<a class="rel" href="#/watch/${esc(r.id)}"><span class="thumb">${r.thumb ? `<img src="${esc(r.thumb)}" alt="" loading="lazy">` : ''}</span><span class="txt"><h3>${esc(r.title)}</h3><p>${esc(r.channel || channelName(r.channelId))}</p><p>${fmtViews(viewCount(r))}</p></span></a>`).join('');
  const isMine = v.isUpload && v.ownerId === me.id;
  return `<section class="watch">
    <div>
      <div class="player"><video id="player" controls playsinline preload="metadata" src="${esc(v.src)}" ${v.thumb ? `poster="${esc(v.thumb)}"` : ''} aria-label="${esc(v.title)}"></video></div>
      <h1>${esc(v.title)}</h1>
      <div class="watch-row">
        <a class="channel" href="#/channel/${esc(v.channelId)}">${avatarHtml(chName)}<span><span class="name">${esc(chName)}</span><br><span id="subCount" class="muted">${fmtCount(subsCount(v.channelId))} subscribers</span></span></a>
        <div class="actions">
          <button class="btn sub ${subbed ? 'on' : ''}" data-action="sub" data-id="${esc(v.channelId)}" aria-pressed="${subbed}">${subbed ? 'Subscribed' : 'Subscribe'}</button>
          <button class="btn act ${liked ? 'on' : ''}" data-action="like" data-id="${esc(v.id)}" aria-pressed="${liked}" id="likeBtn">👍 <span id="likeCount">${fmtCount(likeCount(v))}</span></button>
          <button class="btn act ${disliked ? 'on' : ''}" data-action="dislike" data-id="${esc(v.id)}" aria-pressed="${disliked}" id="dislikeBtn">👎</button>
          <button class="btn act ${later ? 'on' : ''}" data-action="later" data-id="${esc(v.id)}" aria-pressed="${later}" id="laterBtn">${later ? '✓ Watch later' : '+ Watch later'}</button>
          <button class="btn" data-action="share" data-id="${esc(v.id)}">Share</button>
          ${isMine ? `<button class="btn danger" data-action="delupload" data-id="${esc(v.id)}">Delete</button>` : ''}
        </div>
      </div>
      <div class="desc"><div class="stat">${fmtViews(viewCount(v))} · ${timeAgo(v.createdAt)}${v.category ? ' · ' + esc(v.category) : ''}</div>${esc(v.desc || 'No description.')}</div>
      <section class="comments" id="comments" data-vid="${esc(v.id)}">${commentsHtml(v.id)}</section>
    </div>
    <aside class="related" aria-label="Related videos">${relHtml}</aside>
  </section>`;
}
function commentsHtml(vid) {
  const list = allCommentsFor(vid);
  return `<h2 class="section" style="margin-top:0">${list.length} comment${list.length === 1 ? '' : 's'}</h2>
    <form class="comment-form" id="commentForm">
      ${avatarHtml(me.name, 'sm')}
      <textarea name="text" maxlength="500" placeholder="Add a comment…" aria-label="Add a comment" required></textarea>
      <button class="btn primary" type="submit">Comment</button>
    </form>
    <div id="commentList">${list.map((c) => `<div class="comment">${avatarHtml(c.authorName, 'sm')}<div class="body">
      <div class="by">${esc(c.authorName)}<span>${timeAgo(c.at)}</span></div>
      <p>${esc(c.text)}</p>
      ${c.authorId === me.id ? `<button data-action="delcomment" data-id="${esc(c.id)}" data-vid="${esc(vid)}">Delete</button>` : ''}
    </div></div>`).join('') || '<p class="muted">No comments yet. Be the first.</p>'}</div>`;
}
function renderChannel(cid) {
  const name = channelName(cid);
  const list = allVideos().filter((v) => v.channelId === cid);
  const subbed = isSubscribed(cid);
  return `<section class="channel-head" style="display:flex;gap:14px;align-items:center;margin-bottom:18px">
      ${avatarHtml(name, 'lg')}
      <div style="flex:1;min-width:0"><h1 class="page" style="margin:0">${esc(name)}</h1>
      <div class="muted"><span id="subCount">${fmtCount(subsCount(cid))}</span> subscribers · ${list.length} video${list.length === 1 ? '' : 's'}</div></div>
      <button class="btn sub ${subbed ? 'on' : ''}" data-action="sub" data-id="${esc(cid)}" aria-pressed="${subbed}">${subbed ? 'Subscribed' : 'Subscribe'}</button>
    </section>
    ${gridHtml(list, 'No videos on this channel yet.')}`;
}
function renderShorts() {
  const list = allVideos();
  const items = list.map((v) => `<section class="short" data-id="${esc(v.id)}">
      <video src="${esc(v.src)}" loop muted playsinline preload="metadata" ${v.thumb ? `poster="${esc(v.thumb)}"` : ''} aria-label="${esc(v.title)}"></video>
      <div class="shade"><h3>${esc(v.title)}</h3><p>${esc(v.channel || channelName(v.channelId))} · ${fmtViews(viewCount(v))}</p></div>
      <div class="rail">
        <button data-action="like" data-id="${esc(v.id)}" class="${st.likes[v.id] === 1 ? 'on' : ''}" aria-label="Like">👍</button><small>${fmtCount(likeCount(v))}</small>
        <button data-action="dislike" data-id="${esc(v.id)}" class="${st.likes[v.id] === -1 ? 'on' : ''}" aria-label="Dislike">👎</button>
        <button data-action="sub" data-id="${esc(v.channelId)}" class="${isSubscribed(v.channelId) ? 'on' : ''}" aria-label="Subscribe">${isSubscribed(v.channelId) ? '✓' : '+'}</button>
        <button data-action="share" data-id="${esc(v.id)}" aria-label="Share">↗</button>
      </div>
    </section>`).join('');
  return `<div class="shorts" id="shorts" aria-label="Shorts">${items || '<div class="empty">No videos yet.</div>'}</div>
    <a class="shorts-back" href="#/" aria-label="Back to home">←</a>
    <div class="shorts-hint">Swipe up for the next one · tap to unmute</div>`;
}
function renderLibrary() {
  const hist = st.history.map((h) => ({ h, v: findVideo(h.id) })).filter((x) => x.v);
  const later = st.watchLater.map((id) => findVideo(id)).filter(Boolean);
  const histHtml = hist.map(({ h, v }) => `<a class="hist-row" href="#/watch/${esc(v.id)}"><span class="thumb">${v.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy">` : ''}</span><span><b>${esc(v.title)}</b><br><span class="muted">${esc(v.channel || channelName(v.channelId))} · watched ${timeAgo(h.at)}</span></span></a>`).join('');
  return `<h1 class="page">Library</h1>
    <h2 class="section">Watch later (${later.length})</h2>${gridHtml(later, 'Tap “+ Watch later” on any video to save it here.')}
    <h2 class="section">History (${hist.length})</h2>
    <div class="panel">${histHtml || '<p class="muted" style="margin:0">Videos you watch show up here.</p>'}
      ${hist.length ? '<button class="btn" data-action="clearhist" style="margin-top:8px">Clear history</button>' : ''}</div>
    <h2 class="section">Your uploads</h2>${gridHtml(uploads.filter((u) => u.ownerId === me.id), 'Your uploads show here. Tap + to add one.')}`;
}
function renderUpload() {
  const cats = UPLOAD_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('');
  return `<h1 class="page">Upload a video</h1>
    <form class="form" id="uploadForm">
      <div class="drop">
        <div>Pick a video from your phone (MP4, WebM, MOV; up to 200 MB)</div>
        <input type="file" name="file" accept="video/mp4,video/webm,video/quicktime,video/ogg,video/*" required aria-label="Video file">
      </div>
      <video id="uploadPreview" class="preview" controls playsinline hidden></video>
      <label>Title<input type="text" name="title" maxlength="100" required placeholder="Give it a title"></label>
      <label>Description<textarea name="desc" maxlength="2000" placeholder="Tell viewers what it is about"></textarea></label>
      <label>Category<select name="category">${cats}</select></label>
      <div id="upProgress" class="muted" aria-live="polite"></div>
      <div class="progress" hidden id="upBar"><i></i></div>
      <button class="btn primary" type="submit" id="upSubmit">Publish</button>
      <p class="muted" style="font-size:13px">Your video is stored on this phone (IndexedDB), so it plays without a connection. Nothing is uploaded to a server.</p>
    </form>`;
}
function renderStudio() {
  const mine = uploads.filter((u) => u.ownerId === me.id);
  const totalViews = mine.reduce((a, v) => a + viewCount(v), 0);
  const chId = 'u-' + me.id;
  const subs = subsCount(chId);
  const watchHours = mine.reduce((a, v) => a + (viewCount(v) * (v.duration || 0)) / 3600, 0);
  const subPct = Math.min(100, Math.round((subs / 1000) * 100));
  const hrPct = Math.min(100, Math.round((watchHours / 4000) * 100));
  const coins = Math.floor(totalViews / 100);
  const rows = mine.map((v) => `<a class="hist-row" href="#/watch/${esc(v.id)}"><span class="thumb">${v.thumb ? `<img src="${esc(v.thumb)}" alt="">` : ''}</span><span><b>${esc(v.title)}</b><br><span class="muted">${fmtViews(viewCount(v))} · ${timeAgo(v.createdAt)}</span></span></a>`).join('');
  return `<h1 class="page">Studio</h1>
    <div class="stats">
      <div class="stat-card"><span class="muted">Subscribers</span><b>${fmtCount(subs)}</b></div>
      <div class="stat-card"><span class="muted">Views on your videos</span><b>${fmtCount(totalViews)}</b></div>
      <div class="stat-card"><span class="muted">Videos</span><b>${mine.length}</b></div>
    </div>
    <div class="panel">
      <b>Monetization (demo)</b>
      <p class="muted" style="margin:6px 0 10px">Practice thresholds: 1,000 subscribers and 4,000 watch hours. Pass both to be “eligible”.</p>
      <div>Subscribers: ${fmtCount(subs)} / 1K</div><div class="bar"><i style="width:${subPct}%"></i></div>
      <div>Watch hours (est.): ${watchHours.toFixed(2)} / 4K</div><div class="bar"><i style="width:${hrPct}%"></i></div>
      <p style="margin:12px 0 0">Earnings wallet: <b>${coins} demo coins</b> <span class="muted">(not real money)</span></p>
      <p class="muted" style="font-size:13px;margin:6px 0 0">Real payouts need a payment gateway and an identity check. Not connected in this build.</p>
    </div>
    <h2 class="section">Your videos</h2>${rows || '<p class="muted">No uploads yet. Tap + to publish one.</p>'}`;
}
function renderSettings() {
  const t = st.theme || 'dark';
  const canInstall = !!window.__ttInstall;
  return `<h1 class="page">Settings</h1>
    <div class="panel">
      <b>Appearance</b>
      <div class="theme-pick" style="margin-top:10px" role="radiogroup" aria-label="Theme">
        <label><input type="radio" name="theme" value="dark" ${t === 'dark' ? 'checked' : ''}> Dark</label>
        <label><input type="radio" name="theme" value="light" ${t === 'light' ? 'checked' : ''}> Light</label>
      </div>
    </div>
    <div class="panel">
      <b>Account</b>
      <p class="muted" style="margin:6px 0 10px">Signed in as ${esc(me.name)}. Accounts live on this phone only.</p>
      <div class="actions"><button class="btn" data-action="signout">Sign out</button>
      <button class="btn danger" data-action="wipe">Delete my data on this phone</button></div>
    </div>
    <div class="panel">
      <b>Install the app</b>
      <p class="muted" style="margin:6px 0 10px">${canInstall ? 'Tap below to add TechTube to your home screen.' : 'In Chrome on Android: tap the ⋮ menu, then “Install app” (or “Add to Home screen”).'}</p>
      ${canInstall ? '<button class="btn primary" data-action="install">Install TechTube</button>' : ''}
    </div>
    <div class="panel">
      <b>Privacy</b>
      <p class="muted" style="margin:6px 0 0">Watch history, likes, comments and subscriptions are saved per account on this device. Nothing is sent to a server.</p>
    </div>`;
}

// ---------- router ----------
const NAV = { '': 'home', shorts: 'shorts', library: 'library', upload: 'upload', studio: 'studio', settings: 'settings' };
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || '') };
}
let currentRoute = '';
function route() {
  if (!me) { $('#authGate').hidden = false; return; }
  const { parts, q } = parseHash();
  const head = parts[0] || '';
  const key = head in NAV ? head : '';
  document.body.classList.toggle('shorts-page', head === 'shorts');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === NAV[key]));
  let html = '';
  if (head === 'watch' && parts[1]) html = renderWatch(parts[1]);
  else if (head === 'search') html = renderSearch(q);
  else if (head === 'shorts') html = renderShorts();
  else if (head === 'library') html = renderLibrary();
  else if (head === 'upload') html = renderUpload();
  else if (head === 'studio') html = renderStudio();
  else if (head === 'settings') html = renderSettings();
  else if (head === 'channel' && parts[1]) html = renderChannel(parts[1]);
  else html = renderHome(q);
  if (head === 'shorts') {
    view.innerHTML = html;
    document.body.classList.add('in-shorts');
    setupShorts();
  } else {
    document.body.classList.remove('in-shorts');
    view.innerHTML = html;
  }
  currentRoute = location.hash;
  if (head === 'watch') setupWatch();
  if (head === 'upload') setupUpload();
  if (head === 'search') setupSearchForm();
  if (head !== 'shorts') view.scrollTop = 0;
  renderSubList();
  closeSidebarMobile();
}
function renderSubList() {
  if (!st) return;
  const subs = st.subs.map((id) => ({ id, name: channelName(id) }));
  $('#subList').innerHTML = subs.map((s) => `<a href="#/channel/${esc(s.id)}">${avatarHtml(s.name, 'sm')}<span>${esc(s.name)}</span></a>`).join('') || '<p class="muted" style="font-size:13px;padding:0 12px">Subscribe to channels and they show up here.</p>';
}
function closeSidebarMobile() {
  if (window.innerWidth < 1000) $('#sidebar').classList.remove('open');
}

// ---------- setup per page ----------
let watchStarted = null;
function setupWatch() {
  const id = parseHash().parts[1];
  const v = findVideo(id);
  const player = $('#player');
  if (!v || !player) return;
  watchStarted = null;
  player.addEventListener('play', () => {
    if (watchStarted === id) return;
    watchStarted = id;
    viewsLocal[id] = (viewsLocal[id] || 0) + 1; LS.set(KEYS.views, viewsLocal);
    st.history = [{ id, at: Date.now() }, ...st.history.filter((h) => h.id !== id)].slice(0, 200);
    saveState();
  });
  player.addEventListener('ended', () => { /* the related list is right there */ });
}
function setupShorts() {
  const root = $('#shorts');
  if (!root) return;
  const vids = $$('video', root);
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const vid = en.target.querySelector('video');
      if (en.isIntersecting && en.intersectionRatio > 0.6) {
        vids.forEach((x) => { if (x !== vid) x.pause(); });
        vid.currentTime = 0;
        vid.play().catch(() => {});
        const id = en.target.dataset.id;
        if (watchStarted !== 'short-' + id) {
          watchStarted = 'short-' + id;
          viewsLocal[id] = (viewsLocal[id] || 0) + 1; LS.set(KEYS.views, viewsLocal);
          st.history = [{ id, at: Date.now() }, ...st.history.filter((h) => h.id !== id)].slice(0, 200); saveState();
        }
      } else vid.pause();
    }
  }, { root, threshold: [0, 0.61] });
  $$('.short', root).forEach((s) => io.observe(s));
  root.addEventListener('click', (e) => {
    if (e.target.closest('button,a')) return;
    const vid = e.target.closest('.short')?.querySelector('video');
    if (vid) { vid.muted = !vid.muted; toast(vid.muted ? 'Muted' : 'Sound on'); }
  });
  setTimeout(() => { const first = $('.short', root); if (first) root.scrollTop = 0; }, 0);
}
function setupSearchForm() {
  const f = $('#filterForm');
  if (!f) return;
  f.addEventListener('change', () => {
    const fd = new FormData(f);
    const p = new URLSearchParams({ q: fd.get('q') || '', type: fd.get('type'), sort: fd.get('sort') });
    location.hash = '#/search?' + p.toString();
  });
}
function setupUpload() {
  const form = $('#uploadForm');
  const fileIn = form.querySelector('input[type=file]');
  const prev = $('#uploadPreview');
  let picked = null;
  fileIn.addEventListener('change', () => {
    const f = fileIn.files[0];
    if (!f) return;
    const okType = /^video\//.test(f.type) || /\.(mp4|webm|mov|ogv|ogg|m4v)$/i.test(f.name);
    if (!okType) { toast('That file is not a video.'); fileIn.value = ''; return; }
    if (f.size > 200 * 1024 * 1024) { toast('Too big. Keep it under 200 MB.'); fileIn.value = ''; return; }
    picked = f;
    prev.src = URL.createObjectURL(f); prev.hidden = false;
    if (!fld('title').value) fld('title').value = f.name.replace(/\.[^.]+$/, '').slice(0, 100);
  });
  const fld = (n) => form.querySelector(`[name="${n}"]`);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!picked) { toast('Pick a video first.'); return; }
    const btn = $('#upSubmit'); btn.disabled = true;
    const prog = $('#upProgress'), bar = $('#upBar');
    bar.hidden = false; bar.firstElementChild.style.width = '30%';
    prog.textContent = 'Making a thumbnail…';
    try {
      const { blob: thumbBlob, duration } = await makeThumb(picked);
      bar.firstElementChild.style.width = '70%';
      prog.textContent = 'Saving on this phone…';
      const rec = {
        id: 'up-' + uid(),
        ownerId: me.id,
        ownerName: me.name,
        channel: me.name,
        title: fld('title').value.trim().slice(0, 100) || 'Untitled',
        desc: fld('desc').value.slice(0, 2000),
        category: fld('category').value,
        createdAt: Date.now(),
        duration: duration || 0,
        blob: picked,
        thumbBlob,
      };
      await idb('readwrite', (s) => s.put(rec));
      await loadUploads();
      bar.firstElementChild.style.width = '100%';
      toast('Published ✅');
      location.hash = '#/watch/' + encodeURIComponent(rec.id);
    } catch (err) {
      prog.textContent = 'Could not save this video: ' + (err && err.message ? err.message : 'unknown error');
      btn.disabled = false;
    }
  });
}
function makeThumb(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    let done = false;
    const finish = (blob, duration) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve({ blob, duration }); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 1) / 2); };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 640; c.height = Math.round(640 * (v.videoHeight / (v.videoWidth || 16)) * (v.videoWidth ? 1 : 9 / 16)) || 360;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => finish(b, v.duration), 'image/jpeg', 0.8);
      } catch { finish(null, v.duration); }
    };
    v.onerror = () => finish(null, 0);
    setTimeout(() => finish(null, v.duration || 0), 8000);
  });
}

// ---------- actions (event delegation) ----------
function refreshWatchBits() {
  const id = parseHash().parts[1];
  const v = findVideo(id);
  if (!v) return;
  const l = $('#likeBtn'), d = $('#dislikeBtn'), lc = $('#likeCount'), lt = $('#laterBtn');
  if (l) { const on = st.likes[id] === 1; l.classList.toggle('on', on); l.setAttribute('aria-pressed', on); if (lc) lc.textContent = fmtCount(likeCount(v)); }
  if (d) { const on = st.likes[id] === -1; d.classList.toggle('on', on); d.setAttribute('aria-pressed', on); }
  if (lt) { const on = st.watchLater.includes(id); lt.classList.toggle('on', on); lt.textContent = on ? '✓ Watch later' : '+ Watch later'; lt.setAttribute('aria-pressed', on); }
}
function toggleSub(channelId) {
  const on = st.subs.includes(channelId);
  st.subs = on ? st.subs.filter((c) => c !== channelId) : [...st.subs, channelId];
  saveState();
  $$(`[data-action="sub"][data-id="${CSS.escape(channelId)}"]`).forEach((b) => {
    const nowOn = !on;
    if (b.closest('.short')) { b.textContent = nowOn ? '✓' : '+'; }
    else b.textContent = nowOn ? 'Subscribed' : 'Subscribe';
    b.classList.toggle('on', nowOn); b.setAttribute('aria-pressed', nowOn);
  });
  const sc = $('#subCount'); if (sc) sc.textContent = fmtCount(subsCount(channelId));
  renderSubList();
  toast(on ? 'Unsubscribed' : 'Subscribed ✅');
}
const actions = {
  later(id) {
    const on = st.watchLater.includes(id);
    st.watchLater = on ? st.watchLater.filter((x) => x !== id) : [id, ...st.watchLater];
    saveState();
    $$(`[data-action="later"][data-id="${CSS.escape(id)}"]`).forEach((b) => {
      if (b.id === 'laterBtn') { b.classList.toggle('on', !on); b.textContent = !on ? '✓ Watch later' : '+ Watch later'; }
      else { b.classList.toggle('on', !on); b.textContent = !on ? '✓ Saved' : '+ Later'; }
      b.setAttribute('aria-pressed', !on);
    });
    toast(on ? 'Removed from Watch later' : 'Saved to Watch later');
  },
  like(id) { rate(id, 1); },
  dislike(id) { rate(id, -1); },
  sub(id) { toggleSub(id); },
  share(id) {
    const url = location.origin + location.pathname + '#/watch/' + encodeURIComponent(id);
    const v = findVideo(id);
    if (navigator.share) navigator.share({ title: v ? v.title : 'TechTube', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast(url));
    else toast(url);
  },
  delcomment(id, vid) {
    st.comments = st.comments.filter((c) => c.id !== id);
    saveState();
    const box = $('#comments'); if (box) box.innerHTML = commentsHtml(vid);
    toast('Comment deleted');
  },
  async delupload(id) {
    const v = findVideo(id);
    if (!v || v.ownerId !== me.id) { toast('Only the uploader can delete this.'); return; }
    if (!confirm('Delete this upload from this phone?')) return;
    await idb('readwrite', (s) => s.delete(id));
    await loadUploads();
    toast('Upload deleted');
    location.hash = '#/';
  },
  clearhist() {
    if (!confirm('Clear your watch history?')) return;
    st.history = []; saveState(); route(); toast('History cleared');
  },
  signout() { signOut(); },
  wipe() {
    if (!confirm('Delete your account, history, comments and your uploads on this phone? This cannot be undone.')) return;
    (async () => {
      const mineUploads = uploads.filter((u) => u.ownerId === me.id);
      for (const u of mineUploads) await idb('readwrite', (s) => s.delete(u.id));
      LS.del('tt.state.' + me.id);
      const key = Object.keys(users).find((k) => users[k].id === me.id);
      if (key) delete users[key];
      LS.set(KEYS.users, users);
      await loadUploads();
      toast('Your data was deleted');
      signOut();
    })();
  },
  install() {
    const p = window.__ttInstall; if (!p) return;
    p.prompt(); p.userChoice.finally(() => { window.__ttInstall = null; route(); });
  },
};
function rate(id, val) {
  const cur = st.likes[id] || 0;
  if (cur === val) delete st.likes[id]; else st.likes[id] = val;
  saveState();
  const isWatch = parseHash().parts[0] === 'watch';
  if (isWatch) refreshWatchBits();
  else $$(`[data-action="like"][data-id="${CSS.escape(id)}"],[data-action="dislike"][data-id="${CSS.escape(id)}"]`).forEach((b) => {
    b.classList.toggle('on', (st.likes[id] || 0) === (b.dataset.action === 'like' ? 1 : -1));
  });
  toast(val === 1 ? (cur === 1 ? 'Like removed' : 'Liked 👍') : (cur === -1 ? 'Dislike removed' : 'Thanks for the feedback'));
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (!me) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  const r = fn(el.dataset.id, el.dataset.vid);
  if (r && typeof r.catch === 'function') r.catch((err) => toast('Something went wrong: ' + err.message));
});
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'commentForm') return;
  e.preventDefault();
  const text = e.target.querySelector('[name="text"]').value.trim();
  if (!text) return;
  const vid = $('#comments').dataset.vid;
  st.comments = [{ id: uid(), vid, text: text.slice(0, 500), at: Date.now(), authorId: me.id }, ...st.comments];
  saveState();
  $('#comments').innerHTML = commentsHtml(vid);
  toast('Comment posted');
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'theme' && me) { st.theme = e.target.value; saveState(); applyTheme(); }
});

// menu + search + avatar
$('#menuBtn').addEventListener('click', () => {
  if (window.innerWidth >= 1000) document.body.classList.toggle('sidebar-collapsed');
  else $('#sidebar').classList.toggle('open');
});
$('#avatarBtn').addEventListener('click', () => { if (me) location.hash = '#/settings'; else showAuth('signin'); });
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  location.hash = '#/search?' + new URLSearchParams({ q, type: 'all', sort: 'relevance' }).toString();
});
$('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a') && window.innerWidth < 1000) $('#sidebar').classList.remove('open'); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__ttInstall = e; if (parseHash().parts[0] === 'settings') route(); });
window.addEventListener('appinstalled', () => { window.__ttInstall = null; toast('TechTube installed ✅'); });

// auth form
$('#authSwitch').addEventListener('click', () => showAuth(authMode === 'signup' ? 'signin' : 'signup'));
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#authName').value.trim(), pass = $('#authPass').value;
  if (!name) return;
  if (pass.length < 6) { $('#authError').textContent = 'Password needs 6+ characters.'; return; }
  $('#authSubmit').disabled = true;
  $('#authError').textContent = '';
  try {
    const rec = authMode === 'signup' ? await signUp(name, pass) : await signIn(name, pass);
    startSession(rec);
    await loadUploads();
    toast(`Hi ${rec.name} 👋`);
    if (!location.hash || location.hash === '#') location.hash = '#/';
    route();
  } catch (err) {
    $('#authError').textContent = err.message;
  } finally { $('#authSubmit').disabled = false; }
});

// ---------- boot ----------
(async function boot() {
  try { await loadUploads(); } catch { uploads = []; }
  const sid = LS.get(KEYS.session, null);
  const rec = sid && Object.values(users).find((u) => u.id === sid);
  if (rec) startSession(rec); else { showAuth(Object.keys(users).length ? 'signin' : 'signup'); }
  if (!location.hash) history.replaceState(null, '', '#/');
  route();
  window.addEventListener('hashchange', () => {
    if (location.hash === currentRoute) return;
    route();
  });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
})();
