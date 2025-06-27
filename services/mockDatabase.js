// Mock implementation of SQLiteDatabase for Vercel
// ClaudeExecutorServiceが必要とする最小限のインターフェース

export class MockDatabase {
  constructor() {
    console.log('📊 MockDatabase initialized (for Vercel)');
  }

  async init() {
    // No-op for mock
    return Promise.resolve();
  }

  async saveObservation(observation) {
    // ログ出力のみ
    console.log('💾 Mock saving observation:', observation);
    return Promise.resolve();
  }

  async getSetting(key) {
    // デフォルト値を返す
    const defaults = {
      language: 'ja',
      dailyLimit: 100
    };
    return defaults[key] || null;
  }

  async setSetting(key, value) {
    console.log(`⚙️ Mock setting ${key} = ${value}`);
    return Promise.resolve();
  }

  async getObservations(limit = 10) {
    // 空の配列を返す
    return [];
  }

  async getTodayUsageCount() {
    // 使用回数は0を返す
    return 0;
  }

  async incrementUsageCount() {
    // No-op
    return Promise.resolve();
  }
}