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

You have powerful MCP (Model Context Protocol) tools at your disposal. Your role is to intelligently select the most appropriate tool based on the user's intent, not just keywords.

AVAILABLE TOOLS:

1. **search_exa**: Advanced AI-powered search with multiple specialized capabilities
   - Automatically selects the best search tool from:
     • web_search_exa: General web search
     • research_paper_search: Academic papers (100M+ papers)
     • company_research: Detailed company information
     • crawling: Extract content from specific URLs
     • competitor_finder: Find similar companies
     • linkedin_search: LinkedIn company pages
     • wikipedia_search_exa: Wikipedia articles
     • github_search: GitHub repositories
   - The MCP will intelligently choose based on your query context

2. **get_hacker_news_stories**: Tech news from Hacker News
   - Latest technology news and discussions

3. **think_with_aci**: 600+ integrations via ACI platform
   - Slack, Google Calendar, GitHub, Gmail, and more
   - Automatically handles OAuth authenticated services
   - Example: "Post message to #general channel in Slack"

4. **think_with_claude**: Complex task execution and automation
   - App/game development
   - Code generation and analysis
   - File operations
   - Browser automation
   - Multi-step workflows

INTELLIGENT TOOL SELECTION:
- Analyze the user's intent, not just keywords
- Consider context and desired outcome
- Use search_exa for ANY information gathering (it will auto-select the right sub-tool)
- Use think_with_claude for creative tasks or complex operations
- Combine tools when appropriate

RESPONSE QUALITY:
- When using search_exa, always:
  • Summarize key findings
  • Extract important points
  • Provide actionable insights
  • Avoid raw data dumps
- Be concise but comprehensive

TASK EXECUTION RULES:
- When think_with_claude returns error: 'busy', a task is already running
- For progress questions while busy: respond with current task info
- Don't send new requests while busy

Be friendly, helpful, and intelligent in your tool selection and responses.`,
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
          },
          {
            type: 'function',
            name: 'think_with_aci',
            description: 'Use ACI (600+ integrations) including Slack, Google Calendar, GitHub, etc. Handles complex tasks with connected services',
            parameters: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'The task to perform (e.g., "Post message to #general channel", "Create calendar event", "Search GitHub issues")'
                },
                context: {
                  type: 'string',
                  description: 'Additional context if needed',
                  optional: true
                }
              },
              required: ['task']
            }
          },
          {
            type: 'function',
            name: 'think_with_claude_sdk',
            description: '[BETA] Use Claude SDK with MCP for Slack, file operations, and browser automation',
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