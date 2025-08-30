/**
 * GET /api/mcp/gcal/oauth-url?userId=U
 * Returns: { url: "<MCP_BASE>/auth?state=U" }
 */
export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { userId } = req.query || {};
    const isProd = process.env.NODE_ENV === 'production';
    const base = isProd
      ? (process.env.MCP_GCAL_BASE_URL_PRODUCTION || process.env.MCP_GCAL_BASE_URL_STAGING)
      : (process.env.MCP_GCAL_BASE_URL_STAGING || process.env.MCP_GCAL_BASE_URL_PRODUCTION);

    if (!base) {
      return res.status(500).json({ error: 'MCP base URL not configured on server' });
    }

    const u = userId || 'anon';
    const url = `${base.replace(/\/+$/,'')}/auth?state=${encodeURIComponent(u)}`;
    return res.json({ url });
  } catch (e) {
    console.error('gcal oauth-url error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

