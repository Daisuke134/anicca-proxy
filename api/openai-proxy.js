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
  
  // Exaの8つの検索ツールを個別に登録（MCPツール名をそのまま使用）
  tools.push({
    type: 'function',
    name: 'web_search_exa',
    description: 'General web search for news, current events, and general information',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for general web content'
        }
      },
      required: ['query']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'research_paper_search',
    description: 'Search academic research papers and scientific studies',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for academic papers'
        }
      },
      required: ['query']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'company_research',
    description: 'Search for company information and business details',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Company name or business-related query'
        }
      },
      required: ['query']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'github_search',
    description: 'Search GitHub repositories and code',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Repository name, code, or GitHub-related query'
        }
      },
      required: ['query']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'wikipedia_search_exa',
    description: 'Search Wikipedia for encyclopedic information',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Topic or subject to search on Wikipedia'
        }
      },
      required: ['query']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'linkedin_search',
    description: 'Search LinkedIn for professional profiles and company pages',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Person name, company, or professional query'
        }
      },
      required: ['query']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'crawling',
    description: 'Extract and analyze content from a specific URL',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to crawl and extract content from'
        }
      },
      required: ['url']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'competitor_finder',
    description: 'Find similar companies or competitors',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Company name to find competitors for'
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

` : ''}2. **Search Tools** (powered by Exa):
   - **web_search_exa**: General web search for news, current events, general info
   - **research_paper_search**: Academic research papers and scientific studies
   - **company_research**: Company information and business details
   - **github_search**: GitHub repositories and code
   - **wikipedia_search_exa**: Encyclopedia articles and reference information
   - **linkedin_search**: Professional profiles and company pages
   - **crawling**: Extract content from a specific URL
   - **competitor_finder**: Find similar companies or competitors
   
   Examples:
   - "Latest AI news" → I'll use web_search_exa
   - "Research on quantum computing" → I'll use research_paper_search
   - "Apple company details" → I'll use company_research
   - "React repository" → I'll use github_search
   - "John Doe LinkedIn" → I'll use linkedin_search

3. **get_hacker_news_stories**: Technology and startup news ONLY
   - For tech industry news, programming, startups
   - NOT for general news (use web_search_exa instead)

4. **think_with_claude**: Use Claude for complex reasoning, code analysis, and file operations
   - Best for: Complex tasks, code generation, detailed analysis
   - Has access to additional MCP tools for files and browser automation

TOOL SELECTION GUIDELINES:
- For connected services (${hasSlack ? 'like Slack' : 'when available'}), use their specific tools
- For searches, choose the appropriate search tool based on content type
- For tech news specifically, use get_hacker_news_stories  
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