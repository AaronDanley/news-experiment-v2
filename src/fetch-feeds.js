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

async function fetchAllFeeds() {
  const allStories = [];

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

        const story = {
          headline: item.title || '',
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
