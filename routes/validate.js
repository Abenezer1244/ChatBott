// Token validation and widget configuration routes
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
    console.log('Validate route called');
    console.log('Request headers:', req.headers);
    console.log('Request body:', req.body);
    console.log('Request method:', req.method);
    console.log('Request URL:', req.originalUrl);
    
    // Handle case where req.body might be undefined
    if (!req.body) {
      console.error('Request body is missing');
      return res.status(400).json({ 
        error: 'Request body is missing',
        received: 'No body data'
      });
    }
    
    const { token, domain } = req.body;
    
    if (!token) {
      console.error('Token is missing from request');
      return res.status(400).json({ 
        error: 'Token is required',
        received: { token: token || 'undefined', domain: domain || 'undefined' }
      });
    }
    
    console.log(`Validating token for domain: ${domain}`);
    
    // Verify token
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token decoded successfully:', { clientId: decodedToken.clientId });
    } catch (err) {
      console.error('Token verification failed:', err.message);
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          expiredAt: err.expiredAt
        });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token format',
          details: err.message
        });
      }
      if (err.name === 'NotBeforeError') {
        return res.status(401).json({ 
          error: 'Token not active yet',
          date: err.date
        });
      }
      return res.status(401).json({ 
        error: 'Invalid token',
        type: err.name
      });
    }
    
    // Get client from database
    const client = await Client.findOne({ clientId: decodedToken.clientId });
    
    if (!client) {
      console.error(`Client not found: ${decodedToken.clientId}`);
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: decodedToken.clientId
      });
    }
    
    console.log(`Client found: ${client.name} (${client.clientId})`);
    
    if (!client.active) {
      console.warn(`Client is inactive: ${client.clientId}`);
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: client.clientId
      });
    }
    
    // Enhanced domain validation
    if (client.allowedDomains && client.allowedDomains.length > 0) {
      if (!domain) {
        console.warn('Domain information is required but not provided');
        return res.status(400).json({ 
          error: 'Domain information is required',
          allowedDomains: client.allowedDomains
        });
      }
      
      const isAllowed = client.isDomainAllowed(domain);
      
      if (!isAllowed) {
        console.warn(`Domain not authorized: ${domain} for client: ${client.clientId}`);
        console.warn(`Allowed domains: ${client.allowedDomains.join(', ')}`);
        return res.status(403).json({ 
          error: 'Domain not authorized',
          domain: domain,
          allowedDomains: client.allowedDomains
        });
      }
      
      console.log(`Domain ${domain} is authorized for client ${client.clientId}`);
    } else {
      console.log(`No domain restrictions for client ${client.clientId}`);
    }
    
    // Update request count and last request date
    try {
      client.requestCount += 1;
      client.lastRequestDate = new Date();
      await client.save();
      console.log(`Updated usage stats for client ${client.clientId}: ${client.requestCount} requests`);
    } catch (saveError) {
      console.error('Failed to update client usage stats:', saveError);
      // Continue anyway - don't fail validation due to stats update failure
    }
    
    // Return chatbot configuration
    const response = {
      valid: true,
      config: {
        widgetId: client.chatbotConfig.widgetId,
        customization: client.chatbotConfig.customization || {
          primaryColor: '#0084ff',
          secondaryColor: '#ffffff',
          headerText: 'Chat with us',
          botName: 'Assistant'
        }
      },
      client: {
        name: client.name,
        active: client.active
      },
      timestamp: new Date().toISOString()
    };
    
    console.log('Validation successful, returning config');
    res.json(response);
    
  } catch (error) {
    console.error('Token validation error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred during validation'
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
      client.requestCount += 1;
      client.lastRequestDate = new Date();
      
      // Could add more detailed analytics here in the future
      // For example, storing usage patterns, popular pages, etc.
      
      try {
        await client.save();
        console.log(`Usage stats updated for ${clientId}: ${client.requestCount} total requests`);
      } catch (saveError) {
        console.error('Failed to save usage stats:', saveError);
      }
    } else {
      console.warn(`Usage tracking: Client not found: ${clientId}`);
    }
    
    // Always return success, even if client not found
    // This prevents leaking information about valid client IDs
    res.status(200).json({ 
      success: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Usage tracking error:', error);
    // Still return success to prevent errors in the beacon call
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
    version: '1.0.0'
  });
});

/**
 * @route   GET /api/widget-info/:widgetId
 * @desc    Get widget information (for debugging)
 * @access  Public
 */
router.get('/widget-info/:widgetId', async (req, res) => {
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

/**
 * @route   POST /api/verify-domain
 * @desc    Verify if domain is allowed for a client
 * @access  Public
 */
router.post('/verify-domain', async (req, res) => {
  try {
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