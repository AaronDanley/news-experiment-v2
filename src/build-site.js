import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateHTML(data) {
  const categoryOrder = ['World', 'U.S.', 'Business', 'Technology', 'Entertainment', 'Sports', 'Science', 'Health'];
  
  // Group stories by category
  const storyByCategory = {};
  categoryOrder.forEach(cat => {
    storyByCategory[cat] = [];
  });

  data.stories.forEach(story => {
    if (storyByCategory[story.category]) {
      storyByCategory[story.category].push(story);
    }
  });

  // Build HTML
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>News Aggregator - Top 100 Stories</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    h1 { margin-bottom: 10px; }
    .metadata { color: #666; font-size: 0.9em; margin-bottom: 30px; }
    h2 { border-top: 2px solid #999; padding-top: 20px; margin-top: 30px; margin-bottom: 15px; }
    .story { margin-bottom: 20px; padding-left: 20px; border-left: 3px solid #ddd; }
    .story-headline { font-weight: bold; margin-bottom: 5px; }
    .story-meta { color: #666; font-size: 0.9em; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>News Aggregator</h1>
  <div class="metadata">
    <p>Showing ${data.total_stories} of 100 stories (last updated: ${new Date(data.last_updated).toLocaleString()})</p>
  </div>
`;

  // Add stories by category
  categoryOrder.forEach(category => {
    const stories = storyByCategory[category];
    html += `  <h2>${category}</h2>\n`;
    if (stories.length === 0) {
      html += `  <p style="color: #999; font-style: italic;">No stories today</p>\n`;
    } else {
      stories.forEach(story => {
        html += `  <div class="story">
    <div class="story-headline"><a href="${escapeHtml(story.link)}" target="_blank">${escapeHtml(story.headline)}</a></div>
    <div class="story-meta">${escapeHtml(story.source)} • Ranking ${story.rank}${story.sources_covering_story > 1 ? ` • Covered by ${story.sources_covering_story} sources` : ''}</div>
  </div>\n`;
      });
    }
  });

  html += `</body>
</html>`;

  return html;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

async function main() {
  const dataPath = path.join(__dirname, '../data/latest.json');

  if (!fs.existsSync(dataPath)) {
    console.error('latest.json not found. Run dedupe-and-rank.js first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`Loaded ${data.total_stories} stories from latest.json`);

  const html = generateHTML(data);

  const outputPath = path.join(__dirname, '../public/index.html');
  fs.writeFileSync(outputPath, html);

  console.log(`Generated HTML to ${outputPath}`);
  console.log(`\nPhase 2 complete! Open ${outputPath} in a browser to view.`);
}

main().catch(console.error);
