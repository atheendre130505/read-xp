"""Builds today's issue of Read.

  feeds  ->  candidates (recent, unseen)  ->  the LLM picks the most important stories per topic
         ->  full text of each story's sources  ->  the LLM writes a deep, story-driven piece
         ->  site/issues/<date>-<morning|evening>.json (+ index.json)  ->  10:00 reminder scheduled on ntfy

Run:  GEMINI_API_KEY=... python pipeline/build.py [--site site] [--topics econ,philo] [--stories 1]
"""
import argparse
import calendar
import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import feedparser
import requests
import trafilatura

_env = Path(__file__).resolve().parent.parent / ".env"          # local runs: the key lives in .env
if _env.exists():
    for _l in _env.read_text("utf-8").splitlines():
        if "=" in _l and not _l.lstrip().startswith("#"):
            _k, _v = _l.split("=", 1)
            if _v.strip():
                os.environ.setdefault(_k.strip(), _v.strip())

sys.path.insert(0, str(Path(__file__).parent))
import llm  # noqa: E402
import importance  # noqa: E402
from reader import PROFILE  # noqa: E402
from sources import MAX_AGE_DAYS, MAX_PER_FEED, TOPICS  # noqa: E402

TZ = ZoneInfo(os.environ.get("READ_TZ", "Asia/Kolkata"))
REMIND_AT = os.environ.get("REMIND_AT", "10:00")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5"}
WPM = 230   # adult silent reading speed for non-fiction


# ───────────────────────── gathering ─────────────────────────

def clean(text: str, limit: int = 0) -> str:
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit].rsplit(" ", 1)[0] + "…" if limit and len(text) > limit else text


def read_feed(feed):
    name, url, kind = feed
    try:
        r = requests.get(url, headers=UA, timeout=25)
        parsed = feedparser.parse(r.content)
    except Exception as e:  # a broken feed never stops the issue
        print(f"  feed failed: {name}: {e.__class__.__name__}")
        return []
    now, out = time.time(), []
    for e in parsed.entries[:MAX_PER_FEED]:
        t = e.get("published_parsed") or e.get("updated_parsed")
        ts = calendar.timegm(t) if t else now - 86400          # undated research listings count as recent
        if now - ts > MAX_AGE_DAYS[kind] * 86400:
            continue
        link = e.get("link") or ""
        title = clean(e.get("title", ""))
        if not link or not title:
            continue
        out.append({"source": name, "kind": kind, "title": title, "url": link.split("?utm")[0],
                    "summary": clean(e.get("summary", "") or e.get("description", ""), 600),
                    "date": dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d")})
    return out


def full_text(item) -> str:
    try:
        raw = trafilatura.fetch_url(item["url"])
        text = trafilatura.extract(raw, include_comments=False, include_tables=False, favor_precision=True) if raw else None
    except Exception:
        text = None
    text = (text or "").strip()
    if len(text) < 400:                                       # paywall / blocked: the feed's own summary
        text = item["summary"]
    return text[:8000]                                     # keeps each story within the free per-minute limits


# ───────────────────────── choosing ─────────────────────────

PICK_SYSTEM = """You are the editor of a personal daily reader for one curious, serious person. You decide which
few stories in a topic are genuinely worth 5-10 minutes of deep reading today."""

PICK_PROMPT = """Topic: {topic}
Today: {today}

Below are recent items from reputable sources (news, analysis and new research), as
[id] (source · kind · date) title — summary

{items}

Recently covered (do not repeat unless there is a materially new development):
{recent}

Shortlist up to {n} of the most important stories for this topic: big stories, and stories with something real to
learn or use.
Only definitive, newly reported developments: something actually happened, was decided, announced, published or
measured. Skip rumours, speculation, previews of things that haven't happened, opinion without news, and follow-ups
that add nothing new. Also skip: celebrity, sport, routine crime, market-tick noise, listicles, product reviews,
press-release fluff. Merge items about the same story.

If nothing in this list is both important and definitive, return an empty list. That is a good answer.

Return JSON: {{"stories": [{{"ids": [ids of every item about this story, best first, max 4],
"angle": "the specific question this piece should answer", "why": "one line on why it matters"}}]}}
ordered most important first."""


def as_id(x):
    """Models return ids as 12, "12" or "[12]"; accept all of them."""
    m = re.search(r"\d+", str(x))
    return int(m.group(0)) if m else None


def pick(topic, cands, recent, n):
    def prompt(k=len(cands), summary=220, n_recent=40):
        items = "\n".join(f"[{i}] ({c['source']} · {c['kind']} · {c['date']}) {c['title']}"
                          + (f" — {clean(c['summary'], summary)}" if summary else "") for i, c in enumerate(cands[:k]))
        return PICK_PROMPT.format(topic=topic["name"], today=today_str(), items=items, n=n,
                                  recent="\n".join(f"- {h}" for h in recent[:n_recent]) or "- (none)")

    def shrink(max_chars):              # small-request models: fewer candidates (sources take turns, so all stay in)
        for k, summary, nr in [(120, 120, 25), (90, 80, 20), (70, 0, 15), (50, 0, 10), (35, 0, 8)]:
            p = prompt(min(k, len(cands)), summary, nr)
            if len(p) <= max_chars:
                return p
        return None

    out = llm.generate_json(prompt(), system=PICK_SYSTEM, temperature=0.3, tier="light", shrink=shrink, max_tokens=2000)
    stories = out.get("stories", out) if isinstance(out, dict) else out
    picked, used = [], set()
    for s in stories:
        ids = [i for i in map(as_id, s.get("ids", [])) if i is not None and 0 <= i < len(cands) and i not in used][:4]
        if ids:
            used.update(ids)
            picked.append({"items": [cands[i] for i in ids], "angle": s.get("angle", ""), "why": s.get("why", "")})
    return picked[:n]


# No fixed number and no cap: every story that rates high enough goes in, and the app orders your queue by rating.
RATE_PROMPT = PROFILE.replace("{", "{{").replace("}", "}}") + """

{rules}

Score what is actually reported, not the headline's hype.

STORIES
{items}

Return JSON: {{"ratings": [{{"id": story id, "ratings": {shape}}}]}}"""


def rate(stories):
    """The 0-10 ratings on the seven metrics for each story; stories = [(id, text describing it)]."""
    if not stories:
        return {}
    out = {}
    for k in range(0, len(stories), 15):                  # in batches, so the answer never gets cut off
        chunk = stories[k:k + 15]
        try:
            got = llm.generate_json(RATE_PROMPT.format(rules=importance.RATING_INSTRUCTIONS, shape=importance.RATING_JSON,
                                                       items="\n".join(f"[{i}] {t}" for i, t in chunk)),
                                    temperature=0.1, tier="best", max_tokens=4000)
            for r in got.get("ratings", []) if isinstance(got, dict) else []:
                i = as_id(r.get("id"))
                if i is not None and isinstance(r.get("ratings"), dict):
                    out[i] = {m: r["ratings"].get(m) for m in importance.METRICS}
        except Exception as e:
            print("  rating failed:", e, flush=True)
    return out


FIELDS = ["Economics & Finance", "Business & Companies", "Politics & World", "Psychology & Mind",
          "Science & Technology", "Philosophy & Ideas"]

CHOOSE_PROMPT = """You are the chief editor of a small daily reader for one serious, curious person. The field editors
have shortlisted stories. Keep every one that is genuinely important; drop the rest.

- Importance: consequence (how many people, how much money, power or knowledge it changes, and for how long), how much
  there is to understand (a real mechanism, decision or idea), and whether it is definitive, newly reported news.
- No quotas: several from one field and none from another is fine if that is where the important news is.
- Never two about the same event. If two shortlisted items are the same event seen from different fields (e.g. a
  company scandal that is also a geopolitical story), choose it once and merge the other into it.
- Label each chosen story with every field it genuinely belongs to (1-3), from: {fields}.
- Skip anything that repeats what was covered recently without a materially new development.

Recently covered:
{recent}

SHORTLIST
{items}

Return JSON: {{"chosen": [{{"id": shortlist id, "merge": [ids of other items about the same event], "fields": ["..."]}}]}}
most important first."""


def choose(shortlist, recent):
    if not shortlist:
        return []
    items = "\n".join(f"[{i}] ({s['topic']['name']}) "
                      f"{s['items'][0]['title']} | angle: {s['angle']} | why: {s['why']}"
                      for i, s in enumerate(shortlist))
    try:
        out = llm.generate_json(CHOOSE_PROMPT.format(items=items, fields=", ".join(FIELDS),
                                                     recent="\n".join(f"- {h}" for h in recent[:40]) or "- (none)"),
                                temperature=0.2, tier="best", max_tokens=6000)
        chosen, used = [], set()
        for c in out.get("chosen", []):
            i = as_id(c.get("id")) if isinstance(c, dict) else as_id(c)
            if i is None or not 0 <= i < len(shortlist) or i in used:
                continue
            used.add(i)
            s = dict(shortlist[i])
            for j in map(as_id, (c.get("merge") or []) if isinstance(c, dict) else []):
                if j is not None and 0 <= j < len(shortlist) and j not in used:      # same event from another field
                    used.add(j)
                    s["items"] = (s["items"] + [x for x in shortlist[j]["items"] if x not in s["items"]])[:4]
            fields = [f for f in (c.get("fields") or []) if f in FIELDS] if isinstance(c, dict) else []
            s["fields"] = fields or [s["topic"]["name"]]
            chosen.append(s)
        if chosen:
            return chosen
    except Exception as e:
        print("  choose failed, keeping the whole shortlist:", e, flush=True)
    return [dict(s, fields=[s["topic"]["name"]]) for s in shortlist]


# ───────────────────────── writing ─────────────────────────

WRITE_SYSTEM = """You are a knowledgeable, level-headed friend helping one reader through today's reporting.
You are NOT the reporter. The journalists and researchers did the reporting; your job is to relay what they found,
faithfully, and to help the reader understand it: the background, the mechanism, why it matters.

Rules you never break:
- Every fact about this event (names, numbers, dates, quotes, what happened) comes ONLY from the source texts, and you
  say who reported it: "The Financial Times reports…", "According to Reuters…", "A new NBER paper finds…".
  Where only one outlet reports something, or it rests on anonymous sources, say so.
- Never invent scenes, dialogue, feelings, motives or details. Do not dramatise. No "Picture this", no cliffhangers,
  no breathless adjectives. A calm, warm, plain-spoken tone, like a good teacher explaining the news over coffee.
- To explain HOW something works, use real examples and case studies from history or other countries (e.g. the 2008
  crisis, Japan's lost decade, India's 1991 reforms), clearly presented as background, not as part of today's news.
  Keep them accurate and well known; if you're not sure of a detail, leave it out.
- If the sources disagree or something is uncertain, say so plainly.
- No emojis. Explain jargon in plain words the first time you use it."""

WRITE_PROMPT = """Topic: {topic}
The question this piece answers: {angle}
Why it matters: {why}

SOURCES
{sources}

Walk the reader through this story as a conversation, in beats. After each beat the reader asks the natural next
question, and the next beat answers it.

Cover, in a natural order:
- What was reported, in order: who did what, when, and the reasons given (the incentives, constraints and options
  involved, as reported or as clearly explained background).
- HOW it works: the mechanism step by step, a cause-and-effect chain a curious 16-year-old could follow.
  Economics/finance: follow the money and the incentives. Business: the decisions, bets and trade-offs.
  Politics: power, interests and rules. Research: what was done, how, what was found, how strong the evidence is.
  Ideas: the argument, the best objection and the reply.
- A real example or case study that makes the mechanism click, if one genuinely helps.
- Context: history, comparisons, base rates.
- What's uncertain or disputed, and the other side's case.
- What to watch next, and what it means for an ordinary person.
- Finally, the LAST beat, marked "apply": true, is about what the reader can take away and use. Make it concrete and
  practical, tied to this story's mechanism:
  Business: the strategy or decision principle at work, when it works and when it backfires, and how the reader
  could use it in their own work, career, team or a small business (with a small worked example).
  Psychology/mind: what the finding suggests trying in daily life, as a specific small experiment or habit, and
  how strong the evidence is (don't oversell one study).
  Economics/finance: how this changes the way to think about one's own money, prices, loans, jobs or savings
  (general principles only, never "buy X").
  Politics/world: a mental model for reading similar events, and what signals to watch.
  Science/technology: what changes in practice, and how to judge similar claims.
  Ideas/philosophy: a question or practice to try on one's own beliefs or decisions.
  These suggestions are yours, as the helper, not the sources': phrase them as suggestions ("One way to use
  this...", "You could try..."), never as reported fact.

Length: {words} words across 8-11 beats of roughly 150-300 words each. Depth matters more than breadth: every beat
should teach something specific (a number in context, a step in the mechanism, a reason someone acted). Short
paragraphs (1-4 sentences). Use **bold** for the 1-2 key ideas in a beat, a list only when steps are genuinely
list-shaped. No links. Plain markdown text only: never any HTML or tags (no <ruby>, <hint>, <span>), and never add
word meanings in brackets for hard words; a separate step shows short meanings above them.

For every beat except the first, write the reader's "cue": the short, natural question they'd ask right before it,
2-9 words, e.g. "Why would they do that?", "How does that actually work?", "Has this happened before?",
"Who disagrees?", "What does this mean for me?". Each must fit the beat it leads into. The "apply" beat's cue is
like "How can I use this?" or "What should I take from this?".

Return JSON:
{{"title": "a plain, specific headline, max 12 words",
 "dek": "one sentence on what this piece explains",
 "beats": [{{"cue": "reader's question (empty for the first beat)", "label": "2-4 word name for this beat", "body": "markdown",
            "apply": false}}],   // the last beat has "apply": true
 "terms": [{{"term": "...", "meaning": "one-sentence plain definition"}}],   // 3-6 key concepts
 "ask": ["3 good questions the reader might still want to ask"]}}"""

GLOSS_PROMPT = """Below is an article. Like Kindle's Word Wise, pick the hard words a reader might stop on, and give
each a tiny plain meaning that will be shown in small type directly above the word.

Rules:
- Only genuinely hard or uncommon words and short jargon phrases (e.g. "linchpin", "hawkish", "repo rate",
  "extramarital", "fiscal deficit"). Not names, not everyday words, not words the article already explains in the
  same or the next sentence.
- The hint is 1-3 plain words that could replace the word in the sentence ("key part", "keen to raise rates").
  It must not repeat the word itself.
- "word" must be copied exactly as it appears in the text (same spelling), and each word only once.
- 5-12 entries.

Return JSON: {{"glossary": [{{"word": "...", "hint": "..."}}]}}

ARTICLE
{text}"""

EDIT_PROMPT = """You are the editor. Below are the source texts and a draft piece written from them (JSON).
Improve the draft and return it in exactly the same JSON shape.

- Accuracy first: remove or correct any fact, number, name or quote that the sources don't support, and make sure
  each reported fact says who reported it. Background explanations may stay if they are well known and accurate.
- Make it clearer and deeper: where a step in the explanation is skipped, add it; cut repetition and filler.
- Keep the calm, plain voice, the beats and the reader's cues (adjust a cue if the beat changed). Keep the final
  "apply" beat and make it more concrete and useful if you can; it must stay framed as suggestions. Keep the length
  about the same or longer; never shorten it by more than a tenth.
- Plain markdown only, no HTML or tags, no word meanings in brackets.

SOURCES
{sources}

DRAFT
{draft}"""


INLINE_HINT = re.compile(r'<(hint|span|abbr|gloss)\b[^>]*?"([^"]*)"[^>]*>(.*?)</\1>', re.I | re.S)
RUBY = re.compile(r"<ruby>\s*(.*?)\s*<rt>\s*(.*?)\s*</rt>\s*</ruby>(\s*)(\w[\w'-]*)?", re.I | re.S)


def clean_body(text):
    """The writer sometimes puts markup in the text despite being told not to: <hint="key part">linchpin</hint>,
    <span title=...>, or <ruby>price increases<rt>inflation</rt></ruby> inflation. Turn each into a glossary
    entry, keep exactly one copy of the word, and drop every other tag. Returns (clean text, glossary entries)."""
    gloss = []

    def ruby(m):
        a, b, gap, nxt = m.group(1), m.group(2), m.group(3), m.group(4) or ""
        for word, hint in ((a, b), (b, a)):
            if nxt and word.lower() == nxt.lower():          # "<ruby>X<rt>Y</rt></ruby> Y": keep the following word
                gloss.append({"word": word, "hint": hint})
                return nxt
        gloss.append({"word": a, "hint": b})
        return a + gap + nxt

    def hint(m):
        gloss.append({"word": m.group(3).strip(), "hint": m.group(2).strip()})
        return m.group(3)

    text = RUBY.sub(ruby, text)
    text = INLINE_HINT.sub(hint, text)
    text = re.sub(r"<rt>.*?</rt>", "", text, flags=re.I | re.S)  # any stray hint text never enters the prose
    text = re.sub(r"</?[a-zA-Z][^>]*>", "", text)
    return text, gloss


EXPLAINED = re.compile(r"^\W{0,3}(\(|—|–| - |, (which|meaning|or|i\.e\.|that is)\b|: )", re.I)


def clean_gloss(g, text):
    """Keeps only hints that will read well above the word: the word appears exactly, the hint is short, doesn't
    repeat the word, isn't already explained right after it in the text, and isn't part of a longer hinted phrase."""
    out, seen = [], set()
    low = text.lower()
    for e in sorted(g or [], key=lambda e: -len((e.get("word") or ""))):     # longer phrases win
        w, h = (e.get("word") or "").strip(), (e.get("hint") or "").strip().strip(".")
        wl = w.lower()
        if not w or not h or wl in seen or len(h.split()) > 4 or len(h) > 32:
            continue
        m = re.search(r"(?<![\w-])" + re.escape(wl) + r"(?![\w-])", low)
        if not m:
            continue
        if wl in h.lower() or h.lower() == wl:                                  # hint repeats the word
            continue
        after = low[m.end():m.end() + 60]
        if EXPLAINED.search(after) or any(x in after for x in h.lower().split() if len(x) > 4):
            continue                                                            # the text already explains it
        if any(wl in s or s in wl for s in seen):                               # overlaps a hinted phrase
            continue
        seen.add(wl)
        out.append({"word": w, "hint": h})
    return out[:14]


def add_glossary(story):
    """Backfills Word Wise hints for a story written without them."""
    text = "\n\n".join(s["body"] for s in story["sections"])
    g = llm.generate_json(GLOSS_PROMPT.format(text=text), temperature=0.2, tier="light").get("glossary", [])
    story["glossary"] = clean_gloss(g, text)
    return story


def write(topic, story, tier="best"):
    items = story["items"]
    with cf.ThreadPoolExecutor(4) as ex:
        texts = list(ex.map(full_text, items))
    blocks = [f"[{i + 1}] {it['source']} ({it['kind']}, {it['date']}): {it['title']}\n{t}"
              for i, (it, t) in enumerate(zip(items, texts))]
    depth = sum(len(t) for t in texts)
    words = "1600-2200" if depth > 6000 else "1300-1700"
    sources = "\n\n".join(blocks)
    def write_prompt(src, w=words):
        return WRITE_PROMPT.format(topic=topic["name"], angle=story["angle"], why=story["why"], sources=src, words=w)

    def trimmed(max_chars, make):
        """For small-request models: the same sources, each cut to fit (the opening of an article carries the most)."""
        overhead = len(make(""))
        room = max_chars - overhead
        if room < 2500:
            return None
        per = room // len(blocks)
        return make("\n\n".join(b[:per] for b in blocks))

    piece = llm.generate_json(write_prompt(sources), system=WRITE_SYSTEM, temperature=0.7, max_tokens=14000, tier=tier,
                              shrink=lambda mc: trimmed(mc, lambda s: write_prompt(s, "1200-1600")))
    # second pass: an editor checks it against the sources and makes it clearer and deeper
    try:
        draft = json.dumps(piece, ensure_ascii=False)
        edited = llm.generate_json(EDIT_PROMPT.format(sources=sources, draft=draft),
                                   system=WRITE_SYSTEM, temperature=0.4, max_tokens=14000, tier=tier,
                                   shrink=lambda mc: trimmed(mc, lambda s: EDIT_PROMPT.format(sources=s, draft=draft)))
        old_n = sum(len(b.get("body", "").split()) for b in piece.get("beats", []))
        new_n = sum(len(b.get("body", "").split()) for b in edited.get("beats", []))
        if new_n >= 0.85 * old_n and len(edited.get("beats", [])) >= 3:
            piece = {**piece, **edited}
    except Exception as e:
        print("    edit pass skipped:", e, flush=True)
    secs = [s for s in piece.get("beats", piece.get("sections", [])) if s.get("body")]
    if len(secs) < 3:
        raise ValueError("too short")
    inline = []
    for sec in secs:
        sec["body"], g = clean_body(sec["body"])
        inline += g
    text = "\n\n".join(s["body"] for s in secs)
    try:                                                    # word hints: their own careful pass
        g = llm.generate_json(GLOSS_PROMPT.format(text=text), temperature=0.2, tier="light", max_tokens=1200).get("glossary", [])
    except Exception:
        g = []
    piece["glossary"] = g + inline
    n_words = sum(len(s["body"].split()) for s in secs)
    return {
        "id": re.sub(r"[^a-z0-9]+", "-", piece.get("title", "story").lower()).strip("-")[:60],
        "title": piece.get("title", items[0]["title"]),
        "dek": piece.get("dek", ""),
        "kind": items[0]["kind"],
        "why": story["why"],
        "rating": story.get("rating", {}),
        "score": story.get("score"),
        "minutes": max(2, round(n_words / WPM)),
        "words": n_words,
        "sections": [{"heading": s.get("label") or s.get("heading", ""), "cue": (s.get("cue") or "").strip() if k else "",
                      "body": s["body"], **({"apply": True} if str(s.get("apply")).lower() == "true" else {})}
                     for k, s in enumerate(secs)],
        "glossary": clean_gloss(piece.get("glossary"), " ".join(x["body"] for x in secs)),
        "terms": piece.get("terms", [])[:6],
        "ask": piece.get("ask", [])[:3],
        "sources": [{"title": it["title"], "url": it["url"], "source": it["source"], "date": it["date"]} for it in items],
    }


# ───────────────────────── issue ─────────────────────────

def today_str():
    return dt.datetime.now(TZ).strftime("%Y-%m-%d")


KEY_NAMES = {"gemini": ("Gemini", "aistudio.google.com/apikey"), "groq": ("Groq", "console.groq.com/keys")}


def alert_keys(site_url, failed=False):
    """Phone notification when a key's free quota ran out or a key stopped working (once per run)."""
    topic = os.environ.get("NTFY_TOPIC")
    lines = []
    for prov, what in llm.problems.items():
        name, where = KEY_NAMES[prov]
        lines.append(f"{name}: free daily limit used up. It resets within a day; nothing to do unless it keeps happening."
                     if what == "quota" else f"{name}: key rejected (expired or deleted). Make a new one at {where} and "
                     f"replace {prov.upper()}_API_KEY in GitHub secrets and in Read's settings.")
    if failed and not lines:
        lines.append("The issue couldn't be written. Check the run on GitHub Actions.")
    if not lines:
        return
    print("key alert:", " | ".join(lines), flush=True)
    if topic:
        try:
            requests.post(f"https://ntfy.sh/{topic}", data="\n".join(lines).encode(), timeout=20,
                          headers={"Title": "Read: an API key needs attention" if llm.problems else "Read: today's issue failed",
                                   "Tags": "warning", "Priority": "high", "Click": site_url})
        except requests.RequestException:
            pass


def remind(issue, site_url):
    """Schedules the daily nudge on ntfy for REMIND_AT local time (exact delivery, no server of our own)."""
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        return
    hh, mm = map(int, REMIND_AT.split(":"))
    now = dt.datetime.now(TZ)
    at = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    stories = [s for t in issue["topics"] for s in t["stories"]]
    if stories:
        mins = sum(s["minutes"] for s in stories)
        body = f"{len(stories)} stories · ~{mins} min. First up: {stories[0]['title']}"
    else:
        body = "Your stories are waiting."
    headers = {"Title": "Today's read is ready", "Tags": "books", "Priority": "high", "Click": site_url}
    if at > now + dt.timedelta(minutes=2):
        headers["At"] = str(int(at.timestamp()))
    r = requests.post(f"https://ntfy.sh/{topic}", data=body.encode(), headers=headers, timeout=20)
    print("reminder:", r.status_code, "at", at.strftime("%H:%M %Z") if "At" in headers else "now")


def rate_existing(out_dir):
    for p in sorted(out_dir.glob("20*.json")):
        iss = json.loads(p.read_text("utf-8"))
        todo = [(t, x) for t in iss["topics"] for x in t["stories"] if not x.get("rating")]
        if not todo:
            continue
        got = rate([(i, f"({t['name']}) {x['title']} | {x.get('dek', '')} | why: {x.get('why', '')} | sources: "
                        f"{', '.join(src['source'] for src in x.get('sources', []))}") for i, (t, x) in enumerate(todo)])
        for i, (t, x) in enumerate(todo):
            if got.get(i):
                x["rating"], x["score"] = got[i], importance.score(got[i])
                print(f"  {x['score']:4.1f}  {x['title'][:70]}", flush=True)
        p.write_text(json.dumps(iss, ensure_ascii=False, indent=1), "utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default=str(Path(__file__).parent.parent / "site"))
    ap.add_argument("--topics", default="")
    ap.add_argument("--stories", type=int, default=0, help="override the number of stories in this edition")
    ap.add_argument("--remind-only", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="pick and rate, print, write nothing")
    ap.add_argument("--rate-existing", action="store_true", help="rate published stories that have no rating yet")
    ap.add_argument("--edition", choices=["morning", "evening"], help="default: by the time of day")
    a = ap.parse_args()

    site = Path(a.site)
    out_dir = site / "issues"
    out_dir.mkdir(parents=True, exist_ok=True)
    site_url = os.environ.get("SITE_URL", "https://atheendre130505.github.io/read-xp/")
    day = today_str()
    edition = a.edition or ("morning" if dt.datetime.now(TZ).hour < 15 else "evening")
    date = f"{day}-{edition}"                              # two editions a day, kept apart

    if a.rate_existing:
        rate_existing(out_dir)
        return

    if a.remind_only:                                      # pipeline failed: still nudge at 10:00
        remind({"topics": []}, site_url)
        return

    done_path = out_dir / f"{date}.json"                 # a backup run: the edition is already written
    if os.environ.get("SCHEDULED") == "true" and done_path.exists() and not json.loads(done_path.read_text("utf-8")).get("partial"):
        print(f"{date} is already written; nothing to do")
        return

    seen_path = out_dir / "seen.json"
    seen = json.loads(seen_path.read_text("utf-8")) if seen_path.exists() else {}
    cutoff = (dt.date.today() - dt.timedelta(days=21)).isoformat()
    seen = {u: d for u, d in seen.items() if d >= cutoff}

    index_path = out_dir / "index.json"
    index = json.loads(index_path.read_text("utf-8")) if index_path.exists() else []
    recent_heads, all_recent = {}, []
    for entry in index[:6]:
        p = out_dir / f"{entry['date']}.json"
        if p.exists() and entry["date"] != date:
            for t in json.loads(p.read_text("utf-8"))["topics"]:
                recent_heads.setdefault(t["id"], []).extend(s["title"] for s in t["stories"])
                all_recent.extend(s["title"] for s in t["stories"])

    wanted = set(filter(None, a.topics.split(",")))
    issue = {"date": date, "day": day, "edition": edition, "generated": dt.datetime.now(TZ).isoformat(timespec="minutes"),
             "model": llm.models()[0], "partial": True, "topics": []}
    print(f"{edition} edition", flush=True)

    def publish():
        """Saves the issue as it stands, so the app can show each story the moment it is written."""
        n = sum(len(t["stories"]) for t in issue["topics"])
        if not n:
            return
        out = {**issue, "topics": [t for t in issue["topics"] if t["stories"] or t.get("pending")]}
        (out_dir / f"{date}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")
        seen_path.write_text(json.dumps(seen, indent=0), "utf-8")
        first = next(s for t in issue["topics"] for s in t["stories"])
        entry = {"date": date, "day": day, "edition": edition, "stories": n, "minutes": sum(s["minutes"] for t in issue["topics"] for s in t["stories"]),
                 "headline": first["title"], "partial": issue["partial"]}
        idx = [entry] + [e for e in index if e["date"] != date]
        for e in idx[90:]:                                # older issues fall off
            (out_dir / f"{e['date']}.json").unlink(missing_ok=True)
        index_path.write_text(json.dumps(idx[:90], ensure_ascii=False, indent=1), "utf-8")

    # 1. each topic's editor shortlists its two strongest stories (light model)
    shortlist = []
    for topic in TOPICS:
        if wanted and topic["id"] not in wanted:
            continue
        print(f"\n== {topic['name']}", flush=True)
        with cf.ThreadPoolExecutor(10) as ex:
            cands = [c for batch in ex.map(read_feed, topic["feeds"]) for c in batch]
        # newest first, then take turns across sources so every outlet gets a voice in the editor's list
        cands.sort(key=lambda c: c["date"], reverse=True)
        by_src = {}
        for c in cands:
            by_src.setdefault(c["source"], []).append(c)
        cands = [c for rnd in range(MAX_PER_FEED) for lst in by_src.values() if rnd < len(lst) for c in [lst[rnd]]]
        dedup, titles = [], set()
        for c in cands:
            key = re.sub(r"\W+", "", c["title"].lower())[:60]
            if c["url"] not in seen and key not in titles:
                titles.add(key)
                dedup.append(c)
        cands = dedup[:240]
        print(f"  {len(cands)} candidates from {len(by_src)} sources", flush=True)
        if not cands:
            continue
        try:
            got = pick(topic, cands, recent_heads.get(topic["id"], []) + all_recent, 3)
            print(f"  shortlisted {len(got)}" + ("" if got else " (nothing new and definitive)"), flush=True)
            for s in got:
                shortlist.append({**s, "topic": topic})
        except Exception as e:
            print("  pick failed:", e, flush=True)

    # 2. the chief editor merges the same event seen from different fields and drops repeats; then each story is
    #    rated 0-10 on seven metrics, the score is the plain average, and every story at or above the bar goes in
    chosen = choose(shortlist, all_recent)
    desc = [(i, f"({', '.join(s.get('fields') or [s['topic']['name']])}) {s['items'][0]['title']} | angle: {s['angle']}"
                f" | why: {s['why']} | sources: {', '.join(it['source'] for it in s['items'])}")
            for i, s in enumerate(chosen)]
    ratings = rate(desc)
    for i, s in enumerate(chosen):
        s["rating"] = ratings.get(i, {})
        s["score"] = importance.score(s["rating"]) if s["rating"] else 0
    chosen = importance.dedupe(chosen)                    # backstop: never two stories about one event
    chosen.sort(key=lambda s: -s["score"])
    print("\nratings (" + " ".join(importance.METRICS) + "):", flush=True)
    for s in chosen:
        print(f"  {s['score']:4.1f}  {[s['rating'].get(m) for m in importance.METRICS]}  {s['items'][0]['title'][:70]}", flush=True)
    if a.dry_run:
        return
    chosen = [s for s in chosen if s["score"] >= importance.THRESHOLD]
    if a.stories:
        chosen = chosen[:a.stories]
    print(f"\nchosen {len(chosen)} (bar {importance.THRESHOLD})", flush=True)
    if not chosen:
        print("nothing important enough this time")
        return

    # 3. each one is written by the best model, edited, and given word hints; published one by one
    for s in chosen:
        topic = s["topic"]
        entry = {"id": topic["id"], "name": " · ".join(s.get("fields") or [topic["name"]]), "stories": [], "pending": 1}
        issue["topics"].append(entry)
        print("  writing:", s["items"][0]["title"][:90], flush=True)
        try:
            story = write(topic, s, tier="best")
            entry["stories"].append(story)
            for it in s["items"]:
                seen[it["url"]] = date
            print(f"    done: {story['title']} ({story['words']} words)", flush=True)
        except Exception as e:
            print("    write failed:", e, flush=True)
        entry["pending"] = 0
        publish()

    issue["partial"] = False
    for t in issue["topics"]:
        t.pop("pending", None)
    n_stories = sum(len(t["stories"]) for t in issue["topics"])
    if not n_stories:
        print("no stories written; keeping yesterday's issue")
        alert_keys(site_url, failed=True)
        remind({"topics": []}, site_url)
        sys.exit(1)
    publish()
    print(f"\nissue {date}: {n_stories} stories", flush=True)
    alert_keys(site_url)
    if edition == "morning":                              # the 10:00 nudge comes with the morning edition
        remind(issue, site_url)


if __name__ == "__main__":
    main()
