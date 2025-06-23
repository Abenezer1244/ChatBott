// Token validation and widget configuration routes - COMPLETE CORRECTED VERSION
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Client = require('../models/Client');

/**
 * @route   POST /api/validate
 * @desc    Validate token and get chatbot configuration
 * @access  Public
 */
router.post('/validate', async (req, res) => {
  try {
    console.log('=== VALIDATE ROUTE CALLED ===');
    console.log('Request method:', req.method);
    console.log('Request URL:', req.originalUrl);
    console.log('Request headers:', {
      'content-type': req.headers['content-type'],
      'origin': req.headers.origin,
      'user-agent': req.headers['user-agent']?.substring(0, 100),
      'accept': req.headers.accept
    });
    console.log('Request body:', req.body);
    
    // CORRECTED: Set CORS headers immediately
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    res.header('Access-Control-Max-Age', '86400');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS preflight request');
      return res.status(200).end();
    }
    
    // CORRECTED: Enhanced body validation
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
      console.error('Request body is missing or empty');
      return res.status(400).json({ 
        error: 'Request body is required',
        message: 'Please provide a JSON body with token and domain',
        example: { token: "your_jwt_token", domain: "yourdomain.com" },
        received: req.body,
        contentType: req.get('content-type') || 'not provided'
      });
    }
    
    const { token, domain } = req.body;
    
    if (!token) {
      console.error('Token is missing from request body');
      return res.status(400).json({ 
        error: 'Token is required',
        message: 'Please provide a valid JWT token',
        received: { 
          token: token || 'undefined', 
          domain: domain || 'undefined',
          bodyKeys: Object.keys(req.body || {})
        }
      });
    }
    
    console.log(`Validating token for domain: ${domain || 'no domain provided'}`);
    
    // CORRECTED: Verify token with enhanced error handling
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token decoded successfully:', { 
        clientId: decodedToken.clientId,
        iat: decodedToken.iat ? new Date(decodedToken.iat * 1000).toISOString() : 'not set',
        exp: decodedToken.exp ? new Date(decodedToken.exp * 1000).toISOString() : 'not set'
      });
    } catch (err) {
      console.error('Token verification failed:', err.name, err.message);
      
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
    
    // CORRECTED: Get client from database with enhanced error handling
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
    
    // CORRECTED: Enhanced domain validation
    if (client.allowedDomains && client.allowedDomains.length > 0) {
      if (!domain) {
        console.warn('Domain information is required but not provided');
        return res.status(400).json({ 
          error: 'Domain information is required',
          allowedDomains: client.allowedDomains,
          message: 'This client has domain restrictions enabled'
        });
      }
      
      const isAllowed = client.allowedDomains.some(allowedDomain => {
        // Exact match
        if (domain === allowedDomain) return true;
        
        // Clean domain comparison (remove protocol and www)
        const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();
        const cleanAllowedDomain = allowedDomain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();
        
        if (cleanDomain === cleanAllowedDomain) return true;
        
        // Subdomain match
        if (cleanDomain.endsWith(`.${cleanAllowedDomain}`)) return true;
        
        // Wildcard match
        if (allowedDomain.startsWith('*.')) {
          const baseDomain = allowedDomain.substring(2).toLowerCase();
          return cleanDomain === baseDomain || cleanDomain.endsWith(`.${baseDomain}`);
        }
        
        return false;
      });
      
      if (!isAllowed) {
        console.warn(`Domain not authorized: ${domain} for client: ${client.clientId}`);
        return res.status(403).json({ 
          error: 'Domain not authorized',
          domain: domain,
          allowedDomains: client.allowedDomains,
          message: `Domain ${domain} is not authorized for this client`
        });
      }
      
      console.log(`Domain ${domain} is authorized for client ${client.clientId}`);
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
    
    // CORRECTED: Enhanced response with proper widget configuration
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

/**
 * @route   POST /api/usage/track
 * @desc    Track widget usage
 * @access  Public
 */
router.post('/usage/track', async (req, res) => {
  try {
    console.log('Usage tracking request:', req.body);
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    
    const { clientId, url, referrer, timestamp } = req.body;
    
    if (!clientId) {
      console.warn('Usage tracking: Client ID is required');
      return res.status(200).json({ 
        success: true,
        error: 'Client ID is required',
        received: req.body,
        timestamp: new Date().toISOString()
      });
    }
    
    // Find the client
    let client;
    try {
      client = await Client.findOne({ clientId });
    } catch (dbError) {
      console.error('Database error during usage tracking:', dbError);
      return res.status(200).json({ 
        success: true,
        error: 'Database error',
        timestamp: new Date().toISOString()
      });
    }
    
    if (client) {
      console.log(`Tracking usage for client: ${client.name} (${clientId})`);
      
      try {
        // Update usage stats
        client.requestCount = (client.requestCount || 0) + 1;
        client.lastRequestDate = new Date();
        
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
      timestamp: new Date().toISOString(),
      tracked: !!client
    });
    
  } catch (error) {
    console.error('Usage tracking error:', error);
    res.status(200).json({ 
      success: true,
      error: 'Failed to track usage',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
  
  res.json({ 
    status: 'ok',
    service: 'Chatbot Leasing System',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
    },
    database: {
      status: mongoStatus,
      name: 'MongoDB'
    },
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.3'
  });
});

/**
 * @route   GET /api/widget-info/:widgetId
 * @desc    Get widget information (for debugging)
 * @access  Public
 */
router.get('/widget-info/:widgetId', async (req, res) => {
  try {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    
    const { widgetId } = req.params;
    
    if (!widgetId) {
      return res.status(400).json({ error: 'Widget ID is required' });
    }
    
    const client = await Client.findOne({ 'chatbotConfig.widgetId': widgetId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Widget not found',
        widgetId: widgetId
      });
    }
    
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

/**
 * @route   POST /api/verify-domain
 * @desc    Verify if domain is allowed for a client
 * @access  Public
 */
router.post('/verify-domain', async (req, res) => {
  try {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    
    const { clientId, domain } = req.body;
    
    if (!clientId || !domain) {
      return res.status(400).json({ 
        error: 'Client ID and domain are required',
        received: { clientId: clientId || 'undefined', domain: domain || 'undefined' }
      });
    }
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    const isAllowed = client.isDomainAllowed(domain);
    
    res.json({
      allowed: isAllowed,
      domain: domain,
      clientId: clientId,
      restrictions: client.allowedDomains && client.allowedDomains.length > 0,
      allowedDomains: client.allowedDomains || []
    });
    
  } catch (error) {
    console.error('Domain verification error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to verify domain'
    });
  }
});

/**
 * @route   GET /api/stats
 * @desc    Get system statistics (basic)
 * @access  Public
 */
router.get('/stats', async (req, res) => {
  try {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    
    const totalClients = await Client.countDocuments();
    const activeClients = await Client.countDocuments({ active: true });
    const totalRequests = await Client.aggregate([
      { $group: { _id: null, total: { $sum: '$requestCount' } } }
    ]);
    
    res.json({
      system: {
        totalClients: totalClients,
        activeClients: activeClients,
        inactiveClients: totalClients - activeClients,
        totalRequests: totalRequests[0]?.total || 0
      },
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime())
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get stats'
    });
  }
});

/**
 * @route   POST /api/client-info
 * @desc    Get client information by token (for widget)
 * @access  Public
 */
router.post('/client-info', async (req, res) => {
  try {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        error: 'Token is required',
        message: 'Please provide a valid JWT token'
      });
    }
    
    // Verify token
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Token verification failed'
      });
    }
    
    // Get client
    const client = await Client.findOne({ clientId: decodedToken.clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: decodedToken.clientId
      });
    }
    
    res.json({
      clientId: client.clientId,
      name: client.name,
      active: client.active,
      widgetId: client.chatbotConfig?.widgetId,
      customization: client.chatbotConfig?.customization || {}
    });
    
  } catch (error) {
    console.error('Client info error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get client info'
    });
  }
});

/**
 * @route   POST /api/test-connection
 * @desc    Test connection endpoint for widget debugging
 * @access  Public
 */
router.post('/test-connection', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
  
  console.log('Test connection request from:', req.headers.origin || 'unknown origin');
  
  res.json({
    success: true,
    message: 'Connection test successful',
    timestamp: new Date().toISOString(),
    origin: req.headers.origin || 'no origin',
    userAgent: req.headers['user-agent'] || 'no user agent',
    ip: req.ip || 'unknown ip',
    body: req.body || {}
  });
});

/**
 * @route   GET /api/widget-config/:clientId
 * @desc    Get widget configuration for a client (public endpoint)
 * @access  Public
 */
router.get('/widget-config/:clientId', async (req, res) => {
  try {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    
    const { clientId } = req.params;
    
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID is required' });
    }
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    if (!client.active) {
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: clientId
      });
    }
    
    // Return public configuration only
    const customization = client.chatbotConfig?.customization || {};
    res.json({
      widgetId: client.chatbotConfig?.widgetId || "6809b3a1523186af0b2c9933",
      customization: {
        primaryColor: customization.primaryColor || '#0084ff',
        secondaryColor: customization.secondaryColor || '#ffffff',
        headerText: customization.headerText || 'Chat with us',
        botName: customization.botName || 'Assistant',
        logoUrl: customization.logoUrl || '',
        position: customization.position || 'right',
        autoOpen: customization.autoOpen || false
      },
      active: client.active,
      name: client.name
    });
    
  } catch (error) {
    console.error('Widget config error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get widget config'
    });
  }
});

module.exports = router;