// Tiny, safe Markdown → HTML for the subset the writer uses: paragraphs, **bold**, *italic*,
// bullet / numbered lists, > quotes. Everything is escaped first, so nothing in a story can inject HTML.
// Optional extras: Word Wise hints (a short gloss shown above a hard word, first use only) and fixation bold.
(function () {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // walk the text between tags, skipping anything already inside a hinted word (<x-w>)
  function eachText(html, fn) {
    let inRuby = 0;
    return html.split(/(<[^>]+>)/g).map(part => {
      if (part.startsWith("<")) { if (/^<x-w/.test(part)) inRuby++; else if (/^<\/x-w/.test(part)) inRuby--; return part; }
      return inRuby ? part : fn(part);
    }).join("");
  }

  // A hint is shown once per story, on the first use of the word, and never when it would say the same thing twice:
  // the hint repeats the word, or the text right after the word already explains it ("deficit (the gap…)").
  const EXPLAINED = /^\W{0,3}(\(|—|–| - |, (which|meaning|or|i\.e\.|that is)\b|: )/i;
  function gloss(html, list, used) {
    for (const g of list) {
      const key = g.word.toLowerCase();
      if (used.has(key)) continue;
      if (g.hint.toLowerCase().includes(key)) { used.add(key); continue; }
      if ([...used].some(u => u.includes(key) || key.includes(u))) continue;   // overlaps a hinted phrase
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${reEsc(esc(g.word))})(?![\\p{L}\\p{N}])`, "iu");
      let done = false;
      html = eachText(html, t => {
        if (done) return t;
        return t.replace(re, (m, pre, w, off, str) => {
          done = true;
          const after = str.slice(off + m.length, off + m.length + 60);
          if (EXPLAINED.test(after)) return m;                                   // already explained in the text
          return `${pre}<x-w data-h="${esc(g.hint)}">${w}</x-w>`;
        });
      });
      if (done) used.add(key);
    }
    return html;
  }

  // the writer sometimes puts hints inline, e.g. <hint="never done before">unprecedented</hint>,
  // <hint style="key part">linchpin</hint> or <span title="...">word</span>: turn those into proper hints
  const INLINE_HINT = /<(hint|span|abbr|gloss)\b[^>]*?"([^"]*)"[^>]*>(.*?)<\/\1>/gi;
  const MARK = /(\d+)/g;                     // private-use characters as placeholders

  function inline(s, o = {}) {
    const hints = [];
    s = String(s).replace(INLINE_HINT, (m, tag, hint, word) => { hints.push([word, hint]); return `${hints.length - 1}`; });
    s = s.replace(/<rt>[\s\S]*?<\/rt>/gi, "");             // hint text never shows inline
    s = s.replace(/<\/?[a-z][^>]*>/gi, "");                // any other stray tag
    s = esc(s);
    s = s.replace(MARK, (m, i) => o.gloss ? `<x-w data-h="${esc(hints[i][1])}">${esc(hints[i][0])}</x-w>` : esc(hints[i][0]));
    s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>");
    if (o.gloss?.length) s = gloss(s, o.gloss, o.used || new Set());
    if (o.bionic) {   // bold the first ~40% of each word (fixation aid; off by default)
      s = eachText(s, t => t.replace(/[A-Za-zÀ-ÿ]{4,}/g, w => { const k = Math.ceil(w.length * 0.4); return `<span class="fx">${w.slice(0, k)}</span>${w.slice(k)}`; }));
    }
    return s;
  }

  function md(src, opts = {}) {
    const o = { ...opts, gloss: opts.gloss ? opts.gloss.slice().sort((a, b) => b.word.length - a.word.length) : null };
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    const out = [];
    let para = [], list = null;
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "), o)}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i, o)}</li>`).join("")}</${list.tag}>`); list = null; } };
    for (const raw of lines) {
      const line = raw.trim();
      let m;
      if (!line) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^[-*•]\s+(.*)/)) || (m = line.match(/^\d+[.)]\s+(.*)/))) {
        flushPara();
        const tag = /^\d/.test(line) ? "ol" : "ul";
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push(m[1]);
        continue;
      }
      if ((m = line.match(/^>\s?(.*)/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1], o)}</blockquote>`); continue; }
      if ((m = line.match(/^#{1,6}\s+(.*)/))) { flushPara(); flushList(); out.push(`<p><b>${inline(m[1])}</b></p>`); continue; }
      flushList();
      para.push(line);
    }
    flushPara(); flushList();
    return out.join("");
  }
  window.md = md;
  window.esc = esc;
})();
