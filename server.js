import express from 'express';
import cors from 'cors';
import { loadTokens } from './services/tokenStorage.js';
import { initDatabase, loadLatestTokensFromDB } from './services/database.js';

// Only load dotenv in development
if (process.env.NODE_ENV !== 'production') {
  import('dotenv').then(dotenv => dotenv.config());
}

// サーバー起動時の初期化処理
async function initializeServer() {
  // データベースを初期化
  const dbInitialized = await initDatabase();
  
  // ユーザーベースのトークン管理に移行したため、
  // グローバル変数へのトークン読み込みは無効化
  console.log('✅ Database initialized. Using user-based token management.');
  
  // 以下の処理は無効化（後方互換性のためコメントで残す）
  /*
  if (dbInitialized) {
    // データベースから最新のトークンを読み込む
    try {
      const dbTokens = await loadLatestTokensFromDB();
      if (dbTokens) {
        global.slackBotToken = dbTokens.bot_token;
        global.slackUserToken = dbTokens.user_token;
        global.currentSessionId = dbTokens.session_id;
        console.log('✅ Loaded Slack tokens from database');
      }
    } catch (error) {
      console.error('Failed to load tokens from DB:', error);
    }
  } else {
    // データベースが使えない場合はファイルから読み込む（後方互換性）
    try {
      const tokens = await loadTokens('default');
      if (tokens) {
        global.slackBotToken = tokens.bot_token;
        global.slackUserToken = tokens.user_token;
        console.log('✅ Loaded Slack tokens from file');
      }
    } catch (error) {
      console.error('Failed to load tokens from file:', error);
    }
  }
  */
}

initializeServer();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Import auth middleware
// import { authMiddleware } from './middleware/auth.js';

// Apply auth middleware to all routes
// app.use(authMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Import all API handlers
import geminiHandler from './api/gemini.js';
import ttsHandler from './api/tts.js';
import whisperHandler from './api/whisper.js';
import openaiProxyHandler from './api/openai-proxy.js';
import downloadHandler from './api/download.js';
import landingHandler from './api/landing.js';
import hackerNewsHandler from './api/tools/get_hacker_news_stories.js';
import exaHandler from './api/tools/search_exa.js';
import claudeCodeHandler from './api/tools/claude_code.js';
import claudeHandler from './api/claude.js';
// Auth handlers
import authGoogleHandler from './api/auth/google.js';
import authCallbackHandler from './api/auth/callback.js';
import authSessionHandler from './api/auth/session.js';
import authRefreshHandler from './api/auth/refresh.js';
// New Slack OAuth handlers
import slackOauthUrlHandler from './api/slack/oauth-url.js';
import slackOauthCallbackHandler from './api/slack/oauth-callback.js'; // 新しいエンドポイント
import slackCheckConnectionHandler from './api/slack/check-connection.js';
import migrateConnectionHandler from './api/migrate-connection.js';
// Tool handlers
import slackToolHandler from './api/tools/slack.js';
import playwrightHandler from './api/tools/playwright.js';
// Connected services
import connectedServicesHandler from './api/connected-services.js';
// Debug endpoint (REMOVE IN PRODUCTION!)
import debugDeleteTokensHandler from './api/debug-delete-tokens.js';
// Preview app handler
import previewAppHandler from './api/preview-app.js';
// Parallel SDK handler
import parallelSdkExecuteHandler from './api/parallel-sdk-execute.js';

// API Routes - 完全移植
app.all('/api/gemini', geminiHandler);
app.all('/api/tts', ttsHandler);
app.all('/api/whisper', whisperHandler);
app.all('/api/openai-proxy*', openaiProxyHandler);
app.all('/api/claude*', claudeHandler);
// 古いSlack OAuthエンドポイント（無効化）
// app.all('/api/slack-oauth', slackOauthHandler);
// app.all('/api/slack-oauth/callback', slackOauthCallbackHandlerOld);
app.all('/api/download', downloadHandler);
app.all('/api/landing', landingHandler);
app.all('/api/tools/get_hacker_news_stories', hackerNewsHandler);
// Exaの8つの検索ツールをすべて同じハンドラーにルーティング
app.all('/api/tools/web_search_exa', exaHandler);
app.all('/api/tools/research_paper_search', exaHandler);
app.all('/api/tools/company_research', exaHandler);
app.all('/api/tools/github_search', exaHandler);
app.all('/api/tools/wikipedia_search_exa', exaHandler);
app.all('/api/tools/linkedin_search', exaHandler);
app.all('/api/tools/crawling', exaHandler);
app.all('/api/tools/competitor_finder', exaHandler);
app.all('/api/tools/claude_code', claudeCodeHandler);
// Auth routes
app.all('/api/auth/google', authGoogleHandler);
app.all('/api/auth/callback', authCallbackHandler);
app.all('/api/auth/session', authSessionHandler);
app.all('/api/auth/refresh', authRefreshHandler);
// New Slack OAuth routes
app.all('/api/slack/oauth-url', slackOauthUrlHandler);
app.all('/api/slack/oauth-callback', slackOauthCallbackHandler);
app.all('/api/slack/check-connection', slackCheckConnectionHandler);
app.all('/api/migrate-connection', migrateConnectionHandler);
// Slack tool endpoints
app.all('/api/tools/slack', slackToolHandler);
// Playwright tool endpoints - すべてのplaywright_*を同じハンドラーにルーティング
app.all('/api/tools/playwright', playwrightHandler);
app.all('/api/tools/playwright_navigate', playwrightHandler);
app.all('/api/tools/playwright_click', playwrightHandler);
app.all('/api/tools/playwright_type', playwrightHandler);
app.all('/api/tools/playwright_screenshot', playwrightHandler);
// Connected services
app.all('/api/connected-services', connectedServicesHandler);
// Debug endpoint (REMOVE IN PRODUCTION!)
app.all('/api/debug-delete-tokens', debugDeleteTokensHandler);
// Preview app endpoint
app.all('/api/preview-app/*', previewAppHandler);

// Parallel SDK endpoint
app.post('/api/parallel-sdk/execute', parallelSdkExecuteHandler);

// Root endpoint
app.get('/', (req, res) => {
  res.redirect('/api/landing');
});

// Check required environment variables
const requiredEnvVars = [];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingVars);
  console.error('Please set these variables in Railway or your environment');
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Anicca Proxy Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  // console.log(`🔑 ACI_API_KEY: ${process.env.ACI_API_KEY ? 'Set' : '❌ Not set'}`);
});