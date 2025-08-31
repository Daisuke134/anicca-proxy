const tokenMap = new Map(); // key: userId, value: { token, exp }

export function storeAccessToken(userId, token, expiresInSec = 0) {
  const now = Math.floor(Date.now() / 1000);
  const exp = expiresInSec > 0 ? now + expiresInSec : 0;
  tokenMap.set(userId, { token, exp });
}

export function getAccessToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const entry = tokenMap.get(userId);
  if (!entry) return null;
  if (entry.exp && entry.exp > 0 && entry.exp <= now) {
    tokenMap.delete(userId);
    return null;
  }
  return entry.token;
}

