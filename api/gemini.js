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

    // リクエストボディサイズチェック（Vercel制限: 4.5MB）
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxSize = 4.5 * 1024 * 1024; // 4.5MB
    
    if (contentLength > maxSize) {
      console.error(`Request too large: ${(contentLength / 1024 / 1024).toFixed(2)}MB`);
      return res.status(413).json({ 
        error: 'Request Entity Too Large',
        message: `Request size ${(contentLength / 1024 / 1024).toFixed(2)}MB exceeds limit of 4.5MB`
      });
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

    // Gemini APIへリクエスト（タイムアウト設定付き）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25秒タイムアウト（Gemini 2.5対応）
    
    let response;
    try {
      response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        console.error('Request timeout after 25 seconds');
        return res.status(504).json({ 
          error: 'Gateway Timeout',
          message: 'Request to Gemini API timed out'
        });
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }

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