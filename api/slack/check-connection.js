import { loadTokensFromDB } from '../../services/database.js';
import crypto from 'crypto';

// 復号化キー（暗号化と同じキーを使用）
const ENCRYPTION_KEY = process.env.SLACK_TOKEN_ENCRYPTION_KEY 
  ? Buffer.from(process.env.SLACK_TOKEN_ENCRYPTION_KEY, 'hex')
  : crypto.randomBytes(32);

// 復号化関数
function decrypt(text) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export default async function handler(req, res) {
  console.log('🔍 Checking Slack connection status...');
  
  // CORSヘッダーを設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // グローバル変数から直接トークンをチェック
    if (global.slackBotToken || global.slackUserToken) {
      console.log('🔑 Found global Slack tokens');
      
      // どちらかのトークンで認証テスト
      const tokenToTest = global.slackUserToken || global.slackBotToken;
      let decryptedToken;
      
      try {
        // 暗号化されている場合は復号化
        decryptedToken = decrypt(tokenToTest);
      } catch (e) {
        // 暗号化されていない場合はそのまま使用
        decryptedToken = tokenToTest;
      }
      
      // Slack APIでトークンの有効性を確認
      const slackResponse = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${decryptedToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      const slackData = await slackResponse.json();
      console.log('🔒 Slack auth.test response:', slackData.ok ? 'Success' : 'Failed');
      
      if (slackData.ok) {
        console.log('✅ Slack connection verified - Team:', slackData.team, 'User:', slackData.user);
        return res.status(200).json({ 
          connected: true,
          team: slackData.team,
          user: slackData.user
        });
      }
    }
    
    // セッションIDまたはユーザーIDに紐づくSlackトークンをDBから取得（フォールバック）
    const { sessionId, userId } = req.query;
    
    // ユーザーIDベースで検索（優先）
    if (userId) {
      const userSessionId = `user_${userId}_slack`;
      const userTokenData = await loadTokensFromDB(userSessionId);
      console.log('🗄️ User token data from DB:', userTokenData ? 'Found' : 'Not found');
      
      if (userTokenData && userTokenData.bot_token) {
        const decryptedToken = decrypt(userTokenData.bot_token);
        const slackResponse = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${decryptedToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        const slackData = await slackResponse.json();
        if (slackData.ok) {
          return res.status(200).json({ 
            connected: true,
            team: slackData.team,
            user: slackData.user
          });
        }
      }
    }
    
    // セッションIDベースで検索（後方互換性）
    if (sessionId) {
      const tokenData = await loadTokensFromDB(sessionId);
      console.log('🗄️ Session token data from DB:', tokenData ? 'Found' : 'Not found');
      
      if (tokenData && tokenData.bot_token) {
        const decryptedToken = decrypt(tokenData.bot_token);
        const slackResponse = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${decryptedToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        const slackData = await slackResponse.json();
        if (slackData.ok) {
          return res.status(200).json({ 
            connected: true,
            team: slackData.team,
            user: slackData.user
          });
        }
      }
    }
    
    console.log('⚠️ No valid token found, returning connected: false');
    return res.status(200).json({ connected: false });
    
  } catch (error) {
    console.error('❌ Error checking Slack connection:', error);
    return res.status(500).json({ 
      error: 'Failed to check connection status',
      details: error.message 
    });
  }
}