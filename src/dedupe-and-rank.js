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

function cosineSimilarity(keywords1, keywords2) {
  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / (union.size || 1);
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

      const similarity = cosineSimilarity(keywords1, keywords2);
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
  'Politics', 'Business', 'Technology', 'Entertainment', 'Sports',
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
  ['Health', /\b(health|covid|coronavirus|virus|disease|vaccine|vaccination|hospitals?|cancer|medical|medicine|doctors?|patients?|fda|outbreak|mental health|obesity|diabetes|flu|measles|opioid|abortion|pregnan|therapy|surgery)\b/i],
  ['Science', /\b(science|scientists?|space|spacewalks?|spacecrafts?|astronauts?|aerospace|nasa|spacex|rocket|satellite|telescopes?|orbit|cosmic|cosmos|nebula|asteroids?|meteors?|comet|climate|global warming|studies|researchers?|discovery|physics|astronomy|astrophysics|galaxy|galaxies|planet|mars|moon|fossils?|dinosaur|species|archaeolog|geolog|volcano|earthquake|wildlife|ocean|biology|genome)\b/i],
  ['Sports', /\b(sports?|championship|tournament|nba|nfl|mlb|nhl|ncaa|soccer|basketball|baseball|hockey|tennis|golf|olympics?|world cup|playoffs?|finals?|coach|league|fifa|uefa|grand slam|marathon|formula 1|f1|premier league|super bowl|free agency|free agent|quarterback|touchdown|home run|draft pick|midseason|wimbledon|lebron|lakers|celtics|warriors|knicks|yankees|dodgers|cowboys|patriots|athlete)\b/i],
  ['Entertainment', /\b(movie|films?|music|celebrity|celebrities|tv show|hollywood|album|actors?|actress|singers?|oscars?|grammys?|emmys?|box office|streaming|netflix|concert|festival|premiere|red carpet|billboard)\b/i],
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
    source_count: cluster.length,
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

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const parsed = await callGroqBatch(batch, b + 1, batches.length);

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

    // Small delay between batches to respect the tokens-per-minute limit.
    if (b < batches.length - 1) await sleep(3000);
  }

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
3. "category": exactly one of these 7 topical categories: Politics, Business, Technology, Entertainment, Sports, Science, Health.

CRITICAL RULES:
1. You may ONLY use the 7 categories listed above. Never invent new categories. Never use "World" or "U.S." as a category — those are regions only.
2. Evaluate specific categories first (Technology, Business, Entertainment, Sports, Science, Health) before defaulting to Politics.
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

      // Rate limited — wait and retry.
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || (attempt * 8);
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
  // Group stories by source, each group ordered by importance (rank).
  const bySource = {};
  for (const story of stories) {
    if (!bySource[story.source]) bySource[story.source] = [];
    bySource[story.source].push(story);
  }
  Object.values(bySource).forEach(arr => arr.sort((a, b) => a.rank - b.rank));

  const selected = [];
  let addedThisRound = true;

  // Round-robin: each round, take the next most-important story from every source.
  // Within a round, sources are ordered by the rank of their next story so the
  // biggest stories still surface first. This guarantees every source appears
  // before any single source can take a second slot.
  while (selected.length < limit && addedThisRound) {
    addedThisRound = false;

    const sourcesWithStories = Object.keys(bySource)
      .filter(src => bySource[src].length > 0)
      .sort((a, b) => bySource[a][0].rank - bySource[b][0].rank);

    for (const src of sourcesWithStories) {
      if (selected.length >= limit) break;
      selected.push(bySource[src].shift());
      addedThisRound = true;
    }
  }

  // Re-sort the final selection by importance for display.
  selected.sort((a, b) => a.rank - b.rank);

  const sourceCount = new Set(selected.map(s => s.source)).size;
  console.log(`\nBalanced selection: ${selected.length} stories across ${sourceCount} sources`);

  return selected;
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
      'Entertainment': 'Entertainment', 'entertainment': 'Entertainment',
      'Sports': 'Sports', 'sports': 'Sports',
      'Science': 'Science', 'science': 'Science',
      'Health': 'Health', 'health': 'Health',
    };

    const mappedCategory = categoryMap[ranking.category];
    // When neither the LLM nor the headline heuristic yields a specific topic,
    // fall back to the source feed's declared topical category (e.g. NASA's
    // "science" feed) before landing on the Politics catch-all.
    const hintCategory = categoryMap[(primaryStory.category_hint || '').toLowerCase()];
    const heuristicCategory = detectCategory(primaryStory.headline);
    const category = mappedCategory
      || (heuristicCategory === 'Politics' && hintCategory ? hintCategory : heuristicCategory);

    // Region is World or U.S.; prefer the LLM's region, else detect it.
    const region = (ranking.region === 'U.S.' || ranking.region === 'World')
      ? ranking.region
      : detectRegion(primaryStory.headline);

    finalStories.push({
      headline: primaryStory.headline,
      source: primaryStory.source,
      link: primaryStory.link,
      rank: ranking.rank,
      category: category,
      region: region,
      sources_covering_story: cluster.length,
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
