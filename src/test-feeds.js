import Parser from 'rss-parser';

const parser = new Parser();

const feedsToTest = [
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { name: 'BBC News (World)', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'BBC News (Sport)', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  { name: 'BBC News (Entertainment)', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
  { name: 'BBC News (Health)', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
  { name: 'Reuters', url: 'https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { name: 'The Guardian (World)', url: 'https://www.theguardian.com/international/rss' },
  { name: 'The Guardian (US)', url: 'https://www.theguardian.com/us/rss' },
  { name: 'The Guardian (Sport)', url: 'https://www.theguardian.com/sport/rss' },
  { name: 'The Guardian (Entertainment)', url: 'https://www.theguardian.com/culture/rss' },
  { name: 'The Guardian (Health)', url: 'https://www.theguardian.com/society/health/rss' },
  { name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news' },
  { name: 'ABC News', url: 'https://feeds.abcnews.com/abcnews/topstories' },
  { name: 'The Hill', url: 'https://thehill.com/feed/' },
  { name: 'The Atlantic', url: 'https://www.theatlantic.com/feed/all/' },
  { name: 'The New Yorker', url: 'https://www.newyorker.com/feed/rss' },
  { name: 'Time', url: 'https://time.com/feed' },
];

async function testFeeds() {
  console.log('Testing RSS feed URLs...\n');

  for (const feed of feedsToTest) {
    try {
      const result = await parser.parseURL(feed.url);
      const itemCount = result.items ? result.items.length : 0;
      console.log(`✓ ${feed.name.padEnd(30)} - OK (${itemCount} items)`);
    } catch (error) {
      console.log(`✗ ${feed.name.padEnd(30)} - FAILED: ${error.message.substring(0, 50)}`);
    }
    
    // Small delay to be respectful
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

testFeeds().catch(console.error);
