import { exaMcpService } from '../../services/exaMcpService.js';

// MCPサービスの初期化（一度だけ）
let isInitialized = false;

export default async function handler(req, res) {
  // CORS設定
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
    // MCPサービスを初期化（初回のみ）
    if (!isInitialized) {
      await exaMcpService.initialize();
      isInitialized = true;
    }
    
    // 両方の形式に対応
    let query;
    
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    
    if (req.body.arguments) {
      // デスクトップ版形式: { arguments: { query: "..." } }
      const args = typeof req.body.arguments === 'string' 
        ? JSON.parse(req.body.arguments) 
        : req.body.arguments;
      query = args.query;
      console.log('🔧 Using arguments format - query:', query);
    } else {
      // Web版形式: { query: "..." }
      query = req.body.query;
      console.log('🔧 Using direct format - query:', query);
    }
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const exaApiKey = process.env.EXA_API_KEY;
    if (!exaApiKey) {
      throw new Error('EXA_API_KEY is not configured');
    }
    
    // Exa MCPで検索
    console.log('🔍 Using Exa MCP for search...');
    const mcpResult = await exaMcpService.search(query, {
      numResults: 5  // MCPサーバーが期待するパラメータ名
    });
    
    console.log('🌐 Exa MCP response:', JSON.stringify(mcpResult, null, 2));
    
    // MCPレスポンスを既存のフォーマットに変換
    let results = [];
    
    if (mcpResult && mcpResult.content && mcpResult.content.length > 0) {
      for (const content of mcpResult.content) {
        if (content.type === 'text') {
          // MCPのレスポンスフォーマットに従って処理
          try {
            // テキストがJSON形式の場合はパース
            const parsed = JSON.parse(content.text);
            if (Array.isArray(parsed)) {
              results = parsed;
            } else if (parsed.results) {
              results = parsed.results;
            } else {
              // 単一の結果として扱う
              results.push(parsed);
            }
          } catch (e) {
            // JSONでない場合は、改行で分割して結果として扱う
            const lines = content.text.split('\n').filter(line => line.trim());
            lines.forEach(line => {
              // URLパターンを検出
              const urlMatch = line.match(/https?:\/\/[^\s]+/);
              if (urlMatch) {
                results.push({
                  url: urlMatch[0],
                  title: line.replace(urlMatch[0], '').trim() || 'Search Result',
                  snippet: line
                });
              } else if (line.trim()) {
                results.push({
                  title: line.substring(0, 100),
                  snippet: line
                });
              }
            });
          }
        }
      }
    }
    
    // レスポンスフォーマットを維持
    const responseData = {
      success: true,
      query: query,
      results: results.map(result => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet || result.text?.substring(0, 200) + '...'
      }))
    };
    
    console.log('✅ Returning response:', JSON.stringify(responseData, null, 2));
    res.status(200).json(responseData);
    
  } catch (error) {
    console.error('Exa MCP Error:', error);
    res.status(500).json({
      error: 'Failed to search with Exa MCP',
      message: error.message
    });
  }
}