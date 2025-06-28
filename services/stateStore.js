import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// State store directory
const STATE_DIR = path.join(__dirname, '../.slack-states');

// Ensure state directory exists
async function ensureStateDir() {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create state directory:', error);
  }
}

// Simple file-based state store
export const stateStore = {
  // Save state
  set: async (state, data) => {
    await ensureStateDir();
    const filePath = path.join(STATE_DIR, `${state}.json`);
    try {
      await fs.writeFile(filePath, JSON.stringify(data));
      console.log(`✅ State saved: ${state}`);
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  },

  // Get state
  get: async (state) => {
    const filePath = path.join(STATE_DIR, `${state}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      console.log(`✅ State retrieved: ${state}`);
      return JSON.parse(data);
    } catch (error) {
      console.log(`State not found: ${state}`);
      return null;
    }
  },

  // Delete state
  delete: async (state) => {
    const filePath = path.join(STATE_DIR, `${state}.json`);
    try {
      await fs.unlink(filePath);
      console.log(`✅ State deleted: ${state}`);
    } catch (error) {
      console.log(`Failed to delete state: ${state}`);
    }
  },

  // Clean up old states (older than 1 hour)
  cleanup: async () => {
    await ensureStateDir();
    try {
      const files = await fs.readdir(STATE_DIR);
      const now = Date.now();
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(STATE_DIR, file);
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;
          
          // Delete if older than 1 hour
          if (age > 3600000) {
            await fs.unlink(filePath);
            console.log(`🧹 Cleaned up old state: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error('Failed to cleanup states:', error);
    }
  }
};

// Run cleanup periodically
setInterval(() => {
  stateStore.cleanup().catch(console.error);
}, 600000); // Every 10 minutes