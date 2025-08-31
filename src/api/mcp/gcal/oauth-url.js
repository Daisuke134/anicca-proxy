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
    // 代理受け（プロキシ）型: Google同意後はプロキシのcallbackに戻す
    const scheme = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proxyBase = `${scheme}://${host}`;
    const redirectUri = `${proxyBase}/api/mcp/gcal/callback`;

    // FastMCP OAuth 2.1 の認可エンドポイント（MCPがCORSとスコープマージを処理）
    const authorize = new URL(`${WORKSPACE_MCP_URL}/oauth2/authorize`);
    authorize.searchParams.set('state', userId);
    authorize.searchParams.set('redirect_uri', redirectUri);

    return res.json({ url: authorize.toString() });
  } catch (error) {
    console.error('OAuth URL error:', error);
    return res.status(500).json({ error: error.message });
  }
}
