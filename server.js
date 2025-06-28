import express from 'express';
import cors from 'cors';

// Only load dotenv in development
if (process.env.NODE_ENV !== 'production') {
  import('dotenv').then(dotenv => dotenv.config());
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Import all API handlers
import geminiHandler from './api/gemini.js';
import ttsHandler from './api/tts.js';
import whisperHandler from './api/whisper.js';
import openaiProxyHandler from './api/openai-proxy.js';
import slackOauthHandler from './api/slack-oauth.js';
import slackOauthCallbackHandlerOld from './api/slack-oauth/callback.js'; // 古いエンドポイント（名前変更）
import downloadHandler from './api/download.js';
import landingHandler from './api/landing.js';
import hackerNewsHandler from './api/tools/get_hacker_news_stories.js';
import exaHandler from './api/tools/search_exa.js';
import thinkWithClaudeHandler from './api/tools/think_with_claude.js';
import thinkWithAciHandler from './api/tools/think_with_aci.js';
import claudeHandler from './api/claude.js';
import aciOauthUrlHandler from './api/aci/oauth-url.js';
import aciOauthCallbackHandler from './api/aci/oauth-callback.js';
import aciConnectedServicesHandler from './api/aci/connected-services.js';
// New Slack OAuth handlers
import slackOauthUrlHandler from './api/slack/oauth-url.js';
import slackOauthCallbackHandler from './api/slack/oauth-callback.js'; // 新しいエンドポイント
// Tool handlers
import slackToolHandler from './api/tools/slack.js';
import genericToolHandler from './api/tools/[tool].js';

// API Routes - 完全移植
app.all('/api/gemini', geminiHandler);
app.all('/api/tts', ttsHandler);
app.all('/api/whisper', whisperHandler);
app.all('/api/openai-proxy*', openaiProxyHandler);
app.all('/api/claude*', claudeHandler);
app.all('/api/slack-oauth', slackOauthHandler);
app.all('/api/slack-oauth/callback', slackOauthCallbackHandlerOld); // 古いエンドポイント
app.all('/api/download', downloadHandler);
app.all('/api/landing', landingHandler);
app.all('/api/tools/get_hacker_news_stories', hackerNewsHandler);
app.all('/api/tools/search_exa', exaHandler);
app.all('/api/tools/think_with_claude', thinkWithClaudeHandler);
app.all('/api/tools/think_with_aci', thinkWithAciHandler);
app.all('/api/aci/oauth-url', aciOauthUrlHandler);
app.all('/api/aci/oauth-callback', aciOauthCallbackHandler);
app.all('/api/aci/connected-services', aciConnectedServicesHandler);
// New Slack OAuth routes
app.all('/api/slack/oauth-url', slackOauthUrlHandler);
app.all('/api/slack/oauth-callback', slackOauthCallbackHandler);
// Slack tool endpoints
app.all('/api/tools/slack', slackToolHandler);
app.all('/api/tools/:tool', genericToolHandler);

// Root endpoint
app.get('/', (req, res) => {
  res.redirect('/api/landing');
});

// Check required environment variables
const requiredEnvVars = ['ACI_API_KEY'];
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
  console.log(`🔑 ACI_API_KEY: ${process.env.ACI_API_KEY ? 'Set' : '❌ Not set'}`);
});