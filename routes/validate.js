// Token validation and widget configuration routes - COMPLETE WITH LEASE MANAGEMENT
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Client = require('../models/Client');

// Add this at the top of each route file, AFTER the requires but BEFORE any routes:

router.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-key, x-access-token');
  res.header('Access-Control-Allow-Credentials', 'false');
  res.header('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    console.log(`OPTIONS preflight handled for ${req.originalUrl} from ${origin}`);
    return res.status(200).end();
  }
  
  next();
});

/**
 * @route   POST /api/validate
 * @desc    Validate token and get chatbot configuration WITH COMPREHENSIVE LEASE VALIDATION
 * @access  Public
 */
router.post('/validate', async (req, res) => {
  try {
    console.log('=== LEASE VALIDATION STARTED ===');
    console.log('Request method:', req.method);
    console.log('Request URL:', req.originalUrl);
    console.log('Request headers:', {
      'content-type': req.headers['content-type'],
      'origin': req.headers.origin,
      'user-agent': req.headers['user-agent']?.substring(0, 100),
      'accept': req.headers.accept
    });
    console.log('Request body:', req.body);
    
    // Enhanced body validation with better error messages
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
    
    // Verify token with enhanced error handling
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
    
    // CRITICAL: Check lease status first - this is the main lease validation
    const leaseStatus = client.getLeaseStatus();
    console.log(`Lease status for ${client.clientId}:`, leaseStatus);
    
    // Check if lease is expired (beyond grace period)
    if (leaseStatus.status === 'expired') {
      console.warn(`Access denied - lease expired for client: ${client.clientId}`);
      return res.status(403).json({ 
        error: 'Lease expired',
        clientId: client.clientId,
        message: 'Your chatbot lease has expired. Please contact support to renew.',
        leaseStatus: {
          status: 'expired',
          expirationDate: client.leaseConfig.expirationDate.toISOString(),
          gracePeriodEnded: true,
          daysExpired: Math.abs(leaseStatus.daysRemaining)
        }
      });
    }
    
    // Check if client account is inactive
    if (!client.active) {
      console.warn(`Client is inactive: ${client.clientId}`);
      return res.status(403).json({ 
        error: 'Client account is inactive',
        clientId: client.clientId,
        message: 'This client account has been deactivated',
        leaseStatus: leaseStatus
      });
    }
    
    // Check if access is valid (combines active status and lease validation)
    if (!client.hasValidAccess()) {
      console.warn(`Access denied for client: ${client.clientId} - invalid access`);
      return res.status(403).json({ 
        error: 'Access denied',
        clientId: client.clientId,
        message: 'Client access is not valid',
        leaseStatus: leaseStatus
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
      
      if (!client.isDomainAllowed(domain)) {
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
    
    // Update request count and last request date (only if access is valid)
    try {
      client.requestCount = (client.requestCount || 0) + 1;
      client.lastRequestDate = new Date();
      await client.save();
      console.log(`Updated usage stats for client ${client.clientId}: ${client.requestCount} requests`);
    } catch (saveError) {
      console.error('Failed to update client usage stats:', saveError);
      // Continue anyway - don't fail validation due to stats update failure
    }
    
    // Enhanced response with comprehensive lease information
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
      lease: {
        status: leaseStatus.status,
        daysRemaining: leaseStatus.daysRemaining,
        expirationDate: leaseStatus.expirationDate.toISOString(),
        startDate: client.leaseConfig.startDate.toISOString(),
        duration: client.leaseConfig.duration,
        renewalCount: client.leaseConfig.renewalCount,
        inGracePeriod: leaseStatus.gracePeriodActive,
        gracePeriodHours: client.leaseConfig.gracePeriodHours || 24,
        autoRenewal: client.leaseConfig.autoRenewal || false,
        lastRenewalDate: client.leaseConfig.lastRenewalDate ? client.leaseConfig.lastRenewalDate.toISOString() : null
      },
      validation: {
        domain: domain || null,
        timestamp: new Date().toISOString(),
        requestCount: client.requestCount,
        tokenValid: true,
        accessValid: true,
        leaseValid: leaseStatus.status !== 'expired'
      }
    };
    
    // Add warning for expiring leases
    if (leaseStatus.status === 'expiring_soon') {
      response.warning = {
        type: 'lease_expiring',
        message: leaseStatus.message,
        daysRemaining: leaseStatus.daysRemaining,
        action: 'Consider renewing your lease soon',
        severity: leaseStatus.daysRemaining <= 1 ? 'high' : 'medium'
      };
    }
    
    // Add grace period notification
    if (leaseStatus.status === 'grace_period') {
      response.warning = {
        type: 'grace_period',
        message: 'Your lease has expired but you are in the grace period',
        gracePeriodHours: client.leaseConfig.gracePeriodHours || 24,
        action: 'Please renew your lease immediately to avoid service interruption',
        severity: 'critical'
      };
    }
    
    console.log('=== LEASE VALIDATION SUCCESSFUL ===');
    console.log('Lease status:', leaseStatus.status);
    console.log('Days remaining:', leaseStatus.daysRemaining);
    
    res.json(response);
    
  } catch (error) {
    console.error('=== LEASE VALIDATION ERROR ===');
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
 * @route   POST /api/lease/check
 * @desc    Check lease status for a client
 * @access  Public
 */
router.post('/lease/check', async (req, res) => {
  try {
    console.log('Lease status check request:', req.body);
    
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
      console.error('Token verification failed in lease check:', err.message);
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Token verification failed',
        details: err.name
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
    
    const leaseStatus = client.getLeaseStatus();
    const usageStats = client.getUsageStats();
    
    res.json({
      clientId: client.clientId,
      clientName: client.name,
      active: client.active,
      lease: {
        status: leaseStatus.status,
        daysRemaining: leaseStatus.daysRemaining,
        expirationDate: leaseStatus.expirationDate.toISOString(),
        startDate: client.leaseConfig.startDate.toISOString(),
        duration: client.leaseConfig.duration,
        renewalCount: client.leaseConfig.renewalCount,
        gracePeriodActive: leaseStatus.gracePeriodActive,
        gracePeriodHours: client.leaseConfig.gracePeriodHours || 24,
        autoRenewal: client.leaseConfig.autoRenewal || false,
        message: leaseStatus.message,
        isExpired: client.leaseConfig.isExpired,
        lastRenewalDate: client.leaseConfig.lastRenewalDate ? client.leaseConfig.lastRenewalDate.toISOString() : null
      },
      usage: {
        totalRequests: usageStats.totalRequests,
        averageRequestsPerDay: usageStats.averageRequestsPerDay,
        lastRequestDate: client.lastRequestDate ? client.lastRequestDate.toISOString() : null
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Lease check error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to check lease status'
    });
  }
});

/**
 * @route   POST /api/lease/renew
 * @desc    Renew lease for a client (admin only)
 * @access  Admin
 */
router.post('/lease/renew', async (req, res) => {
  try {
    console.log('Lease renewal request:', req.body);
    
    const { clientId, duration, adminKey } = req.body;
    
    // Verify admin key
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ 
        error: 'Invalid admin key',
        message: 'Admin access is required to renew leases'
      });
    }
    
    if (!clientId || !duration) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'clientId and duration are required',
        received: { clientId: clientId || 'missing', duration: duration || 'missing' }
      });
    }
    
    if (![1, 7, 14, 30].includes(duration)) {
      return res.status(400).json({ 
        error: 'Invalid duration',
        message: 'Duration must be 1, 7, 14, or 30 days',
        allowedDurations: [1, 7, 14, 30],
        received: duration
      });
    }
    
    // Find client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    // Get old lease status for comparison
    const oldLeaseStatus = client.getLeaseStatus();
    
    // Renew the lease
    await client.renewLease(duration, 'admin');
    
    console.log(`Lease renewed for client ${clientId}: ${duration} days`);
    
    res.json({
      message: 'Lease renewed successfully',
      clientId: clientId,
      clientName: client.name,
      renewal: {
        previousStatus: oldLeaseStatus.status,
        previousExpirationDate: oldLeaseStatus.expirationDate.toISOString(),
        newDuration: duration,
        newExpirationDate: client.leaseConfig.expirationDate.toISOString(),
        renewalCount: client.leaseConfig.renewalCount,
        renewedAt: new Date().toISOString(),
        renewedBy: 'admin'
      },
      lease: client.getLeaseStatus()
    });
    
  } catch (error) {
    console.error('Lease renewal error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to renew lease'
    });
  }
});

/**
 * @route   POST /api/lease/extend
 * @desc    Extend existing lease by additional days (admin only)
 * @access  Admin
 */
router.post('/lease/extend', async (req, res) => {
  try {
    console.log('Lease extension request:', req.body);
    
    const { clientId, additionalDays, adminKey } = req.body;
    
    // Verify admin key
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ 
        error: 'Invalid admin key',
        message: 'Admin access is required to extend leases'
      });
    }
    
    if (!clientId || !additionalDays) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'clientId and additionalDays are required',
        received: { clientId: clientId || 'missing', additionalDays: additionalDays || 'missing' }
      });
    }
    
    if (additionalDays < 1 || additionalDays > 90) {
      return res.status(400).json({ 
        error: 'Invalid additional days',
        message: 'Additional days must be between 1 and 90',
        received: additionalDays
      });
    }
    
    // Find client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    // Get old expiration date
    const oldExpirationDate = client.leaseConfig.expirationDate;
    const oldLeaseStatus = client.getLeaseStatus();
    
    // Extend the lease
    await client.extendLease(additionalDays, 'admin');
    
    console.log(`Lease extended for client ${clientId}: +${additionalDays} days`);
    
    res.json({
      message: 'Lease extended successfully',
      clientId: clientId,
      clientName: client.name,
      extension: {
        additionalDays: additionalDays,
        oldExpirationDate: oldExpirationDate.toISOString(),
        newExpirationDate: client.leaseConfig.expirationDate.toISOString(),
        extendedAt: new Date().toISOString(),
        extendedBy: 'admin',
        previousStatus: oldLeaseStatus.status
      },
      lease: client.getLeaseStatus()
    });
    
  } catch (error) {
    console.error('Lease extension error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to extend lease'
    });
  }
});

/**
 * @route   POST /api/usage/track
 * @desc    Track widget usage WITH COMPREHENSIVE LEASE VALIDATION
 * @access  Public
 */
router.post('/usage/track', async (req, res) => {
  try {
    console.log('Usage tracking request with lease validation:', req.body);
    
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
      
      // Check if lease is valid before tracking
      const leaseStatus = client.getLeaseStatus();
      
      if (leaseStatus.status === 'expired') {
        console.warn(`Usage tracking blocked - lease expired for client: ${clientId}`);
        return res.status(403).json({
          success: false,
          error: 'Lease expired',
          leaseStatus: leaseStatus,
          message: 'Usage tracking denied due to expired lease',
          timestamp: new Date().toISOString()
        });
      }
      
      try {
        // Update usage stats only if lease is valid
        if (client.hasValidAccess()) {
          client.requestCount = (client.requestCount || 0) + 1;
          client.lastRequestDate = new Date();
          await client.save();
          console.log(`Usage stats updated for ${clientId}: ${client.requestCount} total requests`);
        } else {
          console.warn(`Usage tracking skipped - invalid access for client: ${clientId}`);
          return res.status(403).json({
            success: false,
            error: 'Invalid access',
            leaseStatus: leaseStatus,
            timestamp: new Date().toISOString()
          });
        }
      } catch (saveError) {
        console.error('Failed to save usage stats:', saveError);
      }
    } else {
      console.warn(`Usage tracking: Client not found: ${clientId}`);
    }
    
    // Return success with lease validation info
    res.status(200).json({ 
      success: true,
      timestamp: new Date().toISOString(),
      tracked: !!client,
      leaseValid: client ? client.hasValidAccess() : false,
      leaseStatus: client ? client.getLeaseStatus().status : 'unknown'
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
 * @route   GET /api/lease/expiring
 * @desc    Get clients with expiring leases (admin only)
 * @access  Admin
 */
router.get('/lease/expiring', async (req, res) => {
  try {
    const adminKey = req.query.adminKey || req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ 
        error: 'Invalid admin key',
        message: 'Admin access is required'
      });
    }
    
    const daysAhead = parseInt(req.query.days) || 7;
    
    // Find clients expiring within the specified days
    const now = new Date();
    const futureDate = new Date(now.getTime() + (daysAhead * 24 * 60 * 60 * 1000));
    
    const expiringClients = await Client.find({
      'leaseConfig.expirationDate': { $gt: now, $lt: futureDate },
      'leaseConfig.isExpired': false,
      active: true
    }).select('clientId name email leaseConfig requestCount lastRequestDate');
    
    const clientsWithStatus = expiringClients.map(client => {
      const leaseStatus = client.getLeaseStatus();
      return {
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        leaseStatus: leaseStatus,
        requestCount: client.requestCount || 0,
        lastRequestDate: client.lastRequestDate,
        urgency: leaseStatus.daysRemaining <= 1 ? 'high' : leaseStatus.daysRemaining <= 3 ? 'medium' : 'low'
      };
    });
    
    // Sort by urgency (most urgent first)
    clientsWithStatus.sort((a, b) => {
      const urgencyOrder = { high: 3, medium: 2, low: 1 };
      return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
    });
    
    res.json({
      expiringClients: clientsWithStatus,
      count: clientsWithStatus.length,
      daysAhead: daysAhead,
      breakdown: {
        urgent: clientsWithStatus.filter(c => c.urgency === 'high').length,
        medium: clientsWithStatus.filter(c => c.urgency === 'medium').length,
        low: clientsWithStatus.filter(c => c.urgency === 'low').length
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Expiring leases query error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get expiring leases'
    });
  }
});

/**
 * @route   POST /api/lease/expire-clients
 * @desc    Manually expire clients past their lease (admin only)
 * @access  Admin
 */
router.post('/lease/expire-clients', async (req, res) => {
  try {
    const { adminKey } = req.body;
    
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ 
        error: 'Invalid admin key',
        message: 'Admin access is required'
      });
    }
    
    console.log('Manual lease expiration process started by admin');
    
    // Run the expiration process
    const results = await Client.expireClients();
    
    console.log(`Manual lease expiration process completed:`, results);
    
    res.json({
      message: 'Lease expiration process completed',
      results: results,
      summary: `Processed ${results.processed} clients, expired ${results.expired}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Manual lease expiration process error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to expire clients'
    });
  }
});

/**
 * @route   GET /api/health
 * @desc    Health check endpoint with lease system status
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Get lease statistics
    const now = new Date();
    const leaseStats = {
      totalClients: await Client.countDocuments(),
      activeClients: await Client.countDocuments({ active: true }),
      expiredClients: await Client.countDocuments({ 'leaseConfig.isExpired': true }),
      expiringToday: await Client.countDocuments({
        'leaseConfig.expirationDate': { 
          $gte: now, 
          $lt: new Date(now.getTime() + (24 * 60 * 60 * 1000)) 
        },
        'leaseConfig.isExpired': false
      }),
      gracePeriodClients: await Client.countDocuments({
        'leaseConfig.expirationDate': { $lt: now },
        'leaseConfig.isExpired': false
      })
    };
    
    res.json({ 
      status: 'ok',
      service: 'Chatbot Leasing System with Lease Management',
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
      version: '1.0.3',
      features: ['lease-management', 'expiration-tracking', 'grace-period', 'auto-expiry'],
      leaseStats: leaseStats
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/test-connection
 * @desc    Test connection endpoint for widget debugging with lease info
 * @access  Public
 */
router.post('/test-connection', (req, res) => {
  console.log('Test connection request from:', req.headers.origin || 'unknown origin');
  
  res.json({
    success: true,
    message: 'Connection test successful',
    timestamp: new Date().toISOString(),
    origin: req.headers.origin || 'no origin',
    userAgent: req.headers['user-agent'] || 'no user agent',
    ip: req.ip || 'unknown ip',
    body: req.body || {},
    features: ['lease-management', 'expiration-tracking', 'grace-period'],
    server: {
      version: '1.0.3',
      environment: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime())
    }
  });
});

/**
 * @route   GET /api/widget-info/:widgetId
 * @desc    Get widget information with lease validation (for debugging)
 * @access  Public
 */
router.get('/widget-info/:widgetId', async (req, res) => {
  try {
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
    
    const leaseStatus = client.getLeaseStatus();
    const hasValidAccess = client.hasValidAccess();
    
    res.json({
      widgetId: widgetId,
      exists: true,
      active: client.active,
      hasValidAccess: hasValidAccess,
      customization: client.chatbotConfig.customization,
      client: {
        name: client.name,
        active: client.active,
        clientId: client.clientId
      },
      lease: {
        status: leaseStatus.status,
        daysRemaining: leaseStatus.daysRemaining,
        expirationDate: leaseStatus.expirationDate.toISOString(),
        duration: client.leaseConfig.duration,
        isExpired: client.leaseConfig.isExpired
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
 * @desc    Verify if domain is allowed for a client with lease check
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
    
    const isDomainAllowed = client.isDomainAllowed(domain);
    const leaseStatus = client.getLeaseStatus();
    const hasValidAccess = client.hasValidAccess();
    
    res.json({
      allowed: isDomainAllowed && hasValidAccess,
      domain: domain,
      clientId: clientId,
      domainAllowed: isDomainAllowed,
      leaseValid: hasValidAccess,
      restrictions: client.allowedDomains && client.allowedDomains.length > 0,
      allowedDomains: client.allowedDomains || [],
      leaseStatus: leaseStatus,
      message: !isDomainAllowed ? 'Domain not allowed' : 
               !hasValidAccess ? 'Lease expired or invalid' : 
               'Access granted'
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
 * @desc    Get system statistics with comprehensive lease information
 * @access  Public
 */
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
    const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    
    // Basic stats
    const totalClients = await Client.countDocuments();
    const activeClients = await Client.countDocuments({ active: true });
    const totalRequests = await Client.aggregate([
      { $group: { _id: null, total: { $sum: '$requestCount' } } }
    ]);
    
    // Lease-specific stats
    const leaseStats = {
      // Status breakdown
      activeLeases: await Client.countDocuments({
        'leaseConfig.expirationDate': { $gt: now },
        'leaseConfig.isExpired': false,
        active: true
      }),
      expiredLeases: await Client.countDocuments({
        'leaseConfig.isExpired': true
      }),
      gracePeriodLeases: await Client.countDocuments({
        'leaseConfig.expirationDate': { $lt: now },
        'leaseConfig.isExpired': false
      }),
      
      // Expiry timeline
      expiringToday: await Client.countDocuments({
        'leaseConfig.expirationDate': { $gte: now, $lt: oneDayAgo },
        'leaseConfig.isExpired': false
      }),
      expiring3Days: await Client.countDocuments({
        'leaseConfig.expirationDate': { $gte: now, $lt: threeDaysFromNow },
        'leaseConfig.isExpired': false
      }),
      expiring7Days: await Client.countDocuments({
        'leaseConfig.expirationDate': { $gte: now, $lt: sevenDaysFromNow },
        'leaseConfig.isExpired': false
      }),
      
      // Duration breakdown
      duration1Day: await Client.countDocuments({ 'leaseConfig.duration': 1 }),
      duration7Days: await Client.countDocuments({ 'leaseConfig.duration': 7 }),
      duration14Days: await Client.countDocuments({ 'leaseConfig.duration': 14 }),
      duration30Days: await Client.countDocuments({ 'leaseConfig.duration': 30 }),
      
      // Renewal stats
      totalRenewals: await Client.aggregate([
        { $group: { _id: null, total: { $sum: '$leaseConfig.renewalCount' } } }
      ]).then(result => result[0]?.total || 0),
      
      autoRenewalEnabled: await Client.countDocuments({ 'leaseConfig.autoRenewal': true })
    };
    
    res.json({
      system: {
        totalClients: totalClients,
        activeClients: activeClients,
        inactiveClients: totalClients - activeClients,
        totalRequests: totalRequests[0]?.total || 0
      },
      lease: leaseStats,
      health: {
        urgentAction: leaseStats.expiringToday + leaseStats.gracePeriodLeases,
        needsAttention: leaseStats.expiring3Days,
        stable: leaseStats.activeLeases - leaseStats.expiring7Days
      },
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: '1.0.3'
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
 * @desc    Get client information by token with comprehensive lease data
 * @access  Public
 */
router.post('/client-info', async (req, res) => {
  try {
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
        message: 'Token verification failed',
        details: err.name
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
    
    const leaseStatus = client.getLeaseStatus();
    const usageStats = client.getUsageStats();
    
    res.json({
      clientId: client.clientId,
      name: client.name,
      email: client.email,
      active: client.active,
      hasValidAccess: client.hasValidAccess(),
      widgetId: client.chatbotConfig?.widgetId,
      customization: client.chatbotConfig?.customization || {},
      lease: {
        status: leaseStatus.status,
        daysRemaining: leaseStatus.daysRemaining,
        expirationDate: leaseStatus.expirationDate.toISOString(),
        startDate: client.leaseConfig.startDate.toISOString(),
        duration: client.leaseConfig.duration,
        renewalCount: client.leaseConfig.renewalCount,
        gracePeriodActive: leaseStatus.gracePeriodActive,
        autoRenewal: client.leaseConfig.autoRenewal || false,
        isExpired: client.leaseConfig.isExpired
      },
      usage: {
        totalRequests: usageStats.totalRequests,
        averageRequestsPerDay: usageStats.averageRequestsPerDay,
        lastRequestDate: client.lastRequestDate ? client.lastRequestDate.toISOString() : null
      },
      domains: {
        hasRestrictions: client.allowedDomains && client.allowedDomains.length > 0,
        allowedDomains: client.allowedDomains || []
      }
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
 * @route   GET /api/widget-config/:clientId
 * @desc    Get widget configuration for a client with lease validation
 * @access  Public
 */
router.get('/widget-config/:clientId', async (req, res) => {
  try {
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
    
    // Check lease status
    const leaseStatus = client.getLeaseStatus();
    if (leaseStatus.status === 'expired') {
      return res.status(403).json({ 
        error: 'Lease expired',
        clientId: clientId,
        leaseStatus: leaseStatus
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
      name: client.name,
      lease: {
        status: leaseStatus.status,
        daysRemaining: leaseStatus.daysRemaining,
        hasValidAccess: client.hasValidAccess()
      }
    });
    
  } catch (error) {
    console.error('Widget config error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get widget config'
    });
  }
});

/**
 * @route   POST /api/lease/bulk-renew
 * @desc    Bulk renew leases for multiple clients (admin only)
 * @access  Admin
 */
router.post('/lease/bulk-renew', async (req, res) => {
  try {
    const { clientIds, duration, adminKey } = req.body;
    
    // Verify admin key
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ 
        error: 'Invalid admin key',
        message: 'Admin access is required'
      });
    }
    
    if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(400).json({ 
        error: 'Client IDs array is required',
        message: 'Provide an array of client IDs to renew'
      });
    }
    
    if (![1, 7, 14, 30].includes(duration)) {
      return res.status(400).json({ 
        error: 'Invalid duration',
        message: 'Duration must be 1, 7, 14, or 30 days',
        allowedDurations: [1, 7, 14, 30]
      });
    }
    
    const results = {
      successful: [],
      failed: [],
      total: clientIds.length
    };
    
    for (const clientId of clientIds) {
      try {
        const client = await Client.findOne({ clientId });
        
        if (!client) {
          results.failed.push({
            clientId: clientId,
            error: 'Client not found'
          });
          continue;
        }
        
        const oldStatus = client.getLeaseStatus();
        await client.renewLease(duration, 'admin-bulk');
        
        results.successful.push({
          clientId: clientId,
          name: client.name,
          previousStatus: oldStatus.status,
          newExpirationDate: client.leaseConfig.expirationDate.toISOString()
        });
        
        console.log(`Bulk renewed lease for client ${clientId}: ${duration} days`);
        
      } catch (error) {
        results.failed.push({
          clientId: clientId,
          error: error.message
        });
        console.error(`Failed to bulk renew client ${clientId}:`, error);
      }
    }
    
    res.json({
      message: 'Bulk lease renewal completed',
      results: results,
      summary: `${results.successful.length} successful, ${results.failed.length} failed out of ${results.total} total`,
      duration: duration,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Bulk lease renewal error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to bulk renew leases'
    });
  }
});

/**
 * @route   POST /api/lease/expire-clients
 * @desc    Manually expire clients past their lease (admin only)
 * @access  Admin
 */
router.post('/lease/expire-clients', async (req, res) => {
  try {
    const { adminKey } = req.body;
    
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ 
        error: 'Invalid admin key',
        message: 'Admin access is required'
      });
    }
    
    console.log('Manual lease expiration process started by admin');
    
    // Run the expiration process using the Client model method
    const results = await Client.expireClients();
    
    console.log(`Manual lease expiration process completed:`, results);
    
    res.json({
      message: 'Lease expiration process completed',
      results: results,
      summary: `Processed ${results.processed} clients, expired ${results.expired}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Manual lease expiration process error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to expire clients'
    });
  }
});

/**
 * @route   GET /api/lease/dashboard
 * @desc    Get comprehensive lease dashboard data (admin only)
 * @access  Admin
 */
router.get('/lease/dashboard', async (req, res) => {
  try {
    const adminKey = req.query.adminKey || req.headers['x-admin-key'];
    
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ 
        error: 'Invalid admin key',
        message: 'Admin access is required'
      });
    }
    
    const now = new Date();
    const oneDayFromNow = new Date(now.getTime() + (24 * 60 * 60 * 1000));
    const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
    const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    
    // Comprehensive lease statistics
    const stats = {
      overview: {
        totalClients: await Client.countDocuments(),
        activeClients: await Client.countDocuments({ active: true }),
        inactiveClients: await Client.countDocuments({ active: false })
      },
      
      leaseStatus: {
        active: await Client.countDocuments({
          'leaseConfig.expirationDate': { $gt: now },
          'leaseConfig.isExpired': false,
          active: true
        }),
        expired: await Client.countDocuments({
          'leaseConfig.isExpired': true
        }),
        gracePeriod: await Client.countDocuments({
          'leaseConfig.expirationDate': { $lt: now },
          'leaseConfig.isExpired': false
        }),
        expiring1Day: await Client.countDocuments({
          'leaseConfig.expirationDate': { $gt: now, $lt: oneDayFromNow },
          'leaseConfig.isExpired': false
        }),
        expiring3Days: await Client.countDocuments({
          'leaseConfig.expirationDate': { $gt: now, $lt: threeDaysFromNow },
          'leaseConfig.isExpired': false
        }),
        expiring7Days: await Client.countDocuments({
          'leaseConfig.expirationDate': { $gt: now, $lt: sevenDaysFromNow },
          'leaseConfig.isExpired': false
        })
      },
      
      leaseDuration: {
        sevenDays: await Client.countDocuments({ 'leaseConfig.duration': 7 }),
        fourteenDays: await Client.countDocuments({ 'leaseConfig.duration': 14 }),
        thirtyDays: await Client.countDocuments({ 'leaseConfig.duration': 30 })
      },
      
      renewals: {
        totalRenewals: await Client.aggregate([
          { $group: { _id: null, total: { $sum: '$leaseConfig.renewalCount' } } }
        ]).then(result => result[0]?.total || 0),
        autoRenewalEnabled: await Client.countDocuments({ 'leaseConfig.autoRenewal': true }),
        clientsWithRenewals: await Client.countDocuments({ 'leaseConfig.renewalCount': { $gt: 0 } }),
        averageRenewals: await Client.aggregate([
          { $group: { _id: null, avg: { $avg: '$leaseConfig.renewalCount' } } }
        ]).then(result => Math.round((result[0]?.avg || 0) * 100) / 100)
      }
    };
    
    // Get critical clients (expiring soon or in grace period)
    const criticalClients = await Client.find({
      $or: [
        {
          'leaseConfig.expirationDate': { $gt: now, $lt: threeDaysFromNow },
          'leaseConfig.isExpired': false
        },
        {
          'leaseConfig.expirationDate': { $lt: now },
          'leaseConfig.isExpired': false
        }
      ],
      active: true
    })
    .select('clientId name email leaseConfig requestCount')
    .sort({ 'leaseConfig.expirationDate': 1 })
    .limit(20);
    
    // Get recently expired clients
    const recentlyExpired = await Client.find({
      'leaseConfig.isExpired': true,
      'leaseConfig.expirationDate': { $gt: new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)) }
    })
    .select('clientId name email leaseConfig')
    .sort({ 'leaseConfig.expirationDate': -1 })
    .limit(10);
    
    res.json({
      stats,
      criticalClients: criticalClients.map(client => {
        const leaseStatus = client.getLeaseStatus();
        return {
          clientId: client.clientId,
          name: client.name,
          email: client.email,
          leaseStatus: leaseStatus,
          requestCount: client.requestCount || 0,
          urgency: leaseStatus.status === 'grace_period' ? 'critical' :
                   leaseStatus.daysRemaining <= 1 ? 'high' :
                   leaseStatus.daysRemaining <= 3 ? 'medium' : 'low'
        };
      }),
      recentlyExpired: recentlyExpired.map(client => ({
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        expirationDate: client.leaseConfig.expirationDate,
        duration: client.leaseConfig.duration,
        renewalCount: client.leaseConfig.renewalCount
      })),
      alerts: {
        criticalCount: stats.leaseStatus.gracePeriod,
        urgentCount: stats.leaseStatus.expiring1Day,
        warningCount: stats.leaseStatus.expiring3Days
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Lease dashboard error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get lease dashboard'
    });
  }
});

module.exports = router;