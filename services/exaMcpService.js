import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class ExaMcpService {
  constructor() {
    this.client = null;
    this.transport = null;
  }

  async initialize() {
    if (this.client) {
      console.log('⚠️ Exa MCP service already initialized');
      return;
    }

    try {
      console.log('🚀 Starting Exa MCP server...');
      
      // StdioClientTransportを作成（これがサーバープロセスも起動する）
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', 'exa-mcp-server'],
        env: {
          ...process.env,
          EXA_API_KEY: process.env.EXA_API_KEY
        }
      });

      // MCPクライアントを作成
      this.client = new Client({
        name: 'anicca-exa-client',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      // クライアントを接続
      await this.client.connect(this.transport);
      
      console.log('✅ Exa MCP service initialized successfully');
      
      // listToolsは後で呼び出す（初期化時のエラーを避ける）
      // Zodエラーが発生しているため、一旦スキップ
      
    } catch (error) {
      console.error('❌ Failed to initialize Exa MCP service:', error);
      throw error;
    }
  }

  async search(query, options = {}) {
    if (!this.client) {
      throw new Error('Exa MCP service not initialized');
    }

    try {
      console.log(`🔍 Searching with Exa MCP: "${query}"`);
      console.log('🔧 Search options:', JSON.stringify(options, null, 2));
      
      // MCPツールを呼び出し - 正しいツール名は 'web_search_exa'
      const result = await this.client.callTool('web_search_exa', {
        query,
        ...options
      });

      console.log('✅ Exa MCP search completed');
      console.log('📊 Result:', JSON.stringify(result, null, 2));
      return result;
      
    } catch (error) {
      console.error('❌ Exa MCP search error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
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
      console.log('🔒 Exa MCP service closed');
    } catch (error) {
      console.error('❌ Error closing Exa MCP service:', error);
    }
  }
}

// シングルトンインスタンスをエクスポート
export const exaMcpService = new ExaMcpService();