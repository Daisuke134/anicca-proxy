import { slackMcpService } from '../../services/slackMcpService.js';

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
    
    // Slack MCPサービスを使用
    let result;
    
    switch (action) {
      case 'send_message':
        result = await slackMcpService.callTool('slack_send_message', {
          channel: args.channel,
          text: args.message || args.text
        });
        break;
        
      case 'list_channels':
        result = await slackMcpService.callTool('slack_list_channels', {});
        break;
        
      case 'get_channel_history':
        result = await slackMcpService.callTool('slack_get_channel_history', {
          channel: args.channel,
          limit: args.limit || 10
        });
        break;
        
      case 'add_reaction':
        result = await slackMcpService.callTool('slack_add_reaction', {
          channel: args.channel,
          timestamp: args.timestamp,
          name: args.name
        });
        break;
        
      default:
        // 直接ツール名を指定
        if (args.tool_name) {
          result = await slackMcpService.callTool(args.tool_name, args.tool_args || {});
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