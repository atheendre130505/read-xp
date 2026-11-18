// Read — a calm daily reader. One finite issue a day, read a section at a time, ask about any passage.
// Everything (what you've read, your conversations, settings, your Gemini key) stays on this device.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const WPM = 230;
const I = {   // line icons (no emoji anywhere)
  back: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M3.5 6h8M15.5 6h1M3.5 14h1M8.5 14h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="13.5" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="6.5" cy="14" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  up: '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M10 15.5v-11M5 9.5l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 20 20" width="16" height="16"><path d="M10 4.5v11M15 10.5l-5 5-5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M4.5 10h11M10.5 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

// ───────── storage (device only) ─────────
const DEF = { settings: { theme: "auto", font: "source", fs: 19, ruler: true, bionic: false, hints: true, awake: true, key: "", groq: "", ntfy: "", model: "", rulerPos: 0.3 },
              progress: {}, chats: {} };
let S;
try { const raw = JSON.parse(localStorage.getItem("rxp") || "{}");
      S = { ...structuredClone(DEF), progress: raw.progress || {}, chats: raw.chats || {}, settings: { ...DEF.settings, ...(raw.settings || {}) } }; }
catch { S = structuredClone(DEF); }
const save = () => { try { localStorage.setItem("rxp", JSON.stringify(S)); } catch {} };
const todayKey = () => new Date().toLocaleDateString("en-CA");
S.rr ||= {};                                               // stories read on your other devices (short hashes)
(function prune() {                                        // forget stories older than two weeks
  const cut = new Date(Date.now() - 14 * 864e5).toLocaleDateString("en-CA");
  for (const k of Object.keys(S.progress)) if (/^\d{4}-\d\d-\d\d/.test(k) && k.slice(0, 10) < cut) { delete S.progress[k]; delete S.chats[k]; }
  for (const [h, at] of Object.entries(S.rr)) if (Date.now() - at > 14 * 864e5) delete S.rr[h];
})();

// What you've read syncs between your phone and laptop through your private ntfy topic (+"-sync", so it never
// notifies). Each message is a snapshot of short hashes of the stories read in the last few days.
const h36 = k => { let h = 5381; for (let i = 0; i < k.length; i++) h = (h * 33 ^ k.charCodeAt(i)) >>> 0; return h.toString(36); };
const sync = {
  url: () => S.settings.ntfy ? `https://ntfy.sh/${S.settings.ntfy}-sync` : null,
  snapshot() {
    const now = Date.now(), out = {};
    for (const [k, p] of Object.entries(S.progress)) if (p.done && now - (p.at || now) < 3 * 864e5) out[h36(k)] = p.at || now;
    for (const [h, at] of Object.entries(S.rr)) if (now - at < 3 * 864e5) out[h] = at;
    return out;
  },
  async push() {                       // if ntfy refuses (e.g. its free daily limit), keep it and retry later
    const u = this.url(); if (!u) return;
    try { const r = await fetch(u, { method: "POST", body: JSON.stringify({ r: this.snapshot() }) }); S.syncPending = !r.ok; }
    catch { S.syncPending = true; }
    save();
  },
  merge(text) {
    try {
      const r = JSON.parse(text).r || {};
      let changed = false;
      for (const [h, at] of Object.entries(r)) if (!S.rr[h]) { S.rr[h] = at; changed = true; }
      if (changed) { save(); if (!R && !location.hash.startsWith("#/settings")) route(); }
    } catch {}
  },
  async pull() {
    const u = this.url(); if (!u) return;
    try {
      const t = await (await fetch(u + "/json?poll=1&since=12h")).text();
      for (const line of t.split("\n")) { if (!line) continue; const j = JSON.parse(line); if (j.event === "message") this.merge(j.message); }
    } catch {}
  },
  live() {
    const u = this.url(); if (!u || this.es || !window.EventSource) return;
    this.es = new EventSource(u + "/sse");
    this.es.onmessage = e => { try { const j = JSON.parse(e.data); if (j.event === "message") this.merge(j.message); } catch {} };
  },
};

// setup link: #setup=<base64 {k: gemini key, t: ntfy topic}>. The fragment never reaches any server.
(function setupFromLink() {
  const m = location.hash.match(/setup=([^&]+)/);
  if (!m) return;
  try {
    const cfg = JSON.parse(atob(decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/")));
    if (cfg.k) S.settings.key = cfg.k;
    if (cfg.g) S.settings.groq = cfg.g;
    if (cfg.t) S.settings.ntfy = cfg.t;
    save(); setTimeout(() => toast("Set up on this device"), 400);
  } catch { setTimeout(() => toast("That setup link didn't work"), 400); }
  history.replaceState(null, "", location.pathname + "#/");
})();

// ───────── look ─────────
// "auto": dark between 7 pm and 7 am, light in the day
function effectiveTheme() {
  if (S.settings.theme !== "auto") return S.settings.theme;
  const h = new Date().getHours();
  return h >= 19 || h < 7 ? "dark" : "light";
}
setInterval(() => { if (document.documentElement.dataset.theme !== effectiveTheme()) applySettings(); }, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") applySettings(); });

function applySettings() {
  const st = S.settings, r = document.documentElement;
  r.dataset.theme = effectiveTheme(); r.dataset.font = st.font;
  r.style.setProperty("--fs", st.fs + "px");
  document.body.classList.toggle("ruler-on", !!st.ruler);
  document.body.classList.toggle("hints", !!st.hints);
  $('meta[name="theme-color"]').setAttribute("content", getComputedStyle(r).getPropertyValue("--bg").trim() || "#faf9f5");
  setRulerTop();
}
let toastT;
function toast(msg, ms = 1800) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms); }

let lock = null;   // keep the screen on while reading
async function wake(on) {
  try {
    if (on && S.settings.awake && "wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => (lock = null)); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && document.body.classList.contains("reading")) wake(true); });

// ───────── data ─────────
let INDEX = [], ISSUES = {};
async function getJSON(u) { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.json(); }
async function loadIndex() {
  try { INDEX = await getJSON("issues/index.json"); } catch { INDEX = []; }
  if (!INDEX.length) INDEX = [{ date: "sample", stories: 1, minutes: 6, headline: "Sample" }];
}
async function issue(date) { return (ISSUES[date] ||= await getJSON(date === "sample" ? "sample.json" : `issues/${date}.json`)); }
// While an issue is still being written, look for new stories every 20 s and slot them in.
setInterval(async () => {
  const date = INDEX[0]?.date;
  if (!date || date === "sample" || !(ISSUES[date]?.partial ?? INDEX[0].partial)) return;
  try {
    const fresh = await getJSON(`issues/${date}.json`);
    const count = i => i ? allStories(i).length : 0;
    if (count(fresh) === count(ISSUES[date]) && fresh.partial === ISSUES[date]?.partial) return;
    ISSUES[date] = fresh;
    INDEX = await getJSON("issues/index.json").catch(() => INDEX);
    if (R && R.date === date) {
      const list = allStories(fresh), i = list.findIndex(x => x.id === R.s.id);
      R.iss = fresh; R.total = list.length;
      if (R.p.done) { R.next = await nextUp(); drawBottom(); }
    } else if (!R && !location.hash.startsWith("#/settings")) route();
  } catch {}
}, 20000);
const allStories = iss => iss.topics.flatMap(t => t.stories.map(s => ({ ...s, topic: t })));
// There is no choosing: one fixed order. Unread stories carry over: the oldest edition with unread stories comes first.
async function readingQueue() {
  if (!INDEX.length) await loadIndex();
  const out = [];
  for (const e of INDEX.slice(0, 14).reverse()) {
    const iss = await issue(e.date).catch(() => null);
    if (!iss) continue;
    for (const x of allStories(iss)) if (!isRead(e.date, x)) out.push({ date: e.date, s: x, iss });
  }
  return out;
}
async function nextUp() { return (await readingQueue())[0] || null; }
const editionName = iss => iss.day ? new Date(iss.day + "T12:00").toLocaleDateString(undefined, { weekday: "long" })
  + (iss.edition ? ` ${iss.edition}` : "") : "Sample";
const pkey = (date, s) => `${date}/${s.id}`;
const isRead = (date, s) => !!S.progress[pkey(date, s)]?.done || !!S.rr[h36(pkey(date, s))];
const outlets = s => s.sources.map(x => x.source.split(" · ")[0]).filter((v, k, a) => a.indexOf(v) === k);
const kindLabel = k => ({ news: "Report", analysis: "Analysis", research: "New research" }[k] || k);

// ───────── router ─────────
async function route() {
  const [view, a, b] = location.hash.replace(/^#\/?/, "").split("/");
  document.body.classList.remove("reading"); wake(false); hidePill(); R = null;
  scrollTo(0, 0);
  try {
    if (view === "read") return await renderReader(a, decodeURIComponent(b));
    if (view === "settings") return renderSettings();
    return await renderHome(view === "day" ? a : undefined);
  } catch (e) {
    app.innerHTML = `<div class="col"><div class="empty">Couldn't load the issue.<br><small>${esc(String(e))}</small><br><br><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
  }
}
addEventListener("hashchange", route);

// ───────── home ─────────
function greeting() { const h = new Date().getHours(); return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }

async function renderHome() {
  if (!INDEX.length) await loadIndex();
  const q = await readingQueue(), up = q[0] || null;
  // nothing to choose: opening Read goes straight into the next story in line
  if (up) { location.replace(`#/read/${up.date}/${encodeURIComponent(up.s.id)}`); return; }
  const latest = await issue(INDEX[0].date);
  const today = todayKey();
  const readToday = Object.values(S.progress).filter(p => p.done && p.at && new Date(p.at).toLocaleDateString("en-CA") === today).length;
  const started = up && S.progress[pkey(up.date, up.s)];
  const writing = latest.partial;
  const groups = [];
  for (const x of q) { const g = groups.at(-1); if (g && g.date === x.date) g.items.push(x); else groups.push({ date: x.date, iss: x.iss, items: [x] }); }
  const nice = INDEX[0].date === "sample" ? "A sample story while your first issue is written"
    : new Date((latest.day || INDEX[0].date) + "T12:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  app.innerHTML = `<div class="bar"><div class="in"><div class="word">Read</div>
      <div class="mid"></div>${installEvt && !installed() ? `<button class="installbtn" data-act="install">Install app</button>` : ""}<a class="ib" href="#/settings" aria-label="Settings">${I.gear}</a></div></div>
    <div class="col">
      <div class="hello"><h1>${greeting()}</h1><p>${esc(nice)}</p>
        <p class="count"><b>${readToday}</b> read today<i class="dot"></i>${q.length}${writing ? "+" : ""} to go<i class="dot"></i>about ${q.reduce((n, x) => n + x.s.minutes, 0)} min</p></div>
      ${up ? `<button class="begin" data-go="#/read/${up.date}/${encodeURIComponent(up.s.id)}"><div>
          <div class="lab">${started ? "Continue reading" : "Begin"}</div><div class="t">${esc(up.s.title)}</div></div><div class="go">${I.right}</div></button>`
           : writing ? `<div class="hello" style="padding:24px 0 34px"><p class="typing">The next story is being written</p></div>`
           : `<div class="hello" style="padding:24px 0 34px"><p>You're all caught up. The next edition is written at nine.</p></div>`}
      ${groups.map(g => `<section class="topic"><h2><span>${g.date === INDEX[0].date ? "Still to read" : "Carried over · " + esc(editionName(g.iss))}</span><span>${g.items.length}</span></h2>
        ${g.items.map(x => `<div class="item static ${up && up.s.id === x.s.id && up.date === x.date ? "current" : ""}">
          <div class="t">${esc(x.s.title)}</div>
          <div class="m">${esc(x.s.topic.name)}<i class="dot"></i>${x.s.minutes} min<i class="dot"></i>${esc(outlets(x.s).slice(0, 2).join(", "))}</div></div>`).join("")}
      </section>`).join("")}
      ${writing ? `<p class="writing typing">More stories are being written. They'll appear here as they're ready.</p>` : ""}
    </div>`;
}

// ───────── reader ─────────
let R = null;
let attached = "";        // passage attached to the composer

async function renderReader(date, id) {
  const iss = await issue(date), list = allStories(iss);
  const i = list.findIndex(s => s.id === id);
  if (i < 0) { location.hash = "#/"; return; }
  const s = list[i];
  if (!isRead(date, s)) {                                  // no skipping ahead
    const up = await nextUp();
    if (up && (up.date !== date || up.s.id !== s.id)) { location.replace(`#/read/${up.date}/${encodeURIComponent(up.s.id)}`); return; }
  }
  const p = (S.progress[pkey(date, s)] ||= { sec: 1, done: false });
  save();
  R = { date, iss, s, p, togo: (await readingQueue()).length, next: p.done ? await nextUp() : null, key: pkey(date, s), pos: i + 1, total: list.length, used: new Set() };
  attached = "";
  document.body.classList.add("reading"); wake(true);
  app.innerHTML = `<div class="bar"><div class="in"><a class="ib" href="#/settings" aria-label="Settings">${I.gear}</a>
      <div class="mid">${esc(s.topic.name)}</div><div class="right" id="left"></div>
      ${p.done ? "" : `<button class="installbtn" data-act="mark">Mark as read</button>`}</div><div class="prog"><i id="prog"></i></div></div>
    <article class="story">
      <div class="kicker">${esc(s.topic.name)}</div>
      <h1>${esc(s.title)}</h1><p class="dek">${esc(s.dek)}</p>
      <div class="meta">${kindLabel(s.kind)}<i class="dot"></i>${s.minutes} min read<i class="dot"></i>${esc(outlets(s).join(", "))}</div>
      <div id="thread"></div><div id="end"></div><div class="after"></div>
    </article>
    <div class="dock"><div class="in"><div class="cont" id="cont"></div>
      <form class="composer" id="composer"><div id="att"></div>
        <div class="crow"><textarea id="q" rows="1" placeholder="Ask about this story" enterkeyhint="send"></textarea>
        <button class="send" id="send" type="submit" aria-label="Send" disabled>${I.up}</button></div></form></div></div>`;
  $("#thread").innerHTML = s.sections.slice(0, p.sec).map((_, k) => sectionHTML(k)).join("");
  bindComposer();
  drawBottom();
  const firstP = $(".sec p");
  rulerH = firstP ? parseFloat(getComputedStyle(firstP).lineHeight) : S.settings.fs * 1.7;
  setRulerTop();
  restorePlace();
}

function sectionHTML(k) {
  const sec = R.s.sections[k];
  const lead = k === 0 ? "" : sec.cue ? `<div class="cue" data-cue="${k}">${esc(sec.cue)}</div>` : `<h3 data-cue="${k}">${esc(sec.heading)}</h3>`;
  return `${lead}<section class="sec${k === 0 ? " first" : ""}" data-sec="${k}">${md(sec.body, { bionic: S.settings.bionic, gloss: S.settings.hints ? R.s.glossary : null, used: R.used })}</section>
    <div class="qa" data-qa="${k}">${(S.chats[R.key] || []).filter(c => c.sec === k).map(turnHTML).join("")}</div>`;
}
const turnHTML = c => `<div class="turn-you">${c.quote ? `<span class="quote">${esc(c.quote.slice(0, 240))}</span>` : ""}${esc(c.q)}</div><div class="turn-ai">${md(c.a)}</div>`;

function drawBottom() {
  const { s, p } = R;
  const left = s.sections.slice(p.sec).reduce((n, x) => n + x.body.split(/\s+/).length, 0);
  $("#left").textContent = (R.togo ? `${R.togo} to go · ` : "") + (p.done ? "read" : `${Math.max(1, Math.round(left / WPM + .4))} min left`);
  $("#prog").style.width = (100 * (p.done ? 1 : p.sec / (s.sections.length + 1))) + "%";
  const c = $("#cont");
  if (p.sec < s.sections.length) {
    const nx = s.sections[p.sec];
    c.innerHTML = nx.cue ? `<button class="say" data-act="continue"><span>${esc(nx.cue)}</span></button>`
                         : `<button data-act="continue">${I.down}<span>Continue</span></button>`;
  } else if (!p.done) {
    c.innerHTML = `<button class="primary" data-act="finish"><span>Mark as read</span></button>`;
  } else {
    drawEnd();
    c.innerHTML = R.next ? `<button class="primary" data-go="#/read/${R.next.date}/${encodeURIComponent(R.next.s.id)}"><span>Next: ${esc(R.next.s.title)}</span>${I.right}</button>`
                : R.iss.partial ? `<button disabled><span class="typing">The next story is being written</span></button>`
                : `<button data-go="#/"><span>You've read everything</span></button>`;
  }
}

function drawEnd() {
  const s = R.s;
  $("#end").innerHTML = `<div class="end">
    ${s.terms?.length ? `<h4>Key terms</h4><dl class="terms">${s.terms.map(t => `<dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd>`).join("")}</dl>` : ""}
    ${s.ask?.length ? `<h4>Questions to explore</h4><div class="chiprow">${s.ask.map(q => `<button class="chip" data-askq="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : ""}
    <details class="sources"><summary>Sources (${s.sources.length})</summary>
      ${s.sources.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}<small>${esc(x.source)} · ${esc(x.date)}</small></a>`).join("")}</details>
  </div>`;
}

const barBottom = () => ($(".bar")?.getBoundingClientRect().bottom || 0);
const rulerTopPx = () => Math.max(barBottom(), innerHeight * (S.settings.rulerPos ?? 0.3));
let rulerH = 0;   // height of the line the ruler sits on (measured from the text)
function setRulerTop(top = rulerTopPx(), h = rulerH) {
  const r = document.documentElement.style;
  r.setProperty("--ruler-top", top + "px");
  if (h) r.setProperty("--ruler-h", h + "px");
}
addEventListener("resize", setRulerTop);
function scrollToEl(el) {
  const y = el.getBoundingClientRect().top + scrollY - rulerTopPx() + 4;
  scrollTo({ top: Math.max(0, y), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
// tap a line to move the ruler onto exactly that line (anywhere on screen); scrolling then carries the text through it
function lineRectAt(x, y) {
  const range = document.caretRangeFromPoint?.(x, y) ||
    (() => { const p = document.caretPositionFromPoint?.(x, y); if (!p) return null; const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r; })();
  if (!range) return null;
  const node = range.startContainer;
  if (node.nodeType !== 3) return null;
  const r = document.createRange();
  const o = Math.min(range.startOffset, node.length - 1);
  r.setStart(node, Math.max(0, o)); r.setEnd(node, Math.max(0, o) + 1);
  const rects = [...r.getClientRects()].filter(q => q.height > 0);
  if (!rects.length) return null;
  const block = node.parentElement.closest("p, li, blockquote, h1, dt, dd, .kicker, .meta, .cue, .turn-you") || node.parentElement;
  const lh = parseFloat(getComputedStyle(block).lineHeight) || rects[0].height;
  const mid = (rects[0].top + rects[0].bottom) / 2;
  return { top: mid - lh / 2, h: lh };
}
document.addEventListener("click", e => {
  if (!S.settings.ruler || !R || !e.target.closest(".story") || e.target.closest("button, a, summary") || !getSelection().isCollapsed) return;
  const line = lineRectAt(e.clientX, e.clientY);
  const lh = line?.h || S.settings.fs * 1.7;
  const top = Math.max(barBottom(), line ? line.top : e.clientY - lh / 2);
  rulerH = lh;
  S.settings.rulerPos = top / innerHeight;
  save(); setRulerTop(top, lh);
});

// Remember exactly where you are (which beat, how far into it, measured at the ruler line) so reopening the
// app puts you back on the same line, whatever the screen size.
function placeNow() {
  const y = rulerTopPx() + 2;
  const blocks = [...document.querySelectorAll("#thread .sec, #thread .cue, #thread .qa")];
  let best = null;
  for (const el of blocks) { const r = el.getBoundingClientRect(); if (r.top <= y) best = el; else break; }
  const sec = best?.closest?.(".sec") || (best && best.previousElementSibling?.closest?.(".sec")) || null;
  if (!sec) return { k: -1, f: 0 };
  const r = sec.getBoundingClientRect();
  return { k: +sec.dataset.sec, f: Math.max(0, Math.min(1, (y - r.top) / Math.max(1, r.height))) };
}
let placeT;
addEventListener("scroll", () => {
  if (!R) return;
  clearTimeout(placeT);
  placeT = setTimeout(() => { if (R) { R.p.place = placeNow(); save(); } }, 400);
}, { passive: true });
const savePlace = () => { if (R && document.body.classList.contains("reading")) { R.p.place = placeNow(); save(); } };
addEventListener("pagehide", savePlace);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") savePlace(); });
function restorePlace() {
  const pl = R.p.place;
  if (!pl || pl.k < 0) return;
  const sec = $(`[data-sec="${pl.k}"]`);
  if (!sec) return;
  const go = () => { const r = sec.getBoundingClientRect(); scrollTo(0, Math.max(0, scrollY + r.top + r.height * pl.f - rulerTopPx() - 2)); };
  go();
  document.fonts?.ready.then(go);                       // fonts change line breaks; settle once they load
}

function cont() {
  const { s, p } = R;
  if (p.sec >= s.sections.length) return;
  p.sec++; save();
  const k = p.sec - 1;
  $("#thread").insertAdjacentHTML("beforeend", sectionHTML(k));
  drawBottom();
  scrollToEl($(`[data-cue="${k}"]`) || $(`[data-sec="${k}"]`));
  R.p.place = { k, f: 0 }; save();                       // a new beat: reopening starts you at its first line
}
function markRead(key) {
  const p = (S.progress[key] ||= { sec: 1 });
  if (!p.done) { p.done = true; p.at = Date.now(); save(); sync.push(); }
}
async function finish() { markRead(R.key); R.next = await nextUp(); drawBottom(); setTimeout(() => scrollToEl($("#end")), 60); }
async function markAndNext() {
  markRead(R.key);
  const n = await nextUp();
  toast("Marked as read");
  location.hash = n ? `#/read/${n.date}/${encodeURIComponent(n.s.id)}` : "#/";
}

// ───────── selection → attach to composer ─────────
const pill = $("#askpill");
let selQuote = "", selSec = 0;
function hidePill() { pill.hidden = true; }
document.addEventListener("selectionchange", () => {
  clearTimeout(pill._t);
  pill._t = setTimeout(() => {
    const sel = getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    const node = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const sec = node?.closest?.(".sec");
    if (!text || text.length < 3 || !sec || !R) return hidePill();
    selQuote = text; selSec = +sec.dataset.sec;
    const rc = sel.getRangeAt(0).getBoundingClientRect();
    pill.style.left = Math.min(innerWidth - 90, Math.max(90, rc.left + rc.width / 2)) + "px";
    const below = rc.bottom + 52;                    // under the selection, clear of the phone's own copy menu
    pill.style.top = (below < innerHeight - 200 ? below : Math.max(70, rc.top - 52)) + "px";
    pill.hidden = false;
  }, 250);
});
pill.addEventListener("pointerdown", e => e.preventDefault());
pill.addEventListener("click", () => { hidePill(); attach(selQuote, selSec); getSelection().removeAllRanges(); });

function attach(text, sec) {
  attached = text; R.attSec = sec;
  $("#att").innerHTML = text ? `<div class="attached"><span>${esc(text)}</span><button type="button" data-act="detach" aria-label="Remove">${I.x}</button></div>` : "";
  $("#q").focus(); updateSend();
}
function updateSend() { $("#send").disabled = !$("#q").value.trim(); }
function bindComposer() {
  const q = $("#q");
  q.addEventListener("input", () => { q.style.height = "auto"; q.style.height = Math.min(150, q.scrollHeight) + "px"; updateSend(); });
  q.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); ask(q.value); } });
  $("#composer").addEventListener("submit", e => { e.preventDefault(); ask(q.value); });
}

// ───────── asking (Gemini, streamed, straight from this device) ─────────
const storyText = s => `# ${s.title}\n${s.dek}\n\n` + s.sections.map(x => `## ${x.heading}\n${x.body}`).join("\n\n");

async function ask(q) {
  q = q.trim(); if (!q || !R) return;
  const quote = attached, sec = attached ? R.attSec : Math.max(0, R.p.sec - 1);
  attached = ""; $("#att").innerHTML = ""; $("#q").value = ""; $("#q").style.height = "auto"; $("#q").blur(); updateSend();
  const qa = $(`[data-qa="${sec}"]`);
  qa.insertAdjacentHTML("beforeend", `<div class="turn-you">${quote ? `<span class="quote">${esc(quote.slice(0, 240))}</span>` : ""}${esc(q)}</div>`);
  const you = qa.lastElementChild;
  const out = document.createElement("div"); out.className = "turn-ai typing"; qa.appendChild(out);
  scrollToEl(you);

  const groqKey = S.settings.groq, key = S.settings.key;
  if (!groqKey && !key) { out.className = "turn-ai"; out.innerHTML = `<p>To ask questions, add a free Groq key once in <a href="#/settings">Settings</a> (from console.groq.com), or open your setup link on this device.</p>`; return; }

  const s = R.s, heading = s.sections[sec]?.heading || "";
  const sys = `You are a knowledgeable, level-headed helper. The reader is going through the article below (your summary of
other outlets' reporting) and has a question. You are not the reporter. Answer calmly and plainly, like a good teacher: explain causes and mechanisms step by step, use a concrete example or analogy,
and tie it back to the article. Default to 120-250 words; go longer only when asked for depth. Use **bold** for the key idea,
short paragraphs, and a list only for real steps. Facts about this event must come from the article; you may add general
background knowledge (signal it, e.g. "In general," or "Historically,") but never invent specifics. If unsure, say so.
No emojis.

ARTICLE
${storyText(s)}
${s.terms?.length ? "\nKEY TERMS: " + s.terms.map(t => t.term + " = " + t.meaning).join("; ") : ""}`;
  const history = (S.chats[R.key] || []).slice(-4).flatMap(c => [
    { role: "user", parts: [{ text: (c.quote ? `About: "${c.quote}"\n` : "") + c.q }] }, { role: "model", parts: [{ text: c.a }] }]);
  const user = `(Section: "${heading}")\n` + (quote ? `About this passage: "${quote}"\n\n` : "") + q;
  const body = { systemInstruction: { parts: [{ text: sys }] }, contents: [...history, { role: "user", parts: [{ text: user }] }],
                 generationConfig: { temperature: 0.6, maxOutputTokens: 2048 } };
  // Groq first when you've added a key (fast, generous free tier), then Gemini
  const tries = [];
  if (groqKey) for (const m of ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b"]) tries.push(["groq", m]);
  if (key) for (const m of [S.settings.model, R.iss.model, "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"]
    .filter((m, i, a) => m && a.indexOf(m) === i)) tries.push(["gemini", m]);
  const groqBody = m => JSON.stringify({ model: m, stream: true, temperature: 0.6, max_completion_tokens: 2048,
    messages: [{ role: "system", content: sys },
      ...(S.chats[R.key] || []).slice(-4).flatMap(c => [{ role: "user", content: (c.quote ? `About: "${c.quote}"\n` : "") + c.q }, { role: "assistant", content: c.a }]),
      { role: "user", content: user }] });
  let text = "", err = "";
  const keyTrouble = {};                                  // provider -> "quota" | "invalid"
  for (const [prov, m] of tries) {
    try {
      const r = prov === "groq"
        ? await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` }, body: groqBody(m) })
        : await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`,
            { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
      if (!r.ok) {
        const t = await r.text();
        err = `${r.status}: ${t.slice(0, 160)}`;
        if (r.status === 401 || r.status === 403 || /api key not valid|invalid api key|API_KEY_INVALID/i.test(t)) keyTrouble[prov] = "invalid";
        else if (r.status === 429) keyTrouble[prov] ||= "quota";
        continue;
      }
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith("data:") || line === "data: [DONE]") continue;
          try {
            const j = JSON.parse(line.slice(5));
            text += prov === "groq" ? (j.choices?.[0]?.delta?.content || "")
                                    : (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
          } catch {}
          out.innerHTML = md(text);
        }
      }
      if (text) { if (prov === "gemini" && S.settings.model !== m) { S.settings.model = m; save(); } break; }
    } catch (e) { err = String(e); }
  }
  out.classList.remove("typing");
  if (text && Object.keys(keyTrouble).length) keyNotice(keyTrouble);   // answered by the backup: still tell you once
  if (!text) {
    out.classList.add("err");
    if (!navigator.onLine) { out.textContent = "You're offline."; return; }
    const msg = keyMessages(keyTrouble);
    out.innerHTML = msg.length ? msg.map(m => `<p>${m}</p>`).join("") : `<p>Couldn't get an answer (${esc(err || "empty reply")}).</p>`;
    return;
  }
  (S.chats[R.key] ||= []).push({ sec, quote, q, a: text, at: Date.now() });
  save();
}

// When a key runs out or stops working, say so plainly (once a day per key in a toast; always in a failed answer).
function keyMessages(trouble) {
  const where = { groq: "console.groq.com/keys", gemini: "aistudio.google.com/apikey" }, name = { groq: "Groq", gemini: "Gemini" };
  return Object.entries(trouble).map(([p, w]) => w === "quota"
    ? `Your ${name[p]} key has used up today's free limit. It resets within a day.`
    : `Your ${name[p]} key no longer works (expired or deleted). Make a new one at ${where[p]} and paste it in <a href="#/settings">Settings</a>.`);
}
function keyNotice(trouble) {
  const day = todayKey();
  for (const [p, w] of Object.entries(trouble)) {
    const k = `keywarn-${p}-${w}`;
    if (S[k] === day) continue;
    S[k] = day; save();
    toast(w === "quota" ? `${p === "groq" ? "Groq" : "Gemini"} key: today's free limit used up` : `${p === "groq" ? "Groq" : "Gemini"} key no longer works; see Settings`, 4000);
  }
}

// ───────── settings ─────────
function renderSettings() {
  const st = S.settings;
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${st[k] === v ? "on" : ""}" data-set="${k}" data-val="${v}">${l}</button>`).join("")}</div>`;
  const sw = k => `<button class="switch ${st[k] ? "on" : ""}" data-toggle="${k}" aria-label="${k}"></button>`;
  app.innerHTML = `<div class="bar"><div class="in"><a class="ib" href="#/" aria-label="Back">${I.back}</a><div class="mid"></div></div></div>
  <div class="col set">
    <h2>Settings</h2>
    <h3>Reading</h3>
    <div class="row"><label>Theme<small>Auto turns dark from 7 pm to 7 am</small></label>${seg("theme", [["auto", "Auto"], ["light", "Light"], ["sepia", "Sepia"], ["dark", "Dark"]])}</div>
    <div class="row"><label>Typeface</label>${seg("font", [["source", "Serif"], ["literata", "Literata"], ["atkinson", "Atkinson"]])}</div>
    <div class="row"><label>Text size<small>${st.fs}px</small></label><div class="seg"><button data-fs="-1">A−</button><button data-fs="1">A+</button></div></div>
    <div class="row"><label>Reading ruler<small>A clear band at eye level; tap any line to move it</small></label>${sw("ruler")}</div>
    <div class="row"><label>Word hints<small>Short meanings above harder words, like Kindle's Word Wise</small></label>${sw("hints")}</div>
    <div class="row"><label>Fixation bold<small>Bolds the start of each word. The evidence for it is weak; keep it only if you like it.</small></label>${sw("bionic")}</div>
    <div class="row"><label>Keep the screen on while reading</label>${sw("awake")}</div>
    <p class="preview">${md("When a central bank turns **hawkish** and raises rates, borrowing gets dearer, so firms delay investment.", { gloss: st.hints ? [{ word: "hawkish", hint: "keen to fight inflation" }] : null })}</p>
    <h3>Questions</h3>
    <div class="row" style="display:block"><label>Groq API key<small>Free from console.groq.com → API Keys. Stored only on this device.</small></label>
      <input class="field" id="groq" type="password" autocomplete="off" placeholder="gsk_…" value="${esc(st.groq || "")}"></div>
    <div class="row" style="display:block"><label>Gemini API key (optional backup)<small>Free from Google AI Studio.</small></label>
      <input class="field" id="key" type="password" autocomplete="off" placeholder="AIza…" value="${esc(st.key)}"></div>
    <h3>Ten o'clock reminder</h3>
    ${st.ntfy ? `<p class="note">Install the free ntfy app, then subscribe below. Each morning at ten it tells you what's in the issue; tapping it opens Read.</p>
      <p><a class="btn" href="ntfy://ntfy.sh/${esc(st.ntfy)}">Subscribe in ntfy</a> <button class="btn" data-act="copy-topic">Copy topic</button></p>`
      : `<p class="note">Open your setup link on this device to turn on the reminder.</p>`}
    <h3>App</h3>
    ${installed() ? `<p class="note">Installed. Read opens in its own window from the Start menu or your home screen.</p>`
      : `<div class="row"><label>Install Read on this device<small>Its own window and icon, on Windows (Start menu, taskbar) and on your phone.</small></label>
         <button class="btn" data-act="install">Install</button></div>
         ${installEvt ? "" : `<p class="note">If the button does nothing, open the browser menu and choose "Install Read" (Brave, Chrome, Edge).</p>`}`}
    <h3>This device</h3>
    <p class="note">${Object.values(S.progress).filter(p => p.done).length} stories read. Nothing here leaves this device.</p>
    <p style="margin-bottom:60px"><button class="btn" data-act="reset">Clear reading history</button></p>
  </div>`;
  $("#key").addEventListener("change", e => { st.key = e.target.value.trim(); save(); toast(st.key ? "Key saved" : "Key removed"); });
  $("#groq").addEventListener("change", e => { st.groq = e.target.value.trim(); save(); toast(st.groq ? "Groq key saved" : "Groq key removed"); });
}

// ───────── one click handler ─────────
document.addEventListener("click", e => {
  const t = e.target.closest("[data-go],[data-act],[data-askq],[data-set],[data-toggle],[data-fs]");
  if (!t) return;
  const d = t.dataset;
  if (d.go) { location.hash = d.go; return; }
  if (d.askq) return ask(d.askq);
  if (d.set) { S.settings[d.set] = d.val; save(); applySettings(); return renderSettings(); }
  if (d.toggle) { S.settings[d.toggle] = !S.settings[d.toggle]; save(); applySettings(); return renderSettings(); }
  if (d.fs) { S.settings.fs = Math.min(26, Math.max(15, S.settings.fs + +d.fs)); save(); applySettings(); return renderSettings(); }
  switch (d.act) {
    case "install": return install();
    case "continue": return cont();
    case "finish": return finish();
    case "mark": return markAndNext();
    case "detach": attached = ""; $("#att").innerHTML = ""; return;
    case "copy-topic": navigator.clipboard?.writeText(S.settings.ntfy); return toast("Copied");
    case "reset": if (confirm("Clear what you've read and your questions on this device?")) { S.progress = {}; S.chats = {}; save(); toast("Cleared"); renderSettings(); } return;
  }
});
addEventListener("keydown", e => {   // laptop: Space or → continues
  if (!R || /TEXTAREA|INPUT/.test(document.activeElement?.tagName)) return;
  if (e.key === " " || e.key === "ArrowRight") { e.preventDefault(); if (R.p.sec < R.s.sections.length) cont(); else if (!R.p.done) finish(); }
});

// "Install app": Brave / Chrome / Edge offer this on Windows and Android; we keep the offer and show our own button
let installEvt = null;
const installed = () => matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay)").matches;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (!R) route(); });
addEventListener("appinstalled", () => { installEvt = null; toast("Installed"); if (!R) route(); });
async function install() {
  if (!installEvt) return toast("Use the browser menu: Install app");
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null;
  if (!R) route();
}

applySettings();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { sync.pull(); if (S.syncPending) sync.push(); } });
setInterval(() => { if (S.syncPending) sync.push(); }, 5 * 60000); navigator.serviceWorker.register("sw.js").catch(() => {});
sync.pull().finally(() => { loadIndex().then(route); sync.live(); if (Object.keys(sync.snapshot()).length) sync.push(); });
