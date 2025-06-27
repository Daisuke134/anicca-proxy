// Slack投稿用のツール
// MCPの代わりに直接Slack APIを使用

module.exports = async (req, res) => {
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
    // 両方の形式に対応
    let channel, message;
    
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    
    if (req.body.arguments) {
      // デスクトップ版形式
      const args = typeof req.body.arguments === 'string' 
        ? JSON.parse(req.body.arguments) 
        : req.body.arguments;
      channel = args.channel;
      message = args.message;
      console.log('🔧 Using arguments format - channel:', channel);
    } else {
      // Web版形式
      channel = req.body.channel;
      message = req.body.message;
      console.log('🔧 Using direct format - channel:', channel);
    }
    
    if (!channel || !message) {
      return res.status(400).json({ error: 'Channel and message are required' });
    }
    
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken) {
      return res.status(500).json({ error: 'Slack bot token not configured' });
    }
    
    // Slack APIで投稿
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel: channel,
        text: message,
        mrkdwn: true
      })
    });
    
    const data = await response.json();
    console.log('🚀 Slack API response:', JSON.stringify(data, null, 2));
    
    if (!data.ok) {
      throw new Error(data.error || 'Slack API error');
    }
    
    const result = {
      success: true,
      channel: data.channel,
      ts: data.ts,
      message: message
    };
    
    console.log('✅ Message posted to Slack successfully');
    res.status(200).json(result);
    
  } catch (error) {
    console.error('Slack API Error:', error);
    res.status(500).json({
      error: 'Failed to post to Slack',
      message: error.message
    });
  }
};