import { InstallProvider } from '@slack/oauth';

// グローバルなInstallProviderインスタンスを作成
const installer = new InstallProvider({
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET || 'anicca-slack-state-secret-2025',
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