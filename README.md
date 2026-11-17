# Read

One finite issue a day, written to be read with pleasure. Each story is told in depth: what happened, how it works,
the decisions people took and why. The aim is that you understand it, not skim it.

**Open it:** https://atheendre130505.github.io/read-xp/
- **Phone (Brave):** open the link, then ⋮ → "Install app" / "Add to Home screen". It opens full screen from its own
  icon, with no tabs and no address bar.
- **Laptop:** the "Read XP" Desktop shortcut opens it in its own window.

## Twice a day
1. **09:00 and 21:00 IST** (a morning and an evening edition): GitHub Actions reads about 110 sources, listed in `pipeline/sources.py`:
   - **Indian:** The Indian Express (incl. Explained), The Economic Times, Business Standard, Mint, The Hindu,
     BusinessLine, Inc42, YourStory.
   - **World:** Reuters, Bloomberg, WSJ, FT, The Economist, BBC, Guardian, NYT, NPR, Al Jazeera, DW, France 24, Politico.
   - **Analysis:** NY Fed, VoxEU, Project Syndicate, Bruegel, Noahpinion, Stratechery, HBR, Foreign Affairs,
     The Atlantic, Quanta, National Geographic, Smithsonian, Nautilus, Aeon, Noema.
   - **Research:** NBER, arXiv, Nature Human Behaviour, Trends in Cognitive Sciences, the Stanford Encyclopedia.
2. For each topic (Economics & Finance, Business & Companies, Politics & World, Psychology & Mind, Science &
   Technology, Philosophy & Ideas), Gemini acts as **editor**. It picks the 3–4 most consequential stories, merges
   coverage of the same event, and includes new research when it's strong. Stories already covered are skipped.
3. Gemini then acts as **writer**. It reads the full text of the sources and writes a 1,000–1,800-word, story-driven
   piece: a hook, then what happened in order, the mechanism step by step, history and context, what's disputed, and
   what to watch. Facts must come from the sources, which are listed under each story.
4. **10:00 IST:** after the morning edition, a notification on your phone (ntfy) with the first headline. Tapping it opens the app.

## Reading
- A story arrives one section at a time. Tap **Continue** (or press Space / → on a laptop).
- **Ask about any part:** select a phrase and tap **Ask about this**. The passage is attached to the box at the
  bottom, as in Claude; type your question. The answer streams in under that section and stays there.
  Without a selection, the box asks about the story as a whole.
- **Reading ruler:** a clear band about three lines tall with the rest of the page dimmed, like Kindle. Tap any line to
  move it there.
- **Typography:** Source Serif, Literata or Atkinson Hyperlegible, 19px, line height 1.6, at most about 65 characters
  a line, left-aligned. Light, sepia and dark themes. Key ideas are in **bold**.
- **Nothing else:** no images, ads, feeds, scores or streaks. The screen stays on while you read, and source links are
  folded away at the end of each story.

## Setup
- **Gemini key:** put it in `.env` (git-ignored) as `GEMINI_API_KEY=...`.
- **Local run:** `.venv\Scripts\python pipeline\build.py` writes today's issue to `site/issues/`.
- **GitHub:** `.venv\Scripts\python scripts\setup.py` stores the key and a random reminder topic as GitHub secrets
  and writes `setup-qr.png`. Scan the QR on your phone and open it in Brave. That stores the key on the phone so
  questions work.
- **Reminder:** install **ntfy** from the Play Store, then use Settings → Subscribe in ntfy.

## Privacy & cost
- What you've read, your questions, and your key live only in the browser on each device. Nothing syncs.
- Gemini's free tier costs nothing: about 25 calls a day for the issue, plus your questions. Google may use free-tier
  prompts to improve its products. What's sent is public news text and your questions.
