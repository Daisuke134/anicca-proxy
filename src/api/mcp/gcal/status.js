import crypto from 'crypto';

/**
 * POST /api/mcp/gcal/status
 * Input: { userId: string }
 * Output: { connected: true, server_url: "<MCP_BASE>/sse", authorization: "Bearer <JWT>" }
 */
export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { userId } = req.body || {};
    const u = userId || 'anon';

    const isProd = process.env.NODE_ENV === 'production';
    const base = isProd
      ? (process.env.MCP_GCAL_BASE_URL_PRODUCTION || process.env.MCP_GCAL_BASE_URL_STAGING)
      : (process.env.MCP_GCAL_BASE_URL_STAGING || process.env.MCP_GCAL_BASE_URL_PRODUCTION);

    if (!base) return res.status(500).json({ error: 'MCP base URL not configured' });

    const server_url = `${base.replace(/\/+$/,'')}/sse`;
    const jwt = signJwtHS256(
      { sub: u, aud: 'mcp-gcal', iss: 'anicca-proxy', exp: Math.floor(Date.now()/1000) + 600 },
      process.env.PROXY_MCP_JWT_SECRET || 'dev-secret'
    );
    return res.json({ connected: true, server_url, authorization: `Bearer ${jwt}` });
  } catch (e) {
    console.error('gcal status error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function signJwtHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64url(sig)}`;
}

