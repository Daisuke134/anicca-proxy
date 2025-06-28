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
    
    // Slackの接続状態を確認（トークンの存在で判定）
    if (global.slackBotToken || process.env.SLACK_BOT_TOKEN) {
      connectedServices.push('slack');
    }
    
    // 他のサービスは未実装
    // TODO: Gmail, GitHub, Google Calendar
    
    return res.status(200).json({
      success: true,
      connectedServices: connectedServices,
      availableServices: ['slack', 'google-calendar', 'github', 'gmail']
    });
    
  } catch (error) {
    console.error('Connected services error:', error);
    res.status(500).json({
      error: 'Failed to get connected services',
      message: error.message
    });
  }
}