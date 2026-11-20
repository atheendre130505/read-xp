"""Every story ever published (covered.json), so an old story isn't written again.

Before the chief editor chooses, each shortlisted candidate is matched against this record by shared keywords (rare
words count more than common ones), and the closest past stories are shown next to it. The editor then decides
whether it is the same story again or a real new development. Deleted stories stay in the record too.
"""
import json
import math
import re
from collections import Counter

from importance import STOP

KEEP_DAYS = 180
EXTRA_STOP = set("""how why what new study research scientists finds shows says report could may help make makes
major big inside behind against amid between during today latest""".split())


def words(text: str) -> set:
    out = set()
    for w in re.findall(r"[a-z0-9][a-z0-9'-]+", (text or "").lower().replace("’", "'")):
        w = w.strip("'-")
        if w.endswith("'s"):
            w = w[:-2]
        if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        if len(w) > 2 and w not in STOP and w not in EXTRA_STOP:
            out.add(w)
    return out


def entry(story: dict, date: str) -> dict:
    """What we remember about a published story."""
    return {"d": date, "id": story.get("id", ""), "t": story.get("title", ""), "dek": story.get("dek", ""),
            "src": [s.get("title", "") for s in story.get("sources", [])][:4],
            "terms": [t.get("term", "") for t in story.get("terms", [])][:6]}


def keys(e: dict) -> set:
    return words(" ".join([e["t"], e.get("dek", ""), *e.get("src", []), *e.get("terms", [])]))


def load(path) -> list:
    return json.loads(path.read_text("utf-8")) if path.exists() else []


def add(path, stories, date, today: str):
    """Records the stories (by id; a newer write of the same story replaces the older one)."""
    rec = load(path)
    new = [entry(s, date) for s in stories]
    ids = {e["id"] for e in new}
    rec = new + [e for e in rec if e["id"] not in ids]
    cutoff = _days_ago(today, KEEP_DAYS)
    rec = [e for e in rec if e["d"][:10] >= cutoff]
    path.write_text(json.dumps(rec, ensure_ascii=False, indent=0), "utf-8")


def _days_ago(today: str, n: int) -> str:
    import datetime as dt
    return (dt.date.fromisoformat(today) - dt.timedelta(days=n)).isoformat()


def matches(text: str, rec: list, top: int = 3, min_score: float = 4.0):
    """The past stories closest to a candidate, as (score, entry). Score: sum of rare-word weights shared."""
    if not rec:
        return []
    ks = [keys(e) for e in rec]
    df = Counter(w for k in ks for w in k)
    n = len(rec)
    mine = words(text)
    out = []
    for e, k in zip(rec, ks):
        shared = mine & k
        if len(shared) < 2:
            continue
        sc = sum(math.log(1 + n / df[w]) for w in shared)
        if sc >= min_score:
            out.append((round(sc, 1), e, sorted(shared)))
    out.sort(key=lambda x: -x[0])
    return out[:top]
