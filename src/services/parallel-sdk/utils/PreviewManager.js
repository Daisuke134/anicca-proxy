import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { v4: uuidv4 } = require('uuid');
import { createClient } from '@supabase/supabase-js';

/**
 * PreviewManager - アプリケーションのプレビュー管理
 * 
 * 役割：
 * - 作成したアプリをSupabase Storageに保存
 * - 署名付きURLの生成
 * - アプリのメタデータ管理
 */
export class PreviewManager {
  constructor() {
    // Supabaseクライアントの初期化
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseServiceKey) {
      console.error('❌ SUPABASE_SERVICE_ROLE_KEY is not set');
    }
    
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
    this.bucketName = 'worker-memories';
    
    // 一時的な作業ディレクトリ（アップロード前の準備用）
    this.tempBasePath = process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT
      ? '/tmp/preview'
      : path.join(process.cwd(), 'tmp', 'preview');
    
    // プレビューディレクトリを確保
    this.ensurePreviewDirectory();
  }
  
  /**
   * プレビューディレクトリの存在確認と作成
   */
  ensurePreviewDirectory() {
    try {
      if (!fs.existsSync(this.tempBasePath)) {
        fs.mkdirSync(this.tempBasePath, { recursive: true });
        console.log('📁 Created temp directory:', this.tempBasePath);
      }
    } catch (error) {
      console.error('❌ Failed to create temp directory:', error);
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
      // 必須情報の確認
      const userId = metadata.userId || process.env.CURRENT_USER_ID;
      const workerNumber = metadata.workerNumber || '1';
      
      if (!userId) {
        throw new Error('User ID is required for publishing apps');
      }
      
      // プロジェクトIDを生成（プロジェクト名があれば使用）
      const projectId = metadata.projectName 
        ? `${this.sanitizeProjectName(metadata.projectName)}-${Date.now()}`
        : `app-${Date.now()}-${uuidv4().slice(0, 8)}`;
      
      // Supabase Storageのパス構造（CLAUDE.mdと同じ階層に）
      const storagePath = `${userId}/Worker${workerNumber}/projects/${projectId}`;
      
      // アップロードするファイルを収集
      const files = await this.collectFiles(sourcePath);
      const uploadedFiles = [];
      
      // 各ファイルをSupabase Storageにアップロード
      for (const file of files) {
        const fileContent = fs.readFileSync(file.absolutePath);
        const filePath = `${storagePath}/${file.relativePath}`;
        
        const { data, error } = await this.supabase.storage
          .from(this.bucketName)
          .upload(filePath, fileContent, {
            contentType: this.getMimeType(file.relativePath),
            upsert: true
          });
          
        if (error) {
          console.error(`❌ Failed to upload ${file.relativePath}:`, error);
          throw error;
        }
        
        uploadedFiles.push(filePath);
        console.log(`📤 Uploaded: ${file.relativePath}`);
      }
      
      // メタデータをアップロード
      const fullMetadata = {
        ...metadata,
        projectId,
        userId,
        workerNumber,
        uploadedFiles,
        createdAt: new Date().toISOString(),
        storagePath
      };
      
      const metadataPath = `${storagePath}/metadata.json`;
      const { error: metaError } = await this.supabase.storage
        .from(this.bucketName)
        .upload(metadataPath, JSON.stringify(fullMetadata, null, 2), {
          contentType: 'application/json',
          upsert: true
        });
        
      if (metaError) {
        console.error('❌ Failed to upload metadata:', metaError);
        throw metaError;
      }
      
      // プロキシURLを生成（署名付きURLの代わりに）
      const proxyBaseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : 'https://anicca-proxy-staging.up.railway.app';
      
      const previewUrl = `${proxyBaseUrl}/api/preview-app/${userId}/Worker${workerNumber}/projects/${projectId}/index.html`;
      
      console.log(`✅ App published to Supabase Storage: ${projectId}`);
      console.log(`🌐 Preview URL: ${previewUrl}`);
      console.log(`📁 Storage path: ${storagePath}`);
      console.log(`👤 User ID: ${userId}`);
      
      return {
        projectId,
        previewUrl,
        storagePath,
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
   * ディレクトリ内のファイルを収集
   * @param {string} dirPath - ディレクトリパス
   * @returns {Array} ファイル情報の配列
   */
  async collectFiles(dirPath, basePath = dirPath, files = []) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // 除外するディレクトリ
        if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          await this.collectFiles(fullPath, basePath, files);
        }
      } else {
        // 相対パスを計算
        const relativePath = path.relative(basePath, fullPath);
        files.push({
          relativePath,
          absolutePath: fullPath
        });
      }
    }
    
    return files;
  }
  
  /**
   * ファイルのMIMEタイプを取得
   * @param {string} filePath - ファイルパス
   * @returns {string} MIMEタイプ
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain',
      '.md': 'text/markdown'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
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
  
}

// シングルトンインスタンス
export const previewManager = new PreviewManager();