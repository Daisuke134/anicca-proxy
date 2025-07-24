/**
 * Parent Agent Prompts - ParentAgentのプロンプト定義
 * 
 * ParentAgentが使用するプロンプトテンプレートを管理
 * Desktop版とWeb版でタスク管理方法が異なる
 */

/**
 * ParentAgent用のDesktop版定期タスク管理プロンプトを生成
 */
export function generateDesktopScheduledTaskPrompt() {
  const workspaceRoot = '~/Desktop/anicca-agent-workspace/parentagent';
    
  return `
## 定期タスクの管理

定期タスクの割り当て：
- 「毎朝」「毎日」「毎週」を含むタスクは定期タスクとして認識
- 自分のワークスペースのCLAUDE.mdに記録。存在しない場合は作成する。
  例：「Worker1: 毎朝9時 - Slack確認して返信」
- 通常通りWorkerに割り当てる。

定期タスクの削除：
- 「〜の定期タスクやめて」と言われたら
- CLAUDE.mdで該当タスクの担当Workerを確認
- CLAUDE.mdでその定期タスクを削除
- そのWorkerに「〜の定期タスクを停止して」と指示

定期タスクの確認：
- 「どんな定期タスクある？」と聞かれたら
- CLAUDE.mdから一覧を読み上げ

CLAUDE.mdの場所：${workspaceRoot}/CLAUDE.md`;
}

/**
 * ParentAgent用のWeb版定期タスク管理プロンプトを生成
 */
export function generateWebScheduledTaskPrompt() {
  const workspaceRoot = '/tmp/parent-workspace';
    
  return `
## 定期タスクの管理（Web版）

定期タスクの処理：
- 「毎朝」「毎日」「毎週」「毎時」「〜ごとに」を含むタスクは定期タスクとして認識
- 通常通りWorkerに割り当てを決定
- 自分のCLAUDE.mdにも記録：
  形式: 「Worker1: 毎日9時 - Slack返信」
  場所: ${workspaceRoot}/CLAUDE.md
- 割り当てたWorkerに以下の形式で指示：
  「このタスクをCLAUDE.mdに定期タスクとして記録してください：毎日9時 - Slack返信」

定期タスクの削除：
- 「〜の定期タスクやめて」と言われたらCLAUDE.mdから該当行を削除
- 該当Workerに「〜の定期タスクをCLAUDE.mdから削除してください」と指示

定期タスクの確認：
- 「どんな定期タスクある？」と聞かれたら
- CLAUDE.mdから定期タスクセクションを読み上げ

重要：
- 定期タスクは自動的にSupabaseに登録される
- 実行時刻になると外部Cronから自動的にタスクが送信される
- Workerは通常タスクと同じように処理する`;
}

/**
 * ParentAgentプロンプトを構築
 * @param {object} options - プロンプト構築オプション
 * @returns {object} 構築されたプロンプト
 */
export function buildParentPrompts(options = {}) {
  const isDesktop = process.env.DESKTOP_MODE === 'true';
  
  return {
    scheduledTaskPrompt: isDesktop ? generateDesktopScheduledTaskPrompt() : generateWebScheduledTaskPrompt(),
    taskAnalysisAddition: '' // 追加ルールは不要
  };
}

/**
 * プロンプトのバージョン管理
 */
export const PROMPT_VERSION = '1.0.0';

/**
 * プロンプトの更新履歴
 */
export const PROMPT_CHANGELOG = [
  {
    version: '1.0.0',
    date: '2025-01-20',
    changes: [
      '初期バージョン',
      'Desktop版定期タスク管理プロンプト追加'
    ]
  }
];