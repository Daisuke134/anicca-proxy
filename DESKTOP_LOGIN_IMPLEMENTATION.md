# Desktop版アプリケーションログイン機能実装計画

## 現状分析

### 1. 初回起動時のログインフロー
**現状:**
- `main-voice-simple.ts`では初回起動時に認証チェックなし
- システムトレイメニューに「Connect Slack」オプションのみ
- ユーザー識別は`desktop-user`固定（voiceServer.ts:347）

**課題:**
- ユーザー認証機能が未実装
- セッション管理機能なし
- 自動ログイン機能なし

### 2. Slackトークン取得と伝播
**現状:**
- `ParentAgent.js`でユーザーIDからSlackトークンを取得（187-211行目）
- `Worker.js`は親から環境変数でトークンを受け取る（562-565行目）
- `database.js`の`getSlackTokensForUser`関数でSupabaseから取得

**課題:**
- Desktop版でのユーザーID管理が不在
- 初回起動時のトークン取得フローなし

### 3. タスク完了即座報告
**現状:**
- `ParentAgent.js`の`postCompletionUpdate`メソッドで実装済み（366-407行目）
- Desktop版では`DESKTOP_MODE=true`時にSlack投稿をスキップ（329-332行目）

**課題:**
- Desktop版での報告方法が未定義（ローカル通知？ログファイル？）

### 4. 自動ログイン機能
**現状:**
- `simpleEncryption.ts`で暗号化機能は実装済み
- Web版では`useAuth.tsx`でSupabase認証を使用

**課題:**
- Electronのセキュアストレージ未使用
- 認証トークンの永続化なし

## 実装方針

### フェーズ1: 認証基盤の構築

#### 1.1 Electron認証サービスの作成
```typescript
// src/services/desktopAuthService.ts
import { safeStorage } from 'electron';
import { createClient } from '@supabase/supabase-js';

export class DesktopAuthService {
  private supabase: any;
  private currentUser: any = null;
  
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
  }
  
  async initialize() {
    // セキュアストレージから認証情報を復元
    const savedAuth = this.loadSavedAuth();
    if (savedAuth) {
      await this.restoreSession(savedAuth);
    }
  }
  
  async signIn(email: string, password: string) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (data?.session) {
      this.saveAuth(data.session);
      this.currentUser = data.user;
    }
    
    return { data, error };
  }
  
  private saveAuth(session: any) {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(JSON.stringify(session));
      // ファイルに保存
    }
  }
}
```

#### 1.2 初回起動時のログイン画面
```typescript
// src/windows/loginWindow.ts
import { BrowserWindow } from 'electron';

export function createLoginWindow() {
  const loginWindow = new BrowserWindow({
    width: 400,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  
  loginWindow.loadFile('src/pages/login.html');
  return loginWindow;
}
```

### フェーズ2: ユーザーID伝播の実装

#### 2.1 VoiceServerの改修
```typescript
// voiceServer.tsの改修
private currentUserId: string | null = null;

async setCurrentUser(userId: string) {
  this.currentUserId = userId;
  // ParentAgentにユーザーIDを設定
  process.env.CURRENT_USER_ID = userId;
  process.env.SLACK_USER_ID = userId;
}
```

#### 2.2 ParentAgentの改修
```typescript
// ParentAgent.js改修案
async executeTask(task) {
  // ユーザーIDの優先順位を明確化
  const userId = task.userId || 
                 this.currentUserId || 
                 process.env.CURRENT_USER_ID || 
                 process.env.SLACK_USER_ID || 
                 'desktop-user';
  
  // 全てのWorkerに確実に伝播
  this.broadcastUserIdToWorkers(userId);
}
```

### フェーズ3: Desktop版用の進捗通知

#### 3.1 ローカル通知システム
```typescript
// src/services/desktopNotificationService.ts
import { Notification } from 'electron';

export class DesktopNotificationService {
  async notifyTaskComplete(task: string, worker: string) {
    new Notification({
      title: 'タスク完了',
      body: `${worker}が「${task}」を完了しました`,
      icon: path.join(__dirname, '../assets/icon.png')
    }).show();
  }
  
  async notifyTodoList(todos: any[]) {
    // macOS通知センターに追加
    const { exec } = require('child_process');
    exec(`osascript -e 'display notification "${todos.join('\\n')}" with title "TODOリスト"'`);
  }
}
```

#### 3.2 ParentAgentのDesktop版対応
```typescript
// ParentAgent.js内の改修
async postCompletionUpdate(normalTasks, scheduledTasks, results) {
  const isDesktop = process.env.DESKTOP_MODE === 'true';
  
  if (isDesktop) {
    // Desktop版専用の通知
    const notification = new (await import('electron')).Notification({
      title: '全タスク完了！',
      body: `${normalTasks.length}個のタスクを完了しました`
    });
    notification.show();
    
    // ログファイルに記録
    await this.logToFile(normalTasks, results);
  } else {
    // 既存のSlack投稿処理
  }
}
```

### フェーズ4: 自動ログイン実装

#### 4.1 セキュアストレージの活用
```typescript
// main-voice-simple.tsの改修
async function initializeApp() {
  // 認証サービスの初期化
  const authService = new DesktopAuthService();
  await authService.initialize();
  
  if (!authService.isAuthenticated()) {
    // ログイン画面を表示
    const loginWindow = createLoginWindow();
    
    // ログイン成功を待つ
    await waitForLogin(loginWindow);
  }
  
  // 認証済みユーザーIDを設定
  const userId = authService.getCurrentUserId();
  voiceServer.setCurrentUser(userId);
  
  // 既存の初期化処理を継続
}
```

#### 4.2 システムトレイメニューの更新
```typescript
function updateTrayMenu() {
  const authService = getAuthService();
  const userName = authService.getCurrentUserName() || 'ゲスト';
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: `👤 ${userName}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'アカウント設定',
      click: () => showAccountSettings()
    },
    {
      label: 'ログアウト',
      click: async () => {
        await authService.signOut();
        app.relaunch();
        app.quit();
      }
    },
    // 既存のメニュー項目
  ]);
}
```

## 実装優先順位

1. **Phase 1: 基本認証** (必須)
   - DesktopAuthServiceの実装
   - ログイン画面の作成
   - セッション管理

2. **Phase 2: ユーザーID伝播** (必須)
   - VoiceServerでのユーザーID管理
   - ParentAgent→Worker間の確実な伝播

3. **Phase 3: Desktop版通知** (推奨)
   - ローカル通知の実装
   - ログファイル出力

4. **Phase 4: 自動ログイン** (オプション)
   - セキュアストレージの活用
   - 記憶する機能

## セキュリティ考慮事項

1. **認証情報の保護**
   - Electronの`safeStorage`を使用
   - パスワードは保存せず、セッショントークンのみ保存

2. **通信の安全性**
   - Supabase APIはHTTPS通信
   - ローカルストレージは暗号化

3. **アクセス制御**
   - ユーザーごとにSlackトークンを分離
   - Worker間でのデータ隔離

## テスト計画

1. **初回起動テスト**
   - ログイン画面の表示確認
   - 認証成功/失敗の動作確認

2. **ユーザーID伝播テスト**
   - ParentAgent→Workerへの伝播確認
   - Slackトークン取得の確認

3. **自動ログインテスト**
   - アプリ再起動時の自動ログイン
   - 無効なトークンの処理

4. **マルチユーザーテスト**
   - ユーザー切り替えの動作確認
   - データの分離確認