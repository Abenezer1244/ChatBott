// Server Implementation for ChatBot Widget Leasing System
// File: index.js
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot-leasing';

// Set up rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all requests
app.use(apiLimiter);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define Client Schema
const clientSchema = new mongoose.Schema({
  clientId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  active: { type: Boolean, default: true },
  allowedDomains: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  chatbotConfig: {
    widgetId: { type: String, required: true }, // Original TestMyPrompt widget ID
    customization: {
      primaryColor: { type: String, default: '#0084ff' },
      secondaryColor: { type: String, default: '#ffffff' },
      headerText: { type: String, default: 'Chat with us' },
      botName: { type: String, default: 'Assistant' },
      logoUrl: { type: String, default: '' }
    }
  },
  requestCount: { type: Number, default: 0 },
  lastRequestDate: { type: Date }
});

// Define Client Model
const Client = mongoose.model('Client', clientSchema);

// API Routes

// Generate a new token for a client
app.post('/api/token', async (req, res) => {
  try {
    const { clientId, adminKey } = req.body;
    
    // Verify admin key (you should implement proper auth in production)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Find the client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    if (!client.active) {
      return res.status(403).json({ error: 'Client account is inactive' });
    }
    
    // Generate token
    const token = jwt.sign({
      clientId: client.clientId,
      active: client.active,
      allowedDomains: client.allowedDomains,
      tokenType: 'jwt'
    }, JWT_SECRET, { expiresIn: '1h' });
    
    res.json({ token });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new client
app.post('/api/clients', async (req, res) => {
  try {
    const { adminKey, name, email, allowedDomains, widgetId } = req.body;
    
    // Verify admin key
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
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
        widgetId: widgetId, // The original TestMyPrompt widget ID
      }
    });
    
    await newClient.save();
    
    res.status(201).json({ 
      message: 'Client created successfully',
      clientId 
    });
  } catch (error) {
    console.error('Client creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validate token and get chatbot configuration
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
      
      const isAllowed = client.allowedDomains.some(allowedDomain => {
        return domain.endsWith(allowedDomain);
      });
      
      if (!isAllowed) {
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

// Update client configuration
app.put('/api/clients/:clientId', async (req, res) => {
  try {
    const { adminKey, customization, active, allowedDomains } = req.body;
    const { clientId } = req.params;
    
    // Verify admin key
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Find client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    // Update client
    if (customization) {
      client.chatbotConfig.customization = {
        ...client.chatbotConfig.customization,
        ...customization
      };
    }
    
    if (typeof active === 'boolean') {
      client.active = active;
    }
    
    if (allowedDomains) {
      client.allowedDomains = allowedDomains;
    }
    
    client.updatedAt = new Date();
    await client.save();
    
    res.json({ message: 'Client updated successfully' });
  } catch (error) {
    console.error('Client update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get client usage statistics
app.get('/api/clients/:clientId/stats', async (req, res) => {
  try {
    const { adminKey } = req.query;
    const { clientId } = req.params;
    
    // Verify admin key
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Find client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({
      requestCount: client.requestCount,
      lastRequestDate: client.lastRequestDate,
      active: client.active
    });
  } catch (error) {
    console.error('Stats retrieval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app; // For testing purposes