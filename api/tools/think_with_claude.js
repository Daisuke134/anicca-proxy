module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { arguments: args } = req.body;
    
    if (!args || !args.task) {
      return res.status(400).json({ error: 'Task is required' });
    }

    // Claude APIを呼び出し
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!claudeApiKey) {
      return res.status(500).json({ error: 'Claude API key not configured' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${claudeApiKey}`,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `あなたは「Anicca」という音声AIアシスタントです。以下のタスクを実行してください：

${args.task}

以下のルールに従ってください：
- 日本語で返答してください
- 具体的で実行可能な回答をしてください
- 必要に応じてSlackへの投稿、ファイル作成、ブラウザ操作などの指示を含めてください
- 簡潔で分かりやすい回答を心がけてください

${args.context ? `追加のコンテキスト: ${args.context}` : ''}`
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      return res.status(response.status).json({ 
        error: 'Claude API error', 
        details: errorText 
      });
    }

    const data = await response.json();
    const result = data.content[0].text;

    return res.json({
      success: true,
      result: result,
      task: args.task
    });

  } catch (error) {
    console.error('think_with_claude error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}; 