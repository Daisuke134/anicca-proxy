export default async function handler(req, res) {
  // CORSプリフライト対応
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // POSTメソッドのみ許可
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 環境変数からAPIキーを取得
    const API_KEY = process.env.GEMINI_API_KEY;
    
    if (!API_KEY) {
      console.error('GEMINI_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // リクエストボディから必要な情報を取得
    const { endpoint, data } = req.body;
    
    if (!endpoint || !data) {
      return res.status(400).json({ error: 'Missing endpoint or data' });
    }

    // Gemini APIのベースURL
    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    const fullUrl = `${baseUrl}${endpoint}?key=${API_KEY}`;
    
    console.log(`Proxying request to: ${endpoint}`);

    // Gemini APIへリクエスト
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    // レスポンスのテキストを取得
    const responseText = await response.text();

    // エラーチェック
    if (!response.ok) {
      console.error(`Gemini API error: ${response.status} - ${responseText}`);
      return res.status(response.status).json({ 
        error: 'Gemini API error', 
        details: responseText 
      });
    }

    // 成功レスポンス
    try {
      const responseData = JSON.parse(responseText);
      return res.status(200).json(responseData);
    } catch (parseError) {
      // JSONパースエラーの場合はテキストをそのまま返す
      return res.status(200).send(responseText);
    }

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}