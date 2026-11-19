"""How important is a story? The editor model rates it 0-10 on seven plain questions; the score is the simple
average (every question counts the same). Stories are ranked by that score, and the app's queue is ordered by it.
"""
import os
import re

THRESHOLD = float(os.environ.get("IMPORTANCE_THRESHOLD", "6"))     # average out of 10 needed to get in

METRICS = {
    "size": "how big the story is: how many people, how much money, power or knowledge it changes",
    "lasting": "how long it will matter (a day = 0, years = 10)",
    "growth": "personal development: does it help the reader grow, decide better or live better",
    "learning": "learning opportunity: a real mechanism, strategy or idea worth understanding",
    "relevance": "relevance to the reader's own life, work, money, health or country (India)",
    "novelty": "genuinely new: a new development or finding, not a rehash",
    "solidity": "how definitive and well-sourced it is (rumour or preview = 0, published/decided and confirmed = 10)",
}

RATING_INSTRUCTIONS = "Rate each story 0-10 on each of these, honestly and strictly (5 is ordinary, 9-10 is rare):\n" + \
    "\n".join(f'- "{k}": {v}' for k, v in METRICS.items())
RATING_JSON = "{" + ", ".join(f'"{k}": 0-10' for k in METRICS) + "}"


def score(ratings) -> float:
    """The plain average of the seven ratings (a missing one counts as 5)."""
    vals = []
    for k in METRICS:
        try:
            v = float((ratings or {}).get(k, 5))
        except (TypeError, ValueError):
            v = 5.0
        vals.append(min(10.0, max(0.0, v)))
    return round(sum(vals) / len(vals), 2)


STOP = set("""a an the and or but of for to in on at by with from into over after before about as is are was were be
been being has have had its it this that these those their there here what why how when who which new says said
will would could should may might can not no more most than then also just amid over under after year years week
report reports news first last one two three""".split())


def _tokens(title: str) -> set:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9'-]+", title.lower()) if len(w) > 2 and w not in STOP}


def same_event(a_items, b_items) -> bool:
    """Two shortlisted stories about the same event (a backstop for when the chief editor can't merge them)."""
    for x in a_items:
        tx = _tokens(x["title"])
        for y in b_items:
            ty = _tokens(y["title"])
            shared = len(tx & ty)
            if shared >= 3 or (shared >= 2 and shared / max(1, min(len(tx), len(ty))) >= 0.6):
                return True
    return False


def dedupe(stories):
    """Keeps the higher-rated of any two stories about the same event, folding the other's sources in."""
    out = []
    for s in sorted(stories, key=lambda s: -s["score"]):
        twin = next((o for o in out if same_event(o["items"], s["items"])), None)
        if twin:
            twin["items"] = (twin["items"] + [x for x in s["items"] if x not in twin["items"]])[:4]
            for f in s.get("fields", []):
                if f not in twin.setdefault("fields", []) and len(twin["fields"]) < 3:
                    twin["fields"].append(f)
        else:
            out.append(s)
    return out
