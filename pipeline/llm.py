"""Gemini (Google AI Studio free tier) over plain REST.

The model is picked at run time from what the key can use: the newest stable "flash" model first
(good writing, generous free quota), then the newest "flash-lite" as a fallback when quota runs out.
Set GEMINI_MODEL to force one.
"""
import json
import os
import re
import time

import requests

API = "https://generativelanguage.googleapis.com/v1beta"
KEY = os.environ.get("GEMINI_API_KEY", "")
_models: list[str] | None = None


def _version(name: str) -> float:
    m = re.search(r"gemini-(\d+(?:\.\d+)?)", name)
    return float(m.group(1)) if m else 0.0


def models() -> list[str]:
    """Usable text models, best first."""
    global _models
    if _models is not None:
        return _models
    forced = os.environ.get("GEMINI_MODEL")
    if forced:
        _models = [forced]
        return _models
    r = requests.get(f"{API}/models", params={"key": KEY, "pageSize": 200}, timeout=30)
    r.raise_for_status()
    names = [m["name"].split("/", 1)[1] for m in r.json().get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", [])]
    bad = re.compile(r"image|tts|audio|live|embed|vision|thinking-exp|learnlm|gemma|robotics|computer|exp-\d|-\d{3}$")
    names = [n for n in names if n.startswith("gemini-") and not bad.search(n)]

    def rank(n: str):
        lite = "lite" in n
        flash = "flash" in n
        preview = "preview" in n or "exp" in n
        return (0 if flash and not lite else 1 if flash else 2, preview, -_version(n), len(n))

    names = [n for n in names if "flash" in n]       # Pro has a tiny free quota; flash writes well
    _models = sorted(names, key=rank)[:4] or ["gemini-2.5-flash", "gemini-2.5-flash-lite"]
    print("models:", _models)
    return _models


def generate(prompt: str, *, system: str = "", json_out: bool = False, temperature: float = 0.7,
             max_tokens: int = 8192) -> str:
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if json_out:
        body["generationConfig"]["responseMimeType"] = "application/json"
    last = None
    for model in models():
        for attempt in range(4):
            try:
                r = requests.post(f"{API}/models/{model}:generateContent", params={"key": KEY},
                                  json=body, timeout=240)
            except requests.RequestException as e:
                last = e
                time.sleep(10)
                continue
            if r.status_code == 200:
                data = r.json()
                parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
                text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
                if text.strip():
                    time.sleep(float(os.environ.get("LLM_PAUSE", "7")))   # stay under the free per-minute limit
                    return text
                last = RuntimeError(f"empty answer from {model}: {str(data)[:300]}")
                time.sleep(5)
                continue
            last = RuntimeError(f"{model} {r.status_code}: {r.text[:300]}")
            if r.status_code == 429:
                if "PerDay" in r.text or "per day" in r.text.lower():
                    break                                   # daily quota gone: next model
                time.sleep(30 * (attempt + 1))
            elif r.status_code >= 500:
                time.sleep(15 * (attempt + 1))
            else:
                break                                       # 400/404: try the next model
        print("  ↪", last)
    raise RuntimeError(f"all models failed: {last}")


def generate_json(prompt: str, **kw):
    text = generate(prompt, json_out=True, **kw)
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"[\[{].*[\]}]", text, re.S)
        if m:
            return json.loads(m.group(0))
        raise
