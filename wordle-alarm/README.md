# Daily word alarm demo

Static page, no build step, no camera. Serve the folder over HTTPS (e.g. GitHub Pages) and open index.html.

- Start the alarm: the buzzer rings until the day's word is solved (6 guesses, standard green/yellow/gray coloring with correct duplicate-letter handling). Out of guesses resets the board with the same word and keeps ringing. A Stop button is always available.
- A new word every day at midnight IST (Asia/Kolkata), computed on-device - no network calls, no scraping, no sync with the NYT puzzle. Day #1 = 3 Nov 2026. Everyone gets the same word regardless of device timezone.
- answers.txt: 1,500 common 5-letter words, fixed shuffled order (seed 20261103). Built by taking frequency-ranked common English words from the wordfreq package (Apache-2.0 license, github.com/rspeer/wordfreq) and keeping only words present in github.com/tabatkins/wordle-list (MIT license, see words-LICENSE.txt). Both licenses permit redistribution with attribution.
- words.txt: the full guess-validation list from tabatkins/wordle-list (MIT).
- The active game is pinned to the puzzle it started with: the date is read only when Start/Ring-it-again is pressed, so a game running across midnight keeps its word until solve, Stop, or restart.
- Test hook: ?date=YYYY-MM-DD forces a date (e.g. for demos or screenshots). Dates before 3 Nov 2026 show negative puzzle numbers - test-only path.
- This is a demo: it cannot wake a locked phone; the page must stay open and the screen on.
