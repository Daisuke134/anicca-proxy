import { aciMcpService } from '../../services/aciMcpService.js';

// MCPサービスの初期化状態を管理
let isInitialized = false;

export default async function handler(req, res) {
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
    const { action, arguments: args } = req.body;
    
    console.log('🔧 Slack tool request:', { action, args });
    
    // MCPサービスを初期化（初回のみ）
    if (!isInitialized) {
      console.log('📡 Initializing MCP service for Slack...');
      await aciMcpService.initialize();
      isInitialized = true;
    }
    
    // アクションに応じて適切なSlack関数を実行
    let result;
    
    switch (action) {
      case 'send_message':
        // SLACK__SEND_CHAT_MESSAGE を実行
        result = await aciMcpService.executeFunction(
          'SLACK',
          'SEND_CHAT_MESSAGE',
          {
            channel: args.channel,
            message: args.message
          }
        );
        break;
        
      case 'list_channels':
        // SLACK__LIST_CHANNELS を実行
        result = await aciMcpService.executeFunction(
          'SLACK',
          'LIST_CHANNELS',
          {}
        );
        break;
        
      case 'search_user':
        // SLACK__SEARCH_USER を実行
        result = await aciMcpService.executeFunction(
          'SLACK',
          'SEARCH_USER',
          {
            query: args.query
          }
        );
        break;
        
      default:
        // 汎用的な実行（function_nameを直接指定）
        if (args.function_name) {
          result = await aciMcpService.executeFunction(
            'SLACK',
            args.function_name.replace('SLACK__', ''),
            args.function_args || {}
          );
        } else {
          throw new Error(`Unknown action: ${action}`);
        }
    }
    
    console.log('✅ Slack function executed successfully');
    
    return res.status(200).json({
      success: true,
      result: result
    });
    
  } catch (error) {
    console.error('❌ Slack tool execution error:', error);
    res.status(500).json({
      error: 'Failed to execute Slack function',
      message: error.message
    });
  }
}