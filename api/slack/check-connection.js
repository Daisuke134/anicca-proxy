import { getTokensFromDB } from '../../services/database.js';
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
    const { sessionId } = req.query;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // セッションIDに紐づくSlackトークンをDBから取得
    const tokenData = await getTokensFromDB(sessionId);
    
    if (tokenData && tokenData.bot_token) {
      // 暗号化されたトークンを復号化
      const decryptedToken = decrypt(tokenData.bot_token);
      // Slack APIでトークンの有効性を確認
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
    
    return res.status(200).json({ connected: false });
    
  } catch (error) {
    console.error('❌ Error checking Slack connection:', error);
    return res.status(500).json({ 
      error: 'Failed to check connection status',
      details: error.message 
    });
  }
}