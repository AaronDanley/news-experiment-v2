import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateHTML(data) {
  const categoryOrder = ['Politics', 'Business', 'Technology', 'Arts & Entertainment', 'Sports', 'Science', 'Health'];

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
    .metadata { color: #666; font-size: 0.9em; margin-bottom: 20px; }
    .filters { margin: 0 0 20px; padding: 12px 16px; background: #f5f5f5; border-radius: 8px; display: flex; gap: 20px; align-items: center; }
    .filters strong { font-size: 0.9em; }
    .filters label { font-size: 0.95em; cursor: pointer; user-select: none; }
    .filters input { margin-right: 6px; vertical-align: middle; }
    h2 { border-top: 2px solid #999; padding-top: 20px; margin-top: 30px; margin-bottom: 15px; }
    .category.empty { display: none; }
    .story { margin-bottom: 20px; padding-left: 20px; border-left: 3px solid #ddd; }
    .story.hidden { display: none; }
    .story-headline { font-weight: bold; margin-bottom: 5px; }
    .story-meta { color: #666; font-size: 0.9em; }
    .region-tag { display: inline-block; font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: #fff; background: #888; border-radius: 3px; padding: 1px 6px; margin-right: 6px; }
    .region-tag.region-us { background: #6a1b9a; }
    .region-tag.region-world { background: #00695c; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>News Aggregator</h1>
  <div class="metadata">
    <p>Showing ${data.total_stories} of 100 stories (last updated: ${new Date(data.last_updated).toLocaleString()})</p>
  </div>
  <div class="filters">
    <strong>Regions:</strong>
    <label><input type="checkbox" class="region-filter" value="World" checked> World</label>
    <label><input type="checkbox" class="region-filter" value="U.S." checked> U.S.</label>
  </div>
`;

  // Add stories by category
  categoryOrder.forEach(category => {
    const stories = storyByCategory[category];
    html += `  <section class="category" data-category="${escapeHtml(category)}">\n`;
    html += `  <h2>${category}</h2>\n`;
    if (stories.length === 0) {
      html += `  <p style="color: #999; font-style: italic;">No stories today</p>\n`;
    } else {
      stories.forEach(story => {
        const region = story.region || 'World';
        const regionClass = region === 'U.S.' ? 'region-us' : 'region-world';
        // Coverage line: how many outlets ran the story, plus a few named ones
        // ("also covered by...") drawn from Google's related-outlet list.
        let coverageText = '';
        if (story.sources_covering_story > 1) {
          coverageText = ` • Covered by ${story.sources_covering_story} sources`;
          const others = (story.sources_list || []).filter(
            name => name.toLowerCase().replace(/^the\s+/, '').trim() !==
                    (story.source || '').toLowerCase().replace(/^the\s+/, '').trim()
          );
          if (others.length > 0) {
            const shown = others.slice(0, 3).join(', ');
            const extra = others.length > 3 ? ` +${others.length - 3} more` : '';
            coverageText += ` (also: ${escapeHtml(shown)}${escapeHtml(extra)})`;
          }
        }
        html += `  <div class="story" data-region="${escapeHtml(region)}">
    <div class="story-headline"><a href="${escapeHtml(story.link)}" target="_blank">${escapeHtml(story.headline)}</a></div>
    <div class="story-meta"><span class="region-tag ${regionClass}">${escapeHtml(region)}</span>${escapeHtml(story.source)} • Ranking ${story.rank}${coverageText}</div>
  </div>\n`;
      });
    }
    html += `  </section>\n`;
  });

  html += `
  <script>
    (function () {
      var checkboxes = Array.prototype.slice.call(document.querySelectorAll('.region-filter'));
      function apply() {
        var active = checkboxes.filter(function (c) { return c.checked; })
          .map(function (c) { return c.value; });
        document.querySelectorAll('.story').forEach(function (story) {
          var region = story.getAttribute('data-region');
          story.classList.toggle('hidden', active.indexOf(region) === -1);
        });
        // Hide category sections that have no visible stories.
        document.querySelectorAll('.category').forEach(function (section) {
          var visible = section.querySelectorAll('.story:not(.hidden)').length;
          section.classList.toggle('empty', visible === 0);
        });
      }
      checkboxes.forEach(function (c) { c.addEventListener('change', apply); });
      apply();
    })();
  </script>
</body>
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
