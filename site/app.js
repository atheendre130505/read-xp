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
const DEF = { settings: { theme: "light", font: "source", fs: 19, ruler: true, bionic: false, hints: true, awake: true, key: "", ntfy: "", model: "", rulerPos: 0.3 },
              progress: {}, chats: {} };
let S;
try { const raw = JSON.parse(localStorage.getItem("rxp") || "{}");
      S = { ...structuredClone(DEF), progress: raw.progress || {}, chats: raw.chats || {}, settings: { ...DEF.settings, ...(raw.settings || {}) } }; }
catch { S = structuredClone(DEF); }
const save = () => { try { localStorage.setItem("rxp", JSON.stringify(S)); } catch {} };

// setup link: #setup=<base64 {k: gemini key, t: ntfy topic}>. The fragment never reaches any server.
(function setupFromLink() {
  const m = location.hash.match(/setup=([^&]+)/);
  if (!m) return;
  try {
    const cfg = JSON.parse(atob(decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/")));
    if (cfg.k) S.settings.key = cfg.k;
    if (cfg.t) S.settings.ntfy = cfg.t;
    save(); setTimeout(() => toast("Set up on this device"), 400);
  } catch { setTimeout(() => toast("That setup link didn't work"), 400); }
  history.replaceState(null, "", location.pathname + "#/");
})();

// ───────── look ─────────
function applySettings() {
  const st = S.settings, r = document.documentElement;
  r.dataset.theme = st.theme; r.dataset.font = st.font;
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
      R.iss = fresh; R.next = list[i + 1];
      if (R.p.done) drawBottom();
    } else if (!R && !location.hash.startsWith("#/settings")) route();
  } catch {}
}, 20000);
const allStories = iss => iss.topics.flatMap(t => t.stories.map(s => ({ ...s, topic: t })));
const pkey = (date, s) => `${date}/${s.id}`;
const isRead = (date, s) => !!S.progress[pkey(date, s)]?.done;
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

async function renderHome(date) {
  if (!INDEX.length) await loadIndex();
  date ||= INDEX[0].date;
  const iss = await issue(date), list = allStories(iss);
  const total = list.reduce((n, s) => n + s.minutes, 0);
  const nRead = list.filter(s => isRead(date, s)).length;
  const next = list.find(s => !isRead(date, s));
  const started = list.some(s => S.progress[pkey(date, s)]);
  const isToday = date === INDEX[0].date;
  const nice = date === "sample" ? "A sample story while your first issue is written"
    : new Date((iss.day || date) + "T12:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
      + (iss.edition ? ` · ${iss.edition === "evening" ? "Evening" : "Morning"} edition` : "");
  app.innerHTML = `<div class="bar"><div class="in">${isToday ? `<div class="word">Read</div>` : `<a class="ib" href="#/" aria-label="Today">${I.back}</a>`}
      <div class="mid"></div><a class="ib" href="#/settings" aria-label="Settings">${I.gear}</a></div></div>
    <div class="col">
      <div class="hello"><h1>${isToday ? greeting() : "From the archive"}</h1>
        <p>${esc(nice)}</p>${date === "sample" ? "" : `<p class="count"><b>${nRead}</b> of ${list.length}${iss.partial ? "+" : ""} read<i class="dot"></i>about ${list.filter(s => !isRead(date, s)).reduce((n, s) => n + s.minutes, 0)} min left</p>`}</div>
      ${next ? `<button class="begin" data-go="#/read/${date}/${encodeURIComponent(next.id)}"><div>
          <div class="lab">${started ? "Continue reading" : "Begin with"}</div><div class="t">${esc(next.title)}</div></div><div class="go">${I.right}</div></button>`
             : `<div class="hello" style="padding:24px 0 34px"><p>You've read everything in this edition. The next one is written at nine.</p></div>`}
      ${iss.topics.map(t => `<section class="topic"><h2><span>${esc(t.name)}</span><span>${t.stories.filter(s => isRead(date, s)).length} of ${t.stories.length}${t.pending ? "+" : ""}</span></h2>
        ${t.stories.map(s => `<button class="item ${isRead(date, s) ? "read" : ""}" data-go="#/read/${date}/${encodeURIComponent(s.id)}">
          <div class="t">${esc(s.title)}</div>
          <div class="m">${kindLabel(s.kind)}<i class="dot"></i>${s.minutes} min<i class="dot"></i>${esc(outlets(s).slice(0, 2).join(", "))}</div></button>`).join("")}
        ${t.pending ? `<div class="item pending"><div class="m typing">${t.pending === 1 ? "One more story" : t.pending + " more stories"} being written</div></div>` : ""}
      </section>`).join("")}
      ${iss.partial ? `<p class="writing typing">More topics are being written. They'll appear here as they're ready.</p>` : ""}
      ${INDEX.length > 1 ? `<section class="topic past"><h2><span>Earlier issues</span></h2>${INDEX.filter(e => e.date !== date).slice(0, 10).map(e =>
        `<button data-go="#/day/${e.date}"><span>${esc(e.headline)}</span><small>${new Date((e.day || e.date) + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}${e.edition ? ` · ${e.edition}` : ""} · ${e.stories} stories</small></button>`).join("")}</section>` : ""}
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
  const p = (S.progress[pkey(date, s)] ||= { sec: 1, done: false });
  save();
  R = { date, iss, s, p, next: list[i + 1], key: pkey(date, s), pos: i + 1, total: list.length, used: new Set() };
  attached = "";
  document.body.classList.add("reading"); wake(true);
  app.innerHTML = `<div class="bar"><div class="in"><a class="ib" href="#/day/${date}" aria-label="Back">${I.back}</a>
      <div class="mid">${esc(s.topic.name)}</div><div class="right" id="left"></div></div><div class="prog"><i id="prog"></i></div></div>
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
  setRulerTop();
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
  $("#left").textContent = `${R.pos} of ${R.total}${R.iss.partial ? "+" : ""} · ` + (p.done ? "finished" : `${Math.max(1, Math.round(left / WPM + .4))} min left`);
  $("#prog").style.width = (100 * (p.done ? 1 : p.sec / (s.sections.length + 1))) + "%";
  const c = $("#cont");
  if (p.sec < s.sections.length) {
    const nx = s.sections[p.sec];
    c.innerHTML = nx.cue ? `<button class="say" data-act="continue"><span>${esc(nx.cue)}</span></button>`
                         : `<button data-act="continue">${I.down}<span>Continue</span></button>`;
  } else if (!p.done) {
    c.innerHTML = `<button class="say" data-act="finish"><span>Thanks, that was good.</span></button>`;
  } else {
    drawEnd();
    c.innerHTML = R.next ? `<button class="primary" data-go="#/read/${R.date}/${encodeURIComponent(R.next.id)}"><span>Next: ${esc(R.next.title)}</span>${I.right}</button>`
                : R.iss.partial ? `<button disabled><span class="typing">The next story is being written</span></button>`
                : `<button data-go="#/day/${R.date}"><span>That's the whole issue</span></button>`;
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

const rulerTopPx = () => innerHeight * (S.settings.rulerPos || 0.3);
function setRulerTop() { document.documentElement.style.setProperty("--ruler-top", rulerTopPx() + "px"); }
addEventListener("resize", setRulerTop);
function scrollToEl(el) {
  const y = el.getBoundingClientRect().top + scrollY - rulerTopPx() + 4;
  scrollTo({ top: Math.max(0, y), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
// tap a line to move the ruler there; scrolling then carries the text through it
document.addEventListener("click", e => {
  if (!S.settings.ruler || !R || !e.target.closest(".sec, .story h1, .dek") || !getSelection().isCollapsed) return;
  S.settings.rulerPos = Math.min(0.7, Math.max(0.1, (e.clientY - S.settings.fs * 1.62) / innerHeight));
  save(); setRulerTop();
});

function cont() {
  const { s, p } = R;
  if (p.sec >= s.sections.length) return;
  p.sec++; save();
  const k = p.sec - 1;
  $("#thread").insertAdjacentHTML("beforeend", sectionHTML(k));
  drawBottom();
  scrollToEl($(`[data-cue="${k}"]`) || $(`[data-sec="${k}"]`));
}
function finish() { R.p.done = true; save(); drawBottom(); setTimeout(() => scrollToEl($("#end")), 60); }

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

  const key = S.settings.key;
  if (!key) { out.className = "turn-ai"; out.innerHTML = `<p>To ask questions, add your Gemini key once in <a href="#/settings">Settings</a>, or open your setup link on this device.</p>`; return; }

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
  const models = [S.settings.model, R.iss.model, "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"].filter((m, i, a) => m && a.indexOf(m) === i);
  let text = "", err = "";
  for (const m of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
      if (!r.ok) { err = `${r.status}: ${(await r.text()).slice(0, 160)}`; if (/API key/i.test(err)) break; continue; }
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          try { const j = JSON.parse(line.slice(5)); text += (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join(""); } catch {}
          out.innerHTML = md(text);
        }
      }
      if (text) { if (S.settings.model !== m) { S.settings.model = m; save(); } break; }
    } catch (e) { err = String(e); }
  }
  out.classList.remove("typing");
  if (!text) { out.classList.add("err"); out.textContent = navigator.onLine ? "Couldn't get an answer (" + (err || "empty reply") + ")." : "You're offline."; return; }
  (S.chats[R.key] ||= []).push({ sec, quote, q, a: text, at: Date.now() });
  save();
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
    <div class="row"><label>Theme</label>${seg("theme", [["light", "Light"], ["sepia", "Sepia"], ["dark", "Dark"]])}</div>
    <div class="row"><label>Typeface</label>${seg("font", [["source", "Serif"], ["literata", "Literata"], ["atkinson", "Atkinson"]])}</div>
    <div class="row"><label>Text size<small>${st.fs}px</small></label><div class="seg"><button data-fs="-1">A−</button><button data-fs="1">A+</button></div></div>
    <div class="row"><label>Reading ruler<small>A clear band at eye level; tap any line to move it</small></label>${sw("ruler")}</div>
    <div class="row"><label>Word hints<small>Short meanings above harder words, like Kindle's Word Wise</small></label>${sw("hints")}</div>
    <div class="row"><label>Fixation bold<small>Bolds the start of each word. The evidence for it is weak; keep it only if you like it.</small></label>${sw("bionic")}</div>
    <div class="row"><label>Keep the screen on while reading</label>${sw("awake")}</div>
    <p class="preview">${md("When a central bank turns **hawkish** and raises rates, borrowing gets dearer, so firms delay investment.", { gloss: st.hints ? [{ word: "hawkish", hint: "keen to fight inflation" }] : null })}</p>
    <h3>Questions</h3>
    <div class="row" style="display:block"><label>Gemini API key<small>Free from Google AI Studio. Stored only on this device.</small></label>
      <input class="field" id="key" type="password" autocomplete="off" placeholder="Paste your key" value="${esc(st.key)}"></div>
    <h3>Ten o'clock reminder</h3>
    ${st.ntfy ? `<p class="note">Install the free ntfy app, then subscribe below. Each morning at ten it tells you what's in the issue; tapping it opens Read.</p>
      <p><a class="btn" href="ntfy://ntfy.sh/${esc(st.ntfy)}">Subscribe in ntfy</a> <button class="btn" data-act="copy-topic">Copy topic</button></p>`
      : `<p class="note">Open your setup link on this device to turn on the reminder.</p>`}
    <h3>This device</h3>
    <p class="note">${Object.values(S.progress).filter(p => p.done).length} stories read. Nothing here leaves this device.</p>
    <p style="margin-bottom:60px"><button class="btn" data-act="reset">Clear reading history</button></p>
  </div>`;
  $("#key").addEventListener("change", e => { st.key = e.target.value.trim(); save(); toast(st.key ? "Key saved" : "Key removed"); });
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
    case "continue": return cont();
    case "finish": return finish();
    case "detach": attached = ""; $("#att").innerHTML = ""; return;
    case "copy-topic": navigator.clipboard?.writeText(S.settings.ntfy); return toast("Copied");
    case "reset": if (confirm("Clear what you've read and your questions on this device?")) { S.progress = {}; S.chats = {}; save(); toast("Cleared"); renderSettings(); } return;
  }
});
addEventListener("keydown", e => {   // laptop: Space or → continues
  if (!R || /TEXTAREA|INPUT/.test(document.activeElement?.tagName)) return;
  if (e.key === " " || e.key === "ArrowRight") { e.preventDefault(); if (R.p.sec < R.s.sections.length) cont(); else if (!R.p.done) finish(); }
});

applySettings();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
loadIndex().then(route);
