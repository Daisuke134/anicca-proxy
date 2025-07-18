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
    const { sessionId, userId, platform } = req.query;
    
    // Slack OAuth URLを直接構築
    const clientId = process.env.SLACK_CLIENT_ID;
    // 動的にリダイレクトURIを生成（環境に応じて自動判定）
    const host = req.headers.host || 'anicca-proxy-staging.up.railway.app';
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const redirectUri = `${protocol}://${host}/api/slack/oauth-callback`;
    
    // デバッグログ
    console.log('🔍 OAuth URL generation debug:');
    console.log('  - referer:', req.headers.referer);
    console.log('  - redirectUrl query:', req.query.redirectUrl);
    
    // stateを生成（sessionIdとuserIdを含める）
    let state;
    if (userId || platform === 'desktop') {
      // userIdがある場合、またはDesktop版の場合は、JSON形式でstateを作成
      // リダイレクトURLも含める（開発環境対応）
      const stateData = { 
        sessionId: sessionId || Math.random().toString(36).substring(2, 15), 
        userId: userId || (platform === 'desktop' ? 'desktop-user' : null),
        platform: platform || 'web',
        redirectUrl: req.headers.referer || req.query.redirectUrl || undefined
      };
      console.log('  - stateData to be sent:', stateData);
      state = JSON.stringify(stateData);
    } else {
      // 後方互換性のため、sessionIdのみの場合は単純な文字列
      state = sessionId || Math.random().toString(36).substring(2, 15);
    }
    
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
    
    // User Token Scopes（ユーザーとして操作）
    const userScopes = [
      'channels:read',
      'channels:history',
      'chat:write',
      'groups:read',
      'groups:history',
      'im:read',
      'users:read'
    ].join(',');
    
    // OAuth URLを構築
    const oauthUrl = `https://slack.com/oauth/v2/authorize?` +
      `client_id=${clientId}&` +
      `scope=${scopes}&` +
      `user_scope=${userScopes}&` +  // User scopeを追加
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${encodeURIComponent(state)}`;
    
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