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
    
    console.log('🔑 Token check - Bot:', !!botToken, 'User:', !!userToken);
    
    if (!botToken) {
      throw new Error('Slack is not connected. Please reconnect your Slack account.');
    }
    
    if (botToken && botToken.includes(':')) {
      botToken = decrypt(botToken);
      console.log('🔓 Bot token decrypted');
    }
    if (userToken && userToken.includes(':')) {
      userToken = decrypt(userToken);
      console.log('🔓 User token decrypted');
    }
    
    // Slack Web APIクライアントを作成
    // User Tokenを優先的に使用（全チャンネルアクセス可能）
    const primaryToken = userToken || botToken;
    const slack = new WebClient(primaryToken);
    const botSlack = new WebClient(botToken); // Bot専用の操作用
    
    console.log('🎯 Using token type:', userToken ? 'User Token' : 'Bot Token');
    
    // チャンネル名をIDに変換する関数
    async function resolveChannelId(channelNameOrId) {
      // すでにIDの形式（Cで始まる）ならそのまま返す
      if (channelNameOrId.match(/^[CGD][A-Z0-9]+$/)) {
        return channelNameOrId;
      }
      
      // #を削除
      const channelName = channelNameOrId.replace(/^#/, '');
      
      // チャンネル一覧を取得して名前で検索
      try {
        const channelsList = await slack.conversations.list({
          types: 'public_channel,private_channel',
          limit: 1000
        });
        
        const channel = channelsList.channels?.find(ch => ch.name === channelName);
        if (channel) {
          console.log(`🔄 Resolved channel name "${channelName}" to ID: ${channel.id}`);
          return channel.id;
        }
        
        throw new Error(`Channel "${channelName}" not found`);
      } catch (error) {
        console.error('Failed to resolve channel name:', error);
        throw error;
      }
    }
    
    let result;
    
    // アクションに応じて処理
    switch (action) {
      case 'send_message':
        // チャンネル名をIDに変換
        const sendChannelId = await resolveChannelId(args.channel);
        
        // Bot Tokenの場合のみチャンネル参加を試みる
        if (!userToken) {
          try {
            await botSlack.conversations.join({
              channel: sendChannelId
            });
          } catch (joinError) {
            // 既に参加している場合やプライベートチャンネルの場合はエラーを無視
          }
        }
        
        result = await slack.chat.postMessage({
          channel: sendChannelId,
          text: args.message || args.text
        });
        break;
        
      case 'list_channels':
        const listParams = {
          types: 'public_channel,private_channel',
          // exclude_archived: true, // 削除
          limit: args.limit || 1000
        };
        console.log('📤 Slack API params:', listParams);
        
        result = await slack.conversations.list(listParams);
        
        console.log('📥 Slack API response:', {
          ok: result.ok,
          channels_count: result.channels?.length || 0,
          next_cursor: result.response_metadata?.next_cursor || 'none'
        });
        break;
        
      case 'get_channel_history':
        // チャンネル名をIDに変換
        const historyChannelId = await resolveChannelId(args.channel);
        
        result = await slack.conversations.history({
          channel: historyChannelId,
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
        if (!userToken) {
          throw new Error('User token not available. This action requires user authentication.');
        }
        // チャンネル名をIDに変換
        const userChannelId = await resolveChannelId(args.channel);
        
        result = await slack.chat.postMessage({
          channel: userChannelId,
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
    console.log('📊 Result:', JSON.stringify(result, null, 2).substring(0, 500) + '...');
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