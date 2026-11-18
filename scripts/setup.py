"""One-time setup. Run from the read-xp folder:   .venv\\Scripts\\python scripts\\setup.py

1. reads your free Gemini API key from .env (GEMINI_API_KEY=..., https://aistudio.google.com/apikey);
2. makes a private, random ntfy topic for the 10:00 reminder;
3. stores both as GitHub Actions secrets (via the gh CLI you are already logged in to);
4. writes setup.env + setup-qr.png (both git-ignored): scan the QR with your phone, open it in Brave,
   and the app saves the key and topic on the phone. Nothing is sent to any server by that link.
5. starts the first issue build.
"""
import base64
import json
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "atheendre130505/read-xp"
SYNC_REPO = "atheendre130505/read-xp-sync"
SITE = "https://atheendre130505.github.io/read-xp/"


def gh(*args, input_text=None):
    return subprocess.run(["gh", *args], input=input_text, text=True, capture_output=True, check=True).stdout


def main():
    env_path = ROOT / "setup.env"
    old = dict(line.split("=", 1) for line in env_path.read_text().splitlines() if "=" in line) if env_path.exists() else {}
    dot = ROOT / ".env"
    found = dict(l.split("=", 1) for l in dot.read_text().splitlines() if "=" in l and not l.startswith("#")) if dot.exists() else {}
    key = found.get("GEMINI_API_KEY", "").strip() or old.get("GEMINI_API_KEY", "")
    groq = found.get("GROQ_API_KEY", "").strip() or old.get("GROQ_API_KEY", "")
    sync = found.get("SYNC_TOKEN", "").strip() or old.get("SYNC_TOKEN", "")   # GitHub token for read-xp-sync only
    if not key and not groq:
        sys.exit("Put a key in .env first: GROQ_API_KEY=... and/or GEMINI_API_KEY=...")
    topic = old.get("NTFY_TOPIC") or "readxp-" + secrets.token_urlsafe(12).replace("_", "").replace("-", "")[:16].lower()

    if key:
        gh("secret", "set", "GEMINI_API_KEY", "--repo", REPO, input_text=key)
    if groq:
        gh("secret", "set", "GROQ_API_KEY", "--repo", REPO, input_text=groq)
    gh("secret", "set", "NTFY_TOPIC", "--repo", REPO, input_text=topic)
    print("✓ GitHub secrets set")

    blob = base64.urlsafe_b64encode(json.dumps({"k": key, "g": groq, "t": topic, "s": sync, "r": SYNC_REPO}).encode()).decode().rstrip("=")
    link = f"{SITE}#setup={blob}"
    env_path.write_text(f"# private — git-ignored\nGEMINI_API_KEY={key}\nGROQ_API_KEY={groq}\nNTFY_TOPIC={topic}\nSETUP_LINK={link}\n")
    try:
        import qrcode
        qrcode.make(link).save(ROOT / "setup-qr.png")
        print("✓ setup-qr.png written — scan it with your phone and open in Brave")
    except ImportError:
        print("Open this link on your phone (Brave):", link)

    if "--no-run" not in sys.argv:
        gh("workflow", "run", "daily.yml", "--repo", REPO)
        print("✓ first issue is being written (about 15-25 min): https://github.com/" + REPO + "/actions")
    print(f"\nReminder: install the ntfy app on your phone and subscribe to topic  {topic}")


if __name__ == "__main__":
    main()
