export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // workspace-mcpのURL（環境変数から取得）
    const WORKSPACE_MCP_URL = process.env.WORKSPACE_MCP_URL;
    
    if (!WORKSPACE_MCP_URL) {
      console.error('WORKSPACE_MCP_URL not configured');
      return res.status(500).json({ 
        connected: false, 
        error: 'MCP service not configured' 
      });
    }
    
    // 常に接続済みとして扱う（OAuth管理はworkspace-mcp側）
    return res.json({
      connected: true,
      server_url: `${WORKSPACE_MCP_URL}/mcp`,
      authorization: `Bearer ${userId}`
    });
  } catch (error) {
    console.error('MCP status error:', error);
    return res.status(500).json({ 
      connected: false, 
      error: error.message 
    });
  }
}