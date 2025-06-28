import crypto from 'crypto';
import axios from 'axios';
import { saveTokens } from '../../services/tokenStorage.js';

// 暗号化キー（本番環境では環境変数から取得）
const ENCRYPTION_KEY = process.env.SLACK_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32);
const IV_LENGTH = 16;

// 暗号化関数
function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, state, error } = req.query;
    
    // エラーチェック
    if (error) {
      console.error('❌ Slack OAuth error:', error);
      const redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
      return res.redirect(`${redirectUrl}?error=true&service=slack&message=${encodeURIComponent(error)}`);
    }
    
    if (!code) {
      throw new Error('No authorization code received');
    }
    
    console.log('📝 Exchanging code for token...');
    
    // Slack APIを直接呼び出してトークンを取得
    const tokenResponse = await axios.post('https://slack.com/api/oauth.v2.access', null, {
      params: {
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code: code,
        redirect_uri: process.env.SLACK_REDIRECT_URI || 'https://anicca-proxy-production.up.railway.app/api/slack/oauth-callback'
      }
    });
    
    const data = tokenResponse.data;
    
    if (!data.ok) {
      throw new Error(data.error || 'Failed to exchange code for token');
    }
    
    console.log('✅ Slack OAuth successful');
    
    // トークンを取得
    const botToken = data.access_token;
    const userToken = data.authed_user?.access_token;
    
    // トークンを暗号化して保存
    const teamId = data.team?.id || 'default';
    
    if (botToken) {
      global.slackBotToken = encrypt(botToken);
      process.env.SLACK_BOT_TOKEN = botToken; // MCPサーバー用に環境変数も設定
    }
    if (userToken) {
      global.slackUserToken = encrypt(userToken);
      process.env.SLACK_USER_TOKEN = userToken;
    }
    
    // トークンを永続化（ファイルに保存）
    await saveTokens(teamId, {
      bot_token: encrypt(botToken),
      user_token: userToken ? encrypt(userToken) : null,
      team_id: teamId,
      team_name: data.team?.name,
      authed_user: data.authed_user
    });
    
    // インストール情報を保存（メモリベース）
    global.slackInstallations = global.slackInstallations || {};
    global.slackInstallations[teamId] = data;
    console.log('✅ Slack installation stored for team:', teamId);
    
    // sessionIdをstateから取得（stateがsessionIdの場合）
    const sessionId = state || '';
    
    // フロントエンドにリダイレクト
    const redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}?success=true&service=slack&sessionId=${sessionId}`);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    const redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}?error=true&service=slack&message=${encodeURIComponent(error.message)}`);
  }
}