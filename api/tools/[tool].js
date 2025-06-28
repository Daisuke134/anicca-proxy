import { aciMcpService } from '../../services/aciMcpService.js';

// MCPサービスの初期化状態を管理
let isInitialized = false;

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
    // URLパスからツール名を取得（Express routeの場合はreq.params、Vercelの場合はreq.query）
    const tool = req.params?.tool || req.query?.tool;
    const { arguments: args } = req.body;
    
    console.log(`🔧 Tool call via MCP: ${tool}`, args);
    
    // MCPサービスを初期化（初回のみ）
    if (!isInitialized) {
      console.log('📡 Initializing MCP service...');
      await aciMcpService.initialize();
      isInitialized = true;
    }
    
    let result;
    
    // ACI_SEARCH_FUNCTIONS の場合
    if (tool === 'ACI_SEARCH_FUNCTIONS') {
      result = await aciMcpService.searchFunctions(args.intent || args.query || '');
    }
    // ACI_EXECUTE_FUNCTION の場合
    else if (tool === 'ACI_EXECUTE_FUNCTION') {
      const { function_name, function_arguments } = args;
      // function_nameからアプリ名と関数名を分離
      const [appName, ...functionParts] = function_name.split('__');
      const functionName = functionParts.join('__');
      
      result = await aciMcpService.executeFunction(
        appName,
        functionName,
        function_arguments
      );
    }
    // 直接的な関数呼び出し（例: SLACK__SEND_CHAT_MESSAGE）
    else if (tool.includes('__')) {
      const [appName, ...functionParts] = tool.split('__');
      const functionName = functionParts.join('__');
      
      result = await aciMcpService.executeFunction(
        appName,
        functionName,
        args
      );
    }
    else {
      throw new Error(`Unknown tool: ${tool}`);
    }
    
    console.log('✅ Tool executed successfully via MCP');
    
    return res.status(200).json({
      success: true,
      result: result
    });
    
  } catch (error) {
    console.error('❌ Tool execution error:', error);
    res.status(500).json({
      error: 'Failed to execute tool',
      message: error.message,
      tool: req.params?.tool || req.query?.tool
    });
  }
}