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
import slackOauthCallbackHandler from './api/slack-oauth/callback.js';
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

// API Routes - 完全移植
app.all('/api/gemini', geminiHandler);
app.all('/api/tts', ttsHandler);
app.all('/api/whisper', whisperHandler);
app.all('/api/openai-proxy*', openaiProxyHandler);
app.all('/api/claude*', claudeHandler);
app.all('/api/slack-oauth', slackOauthHandler);
app.all('/api/slack-oauth/callback', slackOauthCallbackHandler);
app.all('/api/download', downloadHandler);
app.all('/api/landing', landingHandler);
app.all('/api/tools/get_hacker_news_stories', hackerNewsHandler);
app.all('/api/tools/search_exa', exaHandler);
app.all('/api/tools/think_with_claude', thinkWithClaudeHandler);
app.all('/api/tools/think_with_aci', thinkWithAciHandler);
app.all('/api/aci/oauth-url', aciOauthUrlHandler);
app.all('/api/aci/oauth-callback', aciOauthCallbackHandler);
app.all('/api/aci/connected-services', aciConnectedServicesHandler);

// Root endpoint
app.get('/', (req, res) => {
  res.redirect('/api/landing');
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Anicca Proxy Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});