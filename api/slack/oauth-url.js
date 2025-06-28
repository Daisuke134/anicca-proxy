import { installer } from '../../services/slackOAuthService.js';

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
    
    // OAuth URLを生成
    const url = await installer.generateInstallUrl({
      scopes: [
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
      ],
      metadata: sessionId ? JSON.stringify({ sessionId }) : undefined,
      redirectUri: process.env.SLACK_REDIRECT_URI || 'http://localhost:3000/api/slack/oauth-callback'
    });
    
    console.log('🔗 Generated Slack OAuth URL');
    
    return res.status(200).json({
      success: true,
      url: url
    });
    
  } catch (error) {
    console.error('Slack OAuth URL generation error:', error);
    res.status(500).json({
      error: 'Failed to generate OAuth URL',
      message: error.message
    });
  }
}