import { WebClient } from '@slack/web-api';
import crypto from 'crypto';

// 復号化関数
function decrypt(text) {
  const ENCRYPTION_KEY = process.env.SLACK_TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32);
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, arguments: args } = req.body;
    
    console.log('🔧 Slack tool request:', { action, args });
    
    // トークンを取得（暗号化されている場合は復号化）
    let botToken = process.env.SLACK_BOT_TOKEN || global.slackBotToken;
    let userToken = process.env.SLACK_USER_TOKEN || global.slackUserToken;
    
    if (!botToken) {
      throw new Error('Slack is not connected. Please reconnect your Slack account.');
    }
    
    if (botToken && botToken.includes(':')) {
      botToken = decrypt(botToken);
    }
    if (userToken && userToken.includes(':')) {
      userToken = decrypt(userToken);
    }
    
    // Slack Web APIクライアントを作成
    const slack = new WebClient(botToken);
    const userSlack = userToken ? new WebClient(userToken) : null;
    
    let result;
    
    // アクションに応じて処理
    switch (action) {
      case 'send_message':
        result = await slack.chat.postMessage({
          channel: args.channel,
          text: args.message || args.text
        });
        break;
        
      case 'list_channels':
        result = await slack.conversations.list({
          types: 'public_channel,private_channel',
          limit: args.limit || 100
        });
        break;
        
      case 'get_channel_history':
        result = await slack.conversations.history({
          channel: args.channel,
          limit: args.limit || 10
        });
        break;
        
      case 'list_users':
        result = await slack.users.list({
          limit: args.limit || 100
        });
        break;
        
      case 'get_user_info':
        result = await slack.users.info({
          user: args.user
        });
        break;
        
      case 'post_as_user':
        if (!userSlack) {
          throw new Error('User token not available. This action requires user authentication.');
        }
        result = await userSlack.chat.postMessage({
          channel: args.channel,
          text: args.message || args.text,
          as_user: true
        });
        break;
        
      case 'add_reaction':
        result = await slack.reactions.add({
          channel: args.channel,
          timestamp: args.timestamp,
          name: args.name
        });
        break;
        
      case 'upload_file':
        result = await slack.files.upload({
          channels: args.channels,
          content: args.content,
          filename: args.filename,
          title: args.title
        });
        break;
        
      default:
        throw new Error(`Unknown Slack action: ${action}`);
    }
    
    console.log('✅ Slack tool execution completed');
    return res.status(200).json({
      success: true,
      result: result
    });
    
  } catch (error) {
    console.error('❌ Slack tool execution error:', error);
    
    // エラーメッセージを改善
    let errorMessage = error.message;
    if (error.data?.error) {
      errorMessage = `Slack API error: ${error.data.error}`;
    }
    
    res.status(500).json({
      error: 'Slack tool execution failed',
      message: errorMessage,
      details: error.stack
    });
  }
}