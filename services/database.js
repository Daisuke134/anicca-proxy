// Database service for managing user data and Slack tokens

import { tokenStorage } from './tokenStorage.js';

/**
 * Get Slack tokens for a specific user
 * @param {string} userId - The user ID
 * @returns {Promise<{bot_token: string, user_token: string, userId: string} | null>}
 */
export async function getSlackTokensForUser(userId) {
  try {
    console.log('🔍 Getting Slack tokens for user:', userId);
    
    // Get tokens from storage
    const tokens = await tokenStorage.getTokens(userId);
    
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
    await tokenStorage.saveTokens(userId, tokens);
    return true;
  } catch (error) {
    console.error('❌ Error saving Slack tokens:', error);
    return false;
  }
}