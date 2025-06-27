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
    
    // ACIのOAuth開始エンドポイントにPOSTリクエスト
    const aciOAuthUrl = 'https://api.aci.dev/v1/linked-accounts/oauth2';
    
    // コールバックURLを構築（https://を含める）
    const callbackUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api/aci/oauth-callback`
      : 'https://anicca-proxy-production.up.railway.app/api/aci/oauth-callback';
    
    // OAuth開始リクエストを送信
    const oauthResponse = await fetch(aciOAuthUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ACI_API_KEY}`
      },
      body: JSON.stringify({
        app_name: service,
        redirect_uri: callbackUrl,
        state: JSON.stringify({
          sessionId: sessionId || generateSessionId(),
          service: service,
          timestamp: Date.now()
        })
      })
    });
    
    if (!oauthResponse.ok) {
      const errorData = await oauthResponse.text();
      console.error('ACI OAuth error:', errorData);
      throw new Error(`Failed to start OAuth: ${oauthResponse.status}`);
    }
    
    const oauthData = await oauthResponse.json();
    const oauthUrl = oauthData.authorization_url || oauthData.url;
    
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