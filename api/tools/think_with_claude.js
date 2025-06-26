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
    // 両方の形式に対応
    let task, context;
    
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    
    if (req.body.arguments) {
      // デスクトップ版形式: { arguments: { task: "...", context: "..." } }
      const args = typeof req.body.arguments === 'string' 
        ? JSON.parse(req.body.arguments) 
        : req.body.arguments;
      task = args.task;
      context = args.context;
      console.log('🔧 Using arguments format - task:', task);
    } else {
      // Web版形式: { task: "...", context: "..." }
      task = req.body.task;
      context = req.body.context;
      console.log('🔧 Using direct format - task:', task);
    }
    
    if (!task) {
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
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `あなたは「Anicca」という音声AIアシスタントです。以下のタスクを実行してください：

${task}
${context ? `\n追加コンテキスト: ${context}` : ''}

以下のルールに従ってください：
- 日本語で返答してください
- 具体的で実行可能な回答をしてください
- 必要に応じてSlackへの投稿、ファイル作成、ブラウザ操作などの指示を含めてください
- 簡潔で分かりやすい回答を心がけてください

`
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
    console.log('🤖 Claude response:', JSON.stringify(data, null, 2));
    
    const result = data.content[0].text;
    console.log('✅ Returning result:', result.substring(0, 100) + '...');

    return res.json({
      success: true,
      result: result,
      task: task,
      response: result  // OpenAI形式との互換性
    });

  } catch (error) {
    console.error('think_with_claude error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
}; 