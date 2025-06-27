export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ACI Linked Accounts APIを使って接続済みサービスを確認
    const linkedAccountOwnerId = process.env.ACI_LINKED_ACCOUNT_OWNER_ID || 'cmboo2kkp0002c1uu0bunorf5';
    
    // 各サービスの接続状態を確認
    const services = ['SLACK', 'GMAIL', 'GITHUB', 'GOOGLE_CALENDAR'];
    const connectedServices = [];
    
    // 各サービスのLinked Accountを確認
    for (const appName of services) {
      const params = new URLSearchParams({
        app_name: appName,
        linked_account_owner_id: linkedAccountOwnerId
      });
      
      const response = await fetch(`https://api.aci.dev/v1/linked-accounts?${params}`, {
        headers: {
          'X-API-KEY': process.env.ACI_API_KEY
        }
      });
      
      if (response.ok) {
        const accounts = await response.json();
        // アカウントが存在し、有効な場合は接続済みとみなす
        if (accounts.length > 0 && accounts[0].enabled) {
          connectedServices.push(appName.toLowerCase());
        }
      }
    }
    
    return res.status(200).json({
      success: true,
      connectedServices: connectedServices,
      availableServices: ['slack', 'google-calendar', 'github', 'gmail']
    });
    
  } catch (error) {
    console.error('Connected services error:', error);
    res.status(500).json({
      error: 'Failed to get connected services',
      message: error.message
    });
  }
}