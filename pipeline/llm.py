"""The writers: Gemini (Google AI Studio free tier) and Groq (console.groq.com free tier), over plain REST.

Two tiers, to make the free daily quotas last:
  "best"   the lead story of each topic: Gemini's full flash model first, then Groq's largest model, then lite
  "light"  choosing stories and the other stories: Gemini flash-lite first (much bigger free quota), then Groq,
           then full flash
A model that reports its daily quota is used up is skipped for the rest of the run.
Keys: GEMINI_API_KEY and/or GROQ_API_KEY (either is enough). GEMINI_MODEL forces one Gemini model.
"""
import json
import os
import re
import time

import requests

GEMINI = "https://generativelanguage.googleapis.com/v1beta"
GROQ = "https://api.groq.com/openai/v1"
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GROQ_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_PREFERRED = ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct", "qwen/qwen3-32b",
                  "openai/gpt-oss-20b"]

_pool: dict | None = None
_dead: set = set()          # (provider, model) whose daily quota ran out
problems: dict = {}         # provider -> "quota" | "invalid": what to warn you about at the end of a run


def _version(name: str) -> float:
    m = re.search(r"gemini-(\d+(?:\.\d+)?)", name)
    return float(m.group(1)) if m else 0.0


def _probe(model: str) -> bool:
    try:
        r = requests.post(f"{GEMINI}/models/{model}:generateContent", params={"key": GEMINI_KEY}, timeout=30,
                          json={"contents": [{"parts": [{"text": "Reply with: ok"}]}]})
        return r.status_code == 200
    except requests.RequestException:
        return False


def _gemini_models() -> list[str]:
    if not GEMINI_KEY:
        return []
    if os.environ.get("GEMINI_MODEL"):
        return [os.environ["GEMINI_MODEL"]]
    try:
        r = requests.get(f"{GEMINI}/models", params={"key": GEMINI_KEY, "pageSize": 200}, timeout=30)
        r.raise_for_status()
    except requests.RequestException as e:
        print("gemini: can't list models:", e)
        return []
    names = [m["name"].split("/", 1)[1] for m in r.json().get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", [])]
    bad = re.compile(r"image|tts|audio|live|embed|vision|omni|thinking-exp|learnlm|gemma|robotics|computer|exp-\d|-\d{3}$")
    names = [n for n in names if n.startswith("gemini-") and "flash" in n and not bad.search(n)]
    names = sorted(names, key=lambda n: ("lite" in n, "preview" in n or "latest" in n, -_version(n), len(n)))[:10]
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(10) as ex:
        ok = dict(zip(names, ex.map(_probe, names)))
    alive = [n for n in names if ok[n]]
    print("gemini answering:", alive, "| not answering:", [n for n in names if not ok[n]])
    return alive


def _groq_models() -> list[str]:
    if not GROQ_KEY:
        return []
    try:
        r = requests.get(f"{GROQ}/models", headers={"Authorization": f"Bearer {GROQ_KEY}"}, timeout=30)
        r.raise_for_status()
        have = {m["id"] for m in r.json().get("data", [])}
    except requests.RequestException as e:
        print("groq: can't list models:", e)
        return []
    out = [m for m in GROQ_PREFERRED if m in have][:3]
    print("groq models:", out)
    return out


def pool() -> dict:
    global _pool
    if _pool is None:
        gem = _gemini_models()
        full = [("gemini", m) for m in gem if "lite" not in m][:2]
        lite = [("gemini", m) for m in gem if "lite" in m][:2]
        groq = [("groq", m) for m in _groq_models()]
        _pool = {"best": full + groq + lite, "light": lite + groq + full}
        if not (full or lite or groq):
            raise RuntimeError("no working model: add GEMINI_API_KEY or GROQ_API_KEY")
    return _pool


def models() -> list[str]:
    """Gemini models in order of preference (the app uses the first for questions)."""
    return [m for p, m in pool()["best"] if p == "gemini"] or ["gemini-3-flash-preview"]


def _call(provider, model, prompt, system, json_out, temperature, max_tokens):
    if provider == "gemini":
        body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        if json_out:
            body["generationConfig"]["responseMimeType"] = "application/json"
        r = requests.post(f"{GEMINI}/models/{model}:generateContent", params={"key": GEMINI_KEY}, json=body, timeout=180)
        if r.status_code != 200:
            return None, r
        parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts if not p.get("thought")), r
    msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    body = {"model": model, "messages": msgs, "temperature": temperature, "max_completion_tokens": max_tokens}
    if json_out:
        body["response_format"] = {"type": "json_object"}
    r = requests.post(f"{GROQ}/chat/completions", headers={"Authorization": f"Bearer {GROQ_KEY}"}, json=body, timeout=180)
    if r.status_code != 200:
        return None, r
    return r.json()["choices"][0]["message"].get("content") or "", r


def _daily_quota_gone(r) -> bool:
    t = r.text.lower()
    return r.status_code == 429 and ("perday" in t.replace(" ", "") or "per day" in t or "tokens per day" in t
                                     or "requests per day" in t or "(rpd)" in t or "(tpd)" in t or "daily" in t)


def generate(prompt: str, *, tier: str = "best", system: str = "", json_out: bool = False,
             temperature: float = 0.7, max_tokens: int = 8192) -> str:
    last = None
    for provider, model in pool()[tier]:
        if (provider, model) in _dead:
            continue
        for attempt in range(3):
            try:
                text, r = _call(provider, model, prompt, system, json_out, temperature, max_tokens)
            except requests.RequestException as e:
                last = e
                time.sleep(10)
                continue
            if text and text.strip():
                time.sleep(float(os.environ.get("LLM_PAUSE", "6")))   # stay under the free per-minute limits
                return text
            if text is not None:
                last = RuntimeError(f"empty answer from {model}")
                continue
            last = RuntimeError(f"{provider}/{model} {r.status_code}: {r.text[:200]}")
            if r.status_code in (401, 403) or (r.status_code == 400 and "api key" in r.text.lower()):
                for pm in pool()["best"]:
                    if pm[0] == provider:
                        _dead.add(pm)
                problems[provider] = "invalid"
                print(f"  {provider}: key rejected ({r.status_code}), switching", flush=True)
                break
            if _daily_quota_gone(r):
                _dead.add((provider, model))
                if all(pm in _dead for pm in pool()["best"] if pm[0] == provider):
                    problems.setdefault(provider, "quota")
                print(f"  {provider}/{model}: daily quota used up, switching", flush=True)
                break
            if r.status_code == 429:
                time.sleep(20 * (attempt + 1))
            elif r.status_code >= 500:
                time.sleep(15 * (attempt + 1))
            else:
                break                                       # 400/404/413: next model
        print("  -> next model:", str(last).encode("ascii", "replace").decode()[:200], flush=True)
    raise RuntimeError(f"all models failed: {last}")


def generate_json(prompt: str, **kw):
    for attempt in range(2):                                # a malformed answer gets one more try
        text = generate(prompt, json_out=True, **kw).strip()
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"[\[{].*[\]}]", text, re.S)
            if m:
                try:
                    return json.loads(m.group(0))
                except json.JSONDecodeError:
                    pass
        print("  malformed JSON, asking again", flush=True)
    raise ValueError("the model kept returning malformed JSON")
