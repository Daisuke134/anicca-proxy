export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // OAuthコールバックパラメータを取得
    const { code, state, error } = req.query;
    
    if (error) {
      console.error('OAuth error:', error);
      return res.redirect('/auth-ui.html?error=' + encodeURIComponent(error));
    }
    
    if (!code) {
      return res.redirect('/auth-ui.html?error=no_code');
    }
    
    // stateをパース
    let stateData = {};
    try {
      stateData = JSON.parse(state);
    } catch (e) {
      console.error('Invalid state:', e);
    }
    
    const { sessionId, service } = stateData;
    
    console.log('🔐 OAuth callback received:', {
      service,
      sessionId,
      codeLength: code.length
    });
    
    // TODO: ここでACIのトークン交換APIを呼び出す
    // 現在はACIが自動的にトークンを管理するため、
    // ユーザーをリダイレクトするだけでOK
    
    // セッションIDをクエリパラメータとして渡す
    const redirectUrl = `/auth-ui.html?success=true&service=${service}&sessionId=${sessionId}`;
    
    // 成功ページにリダイレクト
    return res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/auth-ui.html?error=callback_failed');
  }
}