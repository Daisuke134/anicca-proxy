// Database service for managing user data and Slack tokens

import { loadTokens, saveTokens } from './tokenStorage.js';

/**
 * Get Slack tokens for a specific user
 * @param {string} userId - The user ID
 * @returns {Promise<{bot_token: string, user_token: string, userId: string} | null>}
 */
export async function getSlackTokensForUser(userId) {
  try {
    console.log('🔍 Getting Slack tokens for user:', userId);
    
    // Get tokens from storage
    const tokens = await loadTokens(userId);
    
    if (tokens && tokens.bot_token) {
      console.log('✅ Found Slack tokens for user');
      return {
        bot_token: tokens.bot_token,
        user_token: tokens.user_token || null,
        userId: userId
      };
    }
    
    console.log('❌ No Slack tokens found for user');
    return null;
  } catch (error) {
    console.error('❌ Error getting Slack tokens:', error);
    return null;
  }
}

/**
 * Save Slack tokens for a specific user
 * @param {string} userId - The user ID
 * @param {object} tokens - The tokens object
 * @returns {Promise<boolean>}
 */
export async function saveSlackTokensForUser(userId, tokens) {
  try {
    console.log('💾 Saving Slack tokens for user:', userId);
    await saveTokens(userId, tokens);
    return true;
  } catch (error) {
    console.error('❌ Error saving Slack tokens:', error);
    return false;
  }
}

/**
 * Save tokens to database (alias for saveSlackTokensForUser)
 * @param {string} userId - The user ID
 * @param {object} tokens - The tokens object
 * @returns {Promise<void>}
 */
export async function saveTokensToDB(userId, tokens) {
  await saveSlackTokensForUser(userId, tokens);
}

/**
 * Load tokens from database by userId
 * @param {string} userId - The user ID
 * @returns {Promise<object|null>}
 */
export async function loadTokensFromDB(userId) {
  return await getSlackTokensForUser(userId);
}

/**
 * Load latest tokens from database (for backward compatibility)
 * @returns {Promise<object|null>}
 */
export async function loadLatestTokensFromDB() {
  try {
    // For backward compatibility, return global tokens if available
    if (global.slackBotToken) {
      return {
        bot_token: global.slackBotToken,
        user_token: global.slackUserToken || null
      };
    }
    return null;
  } catch (error) {
    console.error('❌ Error loading latest tokens:', error);
    return null;
  }
}

/**
 * Initialize database (no-op for this implementation)
 * @returns {Promise<void>}
 */
export async function initDatabase() {
  console.log('🔧 Database initialized (using tokenStorage)');
  return Promise.resolve();
}