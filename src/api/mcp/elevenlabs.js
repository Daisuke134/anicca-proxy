import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from
'@modelcontextprotocol/sdk/client/stdio.js';

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

    mcpClient = new Client(
      {
        name: 'elevenlabs-proxy',
        version: '1.0.0'
      },
      {
        capabilities: {}
      }
    );

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

    // MCPプロトコルの必須メソッドをすべて明示的に処理
    switch (method) {
      case 'initialize':
        sendSSEMessage(res, {
          jsonrpc: '2.0',
          id: id,
          result: {
            protocolVersion: '2024-11-05',  // SSEプロトコルバージョン
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'elevenlabs-mcp-proxy',
              version: '1.0.0'
            }
          }
        });
        break;

      case 'tools/list':
        console.log('📋 Listing ElevenLabs MCP tools...');
        const tools = await client.listTools();
        console.log(`✅ Found ${tools.tools.length} tools`);
        sendSSEMessage(res, {
          jsonrpc: '2.0',
          id: id,
          result: tools
        });
        break;

      case 'tools/call':
        console.log(`🔧 Calling tool: ${params.name}`);
        const result = await client.callTool(params);
        console.log('✅ Tool execution completed');
        sendSSEMessage(res, {
          jsonrpc: '2.0',
          id: id,
          result: result
        });
        break;

      case 'resources/list':
        const resources = await client.listResources();
        sendSSEMessage(res, {
          jsonrpc: '2.0',
          id: id,
          result: resources
        });
        break;

      case 'resources/read':
        const resource = await client.readResource(params);
        sendSSEMessage(res, {
          jsonrpc: '2.0',
          id: id,
          result: resource
        });
        break;

      case 'prompts/list':
        const prompts = await client.listPrompts();
        sendSSEMessage(res, {
          jsonrpc: '2.0',
          id: id,
          result: prompts
        });
        break;

      case 'prompts/get':
        const prompt = await client.getPrompt(params);
        sendSSEMessage(res, {
          jsonrpc: '2.0',
          id: id,
          result: prompt
        });
        break;

      default:
        // 本当に未知のメソッドの場合のみ
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