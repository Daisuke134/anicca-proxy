/**
 * Composio API設定エンドポイント
 * デスクトップアプリ用にAPI KEY情報を提供
 */
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const apiKey = process.env.COMPOSIO_API_KEY;
      
      if (!apiKey) {
        return res.status(500).json({ 
          error: 'COMPOSIO_API_KEY not configured' 
        });
      }
      
      return res.json({ apiKey });
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Composio config error:', error);
    return res.status(500).json({ 
      error: 'Internal server error' 
    });
  }
}