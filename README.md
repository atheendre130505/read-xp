# Read XP

News feeds are built to keep you scrolling. Read XP is the opposite: **one finite issue a day**. Each story is written
in depth (what happened, how it works, the decisions people made and why) so you understand it, not just skim it.

**Open it:** https://atheendre130505.github.io/read-xp/
- **Phone (Brave):** open the link → ⋮ → "Install app" / "Add to Home screen". It opens full screen from its own
  icon: no tabs, no address bar, no feed.
- **Laptop:** the "Read XP" Desktop shortcut opens it in its own window (`scripts/windows/`).

## Each morning
1. **07:30 IST:** GitHub Actions reads ~35 reputable sources: newsrooms (BBC, Guardian, NPR, Al Jazeera, Mint,
   The Hindu, CNBC), analysis (NY Fed's Liberty Street, CEPR VoxEU, Foreign Policy, ProPublica, Quanta, MIT Tech
   Review, Aeon, Psyche) and new research (NBER, arXiv, Nature Human Behaviour, the Stanford Encyclopedia).
   All the sources are listed in `pipeline/sources.py`.
2. For each topic (Economics & Finance · Politics & World · Psychology & Mind · Science & Technology · Philosophy & Ideas)
   Gemini acts as **editor**: it picks the few most consequential stories, merges coverage of the same event, and
   includes new research when something strong appeared. Stories already covered are skipped.
3. For each pick, the full text of every source is fetched and Gemini acts as **writer**: a 1,000–1,800-word,
   story-driven piece. It opens with a hook, tells the story in order, explains the mechanism step by step, gives
   history and context, says what's disputed, and ends with what to watch. Facts must come from the sources, and
   the sources are linked at the end.
4. **10:00 IST:** a push notification on your phone (ntfy) with the number of stories and the first headline. Tapping
   it opens the app.

## Reading
- **Story first:** a story arrives one section at a time, like a conversation. Tap **Continue** (Space or → on a
  laptop) for the next section. The next section lands right under the ruler.
- **Ask about any part:** select a phrase and tap **💬 Ask about this**. Quick questions are offered (Why? How
  does this work? An example? The counter-argument?) or you can type your own. The answer appears in the
  conversation under the section it's about, and stays there. 💬 at the top asks about the whole story.
- **Reading ruler:** a clear band about three lines tall with the rest of the page gently dimmed, like Kindle's ruler.
  Tap any line to move the band there.
- **Typography from reading research:** Literata (Google Play Books' serif) or Atkinson Hyperlegible, 19px, line
  height 1.6, at most ~62 characters a line, left-aligned. Warm paper, sepia or night themes, never pure black on white.
  Key ideas are in **bold** so the spine of the argument stands out. "Fixation bold" (bionic) is optional and off by
  default because the evidence for it is weak.
- **No distractions:** no images, ads, comments, related links or endless feed. The screen stays on while you read.
  Source links are folded away at the end of each story.

## The game
| | XP |
|---|---|
| each section read | +5 |
| story finished | +20 |
| quiz answer right (3 per story, why/how questions) | +10 |
| asking a question (curiosity, up to 3 per story) | +5 |
| daily goal: 3 stories | +30 |

Your streak counts days on which you finish at least one story. Levels run from Curious through Reader, Thinker,
Scholar, Sage and Polymath to Oracle. Level-ups get confetti.

## Setup (once)
1. Get a free Gemini API key: https://aistudio.google.com/apikey
2. Run `.venv\Scripts\python scripts\setup.py`. It stores the key and a random reminder topic as GitHub secrets,
   starts the first issue, and writes `setup-qr.png`.
3. On your phone: scan the QR code and open it in Brave. That saves the key on the phone (so chat works) and the
   reminder topic. Then install the app.
4. Install **ntfy** (Play Store) and subscribe to the topic (Settings → Subscribe in ntfy).

## Privacy & cost
- Progress, XP, chats and your key live only in the browser on each device. Nothing syncs.
- Gemini's free tier costs nothing, with roughly 20 calls a day for the issue plus your chats. Google may use
  free-tier prompts to improve its products. Everything sent is public news text plus your questions.
- The reminder topic is a random name. Anyone who knew it could see the reminder text (today's headline), and nothing else.
