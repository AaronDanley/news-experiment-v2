import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

if (!GROQ_API_KEY) {
  console.error('ERROR: GROQ_API_KEY environment variable not set. Please add it to .env');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Never block the build on a rate-limit cooldown longer than this; fall back
// to heuristic categorization instead of sleeping for minutes.
const MAX_RETRY_WAIT_S = 20;

// Simple keyword extraction for deduplication
function extractKeywords(headline) {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'is', 'are', 'was', 'were', 'be', 'been', 'by', 'that', 'this', 'as', 'it', 'from',
    'says', 'said', 'say', 'new', 'just', 'now', 'up', 'out', 'if', 'about', 'all',
  ]);

  return headline
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopwords.has(word))
    .map(word => word.replace(/[^\w]/g, ''))
    .filter(word => word.length > 0);
}

// Jaccard similarity of two keyword sets: |intersection| / |union|.
// (Named cosine historically, but this is set-overlap, i.e. Jaccard.)
function jaccardSimilarity(keywords1, keywords2) {
  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / (union.size || 1);
}

// Normalize a publisher name for coverage counting (lowercase, drop a leading
// "the", collapse whitespace) so "The New York Times" and "New York Times" are
// counted as one outlet.
function normalizeSourceName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Distinct outlets covering a clustered story. Combines the publishers of the
// clustered feed items with the related-outlet list Google provides in each
// Google News item description, deduped by normalized name. Returns
// { count, names } where names keeps the first-seen display form of each outlet.
function clusterCoverage(cluster) {
  const byNormalized = new Map(); // normalized -> display name
  for (const story of cluster) {
    const candidates = [story.source, ...(story.google_sources || [])];
    for (const raw of candidates) {
      const norm = normalizeSourceName(raw);
      if (norm && !byNormalized.has(norm)) byNormalized.set(norm, raw);
    }
  }
  return { count: byNormalized.size, names: [...byNormalized.values()] };
}

function deduplicateStories(stories) {
  const clusters = [];
  const processed = new Set();

  for (let i = 0; i < stories.length; i++) {
    if (processed.has(i)) continue;

    const story = stories[i];
    const cluster = [story];
    processed.add(i);

    const keywords1 = extractKeywords(story.headline);

    // Find similar stories
    for (let j = i + 1; j < stories.length; j++) {
      if (processed.has(j)) continue;

      const otherStory = stories[j];
      const keywords2 = extractKeywords(otherStory.headline);

      const similarity = jaccardSimilarity(keywords1, keywords2);
      if (similarity > 0.4) { // Threshold for "same story"
        cluster.push(otherStory);
        processed.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

// Topical categories shown on the page (World / U.S. are now regions, not
// categories). Politics sits above Business per the requested ordering.
const TOPICAL_CATEGORIES = [
  'Politics', 'Business', 'Technology', 'Arts & Entertainment', 'Sports',
  'Science', 'Health',
];

// A story is tagged U.S. when it clearly concerns United States people,
// places, or institutions; otherwise it is World.
const US_REGION_RE =
  /\b(u\.?s\.?|u\.?s\.?a\.?|united states|americans?|america|washington|d\.?c\.?|congress|senate|white house|capitol|pentagon|supreme court|scotus|trump|biden|harris|vance|republicans?|democrats?|gop|federal reserve|wall street|fbi|cia|ice|nasa|medicare|medicaid|social security|new york|california|texas|florida|nba|nfl|mlb|nhl|ncaa|lakers|celtics|warriors|knicks|yankees|dodgers|cowboys|patriots|super bowl)\b/i;

function detectRegion(headline) {
  return US_REGION_RE.test(headline || '') ? 'U.S.' : 'World';
}

// Ordered topical classifiers — the first match wins, so specific topics are
// checked before the Politics catch-all.
const CATEGORY_PATTERNS = [
  ['Health', /\b(covid|coronavirus|virus|disease|vaccine|vaccination|hospitals?|cancer|medical|medicine|doctors?|patients?|fda|outbreak|mental health|obesity|diabetes|flu|measles|opioid|abortion|pregnan|therapy|surgery|pandemic|epidemic|tuberculosis|malaria|infection|immunization|hiv|aids|covid-19)\b/i],
  ['Science', /\b(science|scientists?|space|spacewalks?|spacecrafts?|astronauts?|aerospace|nasa|spacex|rocket|satellite|telescopes?|orbit|cosmic|cosmos|nebula|asteroids?|meteors?|comet|climate|global warming|studies|researchers?|discovery|physics|astronomy|astrophysics|galaxy|galaxies|planet|mars|moon|fossils?|dinosaur|species|archaeolog|geolog|volcano|earthquake|wildlife|ocean|biology|genome)\b/i],
  ['Sports', /\b(sports?|championship|tournament|nba|nfl|mlb|nhl|ncaa|soccer|basketball|baseball|hockey|tennis|golf|olympics?|world cup|playoffs?|finals?|coach|league|fifa|uefa|grand slam|marathon|formula 1|f1|premier league|super bowl|free agency|free agent|quarterback|touchdown|home run|draft pick|midseason|wimbledon|lebron|lakers|celtics|warriors|knicks|yankees|dodgers|cowboys|patriots|athlete)\b/i],
  ['Arts & Entertainment', /\b(movie|films?|music|celebrity|celebrities|tv show|hollywood|album|actors?|actress|singers?|oscars?|grammys?|emmys?|box office|streaming|netflix|concert|festival|premiere|red carpet|billboard|books?|literary|novel|author|theater|theatre|ballet|opera|dance|gallery|art|artwork|museum|exhibition|painting|sculpture|playwright|broadway|shakespeare|artist|photography|photographer|fashion|design|documentary)\b/i],
  ['Technology', /\b(tech|technology|\bai\b|artificial intelligence|software|hardware|\bapp\b|apps|smartphones?|iphone|android|google|apple|microsoft|amazon|meta|openai|chatgpt|chips?|semiconductor|robots?|cyber|hacking|data breach|crypto|bitcoin|startup|silicon valley|algorithm|quantum)\b/i],
  ['Business', /\b(business|econom|markets?|stocks?|shares?|trade war|trading|earnings|revenue|profits?|inflation|recession|unemployment|\bfed\b|federal reserve|interest rate|gdp|mergers?|acquisition|ipo|tariffs?|banks?|investors?|nasdaq|dow jones|s&p 500|layoffs?|\bceo\b|jobs report)\b/i],
  ['Politics', /\b(politic|elections?|president|congress|senate|parliament|government|policy|votes?|voters?|campaign|\bwar\b|military|troops|courts?|lawsuit|legislation|immigration|border|protests?|minister|sanctions?|diplomat|treaty|nato|united nations|coup|referendum|governor|mayor|prime minister|foreign policy|nuclear|ceasefire|airstrike|election)\b/i],
];

function detectCategory(headline) {
  const text = headline || '';
  for (const [cat, re] of CATEGORY_PATTERNS) {
    if (re.test(text)) return cat;
  }
  // General / hard news with no specific topic defaults to Politics.
  return 'Politics';
}

async function rankStoriesWithLLM(clusters) {
  // Prepare the headlines for categorization
  const headlines = clusters.map((cluster, idx) => ({
    id: idx,
    headline: cluster[0].headline, // Use first story's headline
    source_count: clusterCoverage(cluster).count,
  }));

  // Only the strongest candidates (by source coverage) are sent to the LLM so
  // the number of requests stays small and within the rate limit. The rest are
  // very unlikely to reach the top 100 and fall back to heuristics.
  const LLM_CANDIDATE_LIMIT = 150;
  const BATCH_SIZE = 25;
  const candidates = [...headlines]
    .sort((a, b) => b.source_count - a.source_count || a.id - b.id)
    .slice(0, LLM_CANDIDATE_LIMIT);

  const batches = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  console.log(`Categorizing ${candidates.length} candidate stories via Groq in ${batches.length} batches...`);

  const llmResults = new Map(); // id -> { importance, region, category }
  let llmFailures = 0;

  // Run batches with bounded concurrency instead of one-at-a-time with 3s
  // sleeps between each. callGroqBatch already handles 429/retry-after, so a
  // small concurrency stays within the rate limit while cutting wall time.
  const GROQ_CONCURRENCY = 3;
  let batchCursor = 0;
  async function batchWorker() {
    while (batchCursor < batches.length) {
      const b = batchCursor++;
      const parsed = await callGroqBatch(batches[b], b + 1, batches.length);
      if (parsed) {
        for (const item of parsed) {
          if (item == null || item.id === undefined) continue;
          const region = (item.region === 'U.S.' || item.region === 'World')
            ? item.region
            : null;
          const category = TOPICAL_CATEGORIES.includes(item.category)
            ? item.category
            : null;
          let importance = Number(item.importance);
          if (!Number.isFinite(importance)) importance = 5;
          importance = Math.max(1, Math.min(10, importance));
          llmResults.set(item.id, { importance, region, category });
        }
      } else {
        llmFailures++;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(GROQ_CONCURRENCY, batches.length) }, batchWorker)
  );

  console.log(`LLM categorized ${llmResults.size} stories (${llmFailures} batch failure(s), remainder use heuristics).`);

  // Combine LLM output with heuristic fallback for everything else.
  const enriched = headlines.map(h => {
    const llm = llmResults.get(h.id);
    const region = (llm && llm.region) || detectRegion(h.headline);
    const category = (llm && llm.category) || detectCategory(h.headline);
    const importance = llm ? llm.importance : 0; // 0 => sorts below LLM-scored
    return { ...h, region, category, importance, scored: !!llm };
  });

  // Rank globally: LLM-scored stories first (by importance, then coverage),
  // then the rest by coverage. Importance (1-10) is absolute, so it is
  // comparable across batches.
  enriched.sort((a, b) => {
    if (a.scored !== b.scored) return a.scored ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return b.source_count - a.source_count || a.id - b.id;
  });

  return enriched.map((h, idx) => ({
    id: h.id,
    rank: idx + 1,
    region: h.region,
    category: h.category,
  }));
}

// Calls Groq to categorize one batch of headlines. Returns a parsed array of
// { id, importance, region, category } or null if the request fails.
async function callGroqBatch(batch, batchNum, batchTotal) {
  const systemPrompt = `You are a strict news editor. For each headline assign:
1. "importance": an integer 1-10 (10 = biggest, most consequential story of the day; 1 = minor).
2. "region": exactly "World" or "U.S." ("U.S." for domestic United States news, "World" for everything else).
3. "category": exactly one of these 7 topical categories: Politics, Business, Technology, Arts & Entertainment, Sports, Science, Health.

CRITICAL RULES:
1. You may ONLY use the 7 categories listed above. Never invent new categories. Never use "World" or "U.S." as a category — those are regions only.
2. Evaluate specific categories first (Technology, Business, Arts & Entertainment, Sports, Science, Health) before defaulting to Politics.
3. Politics covers government, elections, policy, war, diplomacy, courts, and general hard news.
4. Assign the category that best fits the actual subject of the headline.
5. Return your response as valid JSON.`;

  const payload = batch.map(h => ({ id: h.id, headline: h.headline }));
  const userPrompt = `Classify each of these headlines.

${JSON.stringify(payload, null, 2)}

Return ONLY a JSON array with one object per headline, like:
[{"id": 0, "importance": 8, "region": "U.S.", "category": "Politics"}]`;

  const MAX_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Rate limited — wait and retry, but never block the whole build on a
      // long cooldown (Groq's free tier can return retry-after of many
      // minutes when the daily quota is exhausted). If the requested wait is
      // too long, give up on the LLM for this batch and use heuristics.
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || (attempt * 8);
        if (retryAfter > MAX_RETRY_WAIT_S) {
          console.log(`  Batch ${batchNum}/${batchTotal}: rate limited (${retryAfter}s cooldown) — skipping LLM, using heuristics.`);
          return null;
        }
        console.log(`  Batch ${batchNum}/${batchTotal}: rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API error: ${response.status} ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`  Batch ${batchNum}/${batchTotal}: categorized ${parsed.length} stories.`);
      return parsed;
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`  Batch ${batchNum}/${batchTotal} attempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_RETRIES) await sleep(attempt * 4000);
    }
  }

  console.error(`  Batch ${batchNum}/${batchTotal}: giving up, using heuristics for these stories.`);
  return null;
}

function ensureMinimumPerCategory(stories, minPerCategory = 5) {
  // Intentionally a no-op: forcing a minimum per category stuffed unrelated
  // stories into small sections (e.g. Politics stories dumped into Science),
  // which produced badly miscategorized sections. Stories now stay only in the
  // category they actually belong to.
  return stories;
}

function balanceSourceRepresentation(stories, limit = 100) {
  // Take the top N stories by rank (importance + coverage), allowing major
  // outlets to appear multiple times. This prioritizes story quality over
  // source diversity.
  const selected = stories
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);

  const sourceCount = new Set(selected.map(s => s.source)).size;
  console.log(`\nQuality-first selection: ${selected.length} stories across ${sourceCount} sources`);

  return selected;
}

// Outlet prominence tiers: used to prefer major outlets over local/niche ones
// when multiple sources cover the same story. Higher tier = more prominent.
const OUTLET_TIERS = {
  // Tier 1: Major national / international news organizations
  1: new Set([
    'Associated Press', 'AP News', 'AP', 'Reuters', 'BBC', 'BBC News',
    'NPR', 'The New York Times', 'The Washington Post', 'CNN', 'ABC News',
    'CBS News', 'NBC News', 'PBS NewsHour', 'PBS News Hour', 'The Wall Street Journal',
    'Financial Times', 'The Guardian', 'The Economist', 'Bloomberg', 'ProPublica',
    'The Atlantic', 'POLITICO', 'Axios', 'USA Today', 'Time', 'Newsweek',
  ]),
  // Tier 2: Major regional / international outlets, plus national sports/entertainment
  2: new Set([
    'Reuters Staff', 'PA Media', 'DPA', 'EFE', 'AFP', 'The Hill', 'The New Yorker',
    'Al Jazeera', 'Euronews', 'Deutsche Welle', 'DW', 'Sky News', 'Channel 4 News',
    'ITV News', 'CNBC', 'Fox News', 'MSNBC', 'The Independent', 'Telegraph',
    'The Times', 'Financial Post', 'The Globe and Mail', 'The Canadian Press',
    'ESPN', 'The Athletic', 'NBC Sports', 'Variety', 'Deadline',
  ]),
  // Tier 3: Niche / regional / newer credible outlets
  3: new Set([
    'Politico', 'The Information', 'VentureBeat', 'TechCrunch', 'The Verge',
    'Wired', 'The Register', 'Protocol', 'Vox', 'Slate', 'The Intercept',
    'Mother Jones', 'The Daily Beast', 'Business Insider', 'STAT News',
    'Science Daily', 'Nature', 'Science Magazine', 'Journal of Science',
  ]),
  // Tier 4: Regional / local outlets (deprioritized — only use if nothing better available)
  4: new Set([
    'PhillyVoice', 'WUSA9', 'NBC4 Washington', 'NBC7 San Diego', 'ABC7 New York',
    'ABC7 Los Angeles', 'KPIX', 'WTVR', 'WAVY', 'San Francisco Chronicle',
    'Chicago Tribune', 'Boston Globe', 'Denver Post', 'Atlanta Journal-Constitution',
    'Miami Herald', 'Seattle Times', 'Minneapolis Star Tribune', '13newsnow',
    'Local 10', 'NBC Bay Area',
  ]),
};

function getOutletTier(outlet) {
  const normalized = normalizeSourceName(outlet);
  for (let tier = 1; tier <= 4; tier++) {
    for (const name of OUTLET_TIERS[tier]) {
      if (normalizeSourceName(name) === normalized) return tier;
    }
  }
  return 5; // Unknown / niche
}

// Pick the most prominent outlet from a list of names, preferring tier 1 > 2 > 3 > unknown.
function pickBestOutlet(outletNames) {
  if (!outletNames || outletNames.length === 0) return null;
  if (outletNames.length === 1) return outletNames[0];
  
  let best = outletNames[0];
  let bestTier = getOutletTier(best);
  
  for (const outlet of outletNames) {
    const tier = getOutletTier(outlet);
    if (tier < bestTier) {
      best = outlet;
      bestTier = tier;
    }
  }
  return best;
}

function buildFinalList(clusters, rankings) {
  // Create a map of rankings
  const rankMap = {};
  rankings.forEach(r => {
    rankMap[r.id] = r;
  });

  const finalStories = [];

  clusters.forEach((cluster, idx) => {
    const primaryStory = cluster[0]; // Use first story as the primary
    const ranking = rankMap[idx] || { rank: 999 };

    // Normalize the LLM's topical category; fall back to heuristics when it is
    // missing or not one of the 7 topical categories (e.g. old "World"/"U.S.").
    const categoryMap = {
      'Politics': 'Politics', 'politics': 'Politics',
      'Business': 'Business', 'business': 'Business',
      'Technology': 'Technology', 'technology': 'Technology',
      'Arts & Entertainment': 'Arts & Entertainment', 'arts & entertainment': 'Arts & Entertainment', 'Entertainment': 'Arts & Entertainment', 'entertainment': 'Arts & Entertainment',
      'Sports': 'Sports', 'sports': 'Sports',
      'Science': 'Science', 'science': 'Science',
      'Health': 'Health', 'health': 'Health',
    };

    const mappedCategory = categoryMap[ranking.category];
    // Google News topic feeds are reliably curated, so trust the feed's topical
    // category over the headline heuristic. The same story can appear in several
    // feeds (dedup clusters them), so scan the whole cluster and pick the most
    // specific topical hint present. "general"/"world"/"us" are non-topical and
    // ignored here (they fall through to the heuristic, which can return Politics).
    const CATEGORY_HINT_PRIORITY = ['Health', 'Science', 'Sports', 'Arts & Entertainment', 'Technology', 'Business'];
    let clusterHint = null;
    for (const cat of CATEGORY_HINT_PRIORITY) {
      if (cluster.some(s => categoryMap[(s.category_hint || '').toLowerCase()] === cat)) {
        clusterHint = cat;
        break;
      }
    }
    const heuristicCategory = detectCategory(primaryStory.headline);
    // Priority: LLM category > topical feed hint > headline heuristic.
    const category = mappedCategory || clusterHint || heuristicCategory;

    // Region is World or U.S.; prefer the LLM's region, else detect it.
    const region = (ranking.region === 'U.S.' || ranking.region === 'World')
      ? ranking.region
      : detectRegion(primaryStory.headline);

    // Coverage combines the cluster's own publishers with Google's related-
    // outlet list, so the count reflects real coverage rather than headline
    // overlap alone. sources_list drives the "also covered by..." display.
    const coverage = clusterCoverage(cluster);

    // Pick the most prominent outlet from the coverage list to display as the
    // primary source, preferring major outlets (CNN, NYT, AP) over local ones.
    const source = pickBestOutlet(coverage.names) || primaryStory.source;
    
    // Find the link from the best outlet's version of this story, if available.
    // Otherwise fall back to the primary story's link.
    let link = primaryStory.link;
    const sourceNormalized = normalizeSourceName(source);
    for (const story of cluster) {
      if (normalizeSourceName(story.source || '') === sourceNormalized) {
        link = story.link;
        break;
      }
    }

    finalStories.push({
      headline: primaryStory.headline,
      source: source,
      link: link,
      rank: ranking.rank,
      category: category,
      region: region,
      sources_covering_story: coverage.count,
      sources_list: coverage.names,
    });
  });

  // Sort by rank
  finalStories.sort((a, b) => a.rank - b.rank);

  // Select the top 100 while ensuring fair representation across all sources
  const balancedStories = balanceSourceRepresentation(finalStories, 100);

  // Renumber ranks sequentially (1..N) by importance so the displayed
  // ranking is always 1-100 rather than the raw ranking scale.
  balancedStories
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .forEach((story, idx) => {
      story.rank = idx + 1;
    });

  return {
    stories: balancedStories,
    total_stories: balancedStories.length,
    last_updated: new Date().toISOString(),
  };
}

async function main() {
  const rawPath = path.join(__dirname, '../data/latest.json');

  if (!fs.existsSync(rawPath)) {
    console.error('latest.json not found. Run fetch-feeds.js first.');
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  
  // Handle both array (from fetch-feeds.js) and object (from previous dedupe run)
  const stories = Array.isArray(rawData) ? rawData : rawData.stories || [];
  console.log(`Loaded ${stories.length} stories from latest.json`);

  // Deduplicate
  console.log('\nDeduplicating stories...');
  const clusters = deduplicateStories(stories);
  console.log(`Clustered into ${clusters.length} story clusters`);

  // Rank with LLM
  const rankings = await rankStoriesWithLLM(clusters);

  // Build final list
  const finalList = buildFinalList(clusters, rankings);

  // Save final output
  const outputPath = path.join(__dirname, '../data/latest.json');
  fs.writeFileSync(outputPath, JSON.stringify(finalList, null, 2));

  console.log(`\nPhase 1 complete!`);
  console.log(`Final list: ${finalList.total_stories} stories`);
  console.log(`Saved to ${outputPath}`);
}

main().catch(console.error);
