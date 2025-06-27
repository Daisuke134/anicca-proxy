import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class ExaMcpService {
  constructor() {
    this.client = null;
    this.transport = null;
    this.serverProcess = null;
  }

  async initialize() {
    if (this.client) {
      console.log('⚠️ Exa MCP service already initialized');
      return;
    }

    try {
      console.log('🚀 Starting Exa MCP server...');
      
      // Exa MCPサーバーを起動
      this.serverProcess = spawn('npx', ['-y', 'exa-mcp-server'], {
        env: {
          ...process.env,
          EXA_API_KEY: process.env.EXA_API_KEY
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // エラー処理
      this.serverProcess.stderr.on('data', (data) => {
        console.error('❌ Exa MCP server error:', data.toString());
      });

      this.serverProcess.on('error', (error) => {
        console.error('❌ Failed to start Exa MCP server:', error);
        throw error;
      });

      this.serverProcess.on('exit', (code) => {
        console.log(`Exa MCP server exited with code ${code}`);
      });

      // MCPクライアントを作成
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', 'exa-mcp-server'],
        env: {
          ...process.env,
          EXA_API_KEY: process.env.EXA_API_KEY
        }
      });

      this.client = new Client({
        name: 'anicca-exa-client',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      // クライアントを接続
      await this.client.connect(this.transport);
      
      console.log('✅ Exa MCP service initialized successfully');
      
      // 利用可能なツールを確認
      const tools = await this.client.listTools();
      console.log('🔧 Available Exa tools:', tools);
      
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
      
      // MCPツールを呼び出し
      const result = await this.client.callTool('search', {
        query,
        ...options
      });

      console.log('✅ Exa MCP search completed');
      return result;
      
    } catch (error) {
      console.error('❌ Exa MCP search error:', error);
      throw error;
    }
  }

  async close() {
    if (this.transport) {
      await this.transport.close();
    }
    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill();
    }
    this.client = null;
    this.transport = null;
    this.serverProcess = null;
    console.log('🔒 Exa MCP service closed');
  }
}

// シングルトンインスタンスをエクスポート
export const exaMcpService = new ExaMcpService();