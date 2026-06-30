# News aggregator website — requirements document

## Context for the build assistant

You're building this with Claude Haiku 4.5 in VS Code. A few ground rules before you start:

- This is a personal project. Every tool, API, and service used must have a sustainable free tier — flag anything that risks needing payment.
- You (the model writing this code) are the development tool, not the production engine. The deployed pipeline calls a separate free LLM API at runtime (see "Categorization & ranking" in Section 4) — do not wire this up to call the Claude/Anthropic API in production, since Anthropic doesn't offer a comparable standing free tier for ongoing use the way Groq or Gemini do.
- No visual design work needed. Plain HTML with browser-default styling (or no styling at all) is the target. Don't add a CSS framework, custom fonts, colors, or layout polish unless asked later.
- If you hit a genuine ambiguity — a source has no findable RSS feed, two requirements conflict, something doesn't add up — stop and ask rather than guessing silently. Don't invent an RSS URL, headline, or link you haven't actually fetched.

## 1. What this site does

A webpage that displays up to 100 current news headlines, pulled only from a fixed list of trusted sources, sorted into one ranked list (1–100, biggest story first) and grouped into categories. It refreshes periodically rather than live per-visitor — see Section 7 for the phased build plan.

## 2. Output requirements

For each story, show, in this order: headline, source name, link to the article, rank (e.g. "Ranking 24"). Group stories under the 8 category headers listed below.

- Headline text must be exact, taken verbatim from the source — no rewriting or summarizing.
- No descriptions — headline only, plus source/link/rank.
- Exactly 100 stories is the goal. See "Story count fallback" below for what to do if fewer genuinely qualify on a given run.
- Every story must come from one of the 27 approved sources — nothing else.
- Every story must currently be free to read at the linked URL — no paywalled articles (see Section 3).
- Stories are grouped under these 8 categories: World, U.S., Business, Technology, Entertainment, Sports, Science, Health.
- Rank reflects overall size/importance of the story for the day, 1 being the biggest (see "Ranking logic" in Section 4).

### Approved sources (27)

Associated Press, Reuters, Bloomberg, United Press International (UPI), The New York Times, The Washington Post, The Wall Street Journal, USA Today, The Christian Science Monitor, The Hill, PBS, NPR, BBC News, CBS News, NBC News, ABC News, C-SPAN, The Economist, Financial Times, The Guardian, Deutsche Welle, The Atlantic, The New Yorker, Time, ProPublica, Axios, Politico.

### Story count fallback

If, after filtering for recency, source whitelist, and paywall status, fewer than 100 qualifying stories exist on a given run, do not invent or duplicate stories to reach 100. Fill the list with the next-largest available stories from the same source set, and record the actual count produced somewhere visible (e.g. a small "showing 87 of 100" note, or in the build log). Never fabricate a headline, source, or link to hit the number.

## 3. Data sources & paywall handling

### RSS feeds, not paid APIs

Pull headlines from each outlet's public RSS feed — no API key required, no rate limit beyond reasonable polling (every 30–60 minutes is plenty).

Known starting points — verify these still resolve before relying on them, outlets change feed infrastructure occasionally:

- NPR: `https://feeds.npr.org/1001/rss.xml`
- BBC News: check `feeds.bbci.co.uk/news/rss.xml` for top stories, and `feeds.bbci.co.uk/news/<section>/rss.xml` for sections
- NYT, Washington Post, WSJ, Politico, NBC News, Bloomberg, Financial Times, The Guardian all currently publish free RSS feeds, but confirm the exact path for each — check the outlet's own `/rss` or `/feeds` page.

Two sources are known to have mostly discontinued public RSS feeds:

- Associated Press and Reuters generally don't offer a direct public feed anymore. Fallback: a Google News RSS search scoped to the domain, e.g. `https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en`. Note in code comments that this returns Google's indexed view of the site rather than an official feed, and may need extra cleanup.
- For any source where no working feed can be found, log it and skip it for that run rather than guessing a URL.

Where an outlet publishes separate feeds per section (many do), prefer pulling those directly over one combined feed — it gives a reliable category signal for free and reduces how much categorization work the LLM has to do later.

### Paywall handling

There's no free API that reports live paywall status per article, so use a practical, two-layer approach:

1. Maintain a static list of source domains where most/all content is paywalled (NYT, WSJ, Bloomberg, FT, The Economist, Washington Post are the obvious candidates) and exclude those by default.
2. Optionally, fetch the linked page and check for known paywall markers ("subscribe to continue," "create a free account to read," etc.) before excluding — this catches outlets that are only sometimes paywalled, instead of excluding them outright.

Start with option 1 since it's simpler; only add option 2 if the user wants finer-grained handling.

## 4. Processing pipeline

Run as a single script (one file or a few small modules) that does, in order:

1. Fetch all configured RSS feeds.
2. Parse each into a common shape: `{ headline, link, source, category_hint, published_at }`.
3. Filter to stories published within the last ~24 hours.
4. Filter out anything from a known-paywalled domain.
5. Deduplicate/cluster stories covering the same event across multiple sources. (Headline keyword overlap is enough — an exact match isn't needed, just a reasonable "these are the same story" grouping.)
6. Send the deduplicated list to a free LLM API to assign each story cluster a category and a rank.
7. Apply the story count fallback rule if needed.
8. Write the final ranked, categorized list to a single JSON file.
9. Generate a plain HTML page from that JSON file.

### Ranking logic

Use two signals together:

- Primary: how many of the 27 sources are covering the same story in this run — more coverage generally means a bigger story.
- Secondary: where coverage counts are tied, or a story has only one source but looks major (e.g. it's the lead story on that outlet's feed), ask the LLM to judge relative importance.

Rank 1 = biggest story of the day; the highest rank number = smallest story that still made the cut.

### Categorization & ranking — which LLM to call

Use Groq's free API (e.g. `llama-3.3-70b-versatile`) or Gemini's free tier for this step — both have standing free-tier access suited to a recurring job like this, unlike the Anthropic API. Pass the deduplicated headline list in, ask for category + rank back, ideally as structured JSON output. Keep this call infrequent — once per scheduled run on the deduplicated clusters, not once per raw RSS entry.

## 5. Tech stack

- Language: Node.js is the natural fit here (RSS parsing and a static HTML build are both simple in it) — Python works too if preferred, just stay consistent throughout.
- RSS parsing: any standard RSS/Atom parser library.
- HTTP requests: built-in fetch or a standard HTTP client.
- LLM call: Groq's OpenAI-compatible endpoint (or Gemini's SDK) via a plain HTTPS request — no special SDK required.
- Output: plain HTML, no CSS framework, no JS framework. A single template looping over the JSON data is enough.
- Secrets: store the LLM API key in a `.env` file, never commit it; read it via an environment variable.

## 6. Suggested project structure

```
news-aggregator/
  src/
    fetch-feeds.js        // pulls and parses all RSS feeds
    sources.json           // outlet name -> feed URL(s) -> category hint
    paywall-domains.json   // list of known-paywalled domains
    dedupe-and-rank.js     // clusters stories, calls the LLM, assigns rank/category
    build-site.js          // turns the final JSON into index.html
  data/
    latest.json             // most recent run's output
  public/
    index.html               // generated output (not hand-edited)
  .env                        // GROQ_API_KEY (gitignored)
  .gitignore
  package.json
```

Treat this as a suggestion, not a strict requirement — simplify it if a smaller layout gets the job done.

## 7. Build phases (work through these in order)

**Phase 1 — Core pipeline, run manually.** Fetch feeds, dedupe, categorize/rank via the LLM, write `data/latest.json`. Confirm by running the script locally and inspecting the JSON: are sources correct, are headlines verbatim, is the count close to 100, do categories look reasonable, is the rank order sensible?

**Phase 2 — Static page.** Build `public/index.html` from `data/latest.json`. No styling needed — group by category, list headline/source/link/rank in plain text or a simple list. Open it in a browser and confirm it renders and every link works.

**Phase 3 (optional, only after Phase 1–2 work) — Automation.** Wrap the pipeline in a scheduled job (e.g. a GitHub Actions workflow on a cron trigger) so it re-runs on its own, every hour or so.

**Phase 4 (optional) — Hosting.** Deploy `public/` to a free static host (Cloudflare Pages is a solid default — unlimited bandwidth, no commercial-use restriction). Not required for local/personal use.

## 8. Definition of done (Phase 1–2, the core ask)

- [ ] Running the pipeline produces a JSON file with up to 100 stories.
- [ ] Every story has a real headline, source name, and working link pulled from an actual RSS feed — nothing invented.
- [ ] Every source used is one of the 27 approved outlets.
- [ ] No story links to a domain on the known-paywalled list.
- [ ] Every story sits under exactly one of the 8 categories.
- [ ] Every story has a unique rank, with rank 1 as the biggest story.
- [ ] `index.html` renders the full list, grouped by category, with headline/source/link/rank visible and no description text.
- [ ] If fewer than 100 qualifying stories were found, that's reflected honestly (count noted somewhere) rather than padded with fake entries.

## 9. Out of scope (for now)

- Visual design, custom styling, responsive layout, dark mode.
- User accounts, comments, search, filtering UI.
- A mobile app.
- Guaranteed real-time paywall detection — best-effort only, per Section 3.
- Hosting/automation (Phases 3–4) — get Phase 1–2 working and confirmed first.
