export default async function handler(req, res) {
  console.log('🔍 Claude proxy handler called');
  console.log('  Method:', req.method);
  console.log('  URL:', req.url);
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key, anthropic-version, anthropic-beta');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    console.log('🔑 API Key check:');
    console.log('  From env:', anthropicApiKey ? `${anthropicApiKey.substring(0, 10)}...` : 'NOT SET');
    console.log('  Type:', typeof anthropicApiKey);
    console.log('  Length:', anthropicApiKey ? anthropicApiKey.length : 0);
    
    if (!anthropicApiKey) {
      console.error('❌ ANTHROPIC_API_KEY not configured');
      return res.status(500).json({ error: 'Claude API key not configured on server' });
    }

    // Extract the API path from the request
    // e.g., /api/claude/v1/messages -> /v1/messages
    const apiPath = req.url.replace('/api/claude', '');
    const anthropicUrl = `https://api.anthropic.com${apiPath}`;
    
    console.log(`🚀 Proxying Claude API request to: ${anthropicUrl}`);
    

    // Forward the request to Anthropic API
    // IMPORTANT: Always use the environment variable API key, ignore any received headers
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': anthropicApiKey,  // Always use environment variable, never the received header
      'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
    };

    // Forward any anthropic-beta headers
    if (req.headers['anthropic-beta']) {
      headers['anthropic-beta'] = req.headers['anthropic-beta'];
    }


    let response;
    try {
      response = await fetch(anthropicUrl, {
        method: req.method,
        headers,
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      });
    } catch (fetchError) {
      console.error('❌ Fetch error:', fetchError);
      return res.status(502).json({ 
        error: 'Bad Gateway', 
        message: 'Failed to connect to Claude API',
        details: fetchError.message
      });
    }

    const responseText = await response.text();
    
    console.log('📥 Response status:', response.status);
    console.log('📥 Response preview:', responseText.substring(0, 200) + '...');

    // Error check
    if (!response.ok) {
      console.error(`❌ Claude API error: ${response.status}`);
      console.error('Response:', responseText);
    }

    // Forward response headers
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-encoding' && 
          key.toLowerCase() !== 'content-length' &&
          key.toLowerCase() !== 'transfer-encoding') {
        res.setHeader(key, value);
      }
    });

    res.status(response.status).send(responseText);

  } catch (error) {
    console.error('❌ Claude proxy error:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}