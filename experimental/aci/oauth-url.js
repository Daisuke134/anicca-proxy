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
    const { service, sessionId } = req.query;
    
    if (!service) {
      return res.status(400).json({ error: 'Service is required' });
    }
    
    // リダイレクトURLを決定（本番/開発環境）
    // ANICCA_WEB_URLが設定されていればそれを使用、なければlocalhostを使用
    const redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
    
    // ACIのOAuth開始エンドポイントにGETリクエスト
    const params = new URLSearchParams({
      app_name: service.toUpperCase(), // SLACK, GMAIL, etc.
      linked_account_owner_id: process.env.ACI_LINKED_ACCOUNT_OWNER_ID || 'cmboo2kkp0002c1uu0bunorf5',
      after_oauth2_link_redirect_url: redirectUrl
    });
    
    const aciOAuthUrl = `https://api.aci.dev/v1/linked-accounts/oauth2?${params}`;
    
    // OAuth URL取得リクエスト
    const oauthResponse = await fetch(aciOAuthUrl, {
      method: 'GET',
      headers: {
        'X-API-KEY': process.env.ACI_API_KEY
      }
    });
    
    if (!oauthResponse.ok) {
      const errorData = await oauthResponse.text();
      console.error('ACI OAuth error:', errorData);
      throw new Error(`Failed to start OAuth: ${oauthResponse.status}`);
    }
    
    // ACIはJSONオブジェクトとして返す
    const oauthData = await oauthResponse.json();
    const oauthUrl = oauthData.url;
    
    console.log('🔗 Generated OAuth URL:', oauthData);
    
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