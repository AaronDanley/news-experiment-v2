import Parser from 'rss-parser';

const parser = new Parser();

const feedsToTest = [
  { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'Reuters', url: 'https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/international/rss' },
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
      console.log(`✓ ${feed.name.padEnd(20)} - OK (${itemCount} items)`);
    } catch (error) {
      console.log(`✗ ${feed.name.padEnd(20)} - FAILED: ${error.message.substring(0, 50)}`);
    }
    
    // Small delay to be respectful
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

testFeeds().catch(console.error);
