const { spawn } = require('child_process');

// MCPプロバイダーの設定
const MCP_PROVIDERS = {
  hackernews: {
    name: 'Hacker News',
    command: 'npx',
    args: ['-y', 'mcp-hn'],
    keywords: ['ニュース', 'news', 'hacker news', 'ハッカーニュース', '最新']
  },
  exa: {
    name: 'Exa Search',
    command: 'npx',
    args: ['-y', 'exa-mcp'],
    keywords: ['調べて', '検索', 'search', 'について', '教えて'],
    env: {
      EXA_API_KEY: process.env.EXA_API_KEY
    }
  }
};

// メッセージから適切なMCPを選択
function selectMCP(message) {
  const lowerMessage = message.toLowerCase();
  
  for (const [id, provider] of Object.entries(MCP_PROVIDERS)) {
    for (const keyword of provider.keywords) {
      if (lowerMessage.includes(keyword)) {
        return { id, provider };
      }
    }
  }
  
  // デフォルトはHackerNews
  return { id: 'hackernews', provider: MCP_PROVIDERS.hackernews };
}

// MCPを実行してツールを呼び出す
async function executeMCP(provider, toolName, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...provider.env };
    
    const mcpProcess = spawn(provider.command, provider.args, { env });
    
    let stdout = '';
    let stderr = '';
    
    mcpProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    mcpProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    mcpProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`MCP process exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    
    // MCPにコマンドを送信
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };
    
    mcpProcess.stdin.write(JSON.stringify(request) + '\n');
    mcpProcess.stdin.end();
  });
}

module.exports = async (req, res) => {
  // CORS設定
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
    const { message, toolName, args } = req.body;
    
    if (!message && !toolName) {
      return res.status(400).json({ error: 'Message or toolName is required' });
    }
    
    // メッセージからMCPを選択
    const { id, provider } = selectMCP(message || '');
    
    console.log(`Selected MCP: ${provider.name} for message: "${message}"`);
    
    // ツール名が指定されていない場合は、デフォルトのツールを使用
    const tool = toolName || (id === 'hackernews' ? 'get_top_stories' : 'search');
    const toolArgs = args || {};
    
    // MCPを実行
    const result = await executeMCP(provider, tool, toolArgs);
    
    res.status(200).json({
      success: true,
      provider: provider.name,
      result: JSON.parse(result)
    });
    
  } catch (error) {
    console.error('MCP Router Error:', error);
    res.status(500).json({
      error: 'Failed to execute MCP',
      message: error.message
    });
  }
};