import { aciMcpService } from '../../services/aciMcpService.js';

// MCPサービスの初期化（一度だけ）
let isInitialized = false;

export default async function handler(req, res) {
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
    // MCPサービスを初期化（初回のみ）
    if (!isInitialized) {
      await aciMcpService.initialize();
      isInitialized = true;
    }
    
    const { task, context } = req.body;
    
    if (!task) {
      return res.status(400).json({ error: 'Task is required' });
    }
    
    console.log('🤖 ACI Task:', task);
    console.log('📋 Context:', context);
    
    // まず関連する機能を検索
    const searchQuery = `${task} ${context || ''}`.trim();
    const searchResult = await aciMcpService.searchFunctions(searchQuery);
    
    // 検索結果から最適な機能を選択して実行
    if (searchResult && searchResult.content && searchResult.content.length > 0) {
      const content = searchResult.content[0];
      
      // 検索結果をパース
      let functions = [];
      try {
        if (content.type === 'text') {
          const parsed = JSON.parse(content.text);
          functions = Array.isArray(parsed) ? parsed : [parsed];
        }
      } catch (e) {
        console.error('Failed to parse search results:', e);
      }
      
      // Slack関連の機能を優先的に選択
      const slackFunction = functions.find(f => 
        f.app_name?.toLowerCase().includes('slack') ||
        f.function_name?.toLowerCase().includes('slack')
      );
      
      if (slackFunction) {
        // Slack機能を実行
        const functionArgs = {};
        
        // タスクから必要な情報を抽出
        if (task.includes('メッセージ') || task.includes('message')) {
          // チャンネル名を抽出（#general, #ai-channel等）
          const channelMatch = task.match(/#[\w-]+/);
          if (channelMatch) {
            functionArgs.channel = channelMatch[0];
          }
          
          // メッセージ内容を抽出
          functionArgs.message = task;
        }
        
        const executeResult = await aciMcpService.executeFunction(
          slackFunction.app_name,
          slackFunction.function_name,
          functionArgs
        );
        
        return res.status(200).json({
          success: true,
          task: task,
          result: executeResult,
          function_used: `${slackFunction.app_name}.${slackFunction.function_name}`,
          _instruction: 'Task completed successfully. Please summarize the result for the user.'
        });
      }
    }
    
    // 適切な機能が見つからない場合
    return res.status(200).json({
      success: true,
      task: task,
      result: {
        message: 'No suitable ACI function found for this task. The user may need to authenticate with the required service first.',
        available_services: ['slack', 'google_calendar', 'github', 'gmail']
      },
      _instruction: 'Explain to the user that they need to connect their account first by clicking the service icon in the UI.'
    });
    
  } catch (error) {
    console.error('ACI MCP Error:', error);
    res.status(500).json({
      error: 'Failed to execute ACI task',
      message: error.message
    });
  }
}