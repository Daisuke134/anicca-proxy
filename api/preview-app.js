import { createClient } from '@supabase/supabase-js';

/**
 * プレビューアプリのプロキシエンドポイント
 * 
 * Supabase Storageからファイルを取得し、正しいContent-Typeで配信
 * これにより、HTMLファイルがブラウザで正しく表示される
 * 
 * URL形式: /api/preview-app/{userId}/{workerName}/projects/{projectId}/{filename}
 */

export default async function handler(req, res) {
  // CORSヘッダーを設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // URLからパスを解析
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.replace('/api/preview-app/', '').split('/');
    
    if (pathParts.length < 5) {
      return res.status(400).json({ error: 'Invalid path format' });
    }
    
    // パスコンポーネントを取得
    const [userId, workerName, projectsDir, projectId, ...filePathParts] = pathParts;
    const filePath = filePathParts.join('/');
    
    // Supabaseクライアントを初期化
    const supabaseUrl = process.env.SUPABASE_URL || 'https://mzkwtwourrkduqkrsxpc.supabase.co';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseServiceKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set');
      return res.status(500).json({ error: 'Storage configuration error' });
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // ストレージパスを構築
    const storagePath = `${userId}/${workerName}/projects/${projectId}/${filePath}`;
    console.log(`📁 Fetching from storage: ${storagePath}`);
    
    // Supabase Storageからファイルをダウンロード
    const { data, error } = await supabase.storage
      .from('worker-memories')
      .download(storagePath);
    
    if (error) {
      console.error('Storage download error:', error);
      return res.status(404).json({ error: 'File not found', details: error.message });
    }
    
    // Content-Typeを決定
    const contentType = getContentType(filePath);
    res.setHeader('Content-Type', contentType);
    
    // キャッシュヘッダーを設定（1時間）
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    // ファイルの内容をバイナリとして読み取り
    const buffer = await data.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);
    
    // レスポンスとして送信
    res.status(200).send(Buffer.from(uint8Array));
    
  } catch (error) {
    console.error('Preview proxy error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

/**
 * ファイルパスからContent-Typeを決定
 */
function getContentType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  
  const mimeTypes = {
    'html': 'text/html; charset=utf-8',
    'htm': 'text/html; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'js': 'application/javascript; charset=utf-8',
    'json': 'application/json; charset=utf-8',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'txt': 'text/plain; charset=utf-8',
    'md': 'text/markdown; charset=utf-8'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}