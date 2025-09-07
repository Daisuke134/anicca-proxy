export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    // TODO(security): Validate Authorization header ties to this userId
    const { query } = await import('../../../lib/db.js');
    await query("DELETE FROM tokens WHERE user_id=$1 AND provider='google'", [userId]);

    // Optionally try to revoke at Google here if needed (best-effort)
    return res.json({ success: true });
  } catch (e) {
    console.error('gcal disconnect error', e);
    return res.status(500).json({ success: false, error: e?.message || 'Internal error' });
  }
}
