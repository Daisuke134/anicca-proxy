import { aciMcpService } from '../../services/aciMcpService.js';

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
    console.log('🚀 Initializing MCP server...');
    
    // MCPサービスを初期化
    await aciMcpService.initialize();
    
    // 利用可能なツールを取得してテスト
    const tools = await aciMcpService.searchFunctions('slack');
    
    console.log('✅ MCP server initialized successfully');
    console.log(`📋 Found ${tools?.content?.length || 0} Slack tools`);
    
    return res.status(200).json({
      success: true,
      message: 'MCP server initialized',
      slackToolsAvailable: tools?.content?.length > 0
    });
    
  } catch (error) {
    console.error('❌ MCP initialization error:', error);
    res.status(500).json({
      error: 'Failed to initialize MCP server',
      message: error.message
    });
  }
}