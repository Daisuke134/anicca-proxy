export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const connectedServices = [];
    
    // Slackが接続されているかチェック
    if (global.slackBotToken || process.env.SLACK_BOT_TOKEN) {
      connectedServices.push({
        id: 'slack',
        name: 'Slack',
        connected: true,
        tools: [
          {
            name: 'slack_send_message',
            description: 'Send a message to a Slack channel',
            parameters: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description: 'Channel name or ID (e.g., "#general" or "C1234567890")'
                },
                message: {
                  type: 'string',
                  description: 'The message text to send'
                }
              },
              required: ['channel', 'message']
            }
          },
          {
            name: 'slack_list_channels',
            description: 'List all channels in the Slack workspace',
            parameters: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'slack_get_channel_history',
            description: 'Get recent messages from a channel',
            parameters: {
              type: 'object',
              properties: {
                channel: {
                  type: 'string',
                  description: 'Channel name or ID'
                },
                limit: {
                  type: 'number',
                  description: 'Number of messages to retrieve (default: 10)'
                }
              },
              required: ['channel']
            }
          }
        ]
      });
    }
    
    // 将来的に他のサービスもここに追加
    // if (global.githubToken) { ... }
    // if (global.googleToken) { ... }
    
    return res.status(200).json({
      success: true,
      services: connectedServices
    });
    
  } catch (error) {
    console.error('Connected services error:', error);
    res.status(500).json({
      error: 'Failed to get connected services',
      message: error.message
    });
  }
}