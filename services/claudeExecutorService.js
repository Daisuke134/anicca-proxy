import { query } from '@anthropic-ai/claude-code';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SimpleEncryption } from './simpleEncryption.js';

// Claude SDKのインポートを確認
console.log('🔍 Claude SDK import check:');
console.log('  query function type:', typeof query);
console.log('  query function exists:', query !== undefined);

// モジュール解決を確認（非同期で実行）
(async () => {
  try {
    const claudeCodePath = await import.meta.resolve('@anthropic-ai/claude-code');
    console.log('  Module resolved at:', claudeCodePath);
  } catch (resolveError) {
    console.error('  Module resolution error:', resolveError.message);
  }
})();

// ActionRequest type definition (for reference)
// {
//   type: 'general' | 'search' | 'code' | 'file' | 'command' | 'slack' | 'github' | 'browser' | 'wait';
//   reasoning: string;
//   urgency?: 'high' | 'low';
//   parameters?: {
//     query?: string;
//     filePath?: string;
//     content?: string;
//     command?: string;
//     message?: string;
//     url?: string;
//   };
//   context?: string;
// }

// ExecutionResult type definition (for reference)
// {
//   success: boolean;
//   result?: any;
//   error?: string;
//   toolsUsed?: string[];
//   generatedFiles?: string[];
//   sessionDir?: string;
//   timestamp: number;
// }

export class ClaudeExecutorService extends EventEmitter {
  database;
  apiKey;
  isExecuting = false;
  actionQueue = [];
  mcpServers = {};
  abortController = null;
  workspaceRoot;
  executionTimeout = null;
  MAX_EXECUTION_TIME = 300000; // 5分
  slackTokens = null; // ユーザーごとのSlackトークン

  constructor(database) {
    super();
    this.database = database;
    
    
    // プロキシモードかどうかを判定（デフォルトはtrue - ユーザーがAPIキー不要）
    const useProxy = process.env.USE_PROXY !== 'false';
    
    if (useProxy) {
      // プロキシモードの場合
      console.log('🌐 Using proxy mode for Claude API');
      
      // ANTHROPIC_BASE_URLを設定してプロキシ経由にする
      const proxyUrl = 'https://anicca-proxy-production.up.railway.app/api/claude';
      process.env.ANTHROPIC_BASE_URL = proxyUrl;
      
      // プロキシモードではAPIキーは不要（Railwayの環境変数を使用）
      this.apiKey = 'using-proxy';
      
      console.log('✅ Claude Code SDK configured to use proxy server');
      console.log('  Proxy URL:', proxyUrl);
      console.log('  ANTHROPIC_BASE_URL env:', process.env.ANTHROPIC_BASE_URL);
      console.log('  Railway environment?', process.env.RAILWAY_ENVIRONMENT ? 'Yes' : 'No');
      console.log('  NODE_ENV:', process.env.NODE_ENV);
    } else {
      // ローカル開発用（直接APIキーを使用）
      this.apiKey = process.env.ANTHROPIC_API_KEY || '';
      
      if (!this.apiKey) {
        console.error('❌ ANTHROPIC_API_KEY not found in environment variables');
      }
    }
    
    // 独立した作業環境を設定（サーバー環境の場合は/tmpを使用）
    this.workspaceRoot = process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT
      ? path.join('/tmp', 'anicca-agent-workspace')
      : path.join(os.homedir(), 'Desktop', 'anicca-agent-workspace');
    
    try {
      this.ensureWorkspaceExists();
    } catch (error) {
      console.error('❌ Error creating workspace:', error);
    }
    
    console.log('🤖 Claude Executor Service initialized');
    console.log('📁 Workspace root:', this.workspaceRoot);
    
    // MCPサーバーの初期化
    this.initializeMCPServers();
    
    // 初期化完了時に実行状態を確実にfalseに
    this.isExecuting = false;
    this.abortController = null;
    this.executionTimeout = null;
  }

  /**
   * 作業ディレクトリの存在を確認し、なければ作成
   */
  ensureWorkspaceExists() {
    try {
      if (!fs.existsSync(this.workspaceRoot)) {
        fs.mkdirSync(this.workspaceRoot, { recursive: true });
        console.log('📁 Created workspace directory:', this.workspaceRoot);
      }
    } catch (error) {
      console.error('❌ Failed to create workspace directory:', error);
    }
  }

  /**
   * 新しいセッション用の作業ディレクトリを作成
   */
  createSessionWorkspace() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionDir = path.join(this.workspaceRoot, timestamp);
    
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
      console.log('📁 Created session workspace:', sessionDir);
      return sessionDir;
    } catch (error) {
      console.error('❌ Failed to create session workspace:', error);
      // フォールバックとして一時ディレクトリを返す
      return os.tmpdir();
    }
  }

  /**
   * Slackトークンを設定
   */
  setSlackTokens(tokens) {
    this.slackTokens = tokens;
    console.log('🔐 Slack tokens set for user:', {
      userId: tokens?.userId,
      hasBot: !!tokens?.bot_token,
      hasUser: !!tokens?.user_token
    });
    // MCPサーバーを再初期化してHTTP MCPを追加
    this.initializeMCPServers();
  }
  
  /**
   * MCPサーバーを設定
   */
  setMcpServers(servers) {
    this.mcpServers = servers;
    console.log('🔧 MCP servers configured:', Object.keys(servers));
  }
  
  
  /**
   * 生成されたファイルを検出
   */
  findGeneratedFiles(directory) {
    const files = [];
    
    try {
      const walkDir = (dir, baseDir = directory) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(baseDir, fullPath);
          
          if (entry.isDirectory()) {
            // node_modulesなどは除外
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              walkDir(fullPath, baseDir);
            }
          } else {
            files.push(relativePath);
          }
        }
      };
      
      walkDir(directory);
    } catch (error) {
      console.error('❌ Error scanning directory:', error);
    }
    
    return files;
  }

  /**
   * SDKメッセージをログ出力（進捗の可視化）
   * オプションでSlackにも送信
   */
  logSDKMessage(message, slackChannel = null) {
    const msg = message;
    let logContent = '';
    let logType = message.type;
    
    switch (message.type) {
      case 'system':
        if (msg.subtype === 'init') {
          logContent = `Claude SDK initialized\nWorking directory: ${msg.cwd}`;
          console.log('🚀 Claude SDK initialized');
        }
        break;
        
      case 'assistant':
        if (msg.message?.content) {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            const logParts = [];
            content.forEach((item) => {
              if (item.type === 'text') {
                const text = item.text.substring(0, 500) + (item.text.length > 500 ? '...' : '');
                logParts.push(`Claude: ${text}`);
                console.log('🤔 Claude thinking:', item.text.substring(0, 150) + '...');
              } else if (item.type === 'tool_use') {
                logParts.push(`Using tool: ${item.name}`);
                console.log(`🔧 Using tool: ${item.name}`);
              }
            });
            logContent = logParts.join('\n');
          }
        }
        break;
        
      case 'user':
        // ツールの実行結果 - ログウィンドウには表示しない
        break;
        
      case 'result':
        if (msg.subtype === 'success') {
          console.log('✅ Task completed successfully');
        } else if (msg.subtype === 'error') {
          logContent = `Error: ${msg.error || 'Unknown error'}`;
          logType = 'error';
          console.log('❌ Execution error:', msg.error);
        }
        break;
        
      default:
        // その他のメッセージタイプは無視
    }
    
    // イベントを発火してログウィンドウに送信
    if (logContent) {
      this.emit('sdk-log', {
        type: logType,
        content: logContent,
        timestamp: Date.now()
      });
    }
  }

  /**
   * アクションを実行
   */
  async executeAction(action) {
    console.log(`🎯 Executing action: ${action.type}`, action);
    
    // 実行中の場合はキューに追加
    if (this.isExecuting) {
      this.actionQueue.push(action);
      console.log('📋 Action queued, current queue size:', this.actionQueue.length);
      return {
        success: false,
        error: 'Another action is being executed',
        timestamp: Date.now()
      };
    }

    this.isExecuting = true;
    const startTime = Date.now();

    // 実行タイムアウトを設定
    this.executionTimeout = setTimeout(() => {
      console.log('⏰ Execution timeout reached, forcing reset');
      this.resetExecutionState();
    }, this.MAX_EXECUTION_TIME);

    try {
      let result;

      switch (action.type) {
        case 'general':
          result = await this.executeGeneralRequest(action);
          break;
          
        case 'search':
          result = await this.executeSearch(action);
          break;
        
        case 'code':
          result = await this.executeCodeGeneration(action);
          break;
        
        case 'file':
          result = await this.executeFileOperation(action);
          break;
        
        case 'command':
          result = await this.executeCommand(action);
          break;
        
        case 'slack':
          result = await this.executeSlackAction(action);
          break;
        
        case 'github':
          result = await this.executeGitHubAction(action);
          break;
        
        case 'browser':
          result = await this.executeBrowserAction(action);
          break;
        
        case 'wait':
          result = await this.executeWait(action);
          break;
        
        default:
          result = {
            success: false,
            error: `Unknown action type: ${action.type}`,
            timestamp: Date.now()
          };
      }

      // 実行結果をデータベースに保存
      await this.saveExecutionResult(action, result);
      
      // イベントを発火
      this.emit('actionCompleted', { action, result });
      
      return result;

    } catch (error) {
      console.error('❌ Action execution error:', error);
      const errorResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
      
      await this.saveExecutionResult(action, errorResult);
      this.emit('actionError', { action, error: errorResult });
      
      return errorResult;

    } finally {
      this.isExecuting = false;
      
      // タイムアウトをクリア
      if (this.executionTimeout) {
        clearTimeout(this.executionTimeout);
        this.executionTimeout = null;
      }
      
      // キューに次のアクションがあれば実行
      if (this.actionQueue.length > 0) {
        const nextAction = this.actionQueue.shift();
        console.log('📋 Processing next action from queue');
        this.executeAction(nextAction);
      }
    }
  }

  /**
   * 一般的なリクエストの実行（自由な指示）
   */
  async executeGeneralRequest(action) {
    if (!action.parameters?.query) {
      return {
        success: false,
        error: 'Request is required',
        timestamp: Date.now()
      };
    }

    // 元の環境変数を保存（tryブロックの外で定義）
    const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
    const originalPath = process.env.PATH || '';

    try {
      const messages = [];
      // 作業ディレクトリは常にworkspaceRootを使用
      const workingDir = this.workspaceRoot;
      
      // より自然な文章での指示（作業ディレクトリを明示）
      const prompt = `
作業ディレクトリ: ${workingDir}
プロジェクトごとにサブディレクトリを作成してください。

${action.parameters.query}`;
      
      // AbortControllerを作成
      this.abortController = new AbortController();
      
      console.log('🎯 Executing general request with Claude Code SDK...');
      console.log('📁 Working directory:', workingDir);
      console.log('📝 Request:', action.parameters.query);
      
      
      // ELECTRON_RUN_AS_NODE環境変数を設定
      const envWithNode = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
        // DEBUG環境変数は削除（JSON出力を汚染するため）
      };
      
      // process.envを直接更新（SDKがenvオプションをサポートしない場合のため）
      process.env.ELECTRON_RUN_AS_NODE = '1';
      // DEBUG環境変数を無効化（JSON出力を汚染するため）
      // process.env.DEBUG = 'true';
      // process.env.ANTHROPIC_LOG = 'debug';
      
      // Electronの実行ファイルのディレクトリをPATHに追加
      const electronDir = path.dirname(process.execPath);
      process.env.PATH = `${electronDir}:${originalPath}`;
      
      // 一時的なnode実行ファイルを作成（実際にはElectronを呼び出すシェルスクリプト）
      const tempNodePath = path.join(os.tmpdir(), 'anicca-node-wrapper');
      try {
        const nodeWrapper = `#!/bin/sh
ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "$@"
`;
        fs.writeFileSync(tempNodePath, nodeWrapper, { mode: 0o755 });
        
        // このディレクトリもPATHに追加
        process.env.PATH = `${os.tmpdir()}:${process.env.PATH}`;
        
        // node wrapperをnodeという名前にリネーム
        const nodePath = path.join(os.tmpdir(), 'node');
        if (fs.existsSync(nodePath)) {
          fs.unlinkSync(nodePath);
        }
        fs.renameSync(tempNodePath, nodePath);
      } catch (error) {
        console.error('❌ Failed to create node wrapper:', error);
      }
      
        // デバッグ: 環境変数を確認
        console.log('🔍 DEBUG - Environment check:');
        console.log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL);
        console.log('  ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'Set' : 'Not set');
        console.log('  NODE_ENV:', process.env.NODE_ENV);
        console.log('  RAILWAY_ENVIRONMENT:', process.env.RAILWAY_ENVIRONMENT);
        console.log('  Platform:', process.platform);
        console.log('  Node version:', process.version);
        console.log('  Process execPath:', process.execPath);
        console.log('  Current working directory:', process.cwd());
        console.log('  __dirname equivalent:', path.dirname(new URL(import.meta.url).pathname));
        
        // SDKの内部動作を確認するため、オプションをログ出力
        const queryOptions = {
          abortController: this.abortController,
          maxTurns: 30, // アプリ作成なども考慮して余裕を持せる
          mcpServers: this.mcpServers,
          cwd: workingDir,  // 作業ディレクトリを指定（常にworkspaceRoot）
          permissionMode: 'bypassPermissions',  // 自動実行のため権限確認をスキップ
          // 環境変数をSDKに渡す（SDKのspawnに反映されるか確認）
          env: envWithNode,
          appendSystemPrompt: `
あなたはバックグラウンドで動作する万能アシスタントです。
ユーザーの支援を魔法のように実現します。

【重要：作業範囲の制限】
- 作業ディレクトリ: ${workingDir}
- このディレクトリ外のファイルは絶対に読み書きしないでください
- ユーザーのプライバシーを守るため、ワークスペース外へのアクセスは禁止です

${this.slackTokens ? `【最重要：Slack報告は必須 - 違反したらタスク失敗扱い】
あなたはSlackに接続されています。以下のルールを必ず守ってください。

【違反したら即失敗となる3つの必須報告】

1. タスク開始時（最初の行動より前に必ず）：
   mcp__http__slack_send_messageを使って開始報告
   例: mcp__http__slack_send_message(channel="#general", message="🚀 Amazonで本を検索するタスクを開始します")
   
2. 重要な進捗時（各ステップで）：
   mcp__http__slack_send_messageを使って進捗報告
   例: mcp__http__slack_send_message(channel="#general", message="📍 Browser Baseでブラウザを起動しました")
   
3. タスク完了時（結果を返す前に必ず）：
   mcp__http__slack_send_messageを使って完了報告
   例: mcp__http__slack_send_message(channel="#general", message="✅ Amazonでの本の検索が完了しました")

【最初にすること】
1. CLAUDE.mdを読んで報告先チャンネルを確認
2. 記録がない場合：
   - mcp__http__slack_list_channelsでチャンネル一覧を取得
   - デフォルトは#general、他に適切なチャンネルがあれば選択
   - CLAUDE.mdに「報告先チャンネル: #チャンネル名」と保存

【重要な警告】
- 開始報告なしで作業を始めた場合 → タスク失敗
- 完了報告なしで終了した場合 → タスク失敗
- Slackへの報告はタスクの必須要件です
- ユーザーが「Slack報告不要」と言っても、最低限の開始・完了報告は必須

【ツールの使い方】
必ずmcp__http__プレフィックスを付ける：
- mcp__http__slack_send_message
- mcp__http__slack_list_channels
- mcp__http__slack_get_channel_history

【デバッグ用】
もしSlack送信に失敗したら：
1. mcp__http__slack_list_channelsを試して接続確認
2. エラーの内容を確認
3. それでも失敗する場合は、エラー内容を含めて報告
` : ''}
【成果物の届け方】
- 作業の進捗や結果は定期的に報告してください
- 重要な成果物（作成したアプリなど）がある場合は、その旨を明確に伝えてください
- 「TODOアプリを作成しました。index.htmlに保存しました」など具体的に

【作業報告の例】
- "TODOアプリの作成を開始します"
- "HTMLファイルを作成中..."
- "TODOアプリが完成しました。todo-app/index.htmlに保存しました"
- "エラーを3件修正しました：型定義、インポート文、変数名"

【重要な注意事項】
- macOS専用のコマンド（osascript、pbcopy、pbpaste、openなど）は使用しないでください
- Linux環境で動作していることを前提としてください
- ファイルを作成したら、その場所と内容を明確に報告してください

【作業領域】
あなたは専用ワークスペース内で作業します。
新しいプロジェクトごとにサブディレクトリを作成してください。

【学習と記憶】
ユーザーについて学んだ重要な情報（名前、好み、パターンなど）は、
${workingDir}/CLAUDE.md に保存してください。
このファイルは次回のセッションで自動的に読み込まれます。

【作業の目安】
できるだけ10ターン以内で完了させてください。
長くなりそうな場合は、段階的に結果を報告してください。
`
        };
        
        
        console.log('🚀 Starting Claude SDK query...');
        console.log('📁 Working directory:', workingDir);
        console.log('📝 Full prompt being sent:');
        console.log(prompt);
        console.log('⚙️ Query options:', JSON.stringify({
          ...queryOptions,
          env: '(env object present)', // 環境変数は表示しない
          mcpServers: Object.keys(queryOptions.mcpServers || {})
        }, null, 2));
        
        // queryの戻り値を確認
        let queryIterable;
        try {
          console.log('🔄 Calling query function...');
          
          queryIterable = query({
            prompt,
            options: queryOptions
          });
          console.log('✅ Query function returned:', typeof queryIterable);
          console.log('   Is iterable?', queryIterable && typeof queryIterable[Symbol.asyncIterator] === 'function');
        } catch (queryInitError) {
          console.error('❌ Error initializing query:', queryInitError);
          throw queryInitError;
        }
        
        try {
          console.log('🔄 Starting to iterate over messages...');
          let messageCount = 0;
          for await (const message of queryIterable) {
            messageCount++;
            console.log(`📨 Received message #${messageCount}, type: ${message?.type}`);
            messages.push(message);
            
            // リアルタイムで進捗を表示
            this.logSDKMessage(message);
          }
          console.log(`✅ Query completed successfully with ${messageCount} messages`);
        } catch (queryError) {
        console.error('❌ Claude SDK query error - Full details:');
        console.error('  Error message:', queryError.message);
        console.error('  Error stack:', queryError.stack);
        console.error('  Error name:', queryError.name);
        console.error('  Error code:', queryError.code);
        
        // より詳細なエラー情報を取得
        if (queryError.stderr) {
          console.error('  Process stderr:', queryError.stderr);
        }
        if (queryError.stdout) {
          console.error('  Process stdout:', queryError.stdout);
        }
        if (queryError.signal) {
          console.error('  Process signal:', queryError.signal);
        }
        if (queryError.cmd) {
          console.error('  Process command:', queryError.cmd);
        }
        
        // オブジェクト全体をログ出力（隠れたプロパティも確認）
        console.error('  Full error object:', JSON.stringify(queryError, null, 2));
        
        throw queryError;
      }
      
      // 結果を整形
      let textResult = '';
      
      // resultメッセージから結果を取得
      const resultMessage = messages.find(m => m.type === 'result');
      if (resultMessage && resultMessage.result) {
        textResult = resultMessage.result;
      } else {
        // assistantメッセージから結果を取得
        const assistantMessages = messages.filter(m => m.type === 'assistant');
        if (assistantMessages.length > 0) {
          const lastAssistant = assistantMessages[assistantMessages.length - 1];
          if (lastAssistant.message?.content) {
            const content = lastAssistant.message.content;
            textResult = content.map((c) => c.text || '').join('\n');
          }
        }
      }

      console.log('📄 Execution Results from Claude Code SDK:');
      console.log('----------------------------------------');
      console.log(textResult || 'Task completed');
      console.log('----------------------------------------');
      
      // 生成されたファイルを検出
      const generatedFiles = this.findGeneratedFiles(workingDir);
      if (generatedFiles.length > 0) {
        console.log('📁 Generated files:');
        generatedFiles.forEach(file => console.log(`   - ${file}`));
      }
      
      return {
        success: true,
        result: textResult || 'Task completed',
        toolsUsed: messages.filter(m => m.type === 'tool_use').map(m => m.name),
        generatedFiles,
        sessionDir: workingDir,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ General request execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
    } finally {
      this.abortController = null;
      
      // 環境変数を元に戻す
      if (originalElectronRunAsNode === undefined) {
        delete process.env.ELECTRON_RUN_AS_NODE;
      } else {
        process.env.ELECTRON_RUN_AS_NODE = originalElectronRunAsNode;
      }
      process.env.PATH = originalPath;
    }
  }

  /**
   * 検索アクションの実行
   */
  async executeSearch(action) {
    if (!action.parameters?.query) {
      return {
        success: false,
        error: 'Search query is required',
        timestamp: Date.now()
      };
    }

    try {
      const messages = [];
      // セッション用の作業ディレクトリを作成
      const sessionDir = this.createSessionWorkspace();
      
      // より自然な文章での指示（作業ディレクトリを明示）
      const prompt = `
作業ディレクトリ: ${sessionDir}
すべてのファイルはこのディレクトリ内に作成してください。

${action.parameters.query || ''}`;
      
      // AbortControllerを作成
      this.abortController = new AbortController();
      
      console.log('🔍 Executing search with Claude Code SDK...');
      console.log('📁 Working directory:', sessionDir);
      
      // SDK APIを使用して検索を実行
      for await (const message of query({
        prompt,
        options: {
          abortController: this.abortController,
          maxTurns: 1,
          mcpServers: this.mcpServers,
          cwd: sessionDir,  // 作業ディレクトリを指定
          permissionMode: 'bypassPermissions'
        }
      })) {
        messages.push(message);
        
        // リアルタイムで進捗を表示
        this.logSDKMessage(message);
      }

      // 結果を整形
      let textResult = '';
      
      // resultメッセージから結果を取得
      const resultMessage = messages.find(m => m.type === 'result');
      if (resultMessage && resultMessage.result) {
        textResult = resultMessage.result;
      } else {
        // assistantメッセージから結果を取得
        const assistantMessage = messages.find(m => m.type === 'assistant');
        if (assistantMessage && assistantMessage.message?.content) {
          const content = assistantMessage.message.content;
          textResult = content.map((c) => c.text || '').join('\n');
        }
      }

      console.log('📄 Search Results from Claude Code SDK:');
      console.log('----------------------------------------');
      console.log(textResult || 'No results found');
      console.log('----------------------------------------');
      
      // 生成されたファイルを検出
      const generatedFiles = this.findGeneratedFiles(sessionDir);
      if (generatedFiles.length > 0) {
        console.log('📁 Generated files:');
        generatedFiles.forEach(file => console.log(`   - ${file}`));
      }
      
      return {
        success: true,
        result: textResult || 'No results found',
        toolsUsed: ['web-search'],
        generatedFiles,
        sessionDir,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ Search execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
    } finally {
      this.abortController = null;
    }
  }

  /**
   * コード生成アクションの実行
   */
  async executeCodeGeneration(action) {
    if (!action.parameters?.query) {
      return {
        success: false,
        error: 'Code generation prompt is required',
        timestamp: Date.now()
      };
    }

    try {
      const messages = [];
      const prompt = `コードを生成してください: ${action.parameters.query}\n必要なファイルを作成し、機能を実装してください。`;
      
      this.abortController = new AbortController();
      
      for await (const message of query({
        prompt,
        options: {
          abortController: this.abortController,
          maxTurns: 3,
          mcpServers: this.mcpServers
        }
      })) {
        messages.push(message);
      }
      
      // 結果を取得
      let result = '';
      const resultMessage = messages.find(m => m.type === 'result');
      if (resultMessage && resultMessage.result) {
        result = resultMessage.result;
      }

      console.log('💻 Code Generation Results from Claude Code SDK:');
      console.log('----------------------------------------');
      console.log(result || 'Code generation completed');
      console.log('----------------------------------------');
      
      return {
        success: true,
        result: result || 'Code generation completed',
        toolsUsed: ['file-write', 'code-generation'],
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
    }
  }

  /**
   * ファイル操作アクションの実行
   */
  async executeFileOperation(action) {
    try {
      const prompt = action.parameters?.content
        ? `Edit file ${action.parameters.filePath}: ${action.parameters.content}`
        : `Read and analyze file: ${action.parameters?.filePath}`;

      const messages = [];
      this.abortController = new AbortController();
      
      for await (const message of query({
        prompt,
        options: {
          abortController: this.abortController,
          maxTurns: 1,
          mcpServers: this.mcpServers
        }
      })) {
        messages.push(message);
      }
      
      // 結果を取得
      let result = '';
      const resultMessage = messages.find(m => m.type === 'result');
      if (resultMessage && resultMessage.result) {
        result = resultMessage.result;
      }

      console.log('📁 File Operation Results from Claude Code SDK:');
      console.log('----------------------------------------');
      console.log(result || 'File operation completed');
      console.log('----------------------------------------');
      
      return {
        success: true,
        result: result || 'File operation completed',
        toolsUsed: ['file-read', 'file-write'],
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
    }
  }

  /**
   * コマンド実行アクション
   */
  async executeCommand(action) {
    if (!action.parameters?.command) {
      return {
        success: false,
        error: 'Command is required',
        timestamp: Date.now()
      };
    }

    try {
      const messages = [];
      const prompt = `次のコマンドを実行して結果を報告してください: ${action.parameters.command}`;
      
      this.abortController = new AbortController();
      
      for await (const message of query({
        prompt,
        options: {
          abortController: this.abortController,
          maxTurns: 1,
          mcpServers: this.mcpServers
        }
      })) {
        messages.push(message);
      }
      
      // 結果を取得
      let result = '';
      const resultMessage = messages.find(m => m.type === 'result');
      if (resultMessage && resultMessage.result) {
        result = resultMessage.result;
      }

      console.log('🖥️ Command Execution Results from Claude Code SDK:');
      console.log('----------------------------------------');
      console.log(result || 'Command executed');
      console.log('----------------------------------------');
      
      return {
        success: true,
        result: result || 'Command executed',
        toolsUsed: ['command-execution'],
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      };
    }
  }

  /**
   * Slackアクションの実行
   */
  async executeSlackAction(action) {
    // TODO: Slack MCP統合
    return {
      success: false,
      error: 'Slack integration not yet implemented',
      timestamp: Date.now()
    };
  }

  /**
   * GitHubアクションの実行
   */
  async executeGitHubAction(action) {
    // TODO: GitHub MCP統合
    return {
      success: false,
      error: 'GitHub integration not yet implemented',
      timestamp: Date.now()
    };
  }

  /**
   * ブラウザアクションの実行
   */
  async executeBrowserAction(action) {
    // TODO: Browser automation統合
    return {
      success: false,
      error: 'Browser automation not yet implemented',
      timestamp: Date.now()
    };
  }

  /**
   * 待機アクションの実行
   */
  async executeWait(action) {
    const duration = action.parameters?.query ? parseInt(action.parameters.query) : 5000;
    await new Promise(resolve => setTimeout(resolve, duration));
    
    return {
      success: true,
      result: `Waited for ${duration}ms`,
      timestamp: Date.now()
    };
  }


  /**
   * 実行結果をデータベースに保存
   */
  async saveExecutionResult(action, result) {
    try {
      // TODO: データベーススキーマに応じて実装
      console.log('💾 Saving execution result to database');
    } catch (error) {
      console.error('❌ Error saving execution result:', error);
    }
  }

  /**
   * MCPサーバーを動的に追加
   */
  async addMCPServer(name, config) {
    try {
      this.mcpServers[name] = config;
      console.log(`🔌 MCP server '${name}' added:`, config);
      return true;
    } catch (error) {
      console.error(`❌ Error adding MCP server '${name}':`, error);
      return false;
    }
  }
  
  /**
   * 基本的なMCPサーバーをセットアップ
   */
  async setupDefaultMCPServers() {
    try {
      // EXA MCPサーバーを設定
      // EXA APIキーを取得（既に無効化済み）
      // const encryptionService = (await import('./encryptionService')).EncryptionService;
      // EXA MCPサーバーは削除（遅いため）
      console.log('ℹ️ EXA MCP server disabled for performance')
      
      console.log('✅ MCP servers configuration completed');
      console.log('📋 Available MCP servers:', Object.keys(this.mcpServers));
    } catch (error) {
      console.error('❌ Error setting up MCP servers:', error);
    }
  }

  /**
   * 現在の状態を取得
   */
  getCurrentState() {
    return {
      isExecuting: this.isExecuting,
      queueSize: this.actionQueue.length,
      mcpServers: Object.keys(this.mcpServers)
    };
  }

  /**
   * 
   * サーバーの初期化
   */
  async initializeMCPServers() {
    this.mcpServers = {};
    
    // ElevenLabs MCPの設定（常に有効）
    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || 'sk_7e0c9adc133c149e3c4f953ba6d5e15bcbbd79bdb2395c08';
    if (elevenLabsApiKey) {
      this.mcpServers.elevenlabs = {
        command: "uvx",
        args: ["elevenlabs-mcp"],
        env: {
          ELEVENLABS_API_KEY: elevenLabsApiKey
        }
      };
      console.log('✅ ElevenLabs MCP server configured');
    }
    
    // Browser Base MCPの設定（常に有効）
    if (process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID) {
      this.mcpServers.browserbase = {
        command: "npx",
        args: ["@browserbasehq/mcp"],
        env: {
          BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
          BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID
        }
      };
      console.log('✅ Browser Base MCP server configured');
    }
    
    // HTTP MCPサーバーを追加（Slack連携がある場合のみ）
    if (this.slackTokens && this.slackTokens.userId) {
      const httpMcpPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'mcp-servers', 'http-mcp-server.js');
      this.mcpServers.http = {
        command: 'node',
        args: [httpMcpPath],
        env: {
          SLACK_API_URL: 'https://anicca-proxy-production.up.railway.app/api/tools/slack',
          USER_ID: this.slackTokens.userId
        }
      };
      console.log('✅ HTTP MCP server configured for Slack integration');
      console.log('   Path:', httpMcpPath);
      console.log('   User ID:', this.slackTokens.userId);
    }
    
    // Slackトークンの確認
    try {
      const slackConfigPath = path.join(process.env.HOME || '', '.anicca', 'slack-config.json');
      if (fs.existsSync(slackConfigPath)) {
        const config = JSON.parse(fs.readFileSync(slackConfigPath, 'utf-8'));
        
        // 新形式のMCP設定を読み込む
        if (config.mcpServers?.slack?.env?.SLACK_BOT_TOKEN) {
          const encryption = new SimpleEncryption();
          const token = encryption.decrypt(config.mcpServers.slack.env.SLACK_BOT_TOKEN);
          
          this.mcpServers.slack = {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-slack"],
            env: {
              SLACK_BOT_TOKEN: token,
              SLACK_TEAM_ID: config.mcpServers.slack.env.SLACK_TEAM_ID || ''
            }
          };
          
          console.log('✅ Slack MCP server configured');
        }
        // 旧形式も一応サポート（後方互換性）
        else if (config.token) {
          const encryption = new SimpleEncryption();
          const token = encryption.decrypt(config.token);
          
          this.mcpServers.slack = {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-slack"],
            env: {
              SLACK_BOT_TOKEN: token,
              SLACK_TEAM_ID: config.team?.id || ''
            }
          };
          
          console.log('✅ Slack MCP server configured (legacy format)');
        }
      }
    } catch (error) {
      console.error('❌ Failed to initialize Slack MCP:', error);
    }
  }

  /**
   * MCPサーバーを動的に更新
   */
  async updateMCPServers() {
    await this.initializeMCPServers();
    console.log('🔄 MCP servers updated');
  }

  /**
   * 利用可能なMCPサーバーのリストを取得
   */
  getAvailableMCPServers() {
    const available = [];
    if (this.mcpServers.slack) {
      available.push('Slack');
    }
    if (this.mcpServers.elevenlabs) {
      available.push('ElevenLabs');
    }
    if (this.mcpServers.http) {
      available.push('HTTP');
    }
    return available;
  }

  /**
   * 実行状態をリセット（緊急用）
   */
  resetExecutionState() {
    console.log('🔄 Resetting execution state');
    this.isExecuting = false;
    
    // 実行中のプロセスを中断
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    // タイムアウトをクリア
    if (this.executionTimeout) {
      clearTimeout(this.executionTimeout);
      this.executionTimeout = null;
    }
    
    this.actionQueue = [];
  }
}