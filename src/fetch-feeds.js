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

async function fetchFeed(feedUrl) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return feed.items || [];
  } catch (error) {
    console.error(`Error fetching ${feedUrl}:`, error.message);
    return [];
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

main().catch(console.error);
