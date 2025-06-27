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
      console.log('🔍 Environment check:');
      console.log('  NODE_ENV:', process.env.NODE_ENV);
      console.log('  Railway environment?', process.env.RAILWAY_ENVIRONMENT ? 'Yes' : 'No');
      console.log('  EXA_API_KEY:', process.env.EXA_API_KEY ? 'Set' : 'Not set');
      
      // StdioClientTransportを作成（これがサーバープロセスも起動する）
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: [
          '-y', 
          'exa-mcp-server',
          '--tools=web_search_exa,research_paper_search,company_research,crawling,competitor_finder,linkedin_search,wikipedia_search_exa,github_search'
        ],
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
      
      console.log('✅ Exa MCP client connected');
      
      // 利用可能なツールを確認
      try {
        console.log('📋 Listing available tools...');
        const tools = await this.client.listTools();
        console.log('🛠️ Available tools:', JSON.stringify(tools, null, 2));
      } catch (listError) {
        console.error('⚠️ Error listing tools:', listError);
        // エラーがあっても続行
      }
      
      console.log('✅ Exa MCP service initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize Exa MCP service:', error);
      console.error('Error stack:', error.stack);
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
      
      // MCPツールを呼び出し
      // 注意: callToolの第一引数はツール名、第二引数は {arguments: {...}} の形式
      const result = await this.client.callTool({
        name: 'web_search_exa',
        arguments: {
          query,
          ...options
        }
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