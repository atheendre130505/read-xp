// Tiny, safe Markdown → HTML for the subset the writer uses: paragraphs, **bold**, *italic*,
// bullet / numbered lists, > quotes. Everything is escaped first, so nothing in a story can inject HTML.
(function () {
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function inline(s, bionic) {
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>");
    if (bionic) {
      // bold the first ~40% of each word outside existing <b>…</b> and tags (fixation aid; off by default)
      s = s.split(/(<b>.*?<\/b>|<[^>]+>)/g).map(part => {
        if (part.startsWith("<")) return part;
        return part.replace(/[A-Za-zÀ-ÿ]{4,}/g, w => { const k = Math.ceil(w.length * 0.4); return `<span class="fx">${w.slice(0, k)}</span>${w.slice(k)}`; });
      }).join("");
    }
    return s;
  }

  function md(src, opts = {}) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    const out = [];
    let para = [], list = null;
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "), opts.bionic)}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i, opts.bionic)}</li>`).join("")}</${list.tag}>`); list = null; } };
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
      if ((m = line.match(/^>\s?(.*)/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1], opts.bionic)}</blockquote>`); continue; }
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
