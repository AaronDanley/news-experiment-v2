# News Aggregator — Build Progress

## Current Status: Phase 1a Complete ✓

### What's Done
- **Project structure**: Set up src/, data/, public/ directories
- **Configuration files**: sources.json, paywall-domains.json
- **Phase 1a script** (fetch-feeds.js): Fetches RSS feeds from 27 sources
- **RSS fetching**: Successfully fetched 639 stories from working feeds
- **Paywall filtering**: Correctly excludes NYT, Washington Post, WSJ content
- **24-hour filtering**: Only pulls recent stories
- **Dependencies installed**: rss-parser, node-fetch, dotenv

### Test Results
```
Fetched 639 stories total (before deduplication)
- Many feeds working (NPR, BBC, The Guardian, NBC, ABC, The Atlantic, The New Yorker, Time, etc.)
- Some feed URLs need fixing (CBS News, USA Today, Politico, PBS, ProPublica, DW, C-SPAN, Bloomberg, FT, Axios)
- Paywalled sources correctly filtered (NYT, Washington Post, WSJ, Bloomberg, FT, The Economist)
```

Output: `data/latest.json` (5,752 lines, 639 stories)

---

## Next Steps: Phase 1b (Deduplication & Ranking)

### Before running Phase 1b:

1. **Get a Groq API key** (required for LLM ranking):
   - Go to https://console.groq.com/keys
   - Sign up for free (takes 2 minutes)
   - Create an API key
   - Copy it to `.env`:
     ```bash
     GROQ_API_KEY=your-key-from-groq
     ```

2. **Optional: Fix RSS feed URLs** (current test shows some failures):
   ```bash
   node src/test-feeds.js
   ```
   Update `src/sources.json` with any corrected URLs for sources that failed.

3. **Run Phase 1b** (deduplication + LLM ranking):
   ```bash
   node src/dedupe-and-rank.js
   ```
   This will:
   - Cluster similar stories across sources (639 → ~100-150 clusters)
   - Call Groq LLM to categorize and rank each cluster
   - Limit to top 100 stories
   - Save ranked list to `data/latest.json`

### Then Phase 2: Build HTML

Once Phase 1b completes successfully:
```bash
node src/build-site.js
```

Open `public/index.html` in a browser. That's the final output!

---

## Feed URLs That Need Attention

Some sources in `src/sources.json` had 404/403 errors. Here are the ones to verify/fix:

- ❌ CBS News: `https://www.cbsnews.com/latest/rss/` (malformed XML)
- ❌ USA Today: `https://www.usatoday.com/news/index.html?feedtype=rss` (404)
- ❌ Politico: Both feeds returning 403
- ❌ PBS: `https://www.pbs.org/newshour/feeds/rss/newshour` (404)
- ❌ C-SPAN: `https://www.c-span.org/feeds/` (403)
- ❌ Christian Science Monitor: Malformed XML
- ❌ UPI: Not recognized as RSS
- ❌ Economist: 403
- ❌ Financial Times: DNS error
- ❌ WSJ: DNS error
- ❌ Bloomberg: 403
- ❌ ProPublica: 404
- ❌ Axios: 403
- ❌ Deutsche Welle: 404

**Action**: Run `node src/test-feeds.js` to verify which URLs are currently working, then update `src/sources.json` with corrected URLs before running Phase 1b.

---

## Project Structure

```
news-experiment-v2/
├── src/
│   ├── fetch-feeds.js          [✓] Phase 1a - fetches RSS feeds
│   ├── dedupe-and-rank.js      [→] Phase 1b - deduplication & LLM ranking
│   ├── build-site.js           [→] Phase 2 - generates HTML
│   ├── test-feeds.js           [→] Helper to validate feed URLs
│   ├── sources.json            [✓] Feed URLs for 27 sources
│   └── paywall-domains.json    [✓] Known paywalled domains
├── data/
│   ├── latest.json             [✓] Current output (639 stories from Phase 1a)
│   └── raw-stories.json        [✓] Raw unfiltered stories
├── public/
│   └── index.html              [→] Generated webpage (not yet created)
├── .env                        [→] Add GROQ_API_KEY here
├── .env.example                [✓] Template
├── .gitignore                  [✓]
├── package.json                [✓]
└── README.md                   [✓]
```

---

## What to Do Now

1. Get your Groq API key from https://console.groq.com/keys
2. Add it to `.env` file
3. Optionally run `node src/test-feeds.js` to check feed URLs
4. Run `node src/dedupe-and-rank.js` to complete Phase 1b
5. Run `node src/build-site.js` to generate the HTML
6. Open `public/index.html` in a browser

Total time to complete: ~5-10 minutes (most of it is waiting for API calls).
