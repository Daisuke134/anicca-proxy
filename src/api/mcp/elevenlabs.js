import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let mcpClient = null;

async function getMCPClient() {
  if (!mcpClient) {
    console.log('🚀 Starting ElevenLabs MCP server...');
    
    const transport = new StdioClientTransport({
      command: 'uvx',
      args: ['elevenlabs-mcp'],
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

export default async function handler(req, res) {
  // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { method, params } = req.body;
    const client = await getMCPClient();
    
    if (method === 'tools/list') {
      console.log('📋 Listing ElevenLabs MCP tools...');
      const tools = await client.listTools();
      console.log(`✅ Found ${tools.tools.length} tools`);
      res.json(tools);
    } else if (method === 'tools/call') {
      console.log(`🔧 Calling tool: ${params.name}`);
      const result = await client.callTool(params);
      console.log('✅ Tool execution completed');
      res.json(result);
    } else {
      res.status(400).json({ error: 'Invalid method' });
    }
  } catch (error) {
    console.error('❌ ElevenLabs MCP error:', error);
    res.status(500).json({ error: error.message });
  }
}