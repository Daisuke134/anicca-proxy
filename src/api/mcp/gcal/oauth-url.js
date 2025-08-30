export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId');
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const WORKSPACE_MCP_URL = process.env.WORKSPACE_MCP_URL;
    
    if (!WORKSPACE_MCP_URL) {
      return res.status(500).json({ error: 'MCP service not configured' });
    }
    
    // workspace-mcpのOAuth開始URL
    return res.json({ 
      url: `${WORKSPACE_MCP_URL}/auth/start?user_id=${userId}` 
    });
  } catch (error) {
    console.error('OAuth URL error:', error);
    return res.status(500).json({ error: error.message });
  }
}