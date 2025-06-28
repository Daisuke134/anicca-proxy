import { InstallProvider } from '@slack/oauth';
import { stateStore } from './stateStore.js';

// グローバルなInstallProviderインスタンスを作成
const installer = new InstallProvider({
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET || 'my-state-secret',
  stateStore: {
    // ファイルベースのstateストア
    generateStateParam: async (installUrlOptions, date) => {
      const state = Math.random().toString(36).substring(2, 15);
      await stateStore.set(state, { installUrlOptions, date: date.toISOString() });
      return state;
    },
    verifyStateParam: async (date, state) => {
      const data = await stateStore.get(state);
      if (!data) return { result: false };
      
      // Delete after verification
      await stateStore.delete(state);
      
      // Check if state is not too old (15 minutes)
      const stateDate = new Date(data.date);
      const now = new Date();
      const age = now.getTime() - stateDate.getTime();
      
      if (age > 900000) { // 15 minutes
        return { result: false };
      }
      
      return { result: true, installUrlOptions: data.installUrlOptions };
    }
  },
  installationStore: {
    // メモリベースの簡易ストア（本番環境ではデータベースを使用）
    storeInstallation: async (installation) => {
      global.slackInstallations = global.slackInstallations || {};
      const key = installation.team ? installation.team.id : 'default';
      global.slackInstallations[key] = installation;
      console.log('✅ Slack installation stored for team:', key);
    },
    fetchInstallation: async (installQuery) => {
      const installations = global.slackInstallations || {};
      const key = installQuery.teamId || 'default';
      return installations[key];
    },
  },
});

export { installer };