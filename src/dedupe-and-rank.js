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
  /\b(u\.?s\.?|u\.?s\.?a\.?|united states|americans?|america|washington|d\.?c\.?|congress|senate|white house|capitol|pentagon|supreme court|scotus|trump|biden|harris|vance|republicans?|democrats?|gop|federal reserve|wall street|fbi|cia|ice|nasa|medicare|medicaid|social security|new york|california|texas|florida)\b/i;

function detectRegion(headline) {
  return US_REGION_RE.test(headline || '') ? 'U.S.' : 'World';
}

// Ordered topical classifiers — the first match wins, so specific topics are
// checked before the Politics catch-all.
const CATEGORY_PATTERNS = [
  ['Health', /\b(health|covid|coronavirus|virus|disease|vaccine|vaccination|hospitals?|cancer|medical|medicine|doctors?|patients?|fda|outbreak|mental health|obesity|diabetes|flu|measles|opioid|abortion|pregnan|therapy|surgery)\b/i],
  ['Science', /\b(science|scientists?|space|nasa|spacex|rocket|satellite|climate|global warming|studies|researchers?|discovery|physics|astronomy|galaxy|planet|mars|moon|fossils?|dinosaur|species|archaeolog|geolog|volcano|earthquake|wildlife|ocean|biology|genome)\b/i],
  ['Sports', /\b(sports?|championship|tournament|nba|nfl|mlb|nhl|soccer|basketball|baseball|hockey|tennis|golf|olympics?|world cup|playoffs?|finals?|coach|league|fifa|uefa|grand slam|marathon|formula 1|f1|premier league|super bowl)\b/i],
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
    category_hint: cluster[0].category_hint || 'general',
  }));

  const systemPrompt = `You are a strict news editor. For each deduplicated headline you must assign:
1. A "region": exactly "World" or "U.S." ("U.S." for domestic United States news, "World" for everything else).
2. A "category": exactly one of these 7 topical categories: Politics, Business, Technology, Entertainment, Sports, Science, Health.

CRITICAL RULES:
1. You may ONLY use the 7 categories listed above. Never invent new categories. Never use "World" or "U.S." as a category — those are regions only.
2. Evaluate specific categories first (Technology, Business, Entertainment, Sports, Science, Health) before defaulting to Politics.
3. Politics covers government, elections, policy, war, diplomacy, courts, and general hard news.
4. DISTRIBUTE FAIRLY across categories. Do not overuse Politics at the expense of other categories.
5. Return your response as valid JSON.`;

  const userPrompt = `Categorize these headlines. Rank them by importance (1 = biggest story).

${JSON.stringify(headlines, null, 2)}

Return a JSON array with objects like: {"id": 0, "rank": 1, "region": "U.S.", "category": "Politics"}`;

  console.log('Calling Groq API for ranking and categorization...');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const rankings = JSON.parse(jsonMatch[0]);
    return rankings;
  } catch (error) {
    console.error('Error calling Groq API:', error);
    
    // Fallback: simple ranking by source count
    console.log('Falling back to simple ranking by source count...');
    return headlines
      .sort((a, b) => b.source_count - a.source_count || a.id - b.id)
      .map((h, idx) => ({
        id: h.id,
        rank: idx + 1,
        region: detectRegion(h.headline),
        category: detectCategory(h.headline),
      }));
  }
}

function ensureMinimumPerCategory(stories, minPerCategory = 5) {
  const categories = TOPICAL_CATEGORIES;
  const storiesByCategory = {};

  categories.forEach(cat => {
    storiesByCategory[cat] = stories.filter(s => s.category === cat);
  });

  // Find categories below minimum
  const underrepresented = categories.filter(cat => storiesByCategory[cat].length < minPerCategory);

  if (underrepresented.length === 0) {
    console.log('All categories meet minimum of 5 stories');
    return stories;
  }

  console.log(`\nRebalancing categories. Underrepresented: ${underrepresented.join(', ')}`);

  const adjustedStories = [...stories];

  for (const targetCat of underrepresented) {
    const current = adjustedStories.filter(s => s.category === targetCat).length;
    const needed = minPerCategory - current;

    if (needed > 0) {
      // Pull the lowest-importance stories from whichever category currently
      // has the most stories (typically Politics) to fill the gap.
      const counts = {};
      categories.forEach(cat => {
        counts[cat] = adjustedStories.filter(s => s.category === cat).length;
      });
      const donorCat = categories
        .filter(cat => cat !== targetCat)
        .sort((a, b) => counts[b] - counts[a])[0];

      const donors = adjustedStories
        .filter(s => s.category === donorCat)
        .sort((a, b) => b.rank - a.rank) // lowest importance first
        .slice(0, needed);

      console.log(`  Moving ${donors.length} stories from ${donorCat} to ${targetCat}`);

      donors.forEach(story => {
        story.category = targetCat;
      });
    }
  }

  // Re-sort by rank since we modified categories
  adjustedStories.sort((a, b) => a.rank - b.rank);
  return adjustedStories;
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
    const category = mappedCategory || detectCategory(primaryStory.headline);

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
  const limitedStories = balanceSourceRepresentation(finalStories, 100);

  // Ensure minimum 5 stories per category
  const balancedStories = ensureMinimumPerCategory(limitedStories, 5);

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
