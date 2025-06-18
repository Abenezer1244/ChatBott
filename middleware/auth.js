// Authentication middleware for securing API routes
const jwt = require('jsonwebtoken');

/**
 * Enhanced verifyAdmin middleware with better error handling and logging
 */
const verifyAdmin = (req, res, next) => {
    // Check multiple possible locations for adminKey
    const adminKey = req.body?.adminKey || 
                    req.query?.adminKey || 
                    req.headers['x-admin-key'] || 
                    req.headers['adminkey'] ||
                    req.headers['authorization']?.replace('Bearer ', '') ||
                    req.headers['authorization']?.replace('Admin ', '');
    
    // Enhanced logging for debugging
    console.log(`Admin verification attempt for ${req.method} ${req.originalUrl}`);
    console.log('Admin key provided:', !!adminKey);
    console.log('Expected admin key configured:', !!process.env.ADMIN_KEY);
    
    if (!adminKey) {
      console.warn('Admin verification failed: No admin key provided');
      return res.status(401).json({ 
        error: 'Admin key is required',
        details: 'Please provide admin key in request body, query parameter, or x-admin-key header',
        supportedMethods: [
          'Body: { "adminKey": "your-key" }',
          'Query: ?adminKey=your-key',
          'Header: x-admin-key: your-key',
          'Header: Authorization: Bearer your-key',
          'Header: Authorization: Admin your-key'
        ]
      });
    }

    if (!process.env.ADMIN_KEY) {
      console.error('ADMIN_KEY environment variable is not set');
      return res.status(500).json({ 
        error: 'Server configuration error',
        details: 'Admin key is not configured on the server'
      });
    }

    if (adminKey !== process.env.ADMIN_KEY) {
      console.warn(`Invalid admin key attempted from IP: ${req.ip || req.connection.remoteAddress}`);
      console.warn(`Invalid key (first 3 chars): ${adminKey.substring(0, 3)}***`);
      return res.status(401).json({ 
        error: 'Unauthorized',
        details: 'Invalid admin key provided',
        timestamp: new Date().toISOString()
      });
    }
    
    // Log successful admin access with more details
    console.log(`Admin access granted for ${req.method} ${req.originalUrl} from IP: ${req.ip || req.connection.remoteAddress}`);
    
    // Add admin context to request
    req.isAdmin = true;
    req.adminAccessTime = new Date();
    
    next();
};

/**
 * Enhanced verifyToken middleware with comprehensive token validation
 */
const verifyToken = (req, res, next) => {
  const token = req.body?.token || 
                req.query?.token || 
                req.headers['x-access-token'] ||
                req.headers['authorization']?.replace('Bearer ', '');
  
  console.log(`Token verification attempt for ${req.method} ${req.originalUrl}`);
  console.log('Token provided:', !!token);
  
  if (!token) {
    console.warn('Token verification failed: No token provided');
    return res.status(400).json({ 
      error: 'Token is required',
      details: 'Please provide token in request body, query parameter, or authorization header',
      supportedMethods: [
        'Body: { "token": "your-token" }',
        'Query: ?token=your-token',
        'Header: x-access-token: your-token',
        'Header: Authorization: Bearer your-token'
      ]
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET environment variable is not set');
    return res.status(500).json({ 
      error: 'Server configuration error',
      details: 'JWT secret is not configured on the server'
    });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Add additional validation
    if (!decoded.clientId) {
      console.warn('Token verification failed: Missing clientId in token');
      return res.status(401).json({
        error: 'Invalid token structure',
        details: 'Token is missing required clientId claim'
      });
    }
    
    // Add token data to request
    req.clientData = decoded;
    req.tokenVerifiedAt = new Date();
    
    console.log(`Token verified successfully for client: ${decoded.clientId}`);
    next();
    
  } catch (error) {
    console.warn(`Token verification failed: ${error.message}`);
    
    // Enhanced error responses based on error type
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token has expired',
        details: 'Please request a new token',
        expiredAt: error.expiredAt,
        currentTime: new Date().toISOString()
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        details: 'Token format is invalid or corrupted',
        tokenError: error.message
      });
    } else if (error.name === 'NotBeforeError') {
      return res.status(401).json({ 
        error: 'Token not active',
        details: 'Token is not active yet',
        activeAt: error.date
      });
    }
    
    return res.status(401).json({ 
      error: 'Token verification failed',
      details: 'Unable to verify the provided token',
      errorType: error.name || 'Unknown'
    });
  }
};

/**
 * Optional admin verification (allows both admin and regular access)
 */
const verifyAdminOptional = (req, res, next) => {
  const adminKey = req.body?.adminKey || 
                  req.query?.adminKey || 
                  req.headers['x-admin-key'] || 
                  req.headers['adminkey'] ||
                  req.headers['authorization']?.replace('Bearer ', '') ||
                  req.headers['authorization']?.replace('Admin ', '');
  
  if (adminKey) {
    if (adminKey === process.env.ADMIN_KEY) {
      req.isAdmin = true;
      req.adminAccessTime = new Date();
      console.log(`Optional admin access granted for ${req.method} ${req.originalUrl}`);
    } else {
      req.isAdmin = false;
      console.warn(`Invalid admin key in optional middleware for ${req.originalUrl}`);
    }
  } else {
    req.isAdmin = false;
  }
  
  next();
};

/**
 * Rate limiting bypass for admin requests
 */
const adminRateLimitBypass = (req, res, next) => {
  const adminKey = req.body?.adminKey || 
                  req.query?.adminKey || 
                  req.headers['x-admin-key'] || 
                  req.headers['adminkey'] ||
                  req.headers['authorization']?.replace('Bearer ', '') ||
                  req.headers['authorization']?.replace('Admin ', '');
  
  if (adminKey === process.env.ADMIN_KEY) {
    // Skip rate limiting for admin requests
    req.skipRateLimit = true;
    console.log(`Rate limiting bypassed for admin request: ${req.method} ${req.originalUrl}`);
  }
  
  next();
};

/**
 * Enhanced domain validation middleware
 */
const validateDomain = (req, res, next) => {
  const allowedDomains = process.env.ALLOWED_DOMAINS?.split(',').map(d => d.trim()) || [];
  
  if (allowedDomains.length === 0) {
    // No domain restrictions configured
    console.log('No domain restrictions configured, allowing all origins');
    return next();
  }
  
  const origin = req.get('origin') || req.get('referer');
  const host = req.get('host');
  const forwardedHost = req.get('x-forwarded-host');
  
  console.log(`Domain validation for ${req.method} ${req.originalUrl}`);
  console.log('Origin:', origin);
  console.log('Host:', host);
  console.log('Forwarded Host:', forwardedHost);
  
  if (!origin && !host && !forwardedHost) {
    console.warn('Domain validation failed: Unable to determine request origin');
    return res.status(400).json({ 
      error: 'Domain validation failed',
      details: 'Unable to determine request origin',
      headers: {
        origin: origin || 'not provided',
        host: host || 'not provided',
        forwardedHost: forwardedHost || 'not provided'
      }
    });
  }
  
  // Extract domain from various sources
  let requestDomain;
  if (origin) {
    try {
      requestDomain = new URL(origin).hostname;
    } catch (err) {
      console.warn('Invalid origin URL:', origin);
    }
  }
  
  if (!requestDomain && host) {
    requestDomain = host.split(':')[0]; // Remove port if present
  }
  
  if (!requestDomain && forwardedHost) {
    requestDomain = forwardedHost.split(':')[0]; // Remove port if present
  }
  
  if (!requestDomain) {
    console.warn('Could not extract domain from request headers');
    return res.status(400).json({
      error: 'Domain validation failed',
      details: 'Could not extract domain from request headers'
    });
  }
  
  console.log('Extracted request domain:', requestDomain);
  console.log('Allowed domains:', allowedDomains);
  
  const isAllowed = allowedDomains.some(domain => {
    // Exact match
    if (requestDomain === domain) return true;
    
    // Subdomain match (e.g., sub.example.com matches example.com)
    if (requestDomain.endsWith(`.${domain}`)) return true;
    
    // Wildcard match (e.g., *.example.com)
    if (domain.startsWith('*.')) {
      const baseDomain = domain.substring(2);
      return requestDomain === baseDomain || requestDomain.endsWith(`.${baseDomain}`);
    }
    
    return false;
  });
  
  if (!isAllowed) {
    console.warn(`Domain not allowed: ${requestDomain}`);
    console.warn(`Allowed domains: ${allowedDomains.join(', ')}`);
    return res.status(403).json({ 
      error: 'Domain not authorized',
      details: `Domain ${requestDomain} is not authorized to access this API`,
      requestDomain: requestDomain,
      allowedDomains: allowedDomains
    });
  }
  
  console.log(`Domain ${requestDomain} is authorized`);
  req.authorizedDomain = requestDomain;
  next();
};

/**
 * Request logging middleware for security monitoring
 */
const securityLogger = (req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
  const userAgent = req.get('user-agent') || 'Unknown';
  const timestamp = new Date().toISOString();
  
  // Log security-relevant requests
  if (req.originalUrl.includes('/admin') || 
      req.headers['x-admin-key'] || 
      req.body?.adminKey ||
      req.query?.adminKey) {
    console.log(`SECURITY LOG [${timestamp}]: Admin access attempt from ${clientIp} - ${req.method} ${req.originalUrl} - User-Agent: ${userAgent}`);
  }
  
  // Log failed authentication attempts
  const originalSend = res.send;
  res.send = function(data) {
    if (res.statusCode === 401 || res.statusCode === 403) {
      console.log(`SECURITY LOG [${timestamp}]: Authentication failed from ${clientIp} - ${req.method} ${req.originalUrl} - Status: ${res.statusCode}`);
    }
    originalSend.call(this, data);
  };
  
  next();
};

/**
 * Enhanced CORS middleware
 */
const corsEnhanced = (req, res, next) => {
  const origin = req.get('origin');
  
  // Log CORS requests for debugging
  if (origin) {
    console.log(`CORS request from origin: ${origin} to ${req.method} ${req.originalUrl}`);
  }
  
  // Set CORS headers
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-key, x-access-token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    console.log(`Handling OPTIONS preflight request from ${origin}`);
    return res.status(200).end();
  }
  
  next();
};

module.exports = {
  verifyAdmin,
  verifyToken,
  verifyAdminOptional,
  adminRateLimitBypass,
  validateDomain,
  securityLogger,
  corsEnhanced
};