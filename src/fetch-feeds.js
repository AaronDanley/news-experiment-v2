import fetch from 'node-fetch';
import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parser = new Parser();
const HOURS_BACK = 24;

// Load configuration
const sourcesData = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const paywallData = JSON.parse(fs.readFileSync(path.join(__dirname, 'paywall-domains.json'), 'utf8'));

const PAYWALLED_DOMAINS = paywallData.paywalled_domains;

const FEED_TIMEOUT_MS = 10000; // Per-feed hard timeout

async function fetchFeed(feedUrl) {
  // Use AbortController so the underlying socket is actually torn down on timeout.
  // (Promise.race alone leaves the connection open, which keeps Node's event loop
  // alive and causes the process to hang after all feeds are "done".)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);

  try {
    const response = await fetch(feedUrl, {
      signal: controller.signal,
      headers: {
        // Some feeds reject requests without a UA
        'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)',
      },
    });

    if (!response.ok) {
      console.error(`Error fetching ${feedUrl}: Status code ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);
    return feed.items || [];
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`Timeout fetching ${feedUrl} (${FEED_TIMEOUT_MS / 1000}s exceeded) — skipping`);
    } else {
      console.error(`Error fetching ${feedUrl}:`, error.message);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function extractDomainFromUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return domain.replace('www.', '');
  } catch {
    return '';
  }
}

function isWithinHours(pubDate, hours = HOURS_BACK) {
  if (!pubDate) return false;
  const published = new Date(pubDate);
  const now = new Date();
  const diffMs = now - published;
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours <= hours && diffHours >= 0;
}

function isPaywalled(url) {
  const domain = extractDomainFromUrl(url);
  return PAYWALLED_DOMAINS.some(pd => domain.includes(pd));
}

// Section/index landing-page titles (after stripping the trailing " - Publisher"
// that Google News appends). These are navigation pages, not articles.
const JUNK_TITLE_PATTERNS = [
  /^leaders$/i,
  /^politics$/i,
  /^opinion$/i,
  /^business$/i,
  /^world( news)?$/i,
  /^u\.?s\.?( news)?$/i,
  /^sports?$/i,
  /^science$/i,
  /^health$/i,
  /^technology$/i,
  /^entertainment$/i,
  /^culture$/i,
  /^lifestyle$/i,
  /^obituaries$/i,
  /^notable obituaries$/i,
  /^briefing$/i,
  /^newsletters?$/i,
  /^podcasts?$/i,
  /^videos?$/i,
  /^photos?$/i,
  /^letters$/i,
  /^most popular$/i,
  /^the economist explains$/i,
  /^graphic detail$/i,
  /^home$/i,
];

// Non-Latin scripts (Cyrillic, Greek, CJK, Arabic, Hebrew, Devanagari, Thai,
// Hangul, Hiragana/Katakana) — a strong signal the story isn't English.
const NON_LATIN_SCRIPT_RE =
  /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

// Distinctive function words that rarely appear in English headlines but are
// common in other Latin-script languages (German, Spanish, French,
// Portuguese, Italian). Two or more is a reliable "not English" signal.
const FOREIGN_STOPWORDS = new Set([
  // German
  'der', 'die', 'das', 'und', 'für', 'mit', 'nicht', 'ist', 'wird', 'auch',
  'oder', 'sich', 'ein', 'eine', 'zum', 'zur', 'des', 'dem', 'den', 'bei',
  // Spanish / Portuguese
  'el', 'la', 'los', 'las', 'que', 'con', 'para', 'por', 'una', 'más',
  'año', 'años', 'como', 'este', 'esta', 'não', 'são', 'uma', 'dos', 'das',
  'del', 'se', 'su', 'sus', 'sin', 'sobre', 'entre', 'pero', 'muy', 'ya',
  'contra', 'hacia', 'desde', 'cuando', 'donde', 'tras', 'ante', 'según',
  // Spanish "y" (and) / French "et" / German "und" — short conjunctions
  'y', 'et', 'ou', 'ne', 'pas', 'où', 'ça',
  // French
  'le', 'les', 'une', 'des', 'pour', 'avec', 'dans', 'être', 'aux', 'ans',
  'plus', 'sur', 'ceci', 'cela',
  // Italian
  'il', 'lo', 'gli', 'che', 'con', 'per', 'una', 'del', 'della', 'nel',
]);

// Romance-language accented vowels that are rare in English text.
const ROMANCE_ACCENT_RE = /[áíóúàìòùâêîôûäëïöü]/i;

// Characters that essentially never occur in English words — a hard
// non-English signal on their own.
const NON_ENGLISH_CHAR_RE = /[ñçßøåæ¿¡ãõ]/i;

// Heuristic English-language check for a headline.
function isEnglish(text) {
  if (!text) return false;

  // Any non-Latin script character → not English.
  if (NON_LATIN_SCRIPT_RE.test(text)) return false;

  // Characters that don't appear in English (ñ, ç, ß, ¿, ¡, ã, õ, …).
  if (NON_ENGLISH_CHAR_RE.test(text)) return false;

  const words = text
    .toLowerCase()
    .split(/[^a-zA-ZÀ-ÿ]+/)
    .filter(Boolean);
  if (words.length === 0) return false;

  let foreignHits = 0;
  for (const w of words) {
    if (FOREIGN_STOPWORDS.has(w)) foreignHits++;
  }

  // Two distinctive foreign function words, or one paired with a Romance
  // accent, → treat as non-English.
  if (foreignHits >= 2) return false;
  if (foreignHits >= 1 && ROMANCE_ACCENT_RE.test(text)) return false;
  return true;
}

// Filters out non-article noise from feeds (especially Google News proxies):
// section pages, topic indexes, newsletters/tracking links, and puzzles/games.
function isJunkStory(headline, link) {
  if (!headline) return true;
  const raw = headline.trim();

  // Too short to be a real headline
  if (raw.length < 12) return true;

  // Games / puzzles
  if (/\b(crossword|wordle|sudoku|the mini|spelling bee|acrostic|quiz of the (day|week))\b/i.test(raw)) {
    return true;
  }

  // Topic index / paginated listing pages
  if (/all content on this topic/i.test(raw)) return true;
  if (/page \d+ of \d+/i.test(raw)) return true;

  // Stray newsletter/tracking-link headlines (e.g. "- click.e.economist.com")
  if (raw.startsWith('-')) return true;
  if (link && /\/\/(click|email|link|track|e)\./i.test(link)) return true;

  // Live streams / rolling coverage pages (e.g. "LIVE: ABC News Live",
  // "WATCH LIVE: ...")
  if (/^(watch\s+)?live[:\s]/i.test(raw)) return true;
  if (/\b(news live|live stream|watch live|live blog)\s*$/i.test(raw)) return true;

  // Full episodes / show landing pages (e.g. "PBS News Hour full")
  if (/\bfull (episode|show)\b/i.test(raw)) return true;
  if (/news ?hour full/i.test(raw)) return true;

  // Market data / futures ticker pages
  // (e.g. "ATWU31 | Rotterdam Coal Sep 2031 Contracts")
  if (/^[A-Z0-9]{4,10}\s*\|/.test(raw)) return true;
  if (/\|/.test(raw) && /\b(contracts?|futures)\s*$/i.test(raw)) return true;

  // Video / audio / gallery segments. Per request, plain media words are only
  // treated as junk when they lead the title (e.g. "Video: ...", "Watch: ...");
  // bracketed markers like [Video] or (Video) count anywhere.
  if (/^(video|watch|listen|gallery|slideshow|slide show|podcast|webcast|live ?stream|photos?|in pictures)\b/i.test(raw)) return true;
  if (/[\[(]\s*(video|watch|photos?|gallery|podcast|listen|audio)\s*[\])]/i.test(raw)) return true;

  // TV show / episode segment pages that use "|"-delimited metadata
  // (e.g. "Hello Houston | June 30, 2026",
  //  "The Slice | Eco3's LNPK Grocery | Season 2026")
  if (/\|\s*season\s+\d{4}\s*$/i.test(raw)) return true;
  if (/\|\s*episode\s+\d+/i.test(raw)) return true;
  if (/\|\s*\w+ \d{1,2},? \d{4}\s*$/i.test(raw)) return true;

  // Schedule / listing / digest pages ending in a date (optionally preceded
  // by a weekday), e.g. "Play Catalogues: Tuesday, June 30, 2026",
  // "The Christian Science Monitor Daily for June 29, 2026".
  if (/(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\s*$/i.test(raw)) return true;
  if (/\bdaily\b[^|]*\bfor\b[^|]*\d{4}\s*$/i.test(raw)) return true;
  if (/\bfor \w+ \d{1,2},? \d{4}\s*$/i.test(raw)) return true;

  // Non-English stories (foreign-language items from Google News site: feeds)
  if (!isEnglish(raw)) return true;

  // Strip the trailing " - Publisher" Google News appends, then test the title
  const titlePart = raw.replace(/\s+[-–|]\s+[^-–|]+$/, '').trim();

  // Bare domain as a "headline" (e.g. "click.e.economist.com")
  if (/^[\w-]+(\.[\w-]+)+$/.test(titlePart)) return true;

  // Bare date left after stripping publisher (e.g. "June 30, 2026")
  if (/^\w+ \d{1,2},? \d{4}$/.test(titlePart)) return true;

  // One- or two-word topic/tag pages (e.g. "Anthropic", "immunity").
  // Real headlines are full phrases; short fragments are section/tag indexes.
  if (titlePart.split(/\s+/).filter(Boolean).length < 3) return true;

  if (JUNK_TITLE_PATTERNS.some(p => p.test(titlePart))) return true;

  return false;
}

// News agency / publisher names that Google News appends as a trailing
// " - Publisher" suffix. Longer names are matched first so, e.g., "AP News"
// wins over "AP".
const AGENCY_NAMES = [
  'Associated Press', 'The Wall Street Journal', 'Wall Street Journal',
  'Christian Science Monitor', 'The Washington Post', 'Washington Post',
  'The New York Times', 'New York Times', 'PBS News Hour', 'PBS NewsHour',
  'The New Yorker', 'Financial Times', 'The Guardian', 'Deutsche Welle',
  'The Economist', 'The Atlantic', 'ProPublica', 'Bloomberg', 'USA Today',
  'BBC News', 'NBC News', 'ABC News', 'CBS News', 'The Hill', 'AP News',
  'Reuters', 'Politico', 'Guardian', 'Axios', 'Time', 'NPR', 'BBC', 'WSJ',
  'NYT', 'PBS', 'DW', 'FT', 'AP',
];

const AGENCY_SUFFIX_RE = new RegExp(
  `\\s*[-–—|]\\s*(?:the\\s+)?(?:${AGENCY_NAMES
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/^The\s+/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\s*$`,
  'i'
);

// Trailing " - Publisher.com" style suffix Google News appends as a domain
// (e.g. "... - DW.com", "... - CNBC.com"). Matches a short publisher token
// ending in a common TLD.
const AGENCY_DOMAIN_SUFFIX_RE =
  /\s*[-–—|]\s*[A-Za-z0-9][\w-]*(?:\.[\w-]+)*\.(?:com|org|net|co|us|uk|co\.uk|io|tv|de|fr)\s*$/i;

// Removes the trailing " - Publisher" news-agency suffix from a headline.
// If sourceName is given, its own name (with/without a leading "The") is also
// stripped as a safety net for publishers not in AGENCY_NAMES.
function stripAgencySuffix(title, sourceName) {
  if (!title) return title;
  let out = title.trim();

  let sourceRe = null;
  if (sourceName) {
    const bare = sourceName.replace(/^The\s+/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sourceRe = new RegExp(`\\s*[-–—|]\\s*(?:the\\s+)?${bare}\\s*$`, 'i');
  }

  // Strip repeatedly in case more than one agency name/domain is appended.
  let prev;
  do {
    prev = out;
    out = out.replace(AGENCY_SUFFIX_RE, '').trim();
    out = out.replace(AGENCY_DOMAIN_SUFFIX_RE, '').trim();
    if (sourceRe) out = out.replace(sourceRe, '').trim();
  } while (out !== prev && out.length > 0);
  return out || title.trim();
}


async function fetchAllFeeds() {
  const allStories = [];
  let junkSkipped = 0;

  console.log(`Starting to fetch feeds (looking for stories from the last ${HOURS_BACK} hours)...`);

  for (const source of sourcesData.sources) {
    console.log(`\nProcessing ${source.name}...`);
    
    for (const feedConfig of source.feeds) {
      console.log(`  Fetching: ${feedConfig.url}`);
      const items = await fetchFeed(feedConfig.url);

      for (const item of items) {
        // Check recency
        if (!isWithinHours(item.pubDate)) {
          continue;
        }

        // Check paywall
        if (isPaywalled(item.link)) {
          console.log(`    Skipping paywalled: ${item.title}`);
          continue;
        }

        // Skip non-article noise (section pages, newsletters, puzzles, etc.).
        // Run the junk check on the agency-stripped title so end-anchored
        // patterns (dates, "| Season 2026", etc.) match correctly.
        const cleanTitle = stripAgencySuffix(item.title, source.name);
        if (isJunkStory(cleanTitle, item.link)) {
          junkSkipped++;
          continue;
        }

        const story = {
          headline: cleanTitle || '',
          link: item.link || '',
          source: source.name,
          source_domain: source.domain,
          category_hint: feedConfig.category,
          published_at: item.pubDate,
          guid: item.guid || item.link || item.title, // For deduplication
        };

        allStories.push(story);
      }

      // Small delay between feeds to be respectful
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`\nFetched ${allStories.length} stories total (before deduplication)`);
  if (junkSkipped > 0) {
    console.log(`Skipped ${junkSkipped} non-article entries (section pages, newsletters, puzzles)`);
  }
  return allStories;
}

async function main() {
  const stories = await fetchAllFeeds();

  // Save raw fetched stories for inspection
  const rawOutputPath = path.join(__dirname, '../data/raw-stories.json');
  fs.writeFileSync(rawOutputPath, JSON.stringify(stories, null, 2));
  console.log(`\nSaved raw stories to ${rawOutputPath}`);

  // Save to latest.json for next stage
  const outputPath = path.join(__dirname, '../data/latest.json');
  fs.writeFileSync(outputPath, JSON.stringify(stories, null, 2));
  console.log(`Saved to ${outputPath}`);

  console.log(`\nPhase 1a complete. Ready for deduplication and ranking.`);
}

// Global safety net: if the whole fetch stage somehow exceeds this, force exit
// so the process can never hang indefinitely.
const GLOBAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const globalKill = setTimeout(() => {
  console.error(`\nGlobal timeout (${GLOBAL_TIMEOUT_MS / 1000}s) reached — forcing exit.`);
  process.exit(1);
}, GLOBAL_TIMEOUT_MS);
globalKill.unref(); // Don't let this timer itself keep the process alive

main()
  .then(() => {
    clearTimeout(globalKill);
    // Force a clean exit in case any lingering keep-alive sockets remain open.
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(globalKill);
    process.exit(1);
  });
