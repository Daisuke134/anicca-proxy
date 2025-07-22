/**
 * Worker Memory Service - Supabase Storageを使用した永続化
 * 
 * 各WorkerとParentAgentのCLAUDE.mdファイルを管理
 * ユーザーごとに独立した記憶を保持
 */

import { createClient } from '@supabase/supabase-js';

// Supabase client setup
const supabaseUrl = process.env.SUPABASE_URL || 'https://mzkwtwourrkduqkrsxpc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// バケット名
const BUCKET_NAME = 'worker-memories';

/**
 * CLAUDE.mdファイルを読み込む
 * @param {string} userId - ユーザーID
 * @param {string} agentName - エージェント名（Worker1, Worker2, ParentAgent等）
 * @returns {Promise<string>} CLAUDE.mdの内容
 */
export async function loadClaudeMd(userId, agentName) {
  if (!supabase) {
    console.error('❌ Supabase client not initialized');
    return '';
  }

  try {
    const filePath = `${userId}/${agentName}/CLAUDE.md`;
    console.log(`📂 Loading CLAUDE.md from: ${filePath}`);
    
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(filePath);
    
    if (error) {
      if (error.message.includes('not found')) {
        console.log(`📝 CLAUDE.md not found for ${agentName}, creating new one`);
        return getInitialClaudeMd(agentName);
      }
      throw error;
    }
    
    const text = await data.text();
    console.log(`✅ Loaded CLAUDE.md for ${agentName} (${text.length} chars)`);
    return text;
    
  } catch (error) {
    console.error(`❌ Error loading CLAUDE.md: ${error.message}`);
    return getInitialClaudeMd(agentName);
  }
}

/**
 * CLAUDE.mdファイルを保存する
 * @param {string} userId - ユーザーID
 * @param {string} agentName - エージェント名
 * @param {string} content - 保存する内容
 */
export async function saveClaudeMd(userId, agentName, content) {
  if (!supabase) {
    console.error('❌ Supabase client not initialized');
    return;
  }

  try {
    const filePath = `${userId}/${agentName}/CLAUDE.md`;
    console.log(`💾 Saving CLAUDE.md to: ${filePath}`);
    
    // Blob形式に変換
    const file = new Blob([content], { type: 'text/markdown' });
    
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        upsert: true, // 既存ファイルを上書き
        contentType: 'text/markdown'
      });
    
    if (error) throw error;
    
    console.log(`✅ Saved CLAUDE.md for ${agentName}`);
    
  } catch (error) {
    console.error(`❌ Error saving CLAUDE.md: ${error.message}`);
  }
}

/**
 * CLAUDE.mdに学習内容を追記する
 * @param {string} userId - ユーザーID
 * @param {string} agentName - エージェント名
 * @param {string} learning - 学習した内容
 */
export async function appendLearning(userId, agentName, learning) {
  try {
    // 現在の内容を読み込む
    let content = await loadClaudeMd(userId, agentName);
    
    // 今日の日付
    const today = new Date().toISOString().split('T')[0];
    
    // 今日のセクションがあるか確認
    if (!content.includes(`## ${today}`)) {
      content += `\n\n## ${today}\n`;
    }
    
    // 学習内容を追記
    content += `- ${learning}\n`;
    
    // 保存
    await saveClaudeMd(userId, agentName, content);
    
  } catch (error) {
    console.error(`❌ Error appending learning: ${error.message}`);
  }
}

/**
 * 日報を保存する
 * @param {string} userId - ユーザーID
 * @param {string} agentName - エージェント名
 * @param {string} report - 日報内容
 */
export async function saveDailyReport(userId, agentName, report) {
  if (!supabase) {
    console.error('❌ Supabase client not initialized');
    return;
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const filePath = `${userId}/${agentName}/daily-reports/${today}.md`;
    
    console.log(`📋 Saving daily report to: ${filePath}`);
    
    const file = new Blob([report], { type: 'text/markdown' });
    
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        upsert: true,
        contentType: 'text/markdown'
      });
    
    if (error) throw error;
    
    console.log(`✅ Saved daily report for ${agentName}`);
    
  } catch (error) {
    console.error(`❌ Error saving daily report: ${error.message}`);
  }
}

/**
 * 初期CLAUDE.mdテンプレートを生成
 * @private
 */
function getInitialClaudeMd(agentName) {
  return `# ${agentName} - CLAUDE.md

## 専門分野
- まだ専門分野は決まっていません

## 学習内容

## 完了タスク履歴

## ユーザーについて学んだこと

---
このファイルは自動的に更新されます。
`;
}

/**
 * ワークスペース全体を復元する
 * @param {string} userId - ユーザーID
 * @param {string} agentName - エージェント名
 * @param {string} workspaceRoot - ローカルワークスペースのルートパス
 */
export async function loadWorkspace(userId, agentName, workspaceRoot) {
  if (!supabase) {
    console.error('❌ Supabase client not initialized');
    return;
  }

  try {
    console.log(`📂 Loading workspace for ${agentName} from Supabase Storage...`);
    
    // 1. ワークスペースのファイル一覧を取得
    const basePath = `${userId}/${agentName}`;
    const { data: files, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(basePath, {
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' }
      });
    
    if (error) {
      console.error(`❌ Error listing workspace files: ${error.message}`);
      return;
    }
    
    if (!files || files.length === 0) {
      console.log(`📭 No files found for ${agentName}, starting fresh`);
      return;
    }
    
    console.log(`📋 Found ${files.length} files/folders to restore`);
    
    // fsモジュールをインポート
    const fs = await import('fs');
    const path = await import('path');
    
    // 2. 各ファイルをダウンロードして復元
    for (const file of files) {
      if (file.name) {
        try {
          const remotePath = `${basePath}/${file.name}`;
          const localPath = path.join(workspaceRoot, file.name);
          
          // ディレクトリの場合はスキップ（再帰的に処理する必要がある場合は後で対応）
          if (file.metadata && file.metadata.mimetype === 'application/x-directory') {
            continue;
          }
          
          // ファイルをダウンロード
          const { data: fileData, error: downloadError } = await supabase.storage
            .from(BUCKET_NAME)
            .download(remotePath);
          
          if (downloadError) {
            console.error(`❌ Error downloading ${file.name}: ${downloadError.message}`);
            continue;
          }
          
          // ローカルディレクトリを作成
          const dir = path.dirname(localPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          // ファイルを書き込み
          const content = await fileData.text();
          fs.writeFileSync(localPath, content, 'utf8');
          
          console.log(`✅ Restored: ${file.name}`);
        } catch (err) {
          console.error(`❌ Error restoring ${file.name}: ${err.message}`);
        }
      }
    }
    
    // サブディレクトリも再帰的に処理
    await loadWorkspaceRecursive(userId, agentName, workspaceRoot, basePath);
    
    console.log(`✅ Workspace restored for ${agentName}`);
    
  } catch (error) {
    console.error(`❌ Error loading workspace: ${error.message}`);
  }
}

/**
 * ワークスペースを再帰的に復元する（サブディレクトリ対応）
 * @private
 */
async function loadWorkspaceRecursive(userId, agentName, workspaceRoot, currentPath, subPath = '') {
  const fs = await import('fs');
  const path = await import('path');
  
  try {
    // 現在のパスのファイル一覧を取得
    const fullPath = subPath ? `${currentPath}/${subPath}` : currentPath;
    const { data: items, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(fullPath, {
        limit: 1000,
        offset: 0
      });
    
    if (error || !items) return;
    
    for (const item of items) {
      const itemPath = subPath ? `${subPath}/${item.name}` : item.name;
      const localPath = path.join(workspaceRoot, itemPath);
      
      // ディレクトリの場合
      if (item.id === null) {
        // ディレクトリを作成して再帰的に処理
        if (!fs.existsSync(localPath)) {
          fs.mkdirSync(localPath, { recursive: true });
        }
        await loadWorkspaceRecursive(userId, agentName, workspaceRoot, currentPath, itemPath);
      }
    }
  } catch (error) {
    console.error(`❌ Error in recursive load: ${error.message}`);
  }
}

/**
 * ワークスペース全体を保存する
 * @param {string} userId - ユーザーID
 * @param {string} agentName - エージェント名
 * @param {string} workspaceRoot - ローカルワークスペースのルートパス
 */
export async function saveWorkspace(userId, agentName, workspaceRoot) {
  if (!supabase) {
    console.error('❌ Supabase client not initialized');
    return;
  }

  try {
    console.log(`💾 Saving workspace for ${agentName} to Supabase Storage...`);
    
    const fs = await import('fs');
    const path = await import('path');
    
    // ワークスペース内のすべてのファイルを取得
    const files = await getAllFiles(workspaceRoot);
    console.log(`📋 Found ${files.length} files to save`);
    
    // 各ファイルをアップロード
    for (const filePath of files) {
      try {
        const relativePath = path.relative(workspaceRoot, filePath);
        const remotePath = `${userId}/${agentName}/${relativePath}`;
        
        // ファイルを読み込み
        const content = fs.readFileSync(filePath, 'utf8');
        const file = new Blob([content], { type: 'text/plain' });
        
        // アップロード
        const { error } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(remotePath, file, {
            upsert: true,
            contentType: 'text/plain'
          });
        
        if (error) {
          console.error(`❌ Error uploading ${relativePath}: ${error.message}`);
        } else {
          console.log(`✅ Saved: ${relativePath}`);
        }
      } catch (err) {
        console.error(`❌ Error processing ${filePath}: ${err.message}`);
      }
    }
    
    console.log(`✅ Workspace saved for ${agentName}`);
    
  } catch (error) {
    console.error(`❌ Error saving workspace: ${error.message}`);
  }
}

/**
 * ディレクトリ内のすべてのファイルを再帰的に取得
 * @private
 */
async function getAllFiles(dirPath, arrayOfFiles = []) {
  const fs = await import('fs');
  const path = await import('path');
  
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    
    // 隠しファイルやnode_modulesなどをスキップ
    if (file.startsWith('.') || file === 'node_modules') {
      continue;
    }
    
    if (fs.statSync(filePath).isDirectory()) {
      await getAllFiles(filePath, arrayOfFiles);
    } else {
      arrayOfFiles.push(filePath);
    }
  }
  
  return arrayOfFiles;
}

// エクスポート確認
export default {
  loadClaudeMd,
  saveClaudeMd,
  appendLearning,
  saveDailyReport,
  loadWorkspace,
  saveWorkspace
};