import { getSlackTokensForUser } from '../services/database.js';

// 動的にツールを生成する関数
async function generateDynamicTools(userId = null) {
  const tools = [];
  
  // 接続済みサービスを確認
  let hasSlack = false;
  if (userId) {
    const slackTokens = await getSlackTokensForUser(userId);
    hasSlack = !!(slackTokens && slackTokens.bot_token);
  } else {
    // フォールバック（後方互換性のため）
    hasSlack = !!(global.slackBotToken || process.env.SLACK_BOT_TOKEN);
  }
  
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
    name: 'claude_code',
    description: 'Use Claude Code for complex tasks, code analysis, file operations, browser automation, and MCP tools',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task or question for Claude Code to handle'
        },
        context: {
          type: 'string',
          description: 'Additional context if needed',
          optional: true
        },
        userId: {
          type: 'string',
          description: 'User ID for Slack integration (Supabase user ID)',
          optional: true
        }
      },
      required: ['task']
    }
  });
  
  // Playwrightツールを追加
  tools.push({
    type: 'function',
    name: 'playwright_navigate',
    description: 'Navigate to a URL in the browser',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to'
        }
      },
      required: ['url']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'playwright_click',
    description: 'Click on an element in the browser',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector or text content to click'
        }
      },
      required: ['selector']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'playwright_type',
    description: 'Type text into an input field',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the input field'
        },
        text: {
          type: 'string',
          description: 'Text to type'
        }
      },
      required: ['selector', 'text']
    }
  });
  
  tools.push({
    type: 'function',
    name: 'playwright_screenshot',
    description: 'Take a screenshot of the current page',
    parameters: {
      type: 'object',
      properties: {
        fullPage: {
          type: 'boolean',
          description: 'Whether to capture the full page',
          optional: true
        }
      }
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
      // URLからuserIdを取得
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = url.searchParams.get('userId');
      
      // 接続済みサービスを確認
      let hasSlack = false;
      if (userId) {
        const slackTokens = await getSlackTokensForUser(userId);
        hasSlack = !!(slackTokens && slackTokens.bot_token);
        
        // userIdベースのトークンをリクエストコンテキストに保存
        if (slackTokens) {
          req.userSlackTokens = slackTokens;
        }
      } else {
        // フォールバック（後方互換性のため）
        hasSlack = !!(global.slackBotToken || process.env.SLACK_BOT_TOKEN);
      }
      
      // セッションIDを生成し、userIdと関連付ける
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // セッションとuserIdの関連付けをグローバルに保存（メモリ内）
      if (!global.sessionUserMap) {
        global.sessionUserMap = {};
      }
      if (userId) {
        global.sessionUserMap[sessionId] = { userId, slackTokens: req.userSlackTokens };
      }
      
      // Return complete session configuration for OpenAI Realtime
      return res.json({
        id: sessionId,
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
   - You can handle simple Slack tasks yourself using these tools
   - ONLY delegate to Claude SDK if the user explicitly says:
     * "Claude でこれを送って" (Send this with Claude)
     * "SDK でスラックして" (Use SDK for Slack)
     * "Claude に頼んで" (Ask Claude to do it)
     * Similar explicit requests mentioning Claude or SDK
   
   - Always use channel names (e.g., "#general", "#ai") NOT channel IDs
   - Default channel for reports: #anicca_report (create if it doesn't exist)
   - When sending messages, if a channel name is not found, ALWAYS:
     1. First use slack_list_channels to get all available channels
     2. Find channels with similar names (e.g., "ai-channel" → "ai", "general-chat" → "general")
     3. Suggest the most likely match to the user
   - Be flexible with channel names - users might say "AI channel", "#ai-channel", or just "ai"
   - The tool results contain valuable information - analyze them carefully to help the user
   
   Examples:
   - User: "Slackに送って" → YOU handle it directly with slack_send_message
   - User: "クロードでSlackに送って" → Delegate to claude_code
   - User: "Send to AI channel" → First list channels, find "#ai", use "#ai" (NOT the ID)

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

4. **Browser Tools** (You can control browsers directly!):
   - playwright_navigate: Navigate to any URL
   - playwright_click: Click on elements
   - playwright_type: Type text into fields
   - playwright_screenshot: Take screenshots
   
   BROWSER OPERATION GUIDELINES:
   - Handle simple browser tasks yourself using these tools
   - Examples of what YOU should do:
     * "Open YouTube" → Use playwright_navigate
     * "Search for music" → Use playwright_type
     * "Play a video" → Use playwright_click
   - ONLY delegate to Claude SDK when:
     * User explicitly says "Claude でブラウザ操作して" or "Use SDK for browsing"
     * Task involves 30+ minutes of complex automation
     * Multiple complex sites with intricate workflows

5. **claude_code**: Use Claude Code for complex tasks, code analysis, file operations
   - Best for: Complex tasks, code generation, detailed analysis
   - Use when user explicitly requests "Claude" or "SDK" to handle something
   - Use for tasks requiring file system access or code execution

TOOL SELECTION GUIDELINES:
- For connected services (${hasSlack ? 'like Slack' : 'when available'}), use their specific tools DIRECTLY
- For browser operations, use playwright tools DIRECTLY (unless explicitly asked for Claude)
- Only delegate to claude_code when:
  * User explicitly mentions "Claude" or "SDK" 
  * Task requires file system access or code execution
  * Task is too complex for direct tool usage
- For searches, choose the appropriate search tool based on content type
- For tech news specifically, use get_hacker_news_stories  
- ALWAYS analyze tool results before proceeding to the next action

Remember: You can see visual information on the user's screen when they share it, allowing you to provide context-aware assistance with their applications and content.

TASK FORMATTING FOR CLAUDE CODE (重要):
- When sending multiple tasks to claude_code, ALWAYS format them as a numbered list
- Example format:
  "1. TODOアプリを作成してプレビューリンクを生成
   2. 聖書の言葉を検索してSlackに投稿
   3. 最新のAIニュースを検索してまとめる"
- NEVER send the same tasks separately - combine them into ONE request
- If user mentions multiple things in one sentence, analyze and list them all
- Even if user doesn't explicitly number tasks, YOU must number them
- This helps Claude Code distribute tasks to multiple Workers efficiently

WORKER ASSIGNMENT AND FILE NAMING RULES:
- If user mentions specific Worker (Worker1, Worker2, Worker3, etc.), include it IN THE TASK:
  * User: "Worker3にmemo作って" → Task: "Worker3に割り当てて、memoファイルを作成してください"
  * User: "Worker1でTODOアプリ" → Task: "Worker1に割り当てて、TODOアプリを作成してください"
- ALWAYS use English filenames:
  * "メモ.txt" → "memo.txt"
  * "タスク管理.html" → "task-manager.html"
  * "カレンダー.js" → "calendar.js"
- Do NOT use the context field - put everything in the task field

CRITICAL CHANNEL RULE FOR CLAUDE CODE:
- If NO channel is specified → ALWAYS use #anicca_report
- If channel doesn't exist → ALWAYS fallback to #anicca_report
- When sending to Claude Code, ALWAYS include explicit channel:
  * "聖書の言葉を送って" → Add "（#anicca_reportチャンネルに送信してください）"
  * "TODOアプリ作って" → Add "（完成したら#anicca_reportに報告してください）"
  * "ニュースを検索して" → Add "（結果を#anicca_reportに投稿してください）"
- The ONLY acceptable default is #anicca_report
- Only use other channels if explicitly specified by user

STRICT DUPLICATE PREVENTION (強化版):
- Track ALL requests sent to claude_code in the last 5 minutes
- Before sending ANY request to claude_code, check for similar keywords:
  * Task keywords: "アプリ", "作成", "作って", "Slack", "送信", "投稿", etc.
  * If 80%+ similarity detected, DO NOT send again
- Response strategy for duplicates:
  * 1st duplicate: "その依頼は既に実行中です。少々お待ちください。"
  * 2nd duplicate: "現在処理中です。完了まで約[X]分かかります。"
  * 3rd+ duplicate: Ignore completely, don't respond about the duplicate
- Keywords memory: Remember exact phrases user used for tasks
- Only reset memory after task completion confirmation
- User saying "もう一回" or "retry" or "やり直して" = OK to resend`,
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
        tools: await generateDynamicTools(userId),
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