import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

// MCPプロセス管理
const mcpProcesses = new Map();

// トークン永続化ディレクトリ
const TOKEN_DIR = '/app/storage/gcal-tokens';

// ディレクトリ作成
async function ensureTokenDir() {
  try {
    await fs.mkdir(TOKEN_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create token directory:', err);
  }
}

// MCPサーバー起動
async function startMCPServer(userId) {
  if (mcpProcesses.has(userId)) {
    return mcpProcesses.get(userId);
  }

  const port = 4000 + (parseInt(userId.substring(0, 8), 16) % 1000);

  // OAuth認証情報ファイルを作成
  const credentialsPath = path.join(TOKEN_DIR, `${userId}-creds.json`);
  await fs.writeFile(credentialsPath, JSON.stringify({
    web: {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uris: [`${process.env.RAILWAY_URL}/api/mcp/gcal/callback`]
    }
  }));

  const mcp = spawn('npx', [
    '-y',
    '@cocal/google-calendar-mcp',
    '--transport', 'http',
    '--port', port.toString(),
    '--host', 'localhost'
  ], {
    env: {
      ...process.env,
      TRANSPORT: 'http',
      PORT: port.toString(),
      HOST: 'localhost',
      GOOGLE_OAUTH_CREDENTIALS: credentialsPath,  // ファイルパスを渡す
      GOOGLE_CALENDAR_MCP_TOKEN_PATH: path.join(TOKEN_DIR, `${userId}.json`)
    }
  });

  mcp.stdout.on('data', (data) => {
    console.log(`MCP[${userId}]: ${data}`);
  });

  mcp.stderr.on('data', (data) => {
    console.error(`MCP[${userId}] error: ${data}`);
  });

  mcpProcesses.set(userId, { process: mcp, port });
  
  // MCPサーバーの起動を待つ
  await new Promise((resolve) => {
    const checkServer = async () => {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        if (res.ok) {
          console.log(`MCP[${userId}]: Server started on port ${port}`);
          resolve();
          return;
        }
      } catch {
        // サーバーがまだ起動していない場合は500ms後に再試行
      }
      setTimeout(checkServer, 500);
    };
    // 1秒待ってからチェック開始
    setTimeout(checkServer, 1000);
  });

  return { process: mcp, port };
}

export default async function gcalHandler(app) {
  // 初期化
  await ensureTokenDir();

  // MCPプロキシエンドポイント
  app.all('/api/mcp/gcal/:userId*', async (req, res) => {
    const { userId } = req.params;
    const { port } = await startMCPServer(userId);

    // StreamableHTTPプロトコルをプロキシ
    const targetUrl = `http://localhost:${port}${req.originalUrl.replace(`/api/mcp/gcal/${userId}`, '')}`;

    try {
      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          ...req.headers,
          host: `localhost:${port}`
        },
        body: req.method !== 'GET' && req.method !== 'HEAD' ?
          JSON.stringify(req.body) : undefined
      });

      // レスポンスをそのまま転送
      const body = await proxyRes.text();
      res.status(proxyRes.status);
      proxyRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      res.send(body);
    } catch (error) {
      console.error('Proxy error:', error);
      res.status(500).json({ error: 'MCP proxy error' });
    }
  });

  // OAuth開始エンドポイント（デスクトップから呼ばれる）
  app.get('/api/mcp/gcal/auth/:userId', (req, res) => {
    const { userId } = req.params;

    // OAuth URL生成
    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${process.env.RAILWAY_URL}/api/mcp/gcal/callback&` +
      `response_type=code&` +
      `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events')}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${userId}`;

    res.json({ authUrl });
  });

  // OAuthコールバック
  app.get('/api/mcp/gcal/callback', async (req, res) => {
    const { code, state: userId } = req.query;

    if (!code || !userId) {
      res.status(400).send('Missing code or state');
      return;
    }

    // MCPサーバーのポート
    const mcpInfo = mcpProcesses.get(userId);
    if (!mcpInfo) {
      // MCPサーバーを起動
      await startMCPServer(userId);
    }

    // トークン交換（Google APIを直接呼ぶ）
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${process.env.RAILWAY_URL}/api/mcp/gcal/callback`,
          grant_type: 'authorization_code'
        })
      });

      const tokens = await tokenRes.json();

      // トークンを保存
      const tokenPath = path.join(TOKEN_DIR, `${userId}.json`);
      await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2));

      // 成功画面（自動で閉じる）
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>認証完了</title>
          <style>
            body { font-family: sans-serif; text-align: center; padding: 50px; }
            h1 { color: #4CAF50; }
          </style>
        </head>
        <body>
          <h1>✅ カレンダー連携完了！</h1>
          <p>このウィンドウは自動的に閉じます</p>
          <script>setTimeout(() => window.close(), 2000);</script>
        </body>
        </html>
      `);
    } catch (error) {
      console.error('Token exchange error:', error);
      res.status(500).send('認証エラーが発生しました');
    }
  });

  // クリーンアップ
  process.on('SIGTERM', () => {
    mcpProcesses.forEach(({ process }) => {
      process.kill();
    });
  });
}