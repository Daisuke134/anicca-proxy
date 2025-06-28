import { InstallProvider } from '@slack/oauth';
import crypto from 'crypto';

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

// Slack OAuth設定（oauth-url.jsと同じ）
const installer = new InstallProvider({
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET || 'my-state-secret',
  installationStore: {
    storeInstallation: async (installation) => {
      // メモリに保存（簡易実装）
      global.slackInstallations = global.slackInstallations || {};
      const key = installation.team ? installation.team.id : 'default';
      global.slackInstallations[key] = installation;
      console.log('✅ Slack installation stored for team:', key);
    },
    fetchInstallation: async (installQuery) => {
      const installations = global.slackInstallations || {};
      const key = installQuery.teamId || 'default';
      return installations[key];
    },
  },
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // OAuthコールバックを処理
    const callbackOptions = {
      success: async (installation, installOptions, req, res) => {
        console.log('✅ Slack OAuth successful');
        
        // トークンを取得
        const botToken = installation.bot?.token;
        const userToken = installation.user?.token;
        
        // トークンを暗号化して保存
        if (botToken) {
          global.slackBotToken = encrypt(botToken);
          process.env.SLACK_BOT_TOKEN = botToken; // MCPサーバー用に環境変数も設定
        }
        if (userToken) {
          global.slackUserToken = encrypt(userToken);
          process.env.SLACK_USER_TOKEN = userToken;
        }
        
        // metadata からsessionIdを取得
        let sessionId = '';
        try {
          const metadata = JSON.parse(installOptions.metadata || '{}');
          sessionId = metadata.sessionId || '';
        } catch (e) {
          console.error('Failed to parse metadata:', e);
        }
        
        // フロントエンドにリダイレクト
        const redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
        res.redirect(`${redirectUrl}?success=true&service=slack&sessionId=${sessionId}`);
      },
      failure: (error, installOptions, req, res) => {
        console.error('❌ Slack OAuth failed:', error);
        const redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
        res.redirect(`${redirectUrl}?error=true&service=slack&message=${encodeURIComponent(error.message)}`);
      },
    };
    
    // URLとExpressのreq/resオブジェクトを渡す
    await installer.handleCallback(req, res, callbackOptions);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    const redirectUrl = process.env.ANICCA_WEB_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}?error=true&service=slack&message=${encodeURIComponent(error.message)}`);
  }
}