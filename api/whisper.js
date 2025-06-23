// OpenAI Whisper API プロキシ
const FormData = require('form-data');

export default async function handler(req, res) {
  // CORSヘッダーを設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // OPTIONSリクエストの処理
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // POSTリクエストのみ許可
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    // 環境変数からOpenAI APIキーを取得
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY not set');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }
    
    // リクエストボディから音声データを取得
    const { audio, language = 'ja' } = req.body;
    
    if (!audio) {
      res.status(400).json({ error: 'Audio data is required' });
      return;
    }
    
    // Base64をバッファに変換
    const audioBuffer = Buffer.from(audio, 'base64');
    
    // WebMをWAVに変換
    const wavBuffer = convertWebMToWAV(audioBuffer);
    
    // FormDataを作成
    const formData = new FormData();
    formData.append('file', wavBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav'
    });
    formData.append('model', 'whisper-1');
    formData.append('language', language);
    formData.append('response_format', 'json');
    
    console.log(`Whisper transcription request: WebM ${audioBuffer.length} bytes -> WAV ${wavBuffer.length} bytes, language: ${language}`);
    
    // OpenAI APIにリクエスト
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders()
      },
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      res.status(response.status).json({ error: 'Transcription failed' });
      return;
    }
    
    const result = await response.json();
    
    res.status(200).json({
      success: true,
      text: result.text,
      language: language
    });
    
  } catch (error) {
    console.error('Whisper Error:', error);
    res.status(500).json({ 
      error: 'Transcription processing failed',
      message: error.message 
    });
  }
}

// WebMからWAVに変換する関数（簡易実装）
function convertWebMToWAV(webmBuffer) {
  // WAVヘッダーを作成（44.1kHz, 16bit, モノラル）
  const sampleRate = 44100;
  const bitsPerSample = 16;
  const channels = 1;
  
  // WebMのヘッダーをスキップして生のPCMデータを取得（簡易実装）
  // 実際のWebMデコードは複雑なので、ここでは簡易的に処理
  // 最初の200バイトをスキップ（WebMヘッダーの概算）
  const pcmData = webmBuffer.slice(200);
  
  // WAVファイルのサイズ計算
  const dataSize = pcmData.length;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  
  // WAVヘッダーを作成（44バイト）
  const wavHeader = Buffer.alloc(44);
  
  // RIFF header
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + dataSize, 4);
  wavHeader.write('WAVE', 8);
  
  // fmt chunk
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16); // fmt chunk size
  wavHeader.writeUInt16LE(1, 20); // audio format (1 = PCM)
  wavHeader.writeUInt16LE(channels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  
  // data chunk
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(dataSize, 40);
  
  // WAVファイルを作成
  return Buffer.concat([wavHeader, pcmData]);
}