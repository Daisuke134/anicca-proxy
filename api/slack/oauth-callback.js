import crypto from 'crypto';
import axios from 'axios';
import { saveTokens } from '../../services/tokenStorage.js';
import { saveTokensToDB } from '../../services/database.js';

// 暗号化キー（本番環境では環境変数から取得）
const ENCRYPTION_KEY = process.env.SLACK_TOKEN_ENCRYPTION_KEY 
  ? Buffer.from(process.env.SLACK_TOKEN_ENCRYPTION_KEY, 'hex')
  : crypto.randomBytes(32);
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
        // 動的にリダイレクトURIを生成（リクエストから判定）
        redirect_uri: (() => {
          const host = req.headers.host || 'anicca-proxy-staging.up.railway.app';
          const protocol = req.headers['x-forwarded-proto'] || 'https';
          return `${protocol}://${host}/api/slack/oauth-callback`;
        })()
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
    
    // stateからsessionIdとuserIdを取得
    let sessionId, userId;
    try {
      // stateがJSON形式の場合（新しい形式）
      const stateData = JSON.parse(state);
      sessionId = stateData.sessionId;
      userId = stateData.userId;
    } catch (e) {
      // stateが単純な文字列の場合（後方互換性）
      sessionId = state || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      userId = null;
    }
    
    // トークンを永続化（ファイルとDBに保存）
    const tokenData = {
      bot_token: encrypt(botToken),
      user_token: userToken ? encrypt(userToken) : null,
      team_id: teamId,
      team_name: data.team?.name,
      authed_user: data.authed_user,
      user_id: userId, // ユーザーIDを追加
      created_at: new Date().toISOString()
    };
    
    // ファイルに保存（後方互換性のため）
    await saveTokens(teamId, tokenData);
    
    // データベースに保存
    if (userId) {
      // userIdのみを渡す（saveSlackTokensForUserが自動的にプレフィックスを追加する）
      await saveTokensToDB(userId, tokenData);
      console.log('✅ Saved tokens for user:', userId);
    } else {
      // userIdがない場合のみ一時的なセッションIDで保存
      await saveTokensToDB(sessionId, tokenData);
      console.log('⚠️ Saved tokens with temporary session ID:', sessionId);
    }
    
    // インストール情報を保存（メモリベース）
    global.slackInstallations = global.slackInstallations || {};
    global.slackInstallations[teamId] = data;
    global.currentSessionId = sessionId; // 現在のセッションIDを保存
    console.log('✅ Slack installation stored for team:', teamId);
    
    // フロントエンドにリダイレクト
    // デバッグログを追加
    console.log('🔍 OAuth callback redirect debug:');
    console.log('  - NODE_ENV:', process.env.NODE_ENV);
    console.log('  - ANICCA_WEB_URL:', process.env.ANICCA_WEB_URL);
    console.log('  - userId:', userId);
    console.log('  - state:', state);
    
    let redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
    
    // stateにredirectUrlが含まれている場合は優先的に使用
    try {
      const stateData = JSON.parse(state);
      console.log('  - stateData:', stateData);
      if (stateData.redirectUrl) {
        redirectUrl = stateData.redirectUrl;
        console.log('  - Using redirectUrl from state:', redirectUrl);
      }
    } catch (e) {
      // stateがJSON形式でない場合
      console.log('  - State is not JSON format');
    }
    
    console.log('  - Final redirectUrl:', redirectUrl);
    
    res.redirect(`${redirectUrl}?success=true&service=slack&sessionId=${sessionId}`);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    const redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}?error=true&service=slack&message=${encodeURIComponent(error.message)}`);
  }
}