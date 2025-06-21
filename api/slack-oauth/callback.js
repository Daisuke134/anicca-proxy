export default async function handler(req, res) {
  const { code, error } = req.query;
  
  // エラーチェック
  if (error) {
    return res.status(400).send(`
      <html>
        <body style="font-family: -apple-system, sans-serif; padding: 50px; text-align: center;">
          <h2>❌ 認証エラー</h2>
          <p>${error}</p>
        </body>
      </html>
    `);
  }
  
  if (!code) {
    return res.status(400).send(`
      <html>
        <body style="font-family: -apple-system, sans-serif; padding: 50px; text-align: center;">
          <h2>❌ エラー</h2>
          <p>認証コードが見つかりません</p>
        </body>
      </html>
    `);
  }
  
  try {
    // Slackのトークン交換
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: '3627470757104.9096399358065',
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code: code,
        redirect_uri: 'https://anicca-proxy-ten.vercel.app/api/slack-oauth/callback'
      })
    });
    
    const data = await response.json();
    
    if (data.ok && data.access_token) {
      // 成功：トークンを表示
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Slack連携完了</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              padding: 50px;
              max-width: 600px;
              margin: 0 auto;
              text-align: center;
            }
            h1 { color: #4a9eff; }
            .token-box {
              background: #f5f5f5;
              border: 1px solid #ddd;
              border-radius: 4px;
              padding: 20px;
              margin: 30px 0;
              word-break: break-all;
              font-family: monospace;
              font-size: 14px;
            }
            .info {
              background: #e3f2fd;
              border: 1px solid #90caf9;
              border-radius: 4px;
              padding: 15px;
              margin: 20px 0;
            }
            .team-info {
              color: #666;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <h1>✅ Slack連携が完了しました！</h1>
          
          ${data.team ? `<p class="team-info">ワークスペース: <strong>${data.team.name}</strong></p>` : ''}
          
          <div class="info">
            <p>以下のトークンがAniccaで自動的に設定されます：</p>
          </div>
          
          <div class="token-box">
            ${data.access_token}
          </div>
          
          <p>このウィンドウは閉じて構いません。<br>
          Aniccaに戻って「Slackに投稿して」と話しかけてみてください。</p>
          
          <script>
            // 親ウィンドウにトークンを送信（将来の拡張用）
            if (window.opener) {
              window.opener.postMessage({
                type: 'slack-oauth-success',
                token: '${data.access_token}',
                team: ${JSON.stringify(data.team || {})}
              }, '*');
            }
          </script>
        </body>
        </html>
      `);
    } else {
      // Slackからのエラー
      res.status(400).send(`
        <html>
          <body style="font-family: -apple-system, sans-serif; padding: 50px; text-align: center;">
            <h2>❌ 認証エラー</h2>
            <p>${data.error || 'トークンの取得に失敗しました'}</p>
            <pre style="text-align: left; background: #f5f5f5; padding: 10px; border-radius: 4px;">
${JSON.stringify(data, null, 2)}
            </pre>
          </body>
        </html>
      `);
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: -apple-system, sans-serif; padding: 50px; text-align: center;">
          <h2>❌ サーバーエラー</h2>
          <p>認証処理中にエラーが発生しました</p>
          <p style="color: #666; font-size: 14px;">${error.message}</p>
        </body>
      </html>
    `);
  }
}