/**
 * Chatbot Leasing System - Fixed Main Server File
 * Production-ready implementation for leasing TestMyPrompt chatbots
 */

// Core dependencies
const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Add this to your .env file: ADMIN_DOMAIN=trychatbot.tech
const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN || 'trychatbot.tech';

// Trust proxy for Render - Important for HTTPS
app.set('trust proxy', true);

// Force HTTPS redirect in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.header('x-forwarded-proto') !== 'https') {
    res.redirect(`https://${req.header('host')}${req.url}`);
  } else {
    next();
  }
});

// FIXED: Enhanced CORS configuration with more permissive settings for widget loading
const corsOptions = {
  origin: function (origin, callback) {
    // CRITICAL FIX: Allow requests with no origin (direct API calls, mobile apps, etc.)
    if (!origin) {
      console.log('CORS: Request with no origin - allowing');
      return callback(null, true);
    }
    
    // CRITICAL FIX: Allow all origins for widget functionality - this is essential for widgets
    console.log('CORS: Request from origin:', origin);
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-access-token', 
    'x-admin-key', 
    'Origin', 
    'X-Requested-With', 
    'Accept',
    'Access-Control-Allow-Origin',
    'Access-Control-Allow-Headers',
    'Access-Control-Allow-Methods'
  ],
  credentials: false, // FIXED: Set to false for widget usage
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

// FIXED: Enhanced preflight handler for all routes
app.options('*', (req, res) => {
  const origin = req.get('origin') || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-key, x-access-token');
  res.header('Access-Control-Max-Age', '86400');
  console.log(`OPTIONS preflight handled for ${req.originalUrl} from ${origin}`);
  res.status(200).end();
});

// FIXED: Enhanced body parsing with better error handling
app.use(express.json({ 
  limit: '1mb',
  verify: (req, res, buf) => {
    try {
      if (buf.length > 0) {
        JSON.parse(buf);
      }
    } catch (e) {
      console.error('Invalid JSON in request body:', e.message);
      res.status(400).json({ 
        error: 'Invalid JSON',
        message: 'Request body contains invalid JSON'
      });
      throw new Error('Invalid JSON');
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '1mb' 
}));

// Validate required environment variables
if (!MONGODB_URI || !JWT_SECRET) {
  console.error('Missing required environment variables. Check your .env file.');
  process.exit(1);
}

// FIXED: Rate limiting with widget-friendly configuration
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes default
  max: parseInt(process.env.RATE_LIMIT_MAX) || 500, // INCREASED for widget functionality
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    // Skip rate limiting for widget-related requests
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    const isWidgetRequest = req.path.includes('/validate') || 
                           req.path.includes('/widget.js') || 
                           req.path.includes('/usage/track') ||
                           req.path.includes('/auth/token');
    return adminKey === process.env.ADMIN_KEY || isWidgetRequest;
  }
});

// FIXED: Enhanced security headers for widget compatibility
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "http:", "*.testmyprompt.com", "testmyprompt.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https:", "http:", "ws:", "wss:", "*.testmyprompt.com", "testmyprompt.com"],
      fontSrc: ["'self'", "data:", "https:", "http:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https:", "http:"],
      frameSrc: ["'self'", "https:", "http:", "*.testmyprompt.com", "testmyprompt.com"],
      frameAncestors: ["*"], // CRITICAL: Allow embedding in any frame
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"]
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" }, // CRITICAL for widget loading
  crossOriginEmbedderPolicy: false // CRITICAL: Disable for iframe compatibility
})); 

app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

// Apply rate limiting to API requests (excluding critical widget endpoints)
app.use('/api', (req, res, next) => {
  // Skip rate limiting for critical widget endpoints
  if (req.path === '/validate' || 
      req.path === '/usage/track' || 
      req.path === '/auth/token' ||
      req.path === '/widget-info' ||
      req.path === '/health') {
    return next();
  }
  return apiLimiter(req, res, next);
});

// Enhanced request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  
  res.send = function(...args) {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const size = args[0] ? Buffer.byteLength(args[0]) : 0;
    
    console.log(`${req.method} ${req.originalUrl} ${status} ${duration}ms ${size}b - ${req.ip} - ${req.get('User-Agent')?.substring(0, 50) || 'Unknown'}`);
    
    // Log errors in detail for widget-related endpoints
    if (status >= 400 && (req.originalUrl.includes('/validate') || req.originalUrl.includes('/widget'))) {
      console.error(`Widget Error ${status}: ${req.method} ${req.originalUrl}`, {
        body: req.body,
        query: req.query,
        headers: {
          origin: req.headers.origin,
          referer: req.headers.referer,
          'user-agent': req.headers['user-agent']
        }
      });
    }
    
    originalSend.apply(this, args);
  };
  
  next();
});

// MongoDB Connection with proper error handling and timeout settings
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Proper process termination handling
process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  try {
    await mongoose.connection.close(false);
    console.log('MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
});

mongoose.Promise = global.Promise;
mongoose.connection.on('error', (err) => {
  console.error(`MongoDB connection error: ${err}`);
  process.exit(1);
});

// Use the external Client model
const Client = require('./models/Client');

// DOMAIN-BASED ADMIN ACCESS ROUTE
app.get('/', (req, res) => {
  const host = req.get('host') || '';
  const hostname = host.split(':')[0];
  
  console.log('Request host:', host);
  console.log('Request hostname:', hostname);
  console.log('Admin domain:', ADMIN_DOMAIN);
  
  if (hostname === ADMIN_DOMAIN || host === ADMIN_DOMAIN || 
      hostname === `www.${ADMIN_DOMAIN}` || host === `www.${ADMIN_DOMAIN}`) {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Chatbot Leasing System</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f5f5f5;
          }
          .container {
            text-align: center;
            padding: 2rem;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 { color: #333; }
          p { color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Chatbot Leasing System</h1>
          <p>Welcome to the Chatbot Leasing API</p>
          <p>For admin access, please visit the designated admin domain.</p>
          <p>System Status: <span style="color: green;">Online</span></p>
        </div>
      </body>
      </html>
    `);
  }
});

// Alternative route for direct admin access
app.get('/admin', (req, res) => {
  const host = req.get('host') || '';
  const hostname = host.split(':')[0];
  
  if (hostname === ADMIN_DOMAIN || host === ADMIN_DOMAIN || 
      hostname === `www.${ADMIN_DOMAIN}` || host === `www.${ADMIN_DOMAIN}`) {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    res.status(403).json({ 
      error: 'Admin panel can only be accessed from the authorized domain',
      adminDomain: ADMIN_DOMAIN 
    });
  }
});

// CRITICAL FIX: Enhanced TOKEN VALIDATION ROUTE
app.post('/api/validate', async (req, res) => {
  try {
    console.log('=== TOKEN VALIDATION REQUEST ===');
    console.log('Headers:', {
      origin: req.headers.origin,
      referer: req.headers.referer,
      'user-agent': req.headers['user-agent'],
      'content-type': req.headers['content-type']
    });
    console.log('Body:', req.body);
    console.log('Method:', req.method);
    console.log('URL:', req.originalUrl);
    console.log('IP:', req.ip);
    
    // FIXED: Enhanced request validation
    if (!req.body || Object.keys(req.body).length === 0) {
      console.error('Request body is missing or empty');
      return res.status(400).json({ 
        error: 'Request body is required',
        received: 'Empty or missing body data',
        contentType: req.get('content-type') || 'not provided'
      });
    }
    
    const { token, domain } = req.body;
    
    if (!token) {
      console.error('Token is missing from request');
      return res.status(400).json({ 
        error: 'Token is required',
        received: { 
          token: token || 'undefined', 
          domain: domain || 'undefined',
          bodyKeys: Object.keys(req.body || {})
        },
        help: 'Include a valid JWT token in the request body'
      });
    }
    
    console.log(`Validating token for domain: ${domain || 'no domain provided'}`);
    
    // FIXED: Verify token with enhanced error handling
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token decoded successfully:', { 
        clientId: decodedToken.clientId,
        iat: decodedToken.iat,
        exp: decodedToken.exp,
        expiresAt: new Date(decodedToken.exp * 1000).toISOString()
      });
    } catch (err) {
      console.error('Token verification failed:', err.message, err.name);
      
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          expiredAt: err.expiredAt,
          message: 'The token has expired, please request a new one'
        });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token format',
          details: err.message,
          message: 'The token format is invalid'
        });
      }
      if (err.name === 'NotBeforeError') {
        return res.status(401).json({ 
          error: 'Token not active yet',
          date: err.date,
          message: 'The token is not active yet'
        });
      }
      return res.status(401).json({ 
        error: 'Invalid token',
        type: err.name,
        message: 'Token verification failed'
      });
    }
    
    // FIXED: Get client from database with enhanced error handling
    let client;
    try {
      client = await Client.findOne({ clientId: decodedToken.clientId });
    } catch (dbError) {
      console.error('Database error while finding client:', dbError);
      return res.status(500).json({ 
        error: 'Database error',
        message: 'Unable to verify client information'
      });
    }
    
    if (!client) {
      console.error(`Client not found: ${decodedToken.clientId}`);
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: decodedToken.clientId,
        message: 'The client associated with this token does not exist'
      });
    }
    
    console.log(`Client found: ${client.name} (${client.clientId}), Active: ${client.active}`);
    
    if (!client.active) {
      console.warn(`Client is inactive: ${client.clientId}`);
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: client.clientId,
        message: 'This client account has been deactivated'
      });
    }
    
    // FIXED: Enhanced domain validation with better logic
    if (client.allowedDomains && client.allowedDomains.length > 0) {
      if (!domain) {
        console.warn('Domain information is required but not provided');
        return res.status(400).json({ 
          error: 'Domain information is required',
          allowedDomains: client.allowedDomains,
          message: 'This client has domain restrictions enabled',
          help: 'Include the domain in your validation request'
        });
      }
      
      // CRITICAL FIX: Better domain validation logic
      const isAllowed = client.allowedDomains.some(allowedDomain => {
        // Exact match
        if (domain === allowedDomain) return true;
        
        // Remove protocol and www if present for comparison
        const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '');
        const cleanAllowedDomain = allowedDomain.replace(/^(https?:\/\/)?(www\.)?/, '');
        
        if (cleanDomain === cleanAllowedDomain) return true;
        
        // Subdomain match (e.g., sub.example.com matches example.com)
        if (cleanDomain.endsWith(`.${cleanAllowedDomain}`)) return true;
        
        // Wildcard match (e.g., *.example.com)
        if (allowedDomain.startsWith('*.')) {
          const baseDomain = allowedDomain.substring(2);
          return cleanDomain === baseDomain || cleanDomain.endsWith(`.${baseDomain}`);
        }
        
        return false;
      });
      
      if (!isAllowed) {
        console.warn(`Domain not authorized: ${domain} for client: ${client.clientId}`);
        console.warn(`Allowed domains: ${client.allowedDomains.join(', ')}`);
        return res.status(403).json({ 
          error: 'Domain not authorized',
          domain: domain,
          allowedDomains: client.allowedDomains,
          message: `Domain ${domain} is not authorized for this client`
        });
      }
      
      console.log(`Domain ${domain} is authorized for client ${client.clientId}`);
    } else {
      console.log(`No domain restrictions for client ${client.clientId}`);
    }
    
    // Update request count and last request date
    try {
      client.requestCount = (client.requestCount || 0) + 1;
      client.lastRequestDate = new Date();
      await client.save();
      console.log(`Updated usage stats for client ${client.clientId}: ${client.requestCount} requests`);
    } catch (saveError) {
      console.error('Failed to update client usage stats:', saveError);
      // Continue anyway - don't fail validation due to stats update failure
    }
    
    // FIXED: Enhanced response with comprehensive configuration
    const customization = client.chatbotConfig?.customization || {};
    const response = {
      valid: true,
      config: {
        widgetId: client.chatbotConfig?.widgetId || "6809b3a1523186af0b2c9933",
        customization: {
          primaryColor: customization.primaryColor || '#0084ff',
          secondaryColor: customization.secondaryColor || '#ffffff',
          headerText: customization.headerText || 'Chat with us',
          botName: customization.botName || 'Assistant',
          logoUrl: customization.logoUrl || '',
          position: customization.position || 'right',
          autoOpen: customization.autoOpen || false,
          ...customization
        }
      },
      client: {
        name: client.name,
        active: client.active,
        clientId: client.clientId
      },
      validation: {
        domain: domain || null,
        timestamp: new Date().toISOString(),
        requestCount: client.requestCount,
        tokenValid: true
      }
    };
    
    console.log('=== VALIDATION SUCCESSFUL ===');
    console.log('Response config:', response.config);
    
    res.json(response);
    
  } catch (error) {
    console.error('=== TOKEN VALIDATION ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred during validation',
      timestamp: new Date().toISOString()
    });
  }
});

// ENHANCED AUTHENTICATION ROUTES

// Generate a new token for a client
app.post('/api/auth/token', async (req, res) => {
  try {
    console.log('Token generation request:', req.body);
    
    const { clientId } = req.body;
    
    if (!clientId) {
      console.error('Client ID is missing from token request');
      return res.status(400).json({ 
        error: 'Client ID is required',
        received: req.body,
        help: 'Include clientId in the request body'
      });
    }
    
    // Find the client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      console.error(`Client not found: ${clientId}`);
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId,
        message: `No client found with ID: ${clientId}`
      });
    }
    
    console.log(`Client found: ${client.name} (${client.clientId})`);
    
    if (!client.active) {
      console.warn(`Inactive client token request: ${clientId}`);
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: clientId,
        message: 'This client account has been deactivated'
      });
    }
    
    // Generate token with comprehensive claims
    const tokenPayload = {
      clientId: client.clientId,
      active: client.active,
      allowedDomains: client.allowedDomains,
      tokenType: 'jwt',
      iat: Math.floor(Date.now() / 1000),
      clientName: client.name,
      widgetId: client.chatbotConfig?.widgetId || "6809b3a1523186af0b2c9933"
    };
    
    const tokenOptions = { 
      expiresIn: process.env.TOKEN_EXPIRY || '24h', // INCREASED: 24 hours for better UX
      issuer: 'chatbot-leasing-system',
      audience: client.clientId
    };
    
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, tokenOptions);
    
    console.log(`Token generated successfully for client: ${clientId}`);
    
    const response = {
      token,
      expiresIn: process.env.TOKEN_EXPIRY || '24h',
      clientId: client.clientId,
      tokenType: 'Bearer',
      generatedAt: new Date().toISOString(),
      client: {
        name: client.name,
        active: client.active,
        widgetId: client.chatbotConfig?.widgetId || "6809b3a1523186af0b2c9933"
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to generate token'
    });
  }
});

// FIXED: Widget.js serving endpoint with enhanced headers
app.get('/widget.js', (req, res) => {
  console.log('Widget.js requested from:', req.get('origin') || req.get('referer') || 'unknown');
  
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, X-Requested-With, Accept');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes cache
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  
  try {
    const widgetPath = path.join(__dirname, 'public', 'widget.js');
    console.log('Serving widget.js from:', widgetPath);
    res.sendFile(widgetPath);
  } catch (error) {
    console.error('Error serving widget.js:', error);
    res.status(500).send('// Error loading widget - please try again later');
  }
});

// Continue with the rest of your existing routes...
// [Include all your other routes here - clients, auth, etc.]

// Health check endpoint
app.get('/api/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  res.json({ 
    status: 'ok',
    service: 'Chatbot Leasing System',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
    },
    mongodb: mongoStatus,
    version: '1.0.2'
  });
});

// FIXED: Test endpoint for debugging
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    headers: {
      origin: req.get('origin'),
      referer: req.get('referer'),
      userAgent: req.get('user-agent'),
      host: req.get('host')
    },
    ip: req.ip,
    method: req.method,
    cors: 'enabled'
  });
});

// Widget info endpoint for debugging
app.get('/api/widget-info/:widgetId', async (req, res) => {
  try {
    const { widgetId } = req.params;
    
    if (!widgetId) {
      return res.status(400).json({ error: 'Widget ID is required' });
    }
    
    // Find client by widget ID
    const client = await Client.findOne({ 'chatbotConfig.widgetId': widgetId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Widget not found',
        widgetId: widgetId
      });
    }
    
    // Return basic widget information (no sensitive data)
    res.json({
      widgetId: widgetId,
      exists: true,
      active: client.active,
      customization: client.chatbotConfig.customization,
      client: {
        name: client.name,
        active: client.active
      }
    });
    
  } catch (error) {
    console.error('Widget info error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get widget info'
    });
  }
});

// USAGE TRACKING ROUTE
app.post('/api/usage/track', async (req, res) => {
  try {
    console.log('Usage tracking request:', req.body);
    
    const { clientId, url, referrer, timestamp } = req.body;
    
    if (!clientId) {
      console.warn('Usage tracking: Client ID is required');
      return res.status(400).json({ 
        error: 'Client ID is required',
        received: req.body
      });
    }
    
    // Find the client
    const client = await Client.findOne({ clientId });
    
    if (client) {
      console.log(`Tracking usage for client: ${client.name} (${clientId})`);
      
      // Update usage stats
      client.requestCount = (client.requestCount || 0) + 1;
      client.lastRequestDate = new Date();
      
      try {
        await client.save();
        console.log(`Usage stats updated for ${clientId}: ${client.requestCount} total requests`);
      } catch (saveError) {
        console.error('Failed to save usage stats:', saveError);
      }
    } else {
      console.warn(`Usage tracking: Client not found: ${clientId}`);
    }
    
    // Always return success to prevent errors in the widget
    res.status(200).json({ 
      success: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Usage tracking error:', error);
    // Still return success to prevent errors in the widget
    res.status(200).json({ 
      success: true,
      error: 'Failed to track usage',
      timestamp: new Date().toISOString()
    });
  }
});

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Handle specific error types
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Invalid JSON in request body',
      message: 'Request body contains malformed JSON'
    });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: Object.values(err.errors).map(e => e.message)
    });
  }
  
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: 'Invalid ID format'
    });
  }
  
  res.status(500).json({ 
    error: 'Something went wrong on the server',
    message: NODE_ENV === 'development' ? err.message : 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    path: req.originalUrl,
    method: req.method,
    message: 'The requested endpoint does not exist'
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${NODE_ENV}`);
  console.log(`🔧 Admin panel: ${ADMIN_DOMAIN}`);
  console.log(`🤖 Widget endpoint available`);
  console.log(`📊 Health check: /api/health`);
  console.log(`=================================`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  setTimeout(() => {
    console.log('Forcing shutdown');
    process.exit(0);
  }, 2000);
});

// Uncaught exception handler
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Export for testing
module.exports = app;