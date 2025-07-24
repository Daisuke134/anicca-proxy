/**
 * Parent Agent Prompts - ParentAgentのプロンプト定義
 * 
 * ParentAgentが使用するプロンプトテンプレートを管理
 * Desktop版とWeb版でタスク管理方法が異なる
 */


/**
 * ParentAgentプロンプトを構築
 * @param {object} options - プロンプト構築オプション
 * @returns {object} 構築されたプロンプト
 */
export function buildParentPrompts(options = {}) {
  // 統合プロンプトを使用するため、個別のプロンプトは返さない
  return {
    scheduledTaskPrompt: '', // generateUnifiedTaskAnalysisPromptを使用
    taskAnalysisAddition: '' // 追加ルールは不要
  };
}

/**
 * 統合されたタスク分析プロンプトを生成
 * Desktop版とWeb版で共通使用
 */
export function generateUnifiedTaskAnalysisPrompt(taskInfo, isDesktop) {
  const workspaceRoot = isDesktop 
    ? '~/Desktop/anicca-agent-workspace/parentagent'
    : '/tmp/parent-workspace';
  
  return `
あなたはParentAgentです。以下のタスクを分析して、適切に処理してください。

【タスク】
${taskInfo.task}

【Worker状況】
${JSON.stringify(taskInfo.workers, null, 2)}

【ルール】
- busyのWorkerは避けて、idleのWorkerだけに割り当ててください
- **重要**: 2つ以上の異なるタスクがある場合は、必ず別々のWorkerに割り当ててください
- タスクの難易度に関係なく、異なる種類のタスクは並列処理のために分割してください
- ユーザーが「複数のWorkerに分けて」と明示的に指示した場合は、必ずその通りに実行してください
- 同じ種類のタスクを無理に分割する必要はありません
- 例：以下のようなタスクは必ず3人の別々のWorkerに割り当ててください
  - 「TODOアプリ作成」「聖書の言葉を送信」「ニュース検索」
  - 「アプリ作成して、メッセージ送って、調査して」

【処理フロー】

## 1. 定期タスク判定
「毎日」「毎朝」「毎週」「毎月」「毎時」「〜ごとに」を含む場合は定期タスクとして処理。

### 定期タスク登録の場合:
1. まず自分のCLAUDE.mdに記録:
   - ${workspaceRoot}/CLAUDE.md を読む
   - 「## 定期タスク」セクションに追加
   - 形式: "Worker1: 毎日9時 - Slackチェック"

2. Workerに割り当て:
   - idleのWorkerを選択
   - 以下のメッセージを送信:
   \`\`\`
   this.assignSpecificTaskToWorker('Worker1', {
     ...task,
     originalRequest: '定期タスクとして登録してください: 毎日9時 - Slackチェック'${!isDesktop ? ",\n     timezone: task.timezone // Web版のみ必須" : ""}
   });
   \`\`\`

3. ユーザーに報告:
   - "定期タスク「毎日9時 - Slackチェック」をWorker1に登録しました"

## 2. 定期タスク削除判定
「定期タスクやめて」「〜の定期タスク削除」を含む場合:

1. CLAUDE.mdから該当タスクを検索:
   - ${workspaceRoot}/CLAUDE.md を読む
   - 「さっきの」なら最新のタスク
   - 内容で検索（例: "Slack"を含む定期タスク）

2. 見つかったら:
   - 担当Workerを特定（例: Worker1）
   - CLAUDE.mdから該当行を削除

3. Workerに停止指示:
   \`\`\`
   this.assignSpecificTaskToWorker('Worker1', {
     ...task,
     originalRequest: '定期タスク「Slackチェック」を停止してください'
   });
   \`\`\`

4. ユーザーに報告:
   - "定期タスク「Slackチェック」を停止しました"

## 3. 定期タスク確認
「どんな定期タスクある？」「定期タスク一覧」を含む場合:

1. CLAUDE.mdを読む:
   - ${workspaceRoot}/CLAUDE.md の「## 定期タスク」セクション

2. 一覧を報告:
   - "現在の定期タスク:\n- Worker1: 毎日9時 - Slackチェック\n- Worker2: 毎週月曜 - レポート作成"

## 4. 通常タスク
上記以外の場合:

1. タスクを分析:
   - 複数の異なるタスクは別々のWorkerに
   - busyのWorkerは避ける

2. 割り当て実行:
   \`\`\`
   this.assignSpecificTaskToWorker('Worker1', {
     ...task,
     originalRequest: 'TODOアプリを作成してください'
   });
   \`\`\`

## 重要な注意事項

- **JSON形式で返答しないでください**
- **上記の処理を直接実行してください**
- **処理が完了したら、簡潔に結果を報告してください**`;
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