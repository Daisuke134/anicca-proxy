module.exports = async (req, res) => {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { limit = 5 } = req.body;
    
    // HackerNews APIから最新ストーリーを取得
    const topStoriesResponse = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const storyIds = await topStoriesResponse.json();
    const limitedIds = storyIds.slice(0, limit);
    
    // 各ストーリーの詳細を取得
    const stories = await Promise.all(
      limitedIds.map(async (id) => {
        const storyResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const story = await storyResponse.json();
        return {
          title: story.title,
          url: story.url || `https://news.ycombinator.com/item?id=${id}`,
          score: story.score,
          by: story.by,
          time: new Date(story.time * 1000).toISOString()
        };
      })
    );
    
    res.status(200).json({
      success: true,
      stories: stories
    });
    
  } catch (error) {
    console.error('HackerNews API Error:', error);
    res.status(500).json({
      error: 'Failed to fetch HackerNews stories',
      message: error.message
    });
  }
};