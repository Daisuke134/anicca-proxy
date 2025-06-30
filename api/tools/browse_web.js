import { ClaudeExecutorService } from '../../services/claudeExecutorService.js';
import { getSlackTokensForUser } from '../../services/database.js';

// Browser contextのデータベース操作
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://mzkwtwourrkduqkrsxpc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

export default async function handler(req, res) {
  console.log('🌐 Browse web tool called');
  
  // Enable CORS
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
    const { arguments: args } = req.body;
    let task, userId;
    
    // Handle both string and object arguments
    if (typeof args === 'string') {
      const parsedArgs = JSON.parse(args);
      task = parsedArgs.task;
      userId = parsedArgs.userId;
    } else {
      task = args.task;
      userId = args.userId;
    }
    
    console.log('🔧 Browse web request:', { task, userId });
    
    // Get user's browser context for the site
    let browserContext = null;
    if (userId && supabase) {
      // Determine which site we're working with
      const site = detectSite(task);
      
      if (site) {
        const { data } = await supabase
          .from('browser_contexts')
          .select('*')
          .eq('user_id', userId)
          .eq('site', site)
          .single();
        
        browserContext = data;
        console.log('📦 Found browser context:', browserContext ? 'Yes' : 'No');
      }
    }
    
    // Get user preferences
    let userPreferences = {};
    if (userId && supabase) {
      const { data } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId);
      
      if (data) {
        data.forEach(pref => {
          userPreferences[pref.key] = pref.value;
        });
      }
      console.log('⭐ User preferences loaded:', Object.keys(userPreferences).length);
    }
    
    // Initialize Claude Executor Service with browser MCP
    const service = new ClaudeExecutorService();
    
    // Configure browser MCP
    const mcpServers = {
      browserbase: {
        command: "npx",
        args: ["@browserbasehq/mcp"],
        env: {
          BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
          BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID
        }
      }
    };
    
    service.setMcpServers(mcpServers);
    
    // Prepare the enhanced prompt with context and preferences
    let enhancedPrompt = task;
    
    if (browserContext) {
      enhancedPrompt += `\n\n【ブラウザコンテキスト】\nContext ID: ${browserContext.context_id}\nこのコンテキストを使用してセッションを開始してください。`;
    }
    
    if (Object.keys(userPreferences).length > 0) {
      enhancedPrompt += `\n\n【ユーザーの好み】\n`;
      for (const [key, value] of Object.entries(userPreferences)) {
        enhancedPrompt += `- "${key}": ${JSON.stringify(value)}\n`;
      }
    }
    
    // Also check for Slack tokens to enable progress reporting
    const slackTokens = await getSlackTokensForUser(userId);
    if (slackTokens) {
      service.setSlackTokens(slackTokens);
    }
    
    // Execute the browser task
    const result = await service.executeGeneralRequest({
      type: 'general',
      reasoning: `Browse web: ${task}`,
      parameters: {
        query: enhancedPrompt
      }
    });
    
    // Save any new context if created
    if (result.messages) {
      await saveNewContextIfNeeded(result.messages, userId, supabase);
    }
    
    console.log('✅ Browse web completed');
    
    res.status(200).json({
      result: result.text || 'Browser task completed',
      messages: result.messages
    });
    
  } catch (error) {
    console.error('❌ Browse web error:', error);
    res.status(500).json({
      error: 'Failed to execute browser task',
      message: error.message
    });
  }
}

// Helper function to detect which site we're working with
function detectSite(task) {
  const taskLower = task.toLowerCase();
  if (taskLower.includes('amazon') || taskLower.includes('アマゾン')) return 'amazon';
  if (taskLower.includes('youtube') || taskLower.includes('ユーチューブ')) return 'youtube';
  if (taskLower.includes('google')) return 'google';
  if (taskLower.includes('twitter') || taskLower.includes('x.com')) return 'twitter';
  return null;
}

// Helper function to save new context if created
async function saveNewContextIfNeeded(messages, userId, supabase) {
  if (!userId || !supabase) return;
  
  // Look for context creation in messages
  for (const message of messages) {
    if (message.type === 'tool_use' && 
        message.tool === 'browserbase_create_session' && 
        message.result?.contextId) {
      
      const site = detectSite(message.reasoning || '');
      if (site) {
        await supabase
          .from('browser_contexts')
          .upsert({
            user_id: userId,
            site: site,
            context_id: message.result.contextId,
            metadata: {}
          });
        
        console.log('💾 Saved new browser context for', site);
      }
    }
  }
}