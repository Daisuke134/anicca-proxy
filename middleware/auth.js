import { createClient } from '@supabase/supabase-js';

// Supabase client for verification
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔧 Supabase config:', {
  url: supabaseUrl ? 'Set' : 'Missing',
  key: supabaseKey ? 'Set' : 'Missing'
});

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Rate limiting storage (in-memory for now)
const rateLimitStore = new Map();

// Allowed origins
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://app.aniccaai.com',
  'https://anicca-web.vercel.app',
  /https:\/\/anicca-web-.*\.vercel\.app/ // Vercel preview URLs
];

// Check if origin is allowed
function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.some(allowed => {
    if (allowed instanceof RegExp) {
      return allowed.test(origin);
    }
    return allowed === origin;
  });
}

// Rate limiting check
function checkRateLimit(userId, isProUser = false) {
  const limit = isProUser ? 1000 : 100; // Daily limits
  const key = `${userId}_${new Date().toDateString()}`;
  
  const current = rateLimitStore.get(key) || 0;
  if (current >= limit) {
    return false;
  }
  
  rateLimitStore.set(key, current + 1);
  return true;
}

// Main auth middleware
export async function authMiddleware(req, res, next) {
  try {
    // 1. Origin/Referer check
    const origin = req.headers.origin || req.headers.referer;
    if (origin && !isAllowedOrigin(origin)) {
      console.warn('❌ Blocked request from unauthorized origin:', origin);
      return res.status(403).json({ error: 'Forbidden: Invalid origin' });
    }

    // 2. Check for public endpoints (no auth required)
    const publicEndpoints = [
      '/api/health',
      '/api/slack/oauth-url',
      '/api/slack/oauth-callback',
      '/api/slack/check-connection'
      // 他のAPIは認証が必要
    ];
    
    const requestPath = req.path || req.url || req.originalUrl;
    console.log('🔍 Auth check for path:', requestPath);
    
    if (publicEndpoints.some(endpoint => requestPath.startsWith(endpoint))) {
      console.log('✅ Public endpoint, skipping auth');
      return next();
    }

    // 3. Bearer token authentication
    const authHeader = req.headers.authorization;
    console.log('🔐 Auth header present:', !!authHeader);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ No valid Bearer token found');
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const token = authHeader.substring(7);
    
    // 4. Verify token with Supabase
    if (!supabase) {
      console.error('❌ Supabase client not initialized');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('❌ Invalid token:', error?.message || 'No user found');
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // 5. Rate limiting
    const isProUser = false; // TODO: Check user's subscription status
    if (!checkRateLimit(user.id, isProUser)) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        limit: isProUser ? 1000 : 100,
        reset: 'Daily at midnight UTC'
      });
    }

    // 6. Attach user to request
    req.user = user;
    req.userId = user.id;
    
    console.log('✅ Authenticated request from user:', user.email);
    next();
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Optional: Middleware for SDK endpoints only
export function sdkAuthMiddleware(req, res, next) {
  // Additional checks for SDK endpoints
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required for SDK' });
  }
  
  // TODO: Check if user has SDK access (paid plan)
  
  next();
}