/**
 * Chatbot Leasing System - Main Server File
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
const ADMIN_KEY = process.env.ADMIN_KEY;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Validate required environment variables
if (!MONGODB_URI || !JWT_SECRET || !ADMIN_KEY) {
  console.error('Missing required environment variables. Check your .env file.');
  process.exit(1);
}

// Set up rate limiting
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes default
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Configure CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? 
    process.env.ALLOWED_ORIGINS.split(',') : 
    '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token']
};

// Middleware
app.use(helmet()); // Security headers
app.use(cors(corsOptions));
app.use(compression()); // Compress responses
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Apply rate limiting to all API requests
app.use('/api', apiLimiter);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});



// MongoDB Connection with proper error handling and your timeout settings
mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,   // Timeout after 5s instead of 30s
    connectTimeoutMS: 10000,          // Give up initial connection after 10 seconds
    socketTimeoutMS: 45000            // Close sockets after 45 seconds of inactivity
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
      await mongoose.connection.close(false); // Pass false to avoid using callbacks
      console.log('MongoDB connection closed');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });

// Set up mongoose to handle promise rejections properly
mongoose.Promise = global.Promise;
mongoose.connection.on('error', (err) => {
  console.error(`MongoDB connection error: ${err}`);
  process.exit(1);
});

// Define Client Schema directly in index.js to keep it self-contained
const clientSchema = new mongoose.Schema({
  clientId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  email: { 
    type: String, 
    required: true,
    lowercase: true,
    trim: true,
    match: [/\S+@\S+\.\S+/, 'Please enter a valid email address']
  },
  active: { 
    type: Boolean, 
    default: true 
  },
  allowedDomains: { 
    type: [String], 
    default: [] 
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    immutable: true 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  chatbotConfig: {
    widgetId: { 
      type: String, 
      required: true 
    },
    customization: {
      primaryColor: { 
        type: String, 
        default: '#0084ff',
        match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please enter a valid hex color']
      },
      secondaryColor: { 
        type: String, 
        default: '#ffffff',
        match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please enter a valid hex color']
      },
      headerText: { 
        type: String, 
        default: 'Chat with us',
        trim: true,
        maxlength: 50
      },
      botName: { 
        type: String, 
        default: 'Assistant',
        trim: true,
        maxlength: 30 
      },
      logoUrl: { 
        type: String, 
        default: '',
        trim: true
      }
    }
  },
  requestCount: { 
    type: Number, 
    default: 0,
    min: 0
  },
  lastRequestDate: { 
    type: Date 
  }
}, {
  timestamps: true,
  indexes: [
    { clientId: 1 },
    { email: 1 },
    { active: 1 }
  ]
});

// Pre-save middleware to update updatedAt
clientSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to check if a domain is allowed
clientSchema.methods.isDomainAllowed = function(domain) {
  if (!this.allowedDomains || this.allowedDomains.length === 0) {
    return true; // All domains allowed
  }
  
  return this.allowedDomains.some(allowedDomain => 
    domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
  );
};

const Client = mongoose.model('Client', clientSchema);

// Middleware to verify admin authentication
const verifyAdmin = (req, res, next) => {
  const adminKey = req.body.adminKey || req.query.adminKey;
  
  if (!adminKey) {
    return res.status(401).json({ error: 'Admin key is required' });
  }

  if (adminKey !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.body.token || req.query.token || req.headers['x-access-token'];
  
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.clientData = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token has expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/api/clients', async (req, res) => {
    console.log('Authentication attempt');
    console.log('ENV ADMIN_KEY:', process.env.ADMIN_KEY);
    console.log('Received admin key:', req.body.adminKey);
    
    
  });

// Define all routes in index.js for simplicity

// TOKEN VALIDATION ROUTE
app.post('/api/validate', async (req, res) => {
  try {
    const { token, domain } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify token
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token has expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Get client from database
    const client = await Client.findOne({ clientId: decodedToken.clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    if (!client.active) {
      return res.status(403).json({ error: 'Client account is inactive' });
    }
    
    // Check domain if restrictions are in place
    if (client.allowedDomains && client.allowedDomains.length > 0) {
      if (!domain) {
        return res.status(400).json({ error: 'Domain information is required' });
      }
      
      const isAllowed = client.isDomainAllowed(domain);
      
      if (!isAllowed) {
        console.warn(`Domain not authorized: ${domain} for client: ${client.clientId}`);
        return res.status(403).json({ error: 'Domain not authorized' });
      }
    }
    
    // Update request count and last request date
    client.requestCount += 1;
    client.lastRequestDate = new Date();
    await client.save();
    
    // Return chatbot configuration
    res.json({
      valid: true,
      config: {
        widgetId: client.chatbotConfig.widgetId,
        customization: client.chatbotConfig.customization
      }
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AUTHENTICATION ROUTES

// Generate a new token for a client
app.post('/api/auth/token', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.body;
    
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID is required' });
    }
    
    // Find the client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    if (!client.active) {
      return res.status(403).json({ error: 'Client account is inactive' });
    }
    
    // Generate token with appropriate claims
    const token = jwt.sign({
      clientId: client.clientId,
      active: client.active,
      allowedDomains: client.allowedDomains,
      tokenType: 'jwt',
      iat: Math.floor(Date.now() / 1000)
    }, JWT_SECRET, { 
      expiresIn: process.env.TOKEN_EXPIRY || '1h'
    });
    
    // Log token creation
    console.log(`Token generated for client: ${clientId}`);
    
    res.json({ 
      token,
      expiresIn: process.env.TOKEN_EXPIRY || '1h'
    });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify a token's validity without increasing usage count
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify token
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Return minimal information
      return res.json({ 
        valid: true,
        clientId: decoded.clientId,
        expiresAt: new Date(decoded.exp * 1000)
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ valid: false, error: 'Token has expired' });
      }
      return res.status(401).json({ valid: false, error: 'Invalid token' });
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CLIENT MANAGEMENT ROUTES

// Get all clients
app.get('/api/clients', verifyAdmin, async (req, res) => {
  try {
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Sorting parameters
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };
    
    // Filtering
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
    
    // Execute query with pagination
    const clients = await Client.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-__v'); // Exclude version field
    
    // Get total count for pagination
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
app.post('/api/clients', verifyAdmin, async (req, res) => {
  try {
    const { name, email, allowedDomains, widgetId } = req.body;
    
    // Validate required fields
    if (!name || !email || !widgetId) {
      return res.status(400).json({ error: 'Name, email, and widgetId are required' });
    }
    
    // Check if email already exists
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({ error: 'A client with this email already exists' });
    }
    
    // Generate a unique client ID
    const clientId = `client-${uuidv4().slice(0, 8)}`;
    
    // Create new client
    const newClient = new Client({
      clientId,
      name,
      email,
      allowedDomains: allowedDomains || [],
      chatbotConfig: {
        widgetId
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
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single client by ID
app.get('/api/clients/:clientId', verifyAdmin, async (req, res) => {
  try {
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
app.put('/api/clients/:clientId', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { name, email, customization, active, allowedDomains, widgetId } = req.body;
    
    // Find client
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
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a client
app.delete('/api/clients/:clientId', verifyAdmin, async (req, res) => {
  try {
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
app.get('/api/clients/:clientId/stats', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    // Get last 30 days stats
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  res.json({ 
    status: 'ok',
    environment: NODE_ENV,
    timestamp: new Date(),
    uptime: process.uptime(),
    mongodb: mongoStatus
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong on the server',
    message: NODE_ENV === 'development' ? err.message : undefined
  });
});

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${NODE_ENV} mode`);
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
// Export for testing
module.exports = app;
