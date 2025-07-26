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
  loadWorkspace,
  saveWorkspace
};