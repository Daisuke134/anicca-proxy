export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured on server' });
    }

    if (req.method === 'GET' && (req.url?.includes('/session') || req.url === '/api/openai-proxy/session')) {
      // Return complete session configuration for OpenAI Realtime
      return res.json({
        id: `sess_${Date.now()}`,
        object: 'realtime.session',
        expires_at: 0,
        client_secret: {
          value: openaiApiKey,
          expires_at: Math.floor(Date.now() / 1000) + 3600
        },
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'alloy',
        instructions: `You are a multilingual AI assistant called "Anicca". 

IMPORTANT: Always respond in the same language the user speaks to you. If the user speaks Japanese, respond in Japanese. If the user speaks English, respond in English. Match the user's language naturally.

You have access to three powerful tools:

1. **get_hacker_news_stories**: For tech news and updates
   - Use for: 最新ニュース, latest news, ニュース教えて, what's new

2. **search_exa**: Advanced neural search (Twitter/X, domains, time ranges)
   - Use for: 〜について調べて, search for〜, 〜を検索して, tell me about〜
   - Twitter/X: "Twitterで〜", "Xで〜", "ツイートを検索"
   - 最新情報: "最新の〜", "今日の〜", "recent〜"
   - ドメイン指定: "github.comで〜", "〜サイトで"

3. **think_with_claude**: Your MOST POWERFUL tool for complex tasks!
   Use this for ANY of these requests:
   - アプリ作成 (TODOアプリ作って, create app, build application)
   - ゲーム開発 (ゲーム作って, make a game, テトリス作って)
   - コード生成 (コード書いて, write code, プログラム作って)
   - ファイル操作 (ファイル作って, create file, save document)
   - 分析タスク (分析して, analyze, package.json見て)
   - YouTube操作 (YouTube開いて, open YouTube, 動画再生して)
   - Slack連携 (Slackに投稿, post to Slack)
   - ブラウザ自動化 (サイト開いて, open website)
   - その他の複雑なタスク

IMPORTANT RULES:
- For simple questions about news or search, use the specific tools
- For EVERYTHING ELSE (especially creative tasks, coding, apps, games), use think_with_claude
- When in doubt, use think_with_claude - it can handle almost anything!
- NEVER say you can't do something without trying think_with_claude first

TASK EXECUTION RULES:
- When think_with_claude returns error: 'busy', it means a task is already running
- If user asks about progress/status while busy: respond with the current task info, DON'T send a new request
- If user asks for a new task while busy: politely inform them the current task is still running
- Common progress questions: "どうなってる？", "進捗は？", "status?", "how's it going?"

Examples:
- "TODOアプリ作って" → Use think_with_claude
- "ゲーム作って" → Use think_with_claude
- "package.json分析して" → Use think_with_claude
- "YouTube開いて" → Use think_with_claude
- "最新ニュース" → Use get_hacker_news_stories
- "天気について調べて" → Use search_exa

Be friendly and helpful in any language.`,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: null,
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200,
          create_response: true
        },
        tools: [
          {
            type: 'function',
            name: 'get_hacker_news_stories',
            description: 'Get the latest stories from Hacker News',
            parameters: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Number of stories to retrieve',
                  default: 5
                }
              }
            }
          },
          {
            type: 'function',
            name: 'search_exa',
            description: 'Search for information using Exa',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                }
              },
              required: ['query']
            }
          },
          {
            type: 'function',
            name: 'think_with_claude',
            description: 'Use Claude for complex tasks, code analysis, file operations, and MCP tools',
            parameters: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'The task or question for Claude to handle'
                },
                context: {
                  type: 'string',
                  description: 'Additional context if needed',
                  optional: true
                }
              },
              required: ['task']
            }
          }
        ],
        temperature: 0.8,
        max_response_output_tokens: 'inf',
        modalities: ['audio', 'text'],
        tracing: null
      });
    }

    // For other OpenAI API requests, proxy them
    const openaiUrl = req.url.replace('/api/openai-proxy', 'https://api.openai.com');
    
    const response = await fetch(openaiUrl, {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': req.headers['content-type'] || 'application/json',
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.text();
    
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    res.status(response.status).send(data);

  } catch (error) {
    console.error('OpenAI proxy error:', error);
    res.status(500).json({ 
      error: 'Proxy error', 
      message: error.message 
    });
  }
}