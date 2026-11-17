"""Builds today's issue of Read XP.

  feeds  ->  candidates (recent, unseen)  ->  the LLM picks the most important stories per topic
         ->  full text of each story's sources  ->  the LLM writes a deep, story-driven piece
         ->  site/issues/<date>.json (+ index.json)  ->  10:00 reminder scheduled on ntfy

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

sys.path.insert(0, str(Path(__file__).parent))
import llm  # noqa: E402
from sources import MAX_AGE_DAYS, MAX_PER_FEED, TOPICS  # noqa: E402

TZ = ZoneInfo(os.environ.get("READ_TZ", "Asia/Kolkata"))
REMIND_AT = os.environ.get("REMIND_AT", "10:00")
UA = {"User-Agent": "Mozilla/5.0 (compatible; ReadXP/1.0; personal RSS reader)"}
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
    return text[:12000]


# ───────────────────────── choosing ─────────────────────────

PICK_SYSTEM = """You are the editor of a personal daily reader for one curious, serious reader.
You decide which few stories in a topic are genuinely worth 5-10 minutes of deep reading today."""

PICK_PROMPT = """Topic: {topic}
Today: {today}

Below are recent items from reputable sources (news, analysis and new research), as
[id] (source · kind · date) title — summary

{items}

Recently covered (do not repeat unless there is a materially new development):
{recent}

Pick the {n} most important stories for this topic. Judge importance by:
- consequence: how many people, how much money/power/knowledge it changes, and for how long;
- explanatory value: there is a mechanism, a decision, or an idea worth understanding in depth;
- signal: several outlets cover it, or it is genuinely new research / a new theory;
- novelty for this reader: not a repeat of the recently covered list.
Skip: celebrity, sport, routine crime, market-tick noise, listicles, product reviews, press-release fluff.
Include at least one research or analysis item when a strong one exists. Merge items about the same story.

Return JSON: {{"stories": [{{"ids": [ids of every item about this story, best first, max 4],
"angle": "the specific question this piece should answer", "why": "one line on why it matters"}}]}}
ordered most important first."""


def pick(topic, cands, recent, n):
    items = "\n".join(f"[{i}] ({c['source']} · {c['kind']} · {c['date']}) {c['title']} — {clean(c['summary'], 220)}"
                      for i, c in enumerate(cands))
    out = llm.generate_json(PICK_PROMPT.format(topic=topic["name"], today=today_str(), items=items,
                                               recent="\n".join(f"- {h}" for h in recent) or "- (none)", n=n),
                            system=PICK_SYSTEM, temperature=0.3)
    stories = out.get("stories", out) if isinstance(out, dict) else out
    picked, used = [], set()
    for s in stories:
        ids = [i for i in s.get("ids", []) if isinstance(i, int) and 0 <= i < len(cands) and i not in used][:4]
        if ids:
            used.update(ids)
            picked.append({"items": [cands[i] for i in ids], "angle": s.get("angle", ""), "why": s.get("why", "")})
    return picked[:n]


# ───────────────────────── writing ─────────────────────────

WRITE_SYSTEM = """You write for Read XP, a focused daily reader. Your reader is smart, curious and not a specialist.
They want to UNDERSTAND the world, not skim it. You are a great explainer and storyteller, in the tradition of the
best long-form magazine writers and patient teachers.

Rules you never break:
- Facts, numbers, names, dates and quotes come ONLY from the source texts given. Never invent a quote, figure or event.
- You may add general background knowledge to explain how something works (e.g. how central-bank rates feed into
  mortgages); keep it textbook-level and uncontroversial, and do not present it as news.
- If the sources disagree or something is uncertain, say so plainly.
- No hype, no clickbait, no moralising. Plain words; define jargon the first time it appears."""

WRITE_PROMPT = """Topic: {topic}
The question this piece answers: {angle}
Why it matters: {why}

SOURCES
{sources}

Write the piece. It must be story-driven and deep:
1. Open with a hook: a concrete moment, person, decision or surprising number — make the reader want to know more.
2. Tell what happened as a story, in order: who did what, when, and WHY they did it (their incentives, constraints,
   the options they had, the decision they took).
3. Explain HOW it works: the mechanism, step by step, as a cause → effect chain a curious 16-year-old could follow.
   For economics, trace the money and incentives. For politics, trace power, interests and rules. For research,
   explain what was done, how (method, sample), what was found, and how strong the evidence is.
   For ideas/philosophy, state the argument, the strongest objection, and the reply.
4. Give the context that makes it make sense: history, comparisons, base rates, what usually happens.
5. What is uncertain or disputed, and what the other side argues.
6. What to watch next, and why it matters for an ordinary person.

Length: {words} words in total across 5-8 sections of roughly 150-350 words each. Each section should end in a way
that pulls the reader into the next. Use **bold** for the 1-3 key ideas or terms per section (so a skimming eye
catches the spine of the argument), *italics* sparingly, short paragraphs (2-4 sentences), and a bullet or numbered list
only where steps or comparisons are genuinely list-shaped. No headings inside section bodies. No links.

Return JSON:
{{"title": "a clear, specific headline (not clickbait), max 12 words",
 "dek": "one sentence that sets up the story's central question",
 "sections": [{{"heading": "short, intriguing section title", "body": "markdown"}}],
 "terms": [{{"term": "...", "meaning": "one-sentence plain definition"}}],   // 3-6 terms
 "takeaways": ["3-4 one-sentence things worth remembering"],
 "quiz": [{{"q": "question that tests understanding (why/how), not trivia", "options": ["4 options"],
            "answer": 0, "why": "one-sentence explanation"}}],                // exactly 3
 "ask": ["3 thought-provoking follow-up questions the reader might ask"]}}"""


def write(topic, story):
    items = story["items"]
    with cf.ThreadPoolExecutor(4) as ex:
        texts = list(ex.map(full_text, items))
    blocks = [f"[{i + 1}] {it['source']} ({it['kind']}, {it['date']}): {it['title']}\n{t}"
              for i, (it, t) in enumerate(zip(items, texts))]
    depth = sum(len(t) for t in texts)
    words = "1300-1800" if depth > 6000 else "1000-1400"
    piece = llm.generate_json(WRITE_PROMPT.format(topic=topic["name"], angle=story["angle"], why=story["why"],
                                                  sources="\n\n".join(blocks), words=words),
                              system=WRITE_SYSTEM, temperature=0.75, max_tokens=12000)
    secs = [s for s in piece.get("sections", []) if s.get("body")]
    if len(secs) < 3:
        raise ValueError("too short")
    n_words = sum(len(s["body"].split()) for s in secs)
    quiz = [q for q in piece.get("quiz", []) if isinstance(q.get("answer"), int) and len(q.get("options", [])) >= 2]
    return {
        "id": re.sub(r"[^a-z0-9]+", "-", piece.get("title", "story").lower()).strip("-")[:60],
        "title": piece.get("title", items[0]["title"]),
        "dek": piece.get("dek", ""),
        "kind": items[0]["kind"],
        "why": story["why"],
        "minutes": max(2, round(n_words / WPM)),
        "words": n_words,
        "sections": [{"heading": s.get("heading", ""), "body": s["body"]} for s in secs],
        "terms": piece.get("terms", [])[:6],
        "takeaways": piece.get("takeaways", [])[:4],
        "quiz": quiz[:3],
        "ask": piece.get("ask", [])[:3],
        "sources": [{"title": it["title"], "url": it["url"], "source": it["source"], "date": it["date"]} for it in items],
    }


# ───────────────────────── issue ─────────────────────────

def today_str():
    return dt.datetime.now(TZ).strftime("%Y-%m-%d")


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
        body = "Today's issue is lighter than usual — open the app to keep your streak."
    headers = {"Title": "Time to read 📖", "Tags": "books", "Priority": "high", "Click": site_url}
    if at > now + dt.timedelta(minutes=2):
        headers["At"] = str(int(at.timestamp()))
    r = requests.post(f"https://ntfy.sh/{topic}", data=body.encode(), headers=headers, timeout=20)
    print("reminder:", r.status_code, "at", at.strftime("%H:%M %Z") if "At" in headers else "now")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", default=str(Path(__file__).parent.parent / "site"))
    ap.add_argument("--topics", default="")
    ap.add_argument("--stories", type=int, default=0, help="override stories per topic (testing)")
    ap.add_argument("--remind-only", action="store_true")
    a = ap.parse_args()

    site = Path(a.site)
    out_dir = site / "issues"
    out_dir.mkdir(parents=True, exist_ok=True)
    site_url = os.environ.get("SITE_URL", "https://atheendre130505.github.io/read-xp/")
    date = today_str()

    if a.remind_only:                                      # pipeline failed: still nudge at 10:00
        remind({"topics": []}, site_url)
        return

    seen_path = out_dir / "seen.json"
    seen = json.loads(seen_path.read_text("utf-8")) if seen_path.exists() else {}
    cutoff = (dt.date.today() - dt.timedelta(days=21)).isoformat()
    seen = {u: d for u, d in seen.items() if d >= cutoff}

    index_path = out_dir / "index.json"
    index = json.loads(index_path.read_text("utf-8")) if index_path.exists() else []
    recent_heads = {}
    for entry in index[:4]:
        p = out_dir / f"{entry['date']}.json"
        if p.exists() and entry["date"] != date:
            for t in json.loads(p.read_text("utf-8"))["topics"]:
                recent_heads.setdefault(t["id"], []).extend(s["title"] for s in t["stories"])

    wanted = set(filter(None, a.topics.split(",")))
    issue = {"date": date, "generated": dt.datetime.now(TZ).isoformat(timespec="minutes"),
             "model": llm.models()[0], "topics": []}

    for topic in TOPICS:
        if wanted and topic["id"] not in wanted:
            continue
        print(f"\n== {topic['name']}")
        with cf.ThreadPoolExecutor(10) as ex:
            cands = [c for batch in ex.map(read_feed, topic["feeds"]) for c in batch]
        dedup, titles = [], set()
        for c in cands:
            key = re.sub(r"\W+", "", c["title"].lower())[:60]
            if c["url"] not in seen and key not in titles:
                titles.add(key)
                dedup.append(c)
        cands = dedup[:160]
        print(f"  {len(cands)} candidates")
        if not cands:
            continue
        n = a.stories or topic["stories"]
        try:
            picks = pick(topic, cands, recent_heads.get(topic["id"], []), n)
        except Exception as e:
            print("  pick failed:", e)
            continue
        stories = []
        for s in picks:
            print("  ✎", s["items"][0]["title"][:90])
            try:
                story = write(topic, s)
            except Exception as e:
                print("    write failed:", e)
                continue
            stories.append(story)
            for it in s["items"]:
                seen[it["url"]] = date
        if stories:
            issue["topics"].append({"id": topic["id"], "name": topic["name"], "emoji": topic["emoji"], "stories": stories})

    n_stories = sum(len(t["stories"]) for t in issue["topics"])
    if not n_stories:
        print("no stories written; keeping yesterday's issue")
        remind({"topics": []}, site_url)
        sys.exit(1)

    (out_dir / f"{date}.json").write_text(json.dumps(issue, ensure_ascii=False, indent=1), "utf-8")
    seen_path.write_text(json.dumps(seen, indent=0), "utf-8")
    first = issue["topics"][0]["stories"][0]
    entry = {"date": date, "stories": n_stories, "minutes": sum(s["minutes"] for t in issue["topics"] for s in t["stories"]),
             "headline": first["title"]}
    index = [entry] + [e for e in index if e["date"] != date]
    keep = index[:45]
    for e in index[45:]:                                  # older issues fall off
        (out_dir / f"{e['date']}.json").unlink(missing_ok=True)
    index_path.write_text(json.dumps(keep, ensure_ascii=False, indent=1), "utf-8")
    print(f"\nissue {date}: {n_stories} stories, ~{entry['minutes']} min")
    remind(issue, site_url)


if __name__ == "__main__":
    main()
