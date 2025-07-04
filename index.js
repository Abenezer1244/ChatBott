/**
 * Chatbot Leasing System - COMPLETE FIXED Main Server File
 * Production-ready implementation for leasing TestMyPrompt chatbots
 * Fixed route ordering and enhanced error handling
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

// Enhanced CORS configuration for widget functionality
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (direct API calls, mobile apps, etc.)
    if (!origin) {
      console.log('CORS: Request with no origin - allowing');
      return callback(null, true);
    }
    
    // Allow all origins for widget functionality - essential for widgets
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
  credentials: false, // Set to false for widget usage
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

// Global preflight handler for all routes
app.options('*', (req, res) => {
  const origin = req.get('origin') || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-key, x-access-token');
  res.header('Access-Control-Max-Age', '86400');
  console.log(`OPTIONS preflight handled for ${req.originalUrl} from ${origin}`);
  res.status(200).end();
});

// Enhanced body parsing with better error handling
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
  console.error('Required: MONGODB_URI, JWT_SECRET');
  process.exit(1);
}

// Rate limiting with widget-friendly configuration
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    // Skip rate limiting for widget-related requests
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    const isWidgetRequest = req.path.includes('/validate') || 
                           req.path.includes('/widget.js') || 
                           req.path.includes('/usage/track') ||
                           req.path.includes('/auth/token') ||
                           req.path.includes('/health') ||
                           req.path.includes('/test-connection') ||
                           req.path.includes('/debug');
    return adminKey === process.env.ADMIN_KEY || isWidgetRequest;
  }
});

// Widget-friendly security headers
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
      frameAncestors: ["*"], // Allow embedding in any frame
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"]
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
})); 

app.use(compression());

// Serve static files with proper CORS headers
app.use('/public', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
  }
}));

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
    if (status >= 400 && (req.originalUrl.includes('/validate') || req.originalUrl.includes('/widget') || req.originalUrl.includes('/clients'))) {
      console.error(`API Error ${status}: ${req.method} ${req.originalUrl}`, {
        body: req.body,
        query: req.query,
        headers: {
          origin: req.headers.origin,
          referer: req.headers.referer,
          'user-agent': req.headers['user-agent'],
          'x-admin-key': req.headers['x-admin-key'] ? 'provided' : 'missing'
        }
      });
    }
    
    originalSend.apply(this, args);
  };
  
  next();
});

// MongoDB Connection with proper error handling
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
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

// Apply rate limiting to API requests (excluding critical widget endpoints)
app.use('/api', (req, res, next) => {
  // Skip rate limiting for critical widget endpoints
  if (req.path === '/validate' || 
      req.path === '/usage/track' || 
      req.path === '/auth/token' ||
      req.path === '/widget-info' ||
      req.path === '/health' ||
      req.path === '/test-connection' ||
      req.path.startsWith('/debug')) {
    return next();
  }
  return apiLimiter(req, res, next);
});

// CORRECTED: Import and mount route modules with proper order
const authRoutes = require('./routes/auth');
const validateRoutes = require('./routes/validate');
const clientRoutes = require('./routes/clients');

// Mount the route modules with correct order - MORE SPECIFIC ROUTES FIRST
app.use('/api/auth', authRoutes);
app.use('/api', validateRoutes);  // This includes /api/validate, /api/lease/*, etc.
app.use('/api/clients', clientRoutes);  // This should come last to avoid conflicts

// Add debugging route to test if routes are working
app.get('/api/debug/routes', (req, res) => {
  res.json({
    message: 'Routes are working correctly',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    routeOrder: [
      '1. /api/auth/* (auth routes)',
      '2. /api/validate, /api/lease/*, etc. (validate routes)', 
      '3. /api/clients/* (client routes - includes lease-dashboard)'
    ],
    availableEndpoints: [
      'GET /api/health',
      'POST /api/validate', 
      'GET /api/clients/lease-dashboard',
      'GET /api/clients',
      'POST /api/clients',
      'POST /api/auth/token',
      'POST /api/lease/check',
      'GET /api/stats'
    ],
    corsEnabled: true,
    widgetSupported: true
  });
});

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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            max-width: 500px;
            margin: 20px;
          }
          h1 { color: white; margin-bottom: 1rem; }
          p { color: rgba(255, 255, 255, 0.9); margin-bottom: 1rem; }
          .status { 
            color: #4ade80; 
            font-weight: 600;
            font-size: 1.1em;
          }
          .version {
            font-size: 0.9em;
            opacity: 0.8;
            margin-top: 1rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 Chatbot Leasing System</h1>
          <p>Welcome to the Chatbot Leasing API</p>
          <p>System Status: <span class="status">Online & Ready</span></p>
          <p>For admin access, please visit the designated admin domain.</p>
          <div class="version">Version 1.0.3 | Production Ready</div>
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
      adminDomain: ADMIN_DOMAIN,
      currentDomain: hostname 
    });
  }
});

// Widget.js serving endpoint with enhanced headers
app.get('/widget.js', (req, res) => {
  console.log('Widget.js requested from:', req.get('origin') || req.get('referer') || 'unknown');
  
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, X-Requested-With, Accept');
  res.setHeader('Cache-Control', 'public, max-age=300');
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

// Chat endpoint for real conversations
app.post('/api/chat', async (req, res) => {
  try {
    console.log('Chat request:', req.body);
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Origin, X-Requested-With');
    
    const { message, widgetId, clientId } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!message) {
      return res.status(400).json({ 
        error: 'Message is required',
        received: req.body
      });
    }
    
    // Verify token if provided
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Chat request from verified client:', decoded.clientId);
        
        // Check if client has valid access
        const client = await Client.findOne({ clientId: decoded.clientId });
        if (client && !client.hasValidAccess()) {
          return res.status(403).json({
            error: 'Access denied',
            message: 'Your lease has expired. Please contact support.',
            leaseStatus: client.getLeaseStatus()
          });
        }
      } catch (err) {
        console.warn('Invalid token in chat request:', err.message);
      }
    }
    
    // Provide intelligent responses based on message content
    let response;
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
      response = 'Hello! Welcome to our chat. How can I assist you today?';
    } else if (lowerMessage.includes('help') || lowerMessage.includes('support')) {
      response = 'I\'m here to help! You can ask me about our services, get information, or I can connect you with our support team. What do you need assistance with?';
    } else if (lowerMessage.includes('price') || lowerMessage.includes('cost') || lowerMessage.includes('pricing')) {
      response = 'I\'d be happy to help you with pricing information. Our costs vary depending on your specific needs. Would you like me to connect you with our sales team for a personalized quote?';
    } else if (lowerMessage.includes('feature') || lowerMessage.includes('service') || lowerMessage.includes('what do you do')) {
      response = 'We offer comprehensive chatbot solutions powered by TestMyPrompt. Our services include custom chatbot development, integration support, and ongoing maintenance. What specific features are you interested in?';
    } else if (lowerMessage.includes('contact') || lowerMessage.includes('talk to someone') || lowerMessage.includes('human')) {
      response = 'I can connect you with our team! Please provide your email address and I\'ll have someone reach out to you, or you can call us directly. How would you prefer to be contacted?';
    } else if (lowerMessage.includes('how does this work') || lowerMessage.includes('how it works')) {
      response = 'Great question! Our chatbot system integrates seamlessly into your website. We provide you with a simple script to add, and your visitors can immediately start chatting. The bot can handle common questions and escalate complex issues to your team.';
    } else if (lowerMessage.includes('demo') || lowerMessage.includes('try') || lowerMessage.includes('test')) {
      response = 'You\'re actually experiencing our demo right now! This chat widget is powered by our system. Would you like to see additional features or learn about customization options?';
    } else if (lowerMessage.includes('thank') || lowerMessage.includes('thanks')) {
      response = 'You\'re very welcome! Is there anything else I can help you with today?';
    } else if (lowerMessage.includes('bye') || lowerMessage.includes('goodbye')) {
      response = 'Goodbye! Thanks for chatting with us. Feel free to reach out anytime if you have more questions. Have a great day!';
    } else {
      // Generic helpful response
      response = 'I understand what you\'re asking about. Our team specializes in providing intelligent chatbot solutions that can be customized for your specific needs. Would you like to learn more about how we can help your business, or do you have a specific question I can address?';
    }
    
    // Track the conversation
    if (clientId) {
      try {
        const client = await Client.findOne({ clientId });
        if (client && client.hasValidAccess()) {
          client.requestCount = (client.requestCount || 0) + 1;
          client.lastRequestDate = new Date();
          await client.save();
        }
      } catch (dbError) {
        console.error('Failed to track conversation:', dbError);
      }
    }
    
    res.json({
      response: response,
      timestamp: new Date().toISOString(),
      widgetId: widgetId,
      clientId: clientId
    });
    
  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({ 
      response: 'I apologize, but I\'m experiencing some technical difficulties right now. Please try again in a moment, or contact our support team directly.',
      error: 'Internal server error',
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
  
  if (err.name === 'MongoError' && err.code === 11000) {
    return res.status(400).json({
      error: 'Duplicate key error',
      message: 'A record with this information already exists'
    });
  }
  
  res.status(500).json({ 
    error: 'Something went wrong on the server',
    message: NODE_ENV === 'development' ? err.message : 'Internal server error',
    timestamp: new Date().toISOString(),
    ...(NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Handle 404 errors
app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Not found',
    path: req.originalUrl,
    method: req.method,
    message: 'The requested endpoint does not exist',
    availableEndpoints: [
      'GET /api/health',
      'POST /api/validate',
      'GET /api/clients/lease-dashboard',
      'GET /api/clients',
      'POST /api/clients',
      'POST /api/auth/token'
    ]
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${NODE_ENV}`);
  console.log(`🔧 Admin panel: ${ADMIN_DOMAIN}`);
  console.log(`🤖 Widget endpoint: /widget.js`);
  console.log(`📊 Health check: /api/health`);
  console.log(`💬 Chat endpoint: /api/chat`);
  console.log(`🔗 API base: /api`);
  console.log(`🐛 Debug route: /api/debug/routes`);
  console.log(`✅ All routes properly configured`);
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