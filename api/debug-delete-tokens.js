// 一時的なデバッグ用エンドポイント
// 本番では絶対に使わないこと！

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 開発環境のみ許可
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Forbidden in production' });
  }

  try {
    // データベースの初期化（テーブルをクリア）
    const { initDatabase } = await import('../services/database.js');
    await initDatabase();
    
    return res.status(200).json({ 
      success: true, 
      message: 'All tokens deleted and database reset' 
    });
  } catch (error) {
    console.error('Debug delete error:', error);
    return res.status(500).json({ error: error.message });
  }
}