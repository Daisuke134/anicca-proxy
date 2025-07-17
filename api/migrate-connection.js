import { loadTokensFromDB, saveTokensToDB } from '../services/database.js';

export default async function handler(req, res) {
  // CORSヘッダーを設定
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
    const { sessionId, userId, service } = req.body;
    
    console.log('🔄 Migrating connection:', { sessionId, userId, service });
    
    if (!sessionId || !userId || !service) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // 既存のセッションIDからトークンを取得
    const existingTokens = await loadTokensFromDB(sessionId);
    
    if (!existingTokens) {
      console.log('⚠️ No tokens found for session:', sessionId);
      return res.status(404).json({ error: 'No tokens found for session' });
    }
    
    // ユーザーIDに紐付けて保存
    // user_id をキーとして使用（Supabaseのuser.id）
    const userSessionId = `user_${userId}_${service}`;
    
    const migratedData = {
      ...existingTokens,
      user_id: userId,
      original_session_id: sessionId,
      migrated_at: new Date().toISOString()
    };
    
    // 新しいセッションIDで保存
    await saveTokensToDB(userSessionId, migratedData);
    
    console.log('✅ Connection migrated successfully');
    
    return res.status(200).json({ 
      success: true,
      message: 'Connection migrated successfully',
      userSessionId
    });
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    return res.status(500).json({ 
      error: 'Failed to migrate connection',
      details: error.message 
    });
  }
}