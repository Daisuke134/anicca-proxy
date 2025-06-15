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
    const API_KEY = process.env.ANTHROPIC_API_KEY;
    
    if (!API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
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
    
    // リクエストボディをそのまま取得（Claude APIのフォーマット）
    const requestBody = req.body;
    
    // Claude APIのエンドポイントを構築
    const endpoint = req.headers['x-claude-endpoint'] || '/v1/messages';
    const baseUrl = 'https://api.anthropic.com';
    const fullUrl = `${baseUrl}${endpoint}`;
    
    console.log(`Proxying request to Claude API: ${endpoint}`);

    // Claude APIへリクエスト
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒タイムアウト
    
    let response;
    try {
      response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          // Claude Code SDK用のヘッダーがあれば転送
          ...(req.headers['anthropic-beta'] && { 'anthropic-beta': req.headers['anthropic-beta'] })
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        console.error('Request timeout after 30 seconds');
        return res.status(504).json({ 
          error: 'Gateway Timeout',
          message: 'Request to Claude API timed out'
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
      console.error(`Claude API error: ${response.status} - ${responseText}`);
      return res.status(response.status).json({ 
        error: 'Claude API error', 
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