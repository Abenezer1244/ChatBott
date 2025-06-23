// Token validation and widget configuration routes - FIXED VERSION
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
    // Enhanced logging for debugging
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
    console.log('Body type:', typeof req.body);
    console.log('Body keys:', req.body ? Object.keys(req.body) : 'no body');
    
    // Enhanced CORS headers - Set immediately
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    res.header('Access-Control-Max-Age', '86400');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS preflight request');
      return res.status(200).end();
    }
    
    // Enhanced body validation
    if (!req.body) {
      console.error('Request body is completely missing');
      return res.status(400).json({ 
        error: 'Request body is required',
        received: 'No body data',
        contentType: req.get('content-type') || 'not provided',
        debug: {
          method: req.method,
          url: req.originalUrl,
          hasBody: !!req.body
        }
      });
    }
    
    // Check if body is empty object
    if (typeof req.body === 'object' && Object.keys(req.body).length === 0) {
      console.error('Request body is an empty object');
      return res.status(400).json({ 
        error: 'Request body cannot be empty',
        received: 'Empty object',
        contentType: req.get('content-type') || 'not provided',
        debug: {
          bodyType: typeof req.body,
          bodyKeys: Object.keys(req.body),
          bodyString: JSON.stringify(req.body)
        }
      });
    }
    
    const { token, domain } = req.body;
    
    if (!token) {
      console.error('Token is missing from request body');
      return res.status(400).json({ 
        error: 'Token is required',
        received: { 
          token: token || 'undefined', 
          domain: domain || 'undefined',
          bodyKeys: Object.keys(req.body || {}),
          bodyType: typeof req.body
        },
        help: 'Include a valid JWT token in the request body as: {"token": "your_token", "domain": "your_domain"}'
      });
    }
    
    console.log(`Validating token for domain: ${domain || 'no domain provided'}`);
    
    // Verify token with enhanced error handling
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token decoded successfully:', { 
        clientId: decodedToken.clientId,
        iat: decodedToken.iat ? new Date(decodedToken.iat * 1000).toISOString() : 'not set',
        exp: decodedToken.exp ? new Date(decodedToken.exp * 1000).toISOString() : 'not set',
        audience: decodedToken.aud,
        issuer: decodedToken.iss
      });
    } catch (err) {
      console.error('Token verification failed:', {
        name: err.name,
        message: err.message,
        expiredAt: err.expiredAt,
        date: err.date
      });
      
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          expiredAt: err.expiredAt,
          message: 'The token has expired, please request a new one',
          debug: {
            currentTime: new Date().toISOString(),
            expiredAt: err.expiredAt
          }
        });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token format',
          details: err.message,
          message: 'The token format is invalid or corrupted',
          debug: {
            tokenLength: token.length,
            tokenStart: token.substring(0, 10) + '...'
          }
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
        message: 'Token verification failed',
        debug: {
          jwtSecret: process.env.JWT_SECRET ? 'configured' : 'missing'
        }
      });
    }
    
    // Get client from database with enhanced error handling
    let client;
    try {
      client = await Client.findOne({ clientId: decodedToken.clientId });
      console.log(`Database query completed for clientId: ${decodedToken.clientId}`);
    } catch (dbError) {
      console.error('Database error while finding client:', {
        error: dbError.message,
        stack: dbError.stack,
        clientId: decodedToken.clientId
      });
      return res.status(500).json({ 
        error: 'Database error',
        message: 'Unable to verify client information',
        debug: {
          dbConnected: require('mongoose').connection.readyState === 1,
          error: process.env.NODE_ENV === 'development' ? dbError.message : 'Database connection issue'
        }
      });
    }
    
    if (!client) {
      console.error(`Client not found in database: ${decodedToken.clientId}`);
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: decodedToken.clientId,
        message: 'The client associated with this token does not exist',
        debug: {
          tokenClientId: decodedToken.clientId,
          dbSearchCompleted: true
        }
      });
    }
    
    console.log(`Client found: ${client.name} (${client.clientId}), Active: ${client.active}`);
    
    if (!client.active) {
      console.warn(`Client is inactive: ${client.clientId}`);
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: client.clientId,
        message: 'This client account has been deactivated',
        debug: {
          clientName: client.name,
          deactivatedAt: client.updatedAt
        }
      });
    }
    
    // Enhanced domain validation with better logic
    if (client.allowedDomains && client.allowedDomains.length > 0) {
      if (!domain) {
        console.warn('Domain information is required but not provided');
        return res.status(400).json({ 
          error: 'Domain information is required',
          allowedDomains: client.allowedDomains,
          message: 'This client has domain restrictions enabled',
          help: 'Include the domain in your validation request: {"token": "...", "domain": "example.com"}',
          debug: {
            hasRestrictions: true,
            restrictionCount: client.allowedDomains.length
          }
        });
      }
      
      // Enhanced domain validation logic
      const isAllowed = client.allowedDomains.some(allowedDomain => {
        // Exact match
        if (domain === allowedDomain) return true;
        
        // Remove protocol and www if present for comparison
        const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();
        const cleanAllowedDomain = allowedDomain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase();
        
        if (cleanDomain === cleanAllowedDomain) return true;
        
        // Subdomain match (e.g., sub.example.com matches example.com)
        if (cleanDomain.endsWith(`.${cleanAllowedDomain}`)) return true;
        
        // Wildcard match (e.g., *.example.com)
        if (allowedDomain.startsWith('*.')) {
          const baseDomain = allowedDomain.substring(2).toLowerCase();
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
          message: `Domain ${domain} is not authorized for this client`,
          debug: {
            providedDomain: domain,
            cleanedDomain: domain.replace(/^(https?:\/\/)?(www\.)?/, '').toLowerCase(),
            allowedDomains: client.allowedDomains
          }
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
    
    // Enhanced response with comprehensive configuration
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
        tokenValid: true,
        tokenExpiry: decodedToken.exp ? new Date(decodedToken.exp * 1000).toISOString() : null
      },
      debug: process.env.NODE_ENV === 'development' ? {
        tokenIssuer: decodedToken.iss,
        tokenAudience: decodedToken.aud,
        clientCreated: client.createdAt,
        lastActive: client.lastRequestDate
      } : undefined
    };
    
    console.log('=== VALIDATION SUCCESSFUL ===');
    console.log('Response config widgetId:', response.config.widgetId);
    console.log('Response customization:', response.config.customization);
    
    res.json(response);
    
  } catch (error) {
    console.error('=== TOKEN VALIDATION ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred during validation',
      timestamp: new Date().toISOString(),
      debug: process.env.NODE_ENV === 'development' ? {
        errorType: error.name,
        errorStack: error.stack
      } : undefined
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
      // Still return success to prevent widget errors
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
      // Still return success to prevent widget errors
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
        
        // Could add more detailed analytics here in the future
        // For example, storing usage patterns, popular pages, etc.
        
        await client.save();
        console.log(`Usage stats updated for ${clientId}: ${client.requestCount} total requests`);
      } catch (saveError) {
        console.error('Failed to save usage stats:', saveError);
        // Continue anyway
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
    // Still return success to prevent errors in the widget
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
  
  // Set CORS headers
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
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    
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

/**
 * @route   POST /api/verify-domain
 * @desc    Verify if domain is allowed for a client
 * @access  Public
 */
router.post('/verify-domain', async (req, res) => {
  try {
    // Set CORS headers
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
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Origin, X-Requested-With');
    
    const Client = require('../models/Client');
    
    // Get basic statistics
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

module.exports = router;