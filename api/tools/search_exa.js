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
    // 両方の形式に対応
    let query;
    
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    
    if (req.body.arguments) {
      // デスクトップ版形式: { arguments: { query: "..." } }
      const args = typeof req.body.arguments === 'string' 
        ? JSON.parse(req.body.arguments) 
        : req.body.arguments;
      query = args.query;
      console.log('🔧 Using arguments format - query:', query);
    } else {
      // Web版形式: { query: "..." }
      query = req.body.query;
      console.log('🔧 Using direct format - query:', query);
    }
    
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
    console.log('🌐 Exa API response:', JSON.stringify(data, null, 2));
    
    if (!response.ok) {
      throw new Error(data.error || 'Exa API error');
    }
    
    const results = data.results.map(result => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet || result.text?.substring(0, 200) + '...'
    }));
    
    const responseData = {
      success: true,
      query: query,
      results: results
    };
    
    console.log('✅ Returning response:', JSON.stringify(responseData, null, 2));
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Exa API Error:', error);
    res.status(500).json({
      error: 'Failed to search with Exa',
      message: error.message
    });
  }
};