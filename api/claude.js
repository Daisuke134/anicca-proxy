export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // CORSヘッダーを定義
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, anthropic-beta, x-claude-endpoint',
  };

  // CORSプリフライト対応
  if (request.method === 'OPTIONS') {
    return new Response(null, { 
      status: 200,
      headers: corsHeaders
    });
  }

  // POSTメソッドのみ許可
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // 環境変数からAPIキーを取得
    const API_KEY = process.env.ANTHROPIC_API_KEY;
    
    if (!API_KEY) {
      console.error('ANTHROPIC_API_KEY not configured');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // リクエストボディを取得
    const requestBody = await request.json();
    
    // URLパスから実際のエンドポイントを取得
    const url = new URL(request.url);
    const urlPath = url.pathname;
    const endpoint = urlPath.replace(/^\/api\/claude/, '') || '/v1/messages';
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
          ...(request.headers.get('anthropic-beta') && { 
            'anthropic-beta': request.headers.get('anthropic-beta') 
          })
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        console.error('Request timeout after 30 seconds');
        return new Response(JSON.stringify({ 
          error: 'Gateway Timeout',
          message: 'Request to Claude API timed out'
        }), {
          status: 504,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
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
      return new Response(JSON.stringify({ 
        error: 'Claude API error', 
        details: responseText 
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 成功レスポンス
    try {
      const responseData = JSON.parse(responseText);
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (parseError) {
      // JSONパースエラーの場合はテキストをそのまま返す
      return new Response(responseText, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', ...corsHeaders },
      });
    }

  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}