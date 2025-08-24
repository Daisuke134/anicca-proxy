/**
 * Composio MCP設定エンドポイント
 * デスクトップアプリ用にMCP URL情報を提供
 */
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const MCP_ID = process.env.MCP_GOOGLE_CALENDAR_ID;
      const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY;
      
      if (!MCP_ID) {
        return res.status(500).json({ 
          error: 'MCP_GOOGLE_CALENDAR_ID environment variable not set' 
        });
      }
      
      if (!COMPOSIO_API_KEY) {
        return res.status(500).json({ 
          error: 'COMPOSIO_API_KEY environment variable not set' 
        });
      }
      
      // Composio MCPのSSE URLを生成
      const mcpUrl = `https://mcp.composio.dev/composio/server/${MCP_ID}?transport=sse`;
      
      return res.json({
        mcpUrl: mcpUrl,
        mcpId: MCP_ID,
        success: true
      });
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Composio MCP config error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}