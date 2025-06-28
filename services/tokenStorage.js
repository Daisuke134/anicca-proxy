import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// トークンを保存するファイルのパス
const TOKEN_FILE = path.join(__dirname, '../.tokens.json');

// トークンを保存
export async function saveTokens(teamId, tokens) {
  try {
    let data = {};
    
    // 既存のデータを読み込み
    try {
      const content = await fs.readFile(TOKEN_FILE, 'utf-8');
      data = JSON.parse(content);
    } catch (err) {
      // ファイルが存在しない場合は新規作成
    }
    
    // 新しいトークンを保存
    data[teamId] = {
      ...tokens,
      savedAt: new Date().toISOString()
    };
    
    // ファイルに書き込み
    await fs.writeFile(TOKEN_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ Tokens saved for team ${teamId}`);
    
  } catch (error) {
    console.error('❌ Failed to save tokens:', error);
    throw error;
  }
}

// トークンを読み込み
export async function loadTokens(teamId) {
  try {
    const content = await fs.readFile(TOKEN_FILE, 'utf-8');
    const data = JSON.parse(content);
    return data[teamId] || null;
  } catch (err) {
    // ファイルが存在しない場合はnullを返す
    return null;
  }
}

// 全ての接続済みサービスを取得
export async function getAllConnectedServices() {
  try {
    const content = await fs.readFile(TOKEN_FILE, 'utf-8');
    const data = JSON.parse(content);
    
    const services = [];
    
    // Slackの接続を確認
    for (const [teamId, tokens] of Object.entries(data)) {
      if (tokens.bot_token) {
        services.push({
          id: 'slack',
          name: 'Slack',
          connected: true,
          teamId: teamId,
          savedAt: tokens.savedAt
        });
        break; // 1つでも接続があればOK
      }
    }
    
    return services;
  } catch (err) {
    return [];
  }
}

// 特定のチームのトークンを削除
export async function deleteTokens(teamId) {
  try {
    const content = await fs.readFile(TOKEN_FILE, 'utf-8');
    const data = JSON.parse(content);
    
    delete data[teamId];
    
    await fs.writeFile(TOKEN_FILE, JSON.stringify(data, null, 2));
    console.log(`✅ Tokens deleted for team ${teamId}`);
    
  } catch (error) {
    console.error('❌ Failed to delete tokens:', error);
  }
}