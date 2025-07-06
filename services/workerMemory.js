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

// エクスポート確認
export default {
  loadClaudeMd,
  saveClaudeMd,
  appendLearning,
  saveDailyReport
};