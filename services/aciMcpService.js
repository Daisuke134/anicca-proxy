import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class AciMcpService {
  constructor() {
    this.client = null;
    this.transport = null;
    this.linkedAccountOwnerId = null;
  }

  async initialize() {
    if (this.client) {
      console.log('⚠️ ACI MCP service already initialized');
      return;
    }

    try {
      console.log('🚀 Starting ACI MCP server...');
      console.log('🔍 Environment check:');
      console.log('  ACI_API_KEY:', process.env.ACI_API_KEY ? 'Set' : 'Not set');
      console.log('  ACI_LINKED_ACCOUNT_OWNER_ID:', process.env.ACI_LINKED_ACCOUNT_OWNER_ID || 'Not set');
      
      this.linkedAccountOwnerId = process.env.ACI_LINKED_ACCOUNT_OWNER_ID || '';
      
      // ACIのMCPサーバーを起動
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: [
          '-y',
          'aci-mcp@latest',
          'unified-server',
          '--linked-account-owner-id',
          this.linkedAccountOwnerId
        ],
        env: {
          ...process.env,
          ACI_API_KEY: process.env.ACI_API_KEY
        }
      });

      // MCPクライアントを作成
      this.client = new Client({
        name: 'anicca-aci-client',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      // クライアントを接続
      await this.client.connect(this.transport);
      
      console.log('✅ ACI MCP client connected');
      
      // 利用可能なツールを確認
      try {
        console.log('📋 Listing available tools...');
        const tools = await this.client.listTools();
        console.log('🛠️ Available tools:', JSON.stringify(tools, null, 2));
      } catch (listError) {
        console.error('⚠️ Error listing tools:', listError);
      }
      
      console.log('✅ ACI MCP service initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize ACI MCP service:', error);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }

  async searchFunctions(query) {
    if (!this.client) {
      throw new Error('ACI MCP service not initialized');
    }

    try {
      console.log(`🔍 Searching ACI functions: "${query}"`);
      
      const result = await this.client.callTool({
        name: 'ACI_SEARCH_FUNCTIONS',
        arguments: {
          query: query
        }
      });

      console.log('✅ ACI function search completed');
      console.log('📊 Result:', JSON.stringify(result, null, 2));
      return result;
      
    } catch (error) {
      console.error('❌ ACI function search error:', error);
      throw error;
    }
  }

  async executeFunction(appName, functionName, functionArguments) {
    if (!this.client) {
      throw new Error('ACI MCP service not initialized');
    }

    try {
      console.log(`🚀 Executing ACI function: ${appName}.${functionName}`);
      console.log('📊 Arguments:', JSON.stringify(functionArguments, null, 2));
      
      const result = await this.client.callTool({
        name: 'ACI_EXECUTE_FUNCTION',
        arguments: {
          app_name: appName,
          function_name: functionName,
          function_arguments: functionArguments
        }
      });

      console.log('✅ ACI function execution completed');
      console.log('📊 Result:', JSON.stringify(result, null, 2));
      return result;
      
    } catch (error) {
      console.error('❌ ACI function execution error:', error);
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
      console.log('🔒 ACI MCP service closed');
    } catch (error) {
      console.error('❌ Error closing ACI MCP service:', error);
    }
  }
}

// シングルトンインスタンスをエクスポート
export const aciMcpService = new AciMcpService();