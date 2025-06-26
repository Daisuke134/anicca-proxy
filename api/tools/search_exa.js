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
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const exaApiKey = process.env.EXA_API_KEY;
    if (!exaApiKey) {
      throw new Error('EXA_API_KEY is not configured');
    }
    
    // Exa APIで検索
    const response = await fetch(
      'https://api.exa.ai/search',
      {
        method: 'POST',
        headers: {
          'x-api-key': exaApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: query,
          num_results: 5,
          type: 'neural',
          use_autoprompt: true
        })
      }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Exa API error');
    }
    
    const results = data.results.map(result => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet || result.text?.substring(0, 200) + '...'
    }));
    
    res.status(200).json({
      success: true,
      query: query,
      results: results
    });
    
  } catch (error) {
    console.error('Exa API Error:', error);
    res.status(500).json({
      error: 'Failed to search with Exa',
      message: error.message
    });
  }
};