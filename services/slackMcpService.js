import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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

export class SlackMcpService {
  constructor() {
    this.client = null;
    this.transport = null;
  }

  async initialize() {
    if (this.client) {
      console.log('⚠️ Slack MCP service already initialized');
      return;
    }

    try {
      console.log('🚀 Starting Slack MCP server...');
      
      // トークンを取得（暗号化されている場合は復号化）
      let botToken = process.env.SLACK_BOT_TOKEN;
      let userToken = process.env.SLACK_USER_TOKEN;
      
      // グローバル変数から暗号化されたトークンを取得
      if (!botToken && global.slackBotToken) {
        botToken = decrypt(global.slackBotToken);
        process.env.SLACK_BOT_TOKEN = botToken;
      }
      if (!userToken && global.slackUserToken) {
        userToken = decrypt(global.slackUserToken);
        process.env.SLACK_USER_TOKEN = userToken;
      }
      
      if (!botToken) {
        throw new Error('Slack bot token not found. Please connect your Slack account first.');
      }
      
      console.log('🔑 Slack tokens found');
      
      // Slack MCPサーバーを起動
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: ['@ubie-oss/slack-mcp-server'],
        env: {
          ...process.env,
          SLACK_BOT_TOKEN: botToken,
          SLACK_USER_TOKEN: userToken || ''
        }
      });

      // MCPクライアントを作成
      this.client = new Client({
        name: 'anicca-slack-client',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      // クライアントを接続
      await this.client.connect(this.transport);
      
      console.log('✅ Slack MCP client connected');
      
      // 利用可能なツールを確認
      try {
        console.log('📋 Listing available Slack tools...');
        const tools = await this.client.listTools();
        console.log(`🛠️ Found ${tools.tools?.length || 0} Slack tools`);
        tools.tools?.forEach(tool => {
          console.log(`  - ${tool.name}: ${tool.description}`);
        });
      } catch (listError) {
        console.error('⚠️ Error listing tools:', listError);
      }
      
      console.log('✅ Slack MCP service initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize Slack MCP service:', error);
      throw error;
    }
  }

  async callTool(toolName, args) {
    if (!this.client) {
      await this.initialize();
    }

    try {
      console.log(`🔧 Calling Slack tool: ${toolName}`, args);
      const result = await this.client.callTool({
        name: toolName,
        arguments: args
      });
      console.log('✅ Tool execution completed');
      return result;
    } catch (error) {
      console.error(`❌ Slack tool error (${toolName}):`, error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.transport) {
        await this.transport.close();
      }
      this.client = null;
      this.transport = null;
      console.log('🔒 Slack MCP service closed');
    } catch (error) {
      console.error('❌ Error closing Slack MCP service:', error);
    }
  }
}

// シングルトンインスタンスをエクスポート
export const slackMcpService = new SlackMcpService();