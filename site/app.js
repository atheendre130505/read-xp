// Read XP — a focused daily reader. One finite issue a day, read section by section, ask about any passage.
// Everything you do (progress, XP, chats, settings, your Gemini key) stays on this device only.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const WPM = 230;
const DAILY_GOAL = 3;                         // stories a day for the goal bonus
const XP = { section: 5, story: 20, quiz: 10, ask: 5, goal: 30 };
const RANKS = [[75, "Oracle"], [50, "Polymath"], [35, "Sage"], [20, "Scholar"], [10, "Thinker"], [5, "Reader"], [1, "Curious"]];

// ───────── storage (device only) ─────────
const DEF = { settings: { theme: "paper", font: "literata", fs: 19, ruler: true, bionic: false, awake: true, key: "", ntfy: "", model: "" },
              progress: {}, chats: {}, xp: 0, days: {}, asked: {} };
let S;
try { S = Object.assign(structuredClone(DEF), JSON.parse(localStorage.getItem("rxp") || "{}")); S.settings = Object.assign({}, DEF.settings, S.settings); }
catch { S = structuredClone(DEF); }
const save = () => { try { localStorage.setItem("rxp", JSON.stringify(S)); } catch {} };

// ───────── setup link: #setup=<base64 {k: gemini key, t: ntfy topic}> (fragment never reaches a server) ─────────
(function setupFromLink() {
  const m = location.hash.match(/setup=([^&]+)/);
  if (!m) return;
  try {
    const cfg = JSON.parse(atob(decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/")));
    if (cfg.k) S.settings.key = cfg.k;
    if (cfg.t) S.settings.ntfy = cfg.t;
    save();
    setTimeout(() => toast("✓ Set up on this device"), 400);
  } catch { setTimeout(() => toast("That setup link didn't work"), 400); }
  history.replaceState(null, "", location.pathname + "#/");
})();

// ───────── levels ─────────
const xpToNext = l => 50 + 15 * l;
function levelOf(xp) { let l = 1, need = 0; while (l < 100 && xp >= need + xpToNext(l)) { need += xpToNext(l); l++; } return { l, into: xp - need, next: xpToNext(l) }; }
const rankOf = l => RANKS.find(([min]) => l >= min)[1];
const todayKey = () => new Date().toLocaleDateString("en-CA");      // local YYYY-MM-DD
function streak() {
  let n = 0; const d = new Date();
  if (!(S.days[todayKey()] > 0)) d.setDate(d.getDate() - 1);        // today not read yet: streak still alive from yesterday
  while (S.days[d.toLocaleDateString("en-CA")] > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function gain(n, why) {
  const before = levelOf(S.xp).l;
  S.xp += n; save();
  const after = levelOf(S.xp).l;
  if (after > before) { toast(`Level ${after} · ${rankOf(after)} 🎉`, 2600); burst(); }
  else if (why) toast(`+${n} XP · ${why}`);
}

// ───────── look & feel ─────────
function applySettings() {
  const st = S.settings, r = document.documentElement;
  r.dataset.theme = st.theme; r.dataset.font = st.font;
  r.style.setProperty("--fs", st.fs + "px");
  document.body.classList.toggle("ruler-on", !!st.ruler);
  const bg = getComputedStyle(r).getPropertyValue("--bg").trim();
  $('meta[name="theme-color"]').setAttribute("content", bg || "#f6f1e7");
}

let toastT;
function toast(msg, ms = 1600) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms); }
function burst() {
  const b = $("#burst"), cols = ["#b5532a", "#2f6f62", "#d9893d", "#2f7d4f", "#6a5acd"];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("i");
    p.style.cssText = `left:${50 + (Math.random() - .5) * 30}%;top:-10px;background:${cols[i % 5]};--dx:${(Math.random() - .5) * 300}px;--r:${Math.random() * 720}deg;animation-delay:${Math.random() * .3}s`;
    b.appendChild(p); setTimeout(() => p.remove(), 1800);
  }
}

// keep the screen on while reading
let lock = null;
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
  if (!INDEX.length) INDEX = [{ date: "sample", stories: 0, minutes: 0, headline: "Sample issue" }];
}
async function issue(date) {
  if (!ISSUES[date]) ISSUES[date] = await getJSON(date === "sample" ? "sample.json" : `issues/${date}.json`);
  return ISSUES[date];
}
const allStories = iss => iss.topics.flatMap(t => t.stories.map(s => ({ ...s, topic: t })));
const pkey = (date, s) => `${date}/${s.id}`;
const prog = (date, s) => (S.progress[pkey(date, s)] ||= { sec: 1, done: false, quiz: {} });

// ───────── router ─────────
async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [view, a, b] = h.split("/");
  document.body.classList.remove("reading"); wake(false); hidePill();
  window.scrollTo(0, 0);
  try {
    if (view === "read") return await renderReader(a, decodeURIComponent(b));
    if (view === "settings") return renderSettings();
    if (view === "day") return await renderHome(a);
    return await renderHome();
  } catch (e) {
    app.innerHTML = `<div class="wrap"><div class="empty">Couldn't load today's issue.<br><small>${esc(String(e))}</small><br><br><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
  }
}
addEventListener("hashchange", route);

// ───────── home ─────────
function ring(frac) {
  const c = 2 * Math.PI * 14, done = frac >= 1;
  return `<svg class="ring" viewBox="0 0 34 34"><circle cx="17" cy="17" r="14" fill="none" stroke="var(--line)" stroke-width="3"/>
    <circle cx="17" cy="17" r="14" fill="none" stroke="${done ? "var(--good)" : "var(--acc)"}" stroke-width="3" stroke-linecap="round"
    stroke-dasharray="${c * frac} ${c}" transform="rotate(-90 17 17)"/>${done ? '<text x="17" y="22" text-anchor="middle" font-size="14" fill="var(--good)">✓</text>' : ""}</svg>`;
}

async function renderHome(date) {
  if (!INDEX.length) await loadIndex();
  date ||= INDEX[0].date;
  const iss = await issue(date);
  const list = allStories(iss);
  const lv = levelOf(S.xp), st = streak(), todayDone = S.days[todayKey()] || 0;
  const total = list.reduce((n, s) => n + s.minutes, 0);
  const next = list.find(s => !S.progress[pkey(date, s)]?.done);
  const started = list.some(s => S.progress[pkey(date, s)]);
  const nice = date === "sample" ? "Sample issue" : new Date(date + "T12:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  app.innerHTML = `<div class="wrap">
    <div class="top"><div class="brand">Read XP</div><a class="icon" href="#/settings" aria-label="Settings">⚙︎</a></div>
    <div class="stats">
      <div class="streak">🔥${st}<small>day<br>streak</small></div>
      <div class="lvl">Level ${lv.l} · ${rankOf(lv.l)} <span>${lv.into}/${lv.next} XP</span></div>
      <div class="bar"><i style="width:${(100 * lv.into / lv.next).toFixed(1)}%"></i></div>
      <div class="goal">Today's goal <span class="dots">${Array.from({ length: DAILY_GOAL }, (_, i) => `<i class="${i < todayDone ? "on" : ""}"></i>`).join("")}</span>
        ${todayDone >= DAILY_GOAL ? "done · +" + XP.goal + " XP" : `${DAILY_GOAL} stories`}</div>
    </div>
    <div class="date">${esc(nice)}</div>
    <h1 class="issue">${date === "sample" ? "Your reader is almost ready" : "Today's read"}</h1>
    <div class="sub">${list.length} stories · ~${total} min · ${iss.topics.length} topics</div>
    ${next ? `<button class="start" data-go="#/read/${date}/${encodeURIComponent(next.id)}">${started ? "Continue" : "Start reading"} → ${esc(next.title)}</button>`
           : `<div class="box" style="text-align:center">✓ You finished this issue. Tomorrow's arrives before 10:00.</div>`}
    ${iss.topics.map(t => `<div class="tsec"><div class="thead">${t.emoji} ${esc(t.name)}<span class="count">${t.stories.filter(s => S.progress[pkey(date, s)]?.done).length}/${t.stories.length}</span></div>
      ${t.stories.map(s => { const p = S.progress[pkey(date, s)]; const f = p ? (p.done ? 1 : (p.sec - 1) / s.sections.length) : 0;
        return `<button class="scard ${p?.done ? "done" : ""}" data-go="#/read/${date}/${encodeURIComponent(s.id)}">${ring(f)}<div>
          <div class="t">${esc(s.title)}</div><div class="m"><span class="kind ${s.kind}">${s.kind}</span>${s.minutes} min · ${esc(s.sources[0]?.source || "")}</div></div></button>`; }).join("")}</div>`).join("")}
    ${INDEX.length > 1 ? `<div class="past"><h3>Earlier issues</h3>${INDEX.filter(e => e.date !== date).slice(0, 7).map(e =>
      `<button data-go="#/day/${e.date}">${esc(e.headline)}<small>${e.date} · ${e.stories} stories · ${e.minutes} min</small></button>`).join("")}</div>` : ""}
  </div>`;
}

// ───────── reader ─────────
let R = null;   // current reading context

async function renderReader(date, id) {
  const iss = await issue(date);
  const list = allStories(iss);
  const i = list.findIndex(s => s.id === id);
  if (i < 0) { location.hash = "#/"; return; }
  const s = list[i], p = prog(date, s);
  R = { date, iss, s, p, next: list[i + 1], key: pkey(date, s) };
  document.body.classList.add("reading"); wake(true);
  app.innerHTML = `<div class="rbar"><a class="icon" href="#/day/${date}" aria-label="Back">←</a>
      <div class="where">${s.topic.emoji} ${esc(s.topic.name)}</div><div class="left" id="left"></div>
      <button class="icon" data-act="ask-story" aria-label="Ask">💬</button><div class="prog" id="prog"></div></div>
    <div class="wrap"><article class="story" id="story">
      <h1>${esc(s.title)}</h1><p class="dek">${esc(s.dek)}</p>
      <div class="meta"><span class="kind ${s.kind}">${s.kind}</span>${s.minutes} min · ${esc(s.sources.map(x => x.source).filter((v, k, a) => a.indexOf(v) === k).join(", "))}</div>
      <div id="thread"></div><div id="end"></div>
    </article></div>
    <div class="next" id="nextbar"></div>`;
  drawThread();
  setRulerTop();
}

function sectionHTML(k) {
  const sec = R.s.sections[k];
  return `<section class="msg" data-sec="${k}"><h2>${esc(sec.heading)}</h2>${md(sec.body, { bionic: S.settings.bionic })}</section><div class="qa" data-qa="${k}">${qaHTML(k)}</div>`;
}
function qaHTML(k) {
  return (S.chats[R.key] || []).filter(c => c.sec === k).map(c =>
    `<div class="bub you">${c.quote ? `<q>${esc(c.quote.slice(0, 220))}</q>` : ""}${esc(c.q)}</div><div class="bub guide">${md(c.a)}</div>`).join("");
}

function drawThread() {
  const { s, p } = R;
  $("#thread").innerHTML = s.sections.slice(0, p.sec).map((_, k) => sectionHTML(k)).join("");
  drawBottom();
}

function drawBottom() {
  const { s, p } = R;
  const left = s.sections.slice(p.sec).reduce((n, x) => n + x.body.split(/\s+/).length, 0);
  $("#left").textContent = p.done ? "done" : `${Math.max(1, Math.round(left / WPM + .4))} min left`;
  $("#prog").style.width = (100 * (p.done ? 1 : p.sec / (s.sections.length + 1))) + "%";
  const nb = $("#nextbar");
  if (p.sec < s.sections.length) {
    nb.innerHTML = `<button data-act="continue">Continue · ${p.sec + 1}/${s.sections.length}</button>`;
    $("#end").innerHTML = "";
  } else if (!p.done) {
    nb.innerHTML = `<button data-act="finish">Finish story ✓</button>`;
    $("#end").innerHTML = "";
  } else {
    drawEnd();
    nb.innerHTML = R.next ? `<button data-go="#/read/${R.date}/${encodeURIComponent(R.next.id)}">Next: ${esc(R.next.title.slice(0, 38))}${R.next.title.length > 38 ? "…" : ""} →</button>`
                          : `<button data-go="#/day/${R.date}">Issue complete 🎉</button>`;
  }
}

function drawEnd() {
  const { s, p } = R;
  $("#end").innerHTML = `<div class="endcap">
    ${s.takeaways?.length ? `<div class="box"><h3>Worth remembering</h3><ul>${s.takeaways.map(t => `<li>${md(t).replace(/^<p>|<\/p>$/g, "")}</li>`).join("")}</ul></div>` : ""}
    ${s.quiz?.length ? `<div class="box quiz"><h3>Check yourself · +${XP.quiz} XP each</h3>${s.quiz.map((q, qi) => {
      const ans = p.quiz[qi];
      return `<div class="q">${esc(q.q)}</div><div class="opts">${q.options.map((o, oi) => {
        const cls = ans === undefined ? "" : oi === q.answer ? "right" : oi === ans ? "wrong" : "";
        return `<button class="${cls}" data-quiz="${qi}:${oi}" ${ans !== undefined ? "disabled" : ""}>${esc(o)}</button>`; }).join("")}</div>
        ${ans !== undefined ? `<div class="why">${ans === q.answer ? "✓ " : "✗ "}${esc(q.why || "")}</div>` : ""}`; }).join("")}</div>` : ""}
    ${s.terms?.length ? `<div class="box"><h3>Key terms</h3><dl class="terms">${s.terms.map(t => `<dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd>`).join("")}</dl></div>` : ""}
    <div class="box"><h3>Go deeper</h3><div class="chipsrow">${(s.ask || []).map(q => `<button class="chip" data-askq="${esc(q)}">${esc(q)}</button>`).join("")}
      <button class="chip" data-act="ask-story">Ask your own…</button></div></div>
    <details class="box sources"><summary><b>Sources</b> (${s.sources.length}) — for checking facts</summary><br>
      ${s.sources.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}<small>${esc(x.source)} · ${esc(x.date)}</small></a>`).join("")}</details>
  </div>`;
}

function rulerTopPx() { return innerHeight * (S.settings.rulerPos || 0.34); }
function setRulerTop() { document.documentElement.style.setProperty("--ruler-top", rulerTopPx() + "px"); }
addEventListener("resize", setRulerTop);
// tap a line to move the ruler there (like a finger under the line); scrolling then carries the text through it
document.addEventListener("click", e => {
  if (!S.settings.ruler || !document.body.classList.contains("reading") || !e.target.closest(".msg, .story h1, .dek")) return;
  if (!getSelection().isCollapsed) return;
  const lineH = S.settings.fs * 1.62;
  S.settings.rulerPos = Math.min(0.7, Math.max(0.12, (e.clientY - lineH) / innerHeight));
  save(); setRulerTop();
});

function scrollToEl(el) {
  const y = el.getBoundingClientRect().top + scrollY - rulerTopPx() + 4;
  scrollTo({ top: Math.max(0, y), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function cont() {
  const { s, p } = R;
  if (p.sec >= s.sections.length) return;
  p.sec++; save();
  const k = p.sec - 1;
  $("#thread").insertAdjacentHTML("beforeend", sectionHTML(k));
  drawBottom();
  gain(XP.section, "section");
  scrollToEl($(`[data-sec="${k}"] h2`));
}

function finish() {
  const { p } = R;
  if (p.done) return;
  p.done = true;
  const d = todayKey();
  S.days[d] = (S.days[d] || 0) + 1;
  save();
  gain(XP.story, "story finished");
  if (S.days[d] === DAILY_GOAL) setTimeout(() => { gain(XP.goal); toast(`Daily goal hit · +${XP.goal} XP 🔥 ${streak()}`, 2600); burst(); }, 1200);
  drawBottom();
  setTimeout(() => scrollToEl($("#end")), 50);
}

function answerQuiz(qi, oi) {
  const q = R.s.quiz[qi];
  if (R.p.quiz[qi] !== undefined) return;
  R.p.quiz[qi] = oi; save();
  if (oi === q.answer) gain(XP.quiz, "right"); else toast("Not quite — read why");
  drawEnd();
}

// ───────── selection → ask ─────────
const pill = $("#askpill");
let selQuote = "", selSec = 0;
function hidePill() { pill.hidden = true; }
document.addEventListener("selectionchange", () => {
  clearTimeout(pill._t);
  pill._t = setTimeout(() => {
    const sel = getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    const node = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const sec = node?.closest?.(".msg");
    if (!text || text.length < 3 || !sec || !R) return hidePill();
    selQuote = text; selSec = +sec.dataset.sec;
    const rc = sel.getRangeAt(0).getBoundingClientRect();
    pill.style.left = Math.min(innerWidth - 90, Math.max(90, rc.left + rc.width / 2)) + "px";
    const below = rc.bottom + 56;                                // under the selection, clear of the phone's own copy menu
    pill.style.top = (below < innerHeight - 90 ? below : Math.max(70, rc.top - 54)) + "px";
    pill.hidden = false;
  }, 250);
});
pill.addEventListener("pointerdown", e => e.preventDefault());       // keep the selection while tapping
pill.addEventListener("click", () => { hidePill(); openSheet(selQuote, selSec); getSelection().removeAllRanges(); });

// ───────── chat ─────────
let chatCtx = null;
function openSheet(quote = "", sec = null, ask = "") {
  if (!R) return;
  chatCtx = { quote, sec: sec ?? Math.max(0, R.p.sec - 1) };
  const log = $("#chatlog");
  const prev = (S.chats[R.key] || []);
  log.innerHTML = prev.map(c => `<div class="bub you">${c.quote ? `<q>${esc(c.quote.slice(0, 220))}</q>` : ""}${esc(c.q)}</div><div class="bub guide">${md(c.a)}</div>`).join("")
    + (quote ? `<div class="bub you" id="pending"><q>${esc(quote.slice(0, 300))}</q><span style="color:var(--dim)">Ask anything about this…</span></div>` : "");
  const chips = quote ? ["Why?", "How does this work?", "Explain it simpler", "Give me an example", "What's the counter-argument?"]
                      : (R.s.ask || []).concat(["Summarise the story in 5 lines", "What's the history behind this?"]);
  $("#chips").innerHTML = chips.map(c => `<button class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("");
  $("#sheet").hidden = false;
  log.scrollTop = log.scrollHeight;
  if (ask) send(ask); else setTimeout(() => $("#chatin").focus(), 200);
}
function closeSheet() { $("#sheet").hidden = true; chatCtx = null; }

function storyText(s) { return `# ${s.title}\n${s.dek}\n\n` + s.sections.map(x => `## ${x.heading}\n${x.body}`).join("\n\n"); }

async function send(q) {
  q = q.trim(); if (!q || !chatCtx) return;
  const key = S.settings.key;
  const log = $("#chatlog");
  $("#pending")?.remove();
  log.insertAdjacentHTML("beforeend", `<div class="bub you">${chatCtx.quote ? `<q>${esc(chatCtx.quote.slice(0, 220))}</q>` : ""}${esc(q)}</div>`);
  if (!key) {
    log.insertAdjacentHTML("beforeend", `<div class="bub guide">To chat, add your free Gemini key once in <a href="#/settings" data-act="close-sheet">Settings</a> (or open your setup link).</div>`);
    return;
  }
  const out = document.createElement("div"); out.className = "bub guide typing"; log.appendChild(out); log.scrollTop = log.scrollHeight;
  $("#chatin").value = ""; autosize();

  const s = R.s, sec = s.sections[chatCtx.sec];
  const sys = `You are the reader's patient, brilliant tutor inside Read XP. They are reading the article below and asked about it.
Answer like a great teacher who loves stories: explain causes and mechanisms step by step, use a concrete example or analogy,
and connect back to the article. Default to 120-250 words; go longer only if they ask for depth. Use **bold** for the key idea,
short paragraphs, a list only for real steps. Facts about this news event must come from the article; you may add general
background knowledge (say "In general," or "Historically,") but never invent specifics about the event. If unsure, say so.

ARTICLE
${storyText(s)}

${s.terms?.length ? "KEY TERMS: " + s.terms.map(t => t.term + " = " + t.meaning).join("; ") : ""}`;
  const history = (S.chats[R.key] || []).slice(-4).flatMap(c => [
    { role: "user", parts: [{ text: (c.quote ? `About: "${c.quote}"\n` : "") + c.q }] },
    { role: "model", parts: [{ text: c.a }] }]);
  const user = (chatCtx.quote ? `I'm in the section "${sec.heading}". About this passage: "${chatCtx.quote}"\n\n` : `I'm in the section "${sec?.heading || ""}".\n\n`) + q;
  const body = { systemInstruction: { parts: [{ text: sys }] }, contents: [...history, { role: "user", parts: [{ text: user }] }],
                 generationConfig: { temperature: 0.6, maxOutputTokens: 2048 } };

  let text = "";
  const models = [S.settings.model, R.iss.model, "gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"].filter((m, i, a) => m && a.indexOf(m) === i);
  let ok = false, err = "";
  for (const m of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
      if (!r.ok) { err = `${r.status} ${(await r.text()).slice(0, 160)}`; if (r.status === 400 && /API key/i.test(err)) break; continue; }
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          try { const j = JSON.parse(line.slice(5)); text += (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join(""); } catch {}
          out.innerHTML = md(text); log.scrollTop = log.scrollHeight;
        }
      }
      if (text) { ok = true; if (S.settings.model !== m) { S.settings.model = m; save(); } break; }
    } catch (e) { err = String(e); }
  }
  out.classList.remove("typing");
  if (!ok) { out.classList.add("err"); out.textContent = "Couldn't reach Gemini: " + (err || "no answer") + (navigator.onLine ? "" : " (you're offline)"); return; }
  const entry = { sec: chatCtx.sec, quote: chatCtx.quote, q, a: text, at: Date.now() };
  (S.chats[R.key] ||= []).push(entry);
  chatCtx.quote = "";                                     // follow-ups continue the same thread
  const n = (S.asked[R.key] || 0);
  if (n < 3) { S.asked[R.key] = n + 1; save(); gain(XP.ask, "curiosity"); } else save();
  const qa = document.querySelector(`[data-qa="${entry.sec}"]`); if (qa) qa.innerHTML = qaHTML(entry.sec);
}

function autosize() { const t = $("#chatin"); t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight) + "px"; }
$("#chatin").addEventListener("input", autosize);
$("#chatin").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); send($("#chatin").value); } });
$("#chatform").addEventListener("submit", e => { e.preventDefault(); send($("#chatin").value); });
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });

// ───────── settings ─────────
function renderSettings() {
  const st = S.settings;
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${st[k] === v ? "on" : ""}" data-set="${k}" data-val="${v}">${l}</button>`).join("")}</div>`;
  const sw = k => `<button class="switch ${st[k] ? "on" : ""}" data-toggle="${k}" aria-label="${k}"></button>`;
  app.innerHTML = `<div class="wrap set">
    <div class="top"><a class="icon" href="#/">←</a><div class="brand">Settings</div></div>
    <h2>Reading</h2>
    <div class="row"><label>Theme</label>${seg("theme", [["paper", "Paper"], ["sepia", "Sepia"], ["night", "Night"]])}</div>
    <div class="row"><label>Typeface<small>Literata (book serif) or Atkinson (max legibility)</small></label>${seg("font", [["literata", "Literata"], ["atkinson", "Atkinson"]])}</div>
    <div class="row"><label>Text size<small>${st.fs}px</small></label><div class="seg"><button data-fs="-1">A−</button><button data-fs="1">A+</button></div></div>
    <div class="row"><label>Reading ruler<small>Clear band at eye level, the rest gently dimmed</small></label>${sw("ruler")}</div>
    <div class="row"><label>Fixation bold<small>Bolds the start of each word. Evidence that it helps is weak — try it, keep it only if you like it.</small></label>${sw("bionic")}</div>
    <div class="row"><label>Keep screen on while reading</label>${sw("awake")}</div>
    <p class="story" style="margin-top:16px"><b>Preview:</b> When a central bank raises rates, borrowing gets dearer, so firms delay investment and households spend less.</p>
    <h2 style="margin-top:28px">Chat</h2>
    <div class="row" style="display:block"><label>Gemini API key<small>Free from Google AI Studio. Stored only on this device.</small></label>
      <input class="field" id="key" type="password" autocomplete="off" placeholder="AIza…" value="${esc(st.key)}"></div>
    <h2 style="margin-top:28px">10:00 reminder</h2>
    ${st.ntfy ? `<p class="note">Install the free <b>ntfy</b> app (Play Store / F-Droid), then tap below to subscribe. The nudge arrives at 10:00 every day with what's in the issue; tapping it opens Read XP.</p>
      <p><a class="btn" href="ntfy://ntfy.sh/${esc(st.ntfy)}">Subscribe in ntfy</a> <button class="btn" data-act="copy-topic">Copy topic</button></p>`
      : `<p class="note">Open your setup link on this device to turn on the 10:00 reminder.</p>`}
    <h2 style="margin-top:28px">You</h2>
    <p class="note">Level ${levelOf(S.xp).l} · ${S.xp} XP · ${Object.values(S.progress).filter(p => p.done).length} stories read · ${streak()}-day streak. Everything stays on this device.</p>
    <p><button class="btn" data-act="reset">Reset progress</button></p>
  </div>`;
  $("#key").addEventListener("change", e => { st.key = e.target.value.trim(); save(); toast(st.key ? "Key saved" : "Key removed"); });
}

// ───────── one click handler for everything ─────────
document.addEventListener("click", e => {
  const t = e.target.closest("[data-go],[data-act],[data-quiz],[data-askq],[data-chip],[data-set],[data-toggle],[data-fs]");
  if (!t) return;
  const d = t.dataset;
  if (d.go) { location.hash = d.go; return; }
  if (d.quiz) { const [q, o] = d.quiz.split(":").map(Number); return answerQuiz(q, o); }
  if (d.askq) return openSheet("", R.p.sec - 1, d.askq);
  if (d.chip) return send(d.chip);
  if (d.set) { S.settings[d.set] = d.val; save(); applySettings(); return renderSettings(); }
  if (d.toggle) { S.settings[d.toggle] = !S.settings[d.toggle]; save(); applySettings(); return renderSettings(); }
  if (d.fs) { S.settings.fs = Math.min(26, Math.max(15, S.settings.fs + +d.fs)); save(); applySettings(); return renderSettings(); }
  switch (d.act) {
    case "continue": return cont();
    case "finish": return finish();
    case "ask-story": return openSheet("", R?.p.sec - 1);
    case "close-sheet": return closeSheet();
    case "copy-topic": navigator.clipboard?.writeText(S.settings.ntfy); return toast("Copied");
    case "reset": if (confirm("Reset XP, streak, progress and chats on this device?")) { const keep = S.settings; S = structuredClone(DEF); S.settings = keep; save(); toast("Reset"); renderSettings(); } return;
  }
});
addEventListener("keydown", e => {   // laptop: Space / → continues, Esc closes the chat
  if (!R || !document.body.classList.contains("reading") || !$("#sheet").hidden && e.key !== "Escape") return;
  if (e.key === "Escape") return closeSheet();
  if ((e.key === " " || e.key === "ArrowRight") && document.activeElement === document.body) {
    e.preventDefault();
    if (R.p.sec < R.s.sections.length) cont(); else if (!R.p.done) finish();
  }
});

// ───────── start ─────────
applySettings();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
loadIndex().then(route);
