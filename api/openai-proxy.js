// 動的にツールを生成する関数
async function generateDynamicTools() {
  const tools = [];
  
  // 接続済みサービスを確認
  const hasSlack = !!(global.slackBotToken || process.env.SLACK_BOT_TOKEN);
  
  // Slackが接続されている場合
  if (hasSlack) {
    tools.push({
      type: 'function',
      name: 'slack_send_message',
      description: 'Send a message to a Slack channel',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel name (e.g., "#general") or channel ID'
          },
          message: {
            type: 'string',
            description: 'The message to send'
          }
        },
        required: ['channel', 'message']
      }
    });
    
    tools.push({
      type: 'function',
      name: 'slack_list_channels',
      description: 'List all channels in the Slack workspace',
      parameters: {
        type: 'object',
        properties: {}
      }
    });
    
    tools.push({
      type: 'function',
      name: 'slack_get_channel_history',
      description: 'Get recent messages from a Slack channel',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel name or ID'
          },
          limit: {
            type: 'number',
            description: 'Number of messages to retrieve (default: 10)',
            optional: true
          }
        },
        required: ['channel']
      }
    });
  }
  
  // 基本ツール（常に利用可能）
  tools.push({
    type: 'function',
    name: 'get_hacker_news_stories',
    description: 'Get the latest technology and startup news from Hacker News (tech news only)',
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
  });
  
  tools.push({
    type: 'function',
    name: 'search_exa',
    description: 'Advanced search using Exa - automatically selects the best search type: web search, research papers, company info, GitHub repos, Wikipedia, LinkedIn, or crawl specific URLs',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - Exa will automatically choose the best search type based on your query'
        }
      },
      required: ['query']
    }
  });
  
  tools.push({
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
  });
  
  return tools;
}

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
      // 接続済みサービスを確認
      const hasSlack = !!(global.slackBotToken || process.env.SLACK_BOT_TOKEN);
      
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

You have powerful MCP (Model Context Protocol) tools at your disposal. Your role is to intelligently select the most appropriate tool based on the user's intent, not just keywords.

AVAILABLE TOOLS:

${hasSlack ? `1. **Slack Tools** (Your Slack workspace is connected!):
   - slack_send_message: Send messages to any channel
   - slack_list_channels: List all channels in your workspace  
   - slack_get_channel_history: Get recent messages from a channel
   
   IMPORTANT SLACK GUIDELINES:
   - Always use channel names (e.g., "#general", "#ai") NOT channel IDs
   - When sending messages, if a channel name is not found, ALWAYS:
     1. First use slack_list_channels to get all available channels
     2. Find channels with similar names (e.g., "ai-channel" → "ai", "general-chat" → "general")
     3. Suggest the most likely match to the user
   - Be flexible with channel names - users might say "AI channel", "#ai-channel", or just "ai"
   - The tool results contain valuable information - analyze them carefully to help the user
   
   Examples:
   - User: "Send to AI channel" → First list channels, find "#ai", use "#ai" (NOT the ID)
   - User: "Post in general" → Use "#general" directly

` : ''}2. **search_exa**: Advanced search that automatically chooses the best search type
   - Just tell me what you're looking for, and I'll automatically use:
     • General web search for news, current events, general information
     • Academic search for research papers and studies
     • Company search for business information
     • GitHub search for code repositories
     • Wikipedia for encyclopedic information
     • LinkedIn for professional/company profiles
     • URL crawling to extract content from specific pages
   - Examples:
     • "Latest news about AI" → Web search
     • "Research papers on quantum computing" → Academic search
     • "Apple company information" → Company search
     • "React GitHub repository" → GitHub search

3. **get_hacker_news_stories**: Technology and startup news ONLY
   - For tech industry news, programming, startups
   - NOT for general news (use search_exa instead)

4. **think_with_claude**: Use Claude for complex reasoning, code analysis, and file operations
   - Best for: Complex tasks, code generation, detailed analysis
   - Has access to additional MCP tools for files and browser automation

TOOL SELECTION GUIDELINES:
- For connected services (${hasSlack ? 'like Slack' : 'when available'}), use their specific tools
- For information searches, use search_exa
- For tech news, use get_hacker_news_stories  
- For complex reasoning or code tasks, use think_with_claude
- ALWAYS analyze tool results before proceeding to the next action

Remember: You can see visual information on the user's screen when they share it, allowing you to provide context-aware assistance with their applications and content.`,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: { 
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200,
          create_response: true
        },
        tools: await generateDynamicTools(),
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