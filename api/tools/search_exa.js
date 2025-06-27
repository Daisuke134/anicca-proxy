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
      num_results: 5,
      type: 'neural',
      use_autoprompt: true
    });
    
    console.log('🌐 Exa MCP response:', JSON.stringify(mcpResult, null, 2));
    
    // MCPレスポンスを既存のフォーマットに変換
    let results = [];
    
    if (mcpResult.content && mcpResult.content.length > 0) {
      const content = mcpResult.content[0];
      
      // MCPレスポンスの構造に応じて処理
      if (content.type === 'text') {
        // テキストレスポンスの場合はパース
        try {
          const data = JSON.parse(content.text);
          results = data.results || data;
        } catch (e) {
          // パースできない場合はそのまま返す
          results = [{ title: 'Search Result', snippet: content.text }];
        }
      } else if (content.results) {
        results = content.results;
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