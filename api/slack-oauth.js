export default function handler(req, res) {
  const clientId = '3627470757104.9096399358065';
  const redirectUri = 'https://anicca-proxy-ten.vercel.app/api/slack-oauth/callback';
  const scopes = 'channels:history,channels:read,chat:write,users:read';
  
  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  
  console.log('Redirecting to Slack OAuth:', authUrl);
  res.redirect(authUrl);
}