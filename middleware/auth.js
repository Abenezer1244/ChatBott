// Authentication middleware for securing API routes
const jwt = require('jsonwebtoken');

// FIXED: Enhanced verifyAdmin middleware with better error handling
const verifyAdmin = (req, res, next) => {
    // Check multiple possible locations for adminKey
    const adminKey = req.body.adminKey || 
                    req.query.adminKey || 
                    req.headers['x-admin-key'] || 
                    req.headers['adminkey'] ||
                    req.headers['authorization']?.replace('Bearer ', '');
    
    // Log for debugging (remove in production)
    console.log('Admin verification - Key provided:', !!adminKey);
    console.log('Expected admin key:', !!process.env.ADMIN_KEY);
    
    if (!adminKey) {
      return res.status(401).json({ 
        error: 'Admin key is required',
        details: 'Please provide admin key in request body, query parameter, or x-admin-key header'
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
      console.warn('Invalid admin key attempted:', adminKey.substring(0, 3) + '***');
      return res.status(401).json({ 
        error: 'Unauthorized',
        details: 'Invalid admin key provided'
      });
    }
    
    // Log successful admin access
    console.log('Admin access granted for request:', req.method, req.originalUrl);
    next();
};

// FIXED: Enhanced verifyToken middleware
const verifyToken = (req, res, next) => {
  const token = req.body.token || 
                req.query.token || 
                req.headers['x-access-token'] ||
                req.headers['authorization']?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(400).json({ 
      error: 'Token is required',
      details: 'Please provide token in request body, query parameter, or x-access-token header'
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
    req.clientData = decoded;
    
    // Log token verification (remove sensitive data in production)
    console.log('Token verified for client:', decoded.clientId);
    next();
  } catch (error) {
    console.warn('Token verification failed:', error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token has expired',
        details: 'Please request a new token',
        expiredAt: error.expiredAt
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        details: 'Token format is invalid or corrupted'
      });
    } else if (error.name === 'NotBeforeError') {
      return res.status(401).json({ 
        error: 'Token not active',
        details: 'Token is not active yet',
        date: error.date
      });
    }
    
    return res.status(401).json({ 
      error: 'Token verification failed',
      details: 'Unable to verify the provided token'
    });
  }
};

// FIXED: Optional admin verification (allows both admin and regular access)
const verifyAdminOptional = (req, res, next) => {
  const adminKey = req.body.adminKey || 
                  req.query.adminKey || 
                  req.headers['x-admin-key'] || 
                  req.headers['adminkey'];
  
  if (adminKey) {
    if (adminKey === process.env.ADMIN_KEY) {
      req.isAdmin = true;
      console.log('Admin access granted (optional middleware)');
    } else {
      req.isAdmin = false;
      console.warn('Invalid admin key in optional middleware');
    }
  } else {
    req.isAdmin = false;
  }
  
  next();
};

// FIXED: Rate limiting bypass for admin
const adminRateLimitBypass = (req, res, next) => {
  const adminKey = req.body.adminKey || 
                  req.query.adminKey || 
                  req.headers['x-admin-key'] || 
                  req.headers['adminkey'];
  
  if (adminKey === process.env.ADMIN_KEY) {
    // Skip rate limiting for admin requests
    req.skipRateLimit = true;
  }
  
  next();
};

// FIXED: Domain validation middleware
const validateDomain = (req, res, next) => {
  const allowedDomains = process.env.ALLOWED_DOMAINS?.split(',') || [];
  
  if (allowedDomains.length === 0) {
    // No domain restrictions
    return next();
  }
  
  const origin = req.get('origin') || req.get('referer');
  const host = req.get('host');
  
  if (!origin && !host) {
    return res.status(400).json({ 
      error: 'Domain validation failed',
      details: 'Unable to determine request origin'
    });
  }
  
  const requestDomain = origin ? new URL(origin).hostname : host.split(':')[0];
  const isAllowed = allowedDomains.some(domain => 
    requestDomain === domain || requestDomain.endsWith(`.${domain}`)
  );
  
  if (!isAllowed) {
    console.warn('Domain not allowed:', requestDomain);
    return res.status(403).json({ 
      error: 'Domain not authorized',
      details: `Domain ${requestDomain} is not authorized to access this API`
    });
  }
  
  next();
};

module.exports = {
  verifyAdmin,
  verifyToken,
  verifyAdminOptional,
  adminRateLimitBypass,
  validateDomain
};