/**
 * Chatbot Leasing System - Main Server File (Fixed)
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

// Enhanced CORS configuration with more permissive settings for widget loading
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all origins for widget functionality
    console.log('CORS: Request from origin:', origin);
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token', 'x-admin-key', 'Origin', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Preflight handler for all routes
app.options('*', cors(corsOptions));

// Enhanced body parsing with better error handling
app.use(express.json({ 
  limit: '1mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
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

// Set trust proxy
app.set('trust proxy', 1);

// Validate required environment variables
if (!MONGODB_URI || !JWT_SECRET) {
  console.error('Missing required environment variables. Check your .env file.');
  process.exit(1);
}

// Set up rate limiting with admin bypass
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes default
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200, // Increased for widget functionality
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    // Skip rate limiting for admin requests and widget validation
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    const isWidgetRequest = req.path.includes('/validate') || req.path.includes('/widget.js');
    return adminKey === process.env.ADMIN_KEY || isWidgetRequest;
  }
});

// Enhanced security headers for widget compatibility
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https:", "https://testmyprompt.com", "*.testmyprompt.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "http://localhost:*", "https://testmyprompt.com", "*.testmyprompt.com", "https://*.onrender.com"],
      fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "https://testmyprompt.com", "*.testmyprompt.com"],
      frameAncestors: ["*"], // Allow embedding in any frame
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false // Disable for iframe compatibility
})); 

app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

// Apply rate limiting to API requests (excluding widget endpoints)
app.use('/api', (req, res, next) => {
  // Skip rate limiting for critical widget endpoints
  if (req.path === '/validate' || req.path === '/usage/track') {
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
    
    // Log errors in detail
    if (status >= 400) {
      console.error(`Error ${status}: ${req.method} ${req.originalUrl}`, {
        body: req.body,
        query: req.query,
        headers: req.headers
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

// ENHANCED TOKEN VALIDATION ROUTE - This is the critical fix
app.post('/api/validate', async (req, res) => {
  try {
    console.log('=== TOKEN VALIDATION REQUEST ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('Method:', req.method);
    console.log('URL:', req.originalUrl);
    console.log('IP:', req.ip);
    
    // Enhanced request validation
    if (!req.body) {
      console.error('Request body is missing');
      return res.status(400).json({ 
        error: 'Request body is missing',
        received: 'No body data',
        contentType: req.get('content-type')
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
        }
      });
    }
    
    console.log(`Validating token for domain: ${domain || 'no domain provided'}`);
    
    // Verify token with enhanced error handling
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token decoded successfully:', { 
        clientId: decodedToken.clientId,
        iat: decodedToken.iat,
        exp: decodedToken.exp
      });
    } catch (err) {
      console.error('Token verification failed:', err.message, err.name);
      
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          expiredAt: err.expiredAt,
          message: 'The token has expired, please refresh'
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
    
    // Get client from database with enhanced error handling
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
    
    // Enhanced domain validation
    if (client.allowedDomains && client.allowedDomains.length > 0) {
      if (!domain) {
        console.warn('Domain information is required but not provided');
        return res.status(400).json({ 
          error: 'Domain information is required',
          allowedDomains: client.allowedDomains,
          message: 'This client has domain restrictions enabled'
        });
      }
      
      const isAllowed = client.isDomainAllowed(domain);
      
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
    
    // Prepare response with enhanced configuration
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
        requestCount: client.requestCount
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
        received: req.body
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
      expiresIn: process.env.TOKEN_EXPIRY || '1h',
      issuer: 'chatbot-leasing-system',
      audience: client.clientId
    };
    
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, tokenOptions);
    
    console.log(`Token generated successfully for client: ${clientId}`);
    
    const response = {
      token,
      expiresIn: process.env.TOKEN_EXPIRY || '1h',
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

// Verify a token's validity
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        error: 'Token is required',
        message: 'Please provide a token to verify'
      });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const client = await Client.findOne({ clientId: decoded.clientId });
      
      const response = {
        valid: true,
        clientId: decoded.clientId,
        expiresAt: new Date(decoded.exp * 1000),
        issuedAt: new Date(decoded.iat * 1000),
        client: {
          exists: !!client,
          active: client ? client.active : false,
          name: client ? client.name : null
        }
      };
      
      return res.json(response);
      
    } catch (err) {
      console.warn('Token verification failed:', err.message);
      
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          valid: false, 
          error: 'Token has expired',
          expiredAt: err.expiredAt,
          message: 'The token has expired and needs to be refreshed'
        });
      } else if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          valid: false, 
          error: 'Invalid token format',
          message: 'The token format is invalid or corrupted'
        });
      } else if (err.name === 'NotBeforeError') {
        return res.status(401).json({ 
          valid: false, 
          error: 'Token not active yet',
          date: err.date,
          message: 'The token is not active yet'
        });
      }
      
      return res.status(401).json({ 
        valid: false, 
        error: 'Invalid token',
        type: err.name,
        message: 'The token could not be verified'
      });
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to verify token'
    });
  }
});

// ENHANCED CLIENT MANAGEMENT ROUTES

// Get all clients
app.get('/api/clients', async (req, res) => {
  try {
    // Verify admin access
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Admin access required' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };
    
    const filter = {};
    if (req.query.active === 'true') filter.active = true;
    if (req.query.active === 'false') filter.active = false;
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { clientId: searchRegex }
      ];
    }
    
    const clients = await Client.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-__v');
    
    const total = await Client.countDocuments(filter);
    
    res.json({
      clients,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new client
app.post('/api/clients', async (req, res) => {
  try {
    // Verify admin access
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Admin access required' });
    }

    const { name, email, allowedDomains, widgetId } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    
    // Check if email already exists
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({ error: 'A client with this email already exists' });
    }
    
    // Generate a unique client ID
    const clientId = `client-${uuidv4().slice(0, 8)}`;
    
    // Use provided widget ID or default
    const finalWidgetId = widgetId || "6809b3a1523186af0b2c9933";
    
    const newClient = new Client({
      clientId,
      name,
      email,
      allowedDomains: allowedDomains || [],
      chatbotConfig: {
        widgetId: finalWidgetId
      }
    });
    
    await newClient.save();
    
    res.status(201).json({ 
      message: 'Client created successfully',
      clientId,
      client: {
        id: newClient._id,
        clientId,
        name,
        email,
        active: newClient.active,
        createdAt: newClient.createdAt
      }
    });
  } catch (error) {
    console.error('Client creation error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single client by ID
app.get('/api/clients/:clientId', async (req, res) => {
  try {
    // Verify admin access
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Admin access required' });
    }

    const { clientId } = req.params;
    
    const client = await Client.findOne({ clientId }).select('-__v');
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({ client });
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a client
app.put('/api/clients/:clientId', async (req, res) => {
  try {
    // Verify admin access
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Admin access required' });
    }

    const { clientId } = req.params;
    const { name, email, customization, active, allowedDomains, widgetId } = req.body;
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    // Update basic fields if provided
    if (name) client.name = name;
    if (email) client.email = email;
    if (typeof active === 'boolean') client.active = active;
    if (allowedDomains) client.allowedDomains = allowedDomains;
    if (widgetId) client.chatbotConfig.widgetId = widgetId;
    
    // Update customization if provided
    if (customization) {
      client.chatbotConfig.customization = {
        ...client.chatbotConfig.customization,
        ...customization
      };
    }
    
    client.updatedAt = new Date();
    await client.save();
    
    res.json({ 
      message: 'Client updated successfully',
      client: {
        clientId,
        name: client.name,
        email: client.email,
        active: client.active,
        updatedAt: client.updatedAt
      }
    });
  } catch (error) {
    console.error('Client update error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a client
app.delete('/api/clients/:clientId', async (req, res) => {
  try {
    // Verify admin access
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Admin access required' });
    }

    const { clientId } = req.params;
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    await Client.deleteOne({ clientId });
    
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Client deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get client usage statistics
app.get('/api/clients/:clientId/stats', async (req, res) => {
  try {
    // Verify admin access
    const adminKey = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Admin access required' });
    }

    const { clientId } = req.params;
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({
      clientId,
      name: client.name,
      email: client.email,
      stats: {
        totalRequests: client.requestCount,
        lastRequestDate: client.lastRequestDate,
        active: client.active,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt
      }
    });
  } catch (error) {
    console.error('Stats retrieval error:', error);
    res.status(500).json({ error: 'Internal server error' });
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

// Widget.js serving endpoint with proper headers
app.get('/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, X-Requested-With, Accept');
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes cache
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  try {
    res.sendFile(path.join(__dirname, 'public', 'widget.js'));
  } catch (error) {
    console.error('Error serving widget.js:', error);
    res.status(500).send('// Error loading widget');
  }
});

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
    version: '1.0.1'
  });
});

// Test endpoint for debugging
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    headers: req.headers,
    origin: req.get('origin'),
    host: req.get('host'),
    ip: req.ip,
    method: req.method
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