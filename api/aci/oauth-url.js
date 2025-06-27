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
    const { service, sessionId } = req.body;
    
    if (!service) {
      return res.status(400).json({ error: 'Service is required' });
    }
    
    // ACIのOAuth URLを生成
    // ACIドキュメントによると、以下のフォーマット
    const baseUrl = 'https://api.aci.dev/v1/linked-accounts/oauth2/authorize';
    
    // パラメータを構築
    const params = new URLSearchParams({
      app_name: service,
      // セッションIDまたはユーザー識別子を state に含める
      state: JSON.stringify({
        sessionId: sessionId || generateSessionId(),
        service: service,
        timestamp: Date.now()
      }),
      // コールバックURL（Railway環境）
      redirect_uri: `${process.env.RAILWAY_PUBLIC_DOMAIN || 'https://anicca-proxy-slack-production.up.railway.app'}/api/aci/oauth-callback`
    });
    
    const oauthUrl = `${baseUrl}?${params.toString()}`;
    
    console.log('🔗 Generated OAuth URL:', oauthUrl);
    
    return res.status(200).json({
      success: true,
      oauthUrl: oauthUrl,
      service: service
    });
    
  } catch (error) {
    console.error('OAuth URL generation error:', error);
    res.status(500).json({
      error: 'Failed to generate OAuth URL',
      message: error.message
    });
  }
}

function generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}