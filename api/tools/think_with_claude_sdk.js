// Claude Code SDK版のthink_with_claude
// MCPサーバーを有効にして、Slackやファイル操作が可能

import { query } from '@anthropic-ai/claude-code';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 両方の形式に対応
    let task, context;
    
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    
    if (req.body.arguments) {
      // デスクトップ版形式: { arguments: { task: "...", context: "..." } }
      const args = typeof req.body.arguments === 'string' 
        ? JSON.parse(req.body.arguments) 
        : req.body.arguments;
      task = args.task;
      context = args.context;
      console.log('🔧 Using arguments format - task:', task);
    } else {
      // Web版形式: { task: "...", context: "..." }
      task = req.body.task;
      context = req.body.context;
      console.log('🔧 Using direct format - task:', task);
    }
    
    if (!task) {
      return res.status(400).json({ error: 'Task is required' });
    }

    // APIキーの設定
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return res.status(500).json({ error: 'Claude API key not configured' });
    }
    
    // プロキシモードの設定
    process.env.ANTHROPIC_API_KEY = anthropicApiKey;
    
    // MCPサーバーの設定
    const mcpServers = {};
    
    // Slack MCPサーバー（環境変数から）
    if (process.env.SLACK_BOT_TOKEN) {
      mcpServers.slack = {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-slack"],
        env: {
          SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
          SLACK_TEAM_ID: process.env.SLACK_TEAM_ID || ''
        }
      };
      console.log('✅ Slack MCP server configured');
    }
    
    // ElevenLabs MCPサーバー
    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || 'sk_7e0c9adc133c149e3c4f953ba6d5e15bcbbd79bdb2395c08';
    mcpServers.elevenlabs = {
      command: "uvx",
      args: ["elevenlabs-mcp"],
      env: {
        ELEVENLABS_API_KEY: elevenLabsApiKey
      }
    };
    console.log('✅ ElevenLabs MCP server configured');
    
    // ワークスペースディレクトリ（一時的）
    const workspaceRoot = path.join(os.tmpdir(), 'anicca-workspace', Date.now().toString());
    fs.mkdirSync(workspaceRoot, { recursive: true });
    console.log('📁 Workspace:', workspaceRoot);
    
    // Claude SDKで実行
    const messages = [];
    const prompt = `
作業ディレクトリ: ${workspaceRoot}

${task}
${context ? `\n追加コンテキスト: ${context}` : ''}

重要な指示：
- Slackへの投稿が必要な場合は、Slack MCPを使用してください
- ファイル作成が必要な場合は、作業ディレクトリ内に作成してください
- 日本語で回答してください
`;

    console.log('🚀 Executing with Claude SDK...');
    
    try {
      // SDKの実行
      let resultText = '';
      let toolsUsed = [];
      
      for await (const message of query({
        prompt,
        options: {
          maxTurns: 10,
          mcpServers: mcpServers,
          cwd: workspaceRoot,
          permissionMode: 'bypassPermissions'
        }
      })) {
        messages.push(message);
        
        // ログ出力
        if (message.type === 'assistant' && message.message?.content) {
          const content = message.message.content;
          if (Array.isArray(content)) {
            content.forEach(item => {
              if (item.type === 'text') {
                console.log('🤔 Claude:', item.text.substring(0, 150) + '...');
              } else if (item.type === 'tool_use') {
                console.log(`🔧 Using tool: ${item.name}`);
                toolsUsed.push(item.name);
              }
            });
          }
        }
      }
      
      // 結果を取得
      const resultMessage = messages.find(m => m.type === 'result');
      if (resultMessage && resultMessage.result) {
        resultText = resultMessage.result;
      } else {
        // assistantメッセージから結果を取得
        const assistantMessages = messages.filter(m => m.type === 'assistant');
        if (assistantMessages.length > 0) {
          const lastAssistant = assistantMessages[assistantMessages.length - 1];
          if (lastAssistant.message?.content) {
            const content = lastAssistant.message.content;
            resultText = content.map(c => c.text || '').join('\n');
          }
        }
      }
      
      console.log('✅ SDK execution completed');
      console.log('📤 Result:', resultText.substring(0, 200) + '...');
      
      // 生成されたファイルを確認
      const files = fs.readdirSync(workspaceRoot);
      if (files.length > 0) {
        console.log('📁 Generated files:', files);
      }
      
      return res.json({
        success: true,
        result: resultText,
        task: task,
        response: resultText,  // OpenAI形式との互換性
        toolsUsed: toolsUsed,
        generatedFiles: files
      });
      
    } catch (sdkError) {
      console.error('❌ Claude SDK error:', sdkError);
      throw sdkError;
    } finally {
      // クリーンアップ（必要に応じて）
      // fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }

  } catch (error) {
    console.error('think_with_claude_sdk error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
};