import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let mcpClient = null;

async function getMCPClient() {
  if (!mcpClient) {
    console.log('🚀 Starting ElevenLabs MCP server...');
    
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', 'elevenlabs-mcp-enhanced'],
      env: {
        ...process.env,
        ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY
      }
    });
    
    mcpClient = new Client({
      name: 'elevenlabs-proxy',
      version: '1.0.0'
    }, {
      capabilities: {}
    });
    
    await mcpClient.connect(transport);
    console.log('✅ ElevenLabs MCP client connected');
  }
  return mcpClient;
}

// SSEでレスポンスを送信するヘルパー関数
function sendSSEMessage(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(req, res) {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // JSON-RPC 2.0形式のリクエストを解析
    const { jsonrpc, method, id, params } = req.body;
    
    // JSON-RPC 2.0形式でない場合はエラー
    if (jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request: Not a JSON-RPC 2.0 request'
        }
      });
    }

    const client = await getMCPClient();
    
    // SSE形式でレスポンスを返す
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    if (method === 'tools/list') {
      console.log('📋 Listing ElevenLabs MCP tools...');
      const tools = await client.listTools();
      console.log(`✅ Found ${tools.tools.length} tools`);
      
      // JSON-RPC 2.0形式のレスポンスをSSEで送信
      sendSSEMessage(res, {
        jsonrpc: '2.0',
        id: id,
        result: tools
      });
      
    } else if (method === 'tools/call') {
      console.log(`🔧 Calling tool: ${params.name}`);
      const result = await client.callTool(params);
      console.log('✅ Tool execution completed');
      
      // JSON-RPC 2.0形式のレスポンスをSSEで送信
      sendSSEMessage(res, {
        jsonrpc: '2.0',
        id: id,
        result: result
      });
      
    } else if (method === 'initialize') {
      // 初期化リクエストへの対応
      sendSSEMessage(res, {
        jsonrpc: '2.0',
        id: id,
        result: {
          protocolVersion: '1.0.0',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'elevenlabs-mcp-server',
            version: '1.0.0'
          }
        }
      });
      
    } else {
      // 未知のメソッド
      sendSSEMessage(res, {
        jsonrpc: '2.0',
        id: id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      });
    }
    
    // SSEストリームを終了
    res.end();
    
  } catch (error) {
    console.error('❌ ElevenLabs MCP error:', error);
    
    // エラーレスポンスもJSON-RPC 2.0形式で
    if (res.headersSent) {
      sendSSEMessage(res, {
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        }
      });
      res.end();
    } else {
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id || null,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        }
      });
    }
  }
}