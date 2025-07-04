import fs from 'fs';
import path from 'path';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;

/**
 * PreviewManager - アプリケーションのプレビュー管理
 * 
 * 役割：
 * - 作成したアプリをプレビューディレクトリにコピー
 * - プレビューURLの生成
 * - アプリのメタデータ管理
 */
export class PreviewManager {
  constructor() {
    // プレビューディレクトリのベースパス
    this.previewBasePath = process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT
      ? '/tmp/preview'
      : path.join(process.cwd(), 'tmp', 'preview');
    
    // プロキシのベースURL
    this.proxyBaseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.RAILWAY_ENVIRONMENT
        ? 'https://anicca-proxy-staging.up.railway.app'
        : 'https://anicca-proxy-ten.vercel.app';
    
    // プレビューディレクトリを確保
    this.ensurePreviewDirectory();
  }
  
  /**
   * プレビューディレクトリの存在確認と作成
   */
  ensurePreviewDirectory() {
    try {
      if (!fs.existsSync(this.previewBasePath)) {
        fs.mkdirSync(this.previewBasePath, { recursive: true });
        console.log('📁 Created preview directory:', this.previewBasePath);
      }
    } catch (error) {
      console.error('❌ Failed to create preview directory:', error);
    }
  }
  
  /**
   * アプリをプレビューに公開
   * @param {string} sourcePath - ソースディレクトリのパス
   * @param {object} metadata - アプリのメタデータ
   * @returns {object} プレビュー情報
   */
  async publishApp(sourcePath, metadata = {}) {
    try {
      // アプリIDを生成（プロジェクト名があれば使用）
      const appId = metadata.projectName 
        ? `${this.sanitizeProjectName(metadata.projectName)}-${uuidv4().slice(0, 8)}`
        : `app-${uuidv4().slice(0, 8)}`;
      
      const targetPath = path.join(this.previewBasePath, appId);
      
      // ディレクトリをコピー
      await this.copyDirectory(sourcePath, targetPath);
      
      // メタデータファイルを作成
      const metadataPath = path.join(targetPath, '.anicca-metadata.json');
      const fullMetadata = {
        ...metadata,
        appId,
        sourcePath,
        createdAt: new Date().toISOString(),
        previewUrl: `${this.proxyBaseUrl}/api/preview/${appId}/`
      };
      
      fs.writeFileSync(metadataPath, JSON.stringify(fullMetadata, null, 2));
      
      console.log(`✅ App published to preview: ${appId}`);
      console.log(`🌐 Preview URL: ${fullMetadata.previewUrl}`);
      
      return {
        appId,
        previewUrl: fullMetadata.previewUrl,
        targetPath,
        metadata: fullMetadata
      };
      
    } catch (error) {
      console.error('❌ Failed to publish app:', error);
      throw error;
    }
  }
  
  /**
   * プロジェクト名をサニタイズ
   */
  sanitizeProjectName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30);
  }
  
  /**
   * ディレクトリを再帰的にコピー
   */
  async copyDirectory(source, target) {
    // ターゲットディレクトリを作成
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    
    // ファイルとディレクトリをコピー
    const entries = fs.readdirSync(source, { withFileTypes: true });
    
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      
      if (entry.isDirectory()) {
        // node_modulesなどは除外
        if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          await this.copyDirectory(sourcePath, targetPath);
        }
      } else {
        // ファイルをコピー
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }
  
  /**
   * プレビューアプリのリストを取得
   */
  async listApps() {
    try {
      const apps = [];
      
      if (!fs.existsSync(this.previewBasePath)) {
        return apps;
      }
      
      const entries = fs.readdirSync(this.previewBasePath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metadataPath = path.join(this.previewBasePath, entry.name, '.anicca-metadata.json');
          
          if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            apps.push({
              appId: entry.name,
              ...metadata
            });
          }
        }
      }
      
      // 作成日時の降順でソート
      apps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      return apps;
      
    } catch (error) {
      console.error('❌ Failed to list apps:', error);
      return [];
    }
  }
  
  /**
   * 古いプレビューをクリーンアップ（24時間以上経過）
   */
  async cleanupOldPreviews() {
    try {
      const apps = await this.listApps();
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24時間
      
      for (const app of apps) {
        const age = now - new Date(app.createdAt).getTime();
        
        if (age > maxAge) {
          const appPath = path.join(this.previewBasePath, app.appId);
          
          // ディレクトリを削除
          fs.rmSync(appPath, { recursive: true, force: true });
          console.log(`🧹 Cleaned up old preview: ${app.appId}`);
        }
      }
      
    } catch (error) {
      console.error('❌ Failed to cleanup old previews:', error);
    }
  }
  
  /**
   * アプリのプレビューURLを生成（既存アプリから）
   */
  generatePreviewUrl(appId) {
    return `${this.proxyBaseUrl}/api/preview/${appId}/`;
  }
}

// シングルトンインスタンス
export const previewManager = new PreviewManager();