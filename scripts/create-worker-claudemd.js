import { createClient } from '@supabase/supabase-js';

// Supabase設定（プロジェクトの情報）
const supabaseUrl = 'https://mzkwtwourrkduqkrsxpc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16a3d0d291cnJrZHVxa3JzeHBjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNjA2NTQ0MCwiZXhwIjoyMDUxNjQxNDQwfQ.ZQOG_tFqJpUcXJL5_QOGFX0tRBCYTNNQsXGUi6Y7vDo';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createWorkerClaude() {
  const userId = '9f126de1-8f37-4635-bd33-b9e1fff262c1';
  
  // Worker1のCLAUDE.md内容
  const claudeMdContent = `# Worker1 - CLAUDE.md

## 役割
- 一般的なタスク処理
- 定期タスクの実行

## 毎日のスケジュール
- 21:50 - 聖書の一節を#anicca_reportに投稿
- 23:00 - おやすみなさいメッセージを投稿

## 最近の学習
- ユーザーは定期的な聖書の投稿を希望
- 夜の挨拶も重要

## ユーザーについて学んだこと
- 定期的な投稿を好む
- 聖書の言葉に興味がある

---
このファイルは自動的に更新されます。
`;

  try {
    // ファイルをアップロード
    const filePath = `${userId}/Worker1/CLAUDE.md`;
    const file = new Blob([claudeMdContent], { type: 'text/markdown' });
    
    const { data, error } = await supabase.storage
      .from('worker-memories')
      .upload(filePath, file, {
        upsert: true,
        contentType: 'text/markdown'
      });
    
    if (error) {
      console.error('❌ Error uploading:', error);
    } else {
      console.log('✅ Worker1のCLAUDE.mdを作成しました！');
      console.log('📅 スケジュール:');
      console.log('  - 21:50 聖書の一節');
      console.log('  - 23:00 おやすみなさい');
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

createWorkerClaude();