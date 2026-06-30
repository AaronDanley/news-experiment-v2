# News Aggregator

A Node.js news aggregator that fetches headlines from 27 trusted sources, deduplicates them, ranks them by importance using an LLM, and displays them on a static HTML page.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Get a Groq API key
- Go to https://console.groq.com/keys
- Create a free account and generate an API key
- Copy `.env.example` to `.env` and add your key:
  ```bash
  cp .env.example .env
  # Edit .env and add your GROQ_API_KEY
  ```

### 3. Run the pipeline

The project uses a three-phase approach:

**Phase 1a: Fetch feeds**
```bash
node src/fetch-feeds.js
```
This fetches all RSS feeds from the 27 approved sources and saves raw stories to `data/latest.json`. It filters for:
- Stories published in the last 24 hours
- Free content only (excludes known paywalled domains)
- Only from approved sources

**Phase 1b: Deduplicate & Rank**
```bash
node src/dedupe-and-rank.js
```
This:
- Clusters similar stories across sources
- Calls Groq's LLM to categorize and rank each cluster
- Limits to top 100 stories
- Updates `data/latest.json` with final ranked output

**Phase 2: Build HTML**
```bash
node src/build-site.js
```
This generates `public/index.html` from the ranked stories, grouped by category.

**Run all steps at once:**
```bash
npm run build
```

### 4. View the results
Open `public/index.html` in a browser.

## Project Structure

```
src/
  fetch-feeds.js       - Fetches all RSS feeds
  dedupe-and-rank.js   - Deduplicates, ranks via LLM
  build-site.js        - Generates HTML
  sources.json         - Feed URLs for all 27 sources
  paywall-domains.json - Known paywalled domains to exclude

data/
  latest.json          - Generated output (stories ranked 1-100)
  raw-stories.json     - Raw fetched stories before processing

public/
  index.html           - Generated webpage (not hand-edited)

.env                   - API keys (never committed)
package.json           - Dependencies
```

## How It Works

### Ranking
1. **Primary signal**: How many of the 27 sources are covering the same story — more coverage = bigger story
2. **Secondary signal**: The LLM uses publication prominence and importance to break ties

### Categorization
The LLM assigns each story cluster to one of 8 categories:
- World, U.S., Business, Technology, Entertainment, Sports, Science, Health

### Deduplication
Stories are clustered by keyword overlap (cosine similarity > 0.4). This catches the same event covered by multiple outlets without requiring exact headline matches.

## Known Limitations

- **Paywall handling**: Uses a static list of known-paywalled domains. Some outlets are only sometimes paywalled and may slip through.
- **RSS feeds**: Some sources (AP, Reuters) no longer offer public RSS feeds, so we use Google News search as a fallback.
- **LLM dependence**: Ranking quality depends on the Groq API response. A fallback to simple source-count ranking is provided if the API fails.
- **Story count**: If fewer than 100 stories qualify after filtering, the count will be less than 100. This is intentional (no fabricated stories).

## Approved Sources (27)

Associated Press, Reuters, Bloomberg, United Press International (UPI), The New York Times, The Washington Post, The Wall Street Journal, USA Today, The Christian Science Monitor, The Hill, PBS, NPR, BBC News, CBS News, NBC News, ABC News, C-SPAN, The Economist, Financial Times, The Guardian, Deutsche Welle, The Atlantic, The New Yorker, Time, ProPublica, Axios, Politico.

## Free Tier Dependencies

All dependencies are free to use:
- **Node.js**: Free, open-source
- **rss-parser**: Free npm package
- **Groq API**: Free tier with generous limits for this use case
- **RSS feeds**: All from public sources with no authentication required

No paid services are required to run this project.
