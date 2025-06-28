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
    const { sessionId } = req.query;
    
    // Slack OAuth URLを直接構築
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = process.env.SLACK_REDIRECT_URI || 'https://anicca-proxy-production.up.railway.app/api/slack/oauth-callback';
    
    // シンプルなstate生成（sessionIdを含める）
    const state = sessionId || Math.random().toString(36).substring(2, 15);
    
    // 必要なスコープ
    const scopes = [
      'channels:read',
      'channels:history',
      'chat:write',
      'groups:read',
      'groups:history',
      'im:read',
      'im:history',
      'users:read',
      'reactions:read',
      'reactions:write'
    ].join(',');
    
    // OAuth URLを構築
    const oauthUrl = `https://slack.com/oauth/v2/authorize?` +
      `client_id=${clientId}&` +
      `scope=${scopes}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;
    
    console.log('🔗 Generated Slack OAuth URL (Simple)');
    
    return res.status(200).json({
      success: true,
      url: oauthUrl
    });
    
  } catch (error) {
    console.error('Slack OAuth URL generation error:', error);
    res.status(500).json({
      error: 'Failed to generate OAuth URL',
      message: error.message
    });
  }
}