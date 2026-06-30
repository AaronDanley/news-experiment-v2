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

async function rankStoriesWithLLM(clusters) {
  // Prepare the prompt for the LLM
  const headlines = clusters.map((cluster, idx) => ({
    id: idx,
    headline: cluster[0].headline, // Use first story's headline
    source_count: cluster.length,
    category_hint: cluster[0].category_hint || 'general',
  }));

  const prompt = `You are a news editor. Rank these stories by importance for today's news (1 = biggest story, highest number = smallest). Assign each to one of these 8 categories: World, U.S., Business, Technology, Entertainment, Sports, Science, Health.

Stories:
${headlines.map(h => `ID ${h.id}: "${h.headline}" (${h.source_count} source(s), hint: ${h.category_hint})`).join('\n')}

Return ONLY a valid JSON array with objects like: {"id": 0, "rank": 1, "category": "World"}
Do not include any other text or markdown.`;

  console.log('Calling Groq API for ranking and categorization...');

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
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

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
      .map((h, idx) => {
        let category = h.category_hint === 'general' ? 'World' : h.category_hint.charAt(0).toUpperCase() + h.category_hint.slice(1);
        // Fix "Us" → "U.S."
        if (category === 'Us') category = 'U.S.';
        return {
          id: h.id,
          rank: idx + 1,
          category: category,
        };
      });
  }
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
    const ranking = rankMap[idx] || { rank: 999, category: 'World' };

    // Map category names to canonical names
    const categoryMap = {
      'World': 'World',
      'world': 'World',
      'US': 'U.S.',
      'us': 'U.S.',
      'U.S.': 'U.S.',
      'Business': 'Business',
      'business': 'Business',
      'Technology': 'Technology',
      'technology': 'Technology',
      'Entertainment': 'Entertainment',
      'entertainment': 'Entertainment',
      'Sports': 'Sports',
      'sports': 'Sports',
      'Science': 'Science',
      'science': 'Science',
      'Health': 'Health',
      'health': 'Health',
    };

    const category = categoryMap[ranking.category] || 'World';

    finalStories.push({
      headline: primaryStory.headline,
      source: primaryStory.source,
      link: primaryStory.link,
      rank: ranking.rank,
      category: category,
      sources_covering_story: cluster.length,
    });
  });

  // Sort by rank
  finalStories.sort((a, b) => a.rank - b.rank);

  // Limit to 100 stories
  const limitedStories = finalStories.slice(0, 100);

  return {
    stories: limitedStories,
    total_stories: limitedStories.length,
    last_updated: new Date().toISOString(),
  };
}

async function main() {
  const rawPath = path.join(__dirname, '../data/latest.json');

  if (!fs.existsSync(rawPath)) {
    console.error('raw-stories.json not found. Run fetch-feeds.js first.');
    process.exit(1);
  }

  const stories = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
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
