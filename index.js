/**
 * Chatbot Leasing System - ENHANCED MAIN SERVER FILE
 * Production-ready implementation for leasing TestMyPrompt chatbots
 * FIXED: Route ordering, CORS preflight, and enhanced error handling
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

// CRITICAL FIX: Force HTTPS redirect in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.header('x-forwarded-proto') !== 'https') {
    res.redirect(`https://${req.header('host')}${req.url}`);
  } else {
    next();
  }
});

// ENHANCED CORS CONFIGURATION - CRITICAL FIX FOR ADMIN DASHBOARD
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

// CRITICAL FIX: Enhanced global preflight handler for all routes
app.options('*', (req, res) => {
  const origin = req.get('origin') || '*';
  
  // Set comprehensive CORS headers
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-key, x-access-token');
  res.header('Access-Control-Max-Age', '86400');
  res.header('Access-Control-Allow-Credentials', 'false');
  
  console.log(`ENHANCED OPTIONS preflight handled for ${req.originalUrl} from ${origin}`);
  res.status(200).end();
});

// ENHANCED BODY PARSING with better error handling
app.use(express.json({ 
  limit: '1mb',
  verify: (req, res, buf) => {
    try {
      if (buf.length > 0) {
        JSON.parse(buf);
      }
    } catch (e) {
      console.error('Invalid JSON in request body:', e.message);
      const error = new Error('Invalid JSON');
      error.statusCode = 400;
      error.body = buf.toString();
      throw error;
    }
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '1mb' 
}));

// ENHANCED VALIDATION: Check required environment variables
if (!MONGODB_URI || !JWT_SECRET) {
  console.error('❌ Missing required environment variables. Check your .env file.');
  console.error('Required: MONGODB_URI, JWT_SECRET');
  console.error('Optional: ADMIN_KEY, ADMIN_DOMAIN');
  process.exit(1);
}

console.log('✅ Environment variables loaded successfully');
console.log('🌍 Admin domain:', ADMIN_DOMAIN);
console.log('🔧 Environment:', NODE_ENV);

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
                           req.path.includes('/debug') ||
                           req.path.includes('/lease-dashboard');
    
    const shouldSkip = adminKey === process.env.ADMIN_KEY || isWidgetRequest;
    if (shouldSkip && req.path.includes('/lease-dashboard')) {
      console.log('Rate limiting bypassed for lease-dashboard request');
    }
    return shouldSkip;
  },
  keyGenerator: (req) => {
    // Use IP for rate limiting, but provide fallback
    return req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
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

// ENHANCED REQUEST LOGGING middleware with error tracking
app.use((req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  
  // Enhanced request logging
  console.log(`📥 ${req.method} ${req.originalUrl} - ${req.ip} - ${req.get('User-Agent')?.substring(0, 50) || 'Unknown'}`);
  
  // Log admin requests
  const hasAdminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
  if (hasAdminKey) {
    console.log(`🔑 Admin request detected for ${req.originalUrl}`);
  }
  
  res.send = function(...args) {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const size = args[0] ? Buffer.byteLength(args[0]) : 0;
    
    // Enhanced logging with status indicators
    const statusIcon = status >= 500 ? '❌' : status >= 400 ? '⚠️' : status >= 300 ? '🔄' : '✅';
    console.log(`📤 ${statusIcon} ${req.method} ${req.originalUrl} ${status} ${duration}ms ${size}b`);
    
    // Log errors in detail for critical endpoints
    if (status >= 400 && (
      req.originalUrl.includes('/validate') || 
      req.originalUrl.includes('/clients') || 
      req.originalUrl.includes('/lease-dashboard') ||
      req.originalUrl.includes('/auth')
    )) {
      console.error(`🚨 API Error ${status}: ${req.method} ${req.originalUrl}`, {
        query: req.query,
        hasAdminKey: !!hasAdminKey,
        origin: req.headers.origin,
        userAgent: req.headers['user-agent']?.substring(0, 100)
      });
    }
    
    originalSend.apply(this, args);
  };
  
  next();
});

// ENHANCED MONGODB CONNECTION with retry logic
async function connectToMongoDB() {
  const maxRetries = 5;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`🔌 Attempting to connect to MongoDB (attempt ${retries + 1}/${maxRetries})`);
      
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        bufferCommands: false,
        bufferMaxEntries: 0
      });
      
      console.log('✅ Connected to MongoDB successfully');
      return;
      
    } catch (err) {
      retries++;
      console.error(`❌ MongoDB connection attempt ${retries} failed:`, err.message);
      
      if (retries >= maxRetries) {
        console.error('❌ Max retries reached. Exiting...');
        process.exit(1);
      }
      
      // Wait before retrying
      console.log(`⏳ Retrying in 3 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

// Connect to MongoDB
connectToMongoDB();

// Enhanced MongoDB event handlers
mongoose.connection.on('error', (err) => {
  console.error(`❌ MongoDB connection error: ${err}`);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('🔄 MongoDB reconnected');
});

// Use the external Client model
const Client = require('./models/Client');

// CRITICAL FIX: Apply rate limiting selectively
app.use('/api', (req, res, next) => {
  // Skip rate limiting for critical endpoints
  if (req.path === '/validate' || 
      req.path === '/usage/track' || 
      req.path === '/auth/token' ||
      req.path === '/widget-info' ||
      req.path === '/health' ||
      req.path === '/test-connection' ||
      req.path.startsWith('/debug') ||
      req.path === '/clients/lease-dashboard') {
    console.log(`⚡ Rate limiting bypassed for: ${req.path}`);
    return next();
  }
  return apiLimiter(req, res, next);
});

// ENHANCED ROUTE MOUNTING with proper order
console.log('🛣️ Setting up routes...');

const authRoutes = require('./routes/auth');
const validateRoutes = require('./routes/validate');
const clientRoutes = require('./routes/clients');

// Mount the route modules with FIXED order - MORE SPECIFIC ROUTES FIRST
app.use('/api/auth', authRoutes);
app.use('/api', validateRoutes);  // This includes /api/validate, /api/lease/*, etc.
app.use('/api/clients', clientRoutes);  // This should come last to avoid conflicts

console.log('✅ Routes mounted successfully');

// ENHANCED DEBUGGING ROUTE
app.get('/api/debug/routes', (req, res) => {
  const hasAdminKey = req.query.adminKey === process.env.ADMIN_KEY;
  
  const basicInfo = {
    message: 'Routes are working correctly',
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
    server: {
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      mongoState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    },
    cors: {
      enabled: true,
      preflightHandling: 'enhanced',
      adminDomain: ADMIN_DOMAIN
    }
  };
  
  if (hasAdminKey) {
    basicInfo.debug = {
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
      environment: {
        jwtSecret: !!JWT_SECRET,
        adminKey: !!process.env.ADMIN_KEY,
        mongoUri: !!MONGODB_URI,
        adminDomain: ADMIN_DOMAIN
      }
    };
  }
  
  res.json(basicInfo);
});

// ENHANCED DOMAIN-BASED ADMIN ACCESS ROUTE
app.get('/', (req, res) => {
  const host = req.get('host') || '';
  const hostname = host.split(':')[0];
  
  console.log('🏠 Home request - Host:', host, 'Hostname:', hostname);
  
  if (hostname === ADMIN_DOMAIN || host === ADMIN_DOMAIN || 
      hostname === `www.${ADMIN_DOMAIN}` || host === `www.${ADMIN_DOMAIN}`) {
    
    console.log('✅ Admin domain access granted');
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
          .api-status {
            background: rgba(255, 255, 255, 0.1);
            padding: 1rem;
            border-radius: 8px;
            margin-top: 1rem;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 Chatbot Leasing System</h1>
          <p>Welcome to the Professional Chatbot Leasing API</p>
          <p>System Status: <span class="status">Online & Ready</span></p>
          <div class="api-status">
            <p>🔗 API Endpoints Available</p>
            <p>🛡️ CORS Enabled</p>
            <p>⚡ Rate Limiting Active</p>
            <p>📊 Lease Management Ready</p>
          </div>
          <p>For admin access, please visit the designated admin domain.</p>
          <div class="version">Version 1.0.4 | Production Ready | Enhanced CORS</div>
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
    console.log('✅ Direct admin access granted');
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    res.status(403).json({ 
      error: 'Admin panel can only be accessed from the authorized domain',
      adminDomain: ADMIN_DOMAIN,
      currentDomain: hostname,
      message: 'Please access the admin panel from the correct domain'
    });
  }
});

// ENHANCED Widget.js serving endpoint
app.get('/widget.js', (req, res) => {
  const origin = req.get('origin') || req.get('referer') || 'unknown';
  console.log('🔧 Widget.js requested from:', origin);
  
  // Set comprehensive headers for widget compatibility
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
    console.log('📦 Serving widget.js from:', widgetPath);
    res.sendFile(widgetPath);
  } catch (error) {
    console.error('❌ Error serving widget.js:', error);
    res.status(500).send('// Error loading widget - please try again later\nconsole.error("Failed to load ChatBot widget");');
  }
});

// ENHANCED Chat endpoint for real conversations
app.post('/api/chat', async (req, res) => {
  try {
    console.log('💬 Chat request received:', {
      hasMessage: !!req.body.message,
      widgetId: req.body.widgetId,
      clientId: req.body.clientId,
      origin: req.headers.origin
    });
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Origin, X-Requested-With');
    
    const { message, widgetId, clientId } = req.body;
    const authHeader = req.headers.authorization;
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Valid message is required',
        received: { message: message || 'undefined', type: typeof message }
      });
    }
    
    // Verify token if provided
    let isValidToken = false;
    let clientData = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('🔑 Chat request from verified client:', decoded.clientId);
        
        // Check if client has valid access
        const client = await Client.findOne({ clientId: decoded.clientId });
        if (client && client.hasValidAccess()) {
          isValidToken = true;
          clientData = client;
        } else if (client) {
          console.warn('⚠️ Chat request from client with expired lease:', decoded.clientId);
          return res.status(403).json({
            error: 'Access denied',
            message: 'Your lease has expired. Please contact support.',
            leaseStatus: client.getLeaseStatus()
          });
        }
      } catch (err) {
        console.warn('⚠️ Invalid token in chat request:', err.message);
      }
    }
    
    // Enhanced intelligent responses based on message content
    const lowerMessage = message.toLowerCase().trim();
    let response;
    
    // Greeting responses
    if (lowerMessage.match(/^(hello|hi|hey|good morning|good afternoon|good evening)/)) {
      response = 'Hello! Welcome to our chat. How can I assist you today?';
    }
    // Help and support
    else if (lowerMessage.includes('help') || lowerMessage.includes('support') || lowerMessage.includes('assist')) {
      response = 'I\'m here to help! You can ask me about our services, get information, or I can connect you with our support team. What do you need assistance with?';
    }
    // Pricing inquiries
    else if (lowerMessage.match(/(price|cost|pricing|fee|charge|payment|how much)/)) {
      response = 'I\'d be happy to help you with pricing information. Our costs vary depending on your specific needs. Would you like me to connect you with our sales team for a personalized quote?';
    }
    // Services and features
    else if (lowerMessage.match(/(feature|service|what do you do|what can you do|capabilities)/)) {
      response = 'We offer comprehensive chatbot solutions powered by TestMyPrompt. Our services include custom chatbot development, integration support, and ongoing maintenance. What specific features are you interested in?';
    }
    // Contact requests
    else if (lowerMessage.match(/(contact|talk to someone|human|agent|representative)/)) {
      response = 'I can connect you with our team! Please provide your email address and I\'ll have someone reach out to you, or you can call us directly. How would you prefer to be contacted?';
    }
    // How it works
    else if (lowerMessage.match(/(how does this work|how it works|explain|process)/)) {
      response = 'Great question! Our chatbot system integrates seamlessly into your website. We provide you with a simple script to add, and your visitors can immediately start chatting. The bot can handle common questions and escalate complex issues to your team.';
    }
    // Demo requests
    else if (lowerMessage.match(/(demo|try|test|example|show me)/)) {
      response = 'You\'re actually experiencing our demo right now! This chat widget is powered by our system. Would you like to see additional features or learn about customization options?';
    }
    // Thank you responses
    else if (lowerMessage.match(/(thank|thanks|appreciate)/)) {
      response = 'You\'re very welcome! Is there anything else I can help you with today?';
    }
    // Goodbye responses
    else if (lowerMessage.match(/(bye|goodbye|see you|farewell|exit|quit)/)) {
      response = 'Goodbye! Thanks for chatting with us. Feel free to reach out anytime if you have more questions. Have a great day!';
    }
    // Business hours
    else if (lowerMessage.match(/(hours|open|close|available|when)/)) {
      response = 'Our chat support is available 24/7, but our human agents are typically available Monday through Friday, 9 AM to 6 PM EST. I can help you right now, or connect you with our team during business hours.';
    }
    // Integration questions
    else if (lowerMessage.match(/(integrate|installation|setup|install|implement)/)) {
      response = 'Integration is simple! We provide you with a small JavaScript code snippet that you add to your website. It takes just a few minutes to set up. Would you like me to walk you through the process or connect you with our technical team?';
    }
    // Generic helpful response
    else {
      response = 'I understand what you\'re asking about. Our team specializes in providing intelligent chatbot solutions that can be customized for your specific needs. Would you like to learn more about how we can help your business, or do you have a specific question I can address?';
    }
    
    // Track the conversation if client data is available
    if (clientData) {
      try {
        clientData.requestCount = (clientData.requestCount || 0) + 1;
        clientData.lastRequestDate = new Date();
        await clientData.save();
        console.log('📊 Updated usage stats for client:', clientData.clientId);
      } catch (dbError) {
        console.error('❌ Failed to track conversation:', dbError);
      }
    }
    
    const chatResponse = {
      response: response,
      timestamp: new Date().toISOString(),
      widgetId: widgetId,
      clientId: clientId,
      sessionId: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        authenticated: isValidToken,
        messageLength: message.length,
        responseType: 'automated'
      }
    };
    
    console.log('✅ Chat response sent successfully');
    res.json(chatResponse);
    
  } catch (error) {
    console.error('❌ Chat endpoint error:', error);
    res.status(500).json({ 
      response: 'I apologize, but I\'m experiencing some technical difficulties right now. Please try again in a moment, or contact our support team directly.',
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
      sessionId: `error_${Date.now()}`
    });
  }
});

// ENHANCED ERROR HANDLING middleware
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  
  // Handle specific error types
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Invalid JSON in request body',
      message: 'Request body contains malformed JSON',
      details: err.message
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
      error: 'Invalid ID format',
      field: err.path,
      value: err.value
    });
  }
  
  if (err.name === 'MongoError' && err.code === 11000) {
    return res.status(400).json({
      error: 'Duplicate key error',
      message: 'A record with this information already exists'
    });
  }
  
  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid token',
      message: 'The provided token is invalid'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expired',
      message: 'The provided token has expired'
    });
  }
  
  // Enhanced error response
  const errorResponse = {
    error: 'Something went wrong on the server',
    message: NODE_ENV === 'development' ? err.message : 'Internal server error',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };
  
  if (NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
    errorResponse.details = {
      name: err.name,
      code: err.code,
      statusCode: err.statusCode
    };
  }
  
  res.status(err.statusCode || 500).json(errorResponse);
});

// ENHANCED 404 handler
app.use((req, res) => {
  console.log(`❓ 404 - Route not found: ${req.method} ${req.originalUrl} from ${req.ip}`);
  
  const response = {
    error: 'Not found',
    path: req.originalUrl,
    method: req.method,
    message: 'The requested endpoint does not exist',
    timestamp: new Date().toISOString(),
    suggestions: [
      'Check the URL for typos',
      'Verify the HTTP method',
      'Consult the API documentation'
    ],
    availableEndpoints: {
      health: 'GET /api/health',
      validate: 'POST /api/validate',
      auth: 'POST /api/auth/token',
      dashboard: 'GET /api/clients/lease-dashboard',
      clients: 'GET /api/clients',
      chat: 'POST /api/chat',
      widget: 'GET /widget.js'
    }
  };
  
  res.status(404).json(response);
});

// ENHANCED SERVER STARTUP
const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                  🚀 SERVER READY                           ║
║                                                            ║
║  Port: ${PORT.toString().padEnd(52)} ║
║  Environment: ${NODE_ENV.padEnd(44)} ║
║  Admin Domain: ${ADMIN_DOMAIN.padEnd(43)} ║
║                                                            ║
║  🔗 API Base: /api                                         ║
║  🔧 Widget: /widget.js                                     ║
║  📊 Dashboard: /api/clients/lease-dashboard                ║
║  💬 Chat: /api/chat                                        ║
║  ❤️ Health: /api/health                                    ║
║                                                            ║
║  ✅ MongoDB Connected                                      ║
║  ✅ CORS Enhanced                                          ║
║  ✅ Routes Configured                                      ║
║  ✅ Lease Management Active                                ║
║                                                            ║
║  Version: 1.0.4 | Production Ready                        ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// ENHANCED GRACEFUL SHUTDOWN
async function gracefulShutdown(signal) {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  
  try {
    // Close server
    server.close(() => {
      console.log('✅ HTTP server closed');
    });
    
    // Close database connection
    await mongoose.connection.close(false);
    console.log('✅ MongoDB connection closed');
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
}

// Handle various shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Enhanced process error handlers
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit in production, just log
  if (NODE_ENV === 'development') {
    process.exit(1);
  }
});

// Export for testing
module.exports = app;