// Client management routes WITH COMPLETE LEASE MANAGEMENT - FIXED ROUTE ORDERING & CORS
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { verifyAdmin } = require('../middleware/auth');
const Client = require('../models/Client');

// CRITICAL FIX: Enhanced CORS middleware for all client routes
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
 * CRITICAL FIX: Route ordering - Most specific routes FIRST
 * Order: /lease-dashboard -> /search/* -> /bulk-* -> / -> /:clientId
 */

/**
 * @route   GET /api/clients/lease-dashboard
 * @desc    Get lease dashboard statistics - HIGHEST PRIORITY ROUTE
 * @access  Admin only
 */
router.get('/lease-dashboard', verifyAdmin, async (req, res) => {
  try {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
    const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
    
    console.log('Loading lease dashboard statistics...');
    
    // ENHANCED ERROR HANDLING: Wrap database operations in try-catch
    let stats;
    try {
      stats = {
        totalClients: await Client.countDocuments(),
        activeClients: await Client.countDocuments({ active: true }),
        
        // Lease status breakdown with enhanced error handling
        leaseStatus: {
          active: await Client.countDocuments({
            'leaseConfig.expirationDate': { $gt: now },
            'leaseConfig.isExpired': false,
            active: true
          }),
          expired: await Client.countDocuments({
            'leaseConfig.isExpired': true
          }),
          expiring3Days: await Client.countDocuments({
            'leaseConfig.expirationDate': { $gt: now, $lt: threeDaysFromNow },
            'leaseConfig.isExpired': false
          }),
          expiring7Days: await Client.countDocuments({
            'leaseConfig.expirationDate': { $gt: now, $lt: sevenDaysFromNow },
            'leaseConfig.isExpired': false
          }),
          gracePeriod: await Client.countDocuments({
            'leaseConfig.expirationDate': { $lt: now },
            'leaseConfig.isExpired': false
          })
        },
        
        // Duration breakdown
        leaseDuration: {
          sevenDays: await Client.countDocuments({ 'leaseConfig.duration': 7 }),
          fourteenDays: await Client.countDocuments({ 'leaseConfig.duration': 14 }),
          thirtyDays: await Client.countDocuments({ 'leaseConfig.duration': 30 })
        },
        
        // Renewal statistics
        renewals: {
          totalRenewals: await Client.aggregate([
            { $group: { _id: null, total: { $sum: '$leaseConfig.renewalCount' } } }
          ]).then(result => result[0]?.total || 0),
          autoRenewalEnabled: await Client.countDocuments({ 'leaseConfig.autoRenewal': true }),
          clientsWithRenewals: await Client.countDocuments({ 'leaseConfig.renewalCount': { $gt: 0 } })
        }
      };
    } catch (dbError) {
      console.error('Database error in lease dashboard:', dbError);
      throw new Error(`Database operation failed: ${dbError.message}`);
    }
    
    // Get additional data with error handling
    let expiringSoon = [];
    let recentlyExpired = [];
    
    try {
      expiringSoon = await Client.find({
        'leaseConfig.expirationDate': { $gt: now, $lt: threeDaysFromNow },
        'leaseConfig.isExpired': false,
        active: true
      })
      .select('clientId name email leaseConfig requestCount')
      .limit(10)
      .sort({ 'leaseConfig.expirationDate': 1 });
      
      recentlyExpired = await Client.find({
        'leaseConfig.isExpired': true,
        'leaseConfig.expirationDate': { $gt: new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)) }
      })
      .select('clientId name email leaseConfig')
      .limit(10)
      .sort({ 'leaseConfig.expirationDate': -1 });
    } catch (queryError) {
      console.warn('Failed to fetch additional dashboard data:', queryError);
      // Continue with empty arrays rather than failing
    }
    
    console.log('Lease dashboard stats loaded successfully:', {
      totalClients: stats.totalClients,
      activeLeases: stats.leaseStatus.active,
      expiredLeases: stats.leaseStatus.expired
    });
    
    const response = {
      stats,
      expiringSoon: expiringSoon.map(client => ({
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        leaseStatus: client.getLeaseStatus(),
        requestCount: client.requestCount || 0
      })),
      recentlyExpired: recentlyExpired.map(client => ({
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        expirationDate: client.leaseConfig.expirationDate,
        duration: client.leaseConfig.duration
      })),
      timestamp: new Date().toISOString()
    };
    
    // ENHANCED RESPONSE HEADERS
    res.header('Content-Type', 'application/json');
    res.json(response);
    
  } catch (error) {
    console.error('CRITICAL: Lease dashboard error:', error);
    console.error('Error stack:', error.stack);
    
    // ENHANCED ERROR RESPONSE
    const errorResponse = {
      error: 'Failed to load lease dashboard',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        mongooseConnection: require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected'
      } : undefined
    };
    
    res.status(500).json(errorResponse);
  }
});

/**
 * @route   GET /api/clients/search/:query
 * @desc    Search clients - SECOND PRIORITY
 * @access  Admin only
 */
router.get('/search/:query', verifyAdmin, async (req, res) => {
  try {
    const { query } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    
    if (!query || query.length < 2) {
      return res.status(400).json({
        error: 'Invalid search query',
        message: 'Search query must be at least 2 characters long'
      });
    }
    
    const searchRegex = new RegExp(query, 'i');
    
    const clients = await Client.find({
      $or: [
        { name: searchRegex },
        { email: searchRegex },
        { clientId: searchRegex },
        { 'chatbotConfig.widgetId': searchRegex },
        { allowedDomains: { $in: [searchRegex] } }
      ]
    })
    .limit(limit)
    .select('clientId name email active requestCount lastRequestDate createdAt allowedDomains leaseConfig')
    .lean();
    
    const results = clients.map(client => {
      const tempClient = new Client(client);
      const leaseStatus = tempClient.getLeaseStatus();
      
      return {
        ...client,
        matchType: 
          client.name.toLowerCase().includes(query.toLowerCase()) ? 'name' :
          client.email.toLowerCase().includes(query.toLowerCase()) ? 'email' :
          client.clientId.toLowerCase().includes(query.toLowerCase()) ? 'clientId' :
          'other',
        leaseStatus: leaseStatus,
        leaseInfo: {
          duration: client.leaseConfig.duration,
          expirationDate: client.leaseConfig.expirationDate,
          renewalCount: client.leaseConfig.renewalCount,
          isExpired: client.leaseConfig.isExpired
        }
      };
    });
    
    res.json({
      query: query,
      results: results,
      count: results.length,
      limit: limit
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Search failed'
    });
  }
});

/**
 * @route   POST /api/clients/bulk-update
 * @desc    Bulk update clients - THIRD PRIORITY
 * @access  Admin only
 */
router.post('/bulk-update', verifyAdmin, async (req, res) => {
  try {
    const { clientIds, updates } = req.body;
    
    if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(400).json({
        error: 'Client IDs array is required',
        message: 'Provide an array of client IDs to update'
      });
    }
    
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'Updates object is required',
        message: 'Provide updates to apply to the clients'
      });
    }
    
    // Validate that only allowed fields are being updated
    const allowedFields = ['active', 'allowedDomains', 'autoRenewal'];
    const updateFields = Object.keys(updates);
    const invalidFields = updateFields.filter(field => !allowedFields.includes(field));
    
    if (invalidFields.length > 0) {
      return res.status(400).json({
        error: 'Invalid update fields',
        invalidFields: invalidFields,
        allowedFields: allowedFields
      });
    }
    
    const updateQuery = {
      ...updates,
      updatedAt: new Date()
    };
    
    // Handle autoRenewal updates for lease config
    if (updates.autoRenewal !== undefined) {
      updateQuery['leaseConfig.autoRenewal'] = updates.autoRenewal;
      delete updateQuery.autoRenewal;
    }
    
    const result = await Client.updateMany(
      { clientId: { $in: clientIds } },
      { $set: updateQuery }
    );
    
    console.log(`Bulk update completed: ${result.modifiedCount} clients updated`);
    
    res.json({
      message: 'Bulk update completed',
      matched: result.matchedCount,
      modified: result.modifiedCount,
      clientIds: clientIds,
      updates: updates,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Bulk update failed'
    });
  }
});

/**
 * @route   POST /api/clients/bulk-lease-operation
 * @desc    Bulk lease operations - FOURTH PRIORITY
 * @access  Admin only
 */
router.post('/bulk-lease-operation', verifyAdmin, async (req, res) => {
  try {
    const { clientIds, operation, duration, additionalDays } = req.body;
    
    if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(400).json({
        error: 'Client IDs array is required',
        message: 'Provide an array of client IDs for lease operations'
      });
    }
    
    if (!operation || !['renew', 'extend'].includes(operation)) {
      return res.status(400).json({
        error: 'Invalid operation',
        message: 'Operation must be "renew" or "extend"',
        allowedOperations: ['renew', 'extend']
      });
    }
    
    if (operation === 'renew' && (!duration || ![7, 14, 30].includes(duration))) {
      return res.status(400).json({
        error: 'Invalid duration for renewal',
        message: 'Duration must be 7, 14, or 30 days for renewal',
        allowedDurations: [7, 14, 30]
      });
    }
    
    if (operation === 'extend' && (!additionalDays || additionalDays < 1 || additionalDays > 90)) {
      return res.status(400).json({
        error: 'Invalid additional days for extension',
        message: 'Additional days must be between 1 and 90 for extension'
      });
    }
    
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: []
    };
    
    // Process each client
    for (const clientId of clientIds) {
      try {
        results.processed++;
        
        const client = await Client.findOne({ clientId });
        
        if (!client) {
          results.failed++;
          results.errors.push({
            clientId: clientId,
            error: 'Client not found'
          });
          continue;
        }
        
        if (operation === 'renew') {
          await client.renewLease(duration, 'admin-bulk');
        } else if (operation === 'extend') {
          await client.extendLease(additionalDays, 'admin-bulk');
        }
        
        results.successful++;
        console.log(`Bulk ${operation} completed for client: ${clientId}`);
        
      } catch (error) {
        results.failed++;
        results.errors.push({
          clientId: clientId,
          error: error.message
        });
        console.error(`Bulk ${operation} failed for client ${clientId}:`, error);
      }
    }
    
    console.log(`Bulk lease operation completed:`, results);
    
    res.json({
      message: `Bulk lease ${operation} operation completed`,
      operation: operation,
      results: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Bulk lease operation error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Bulk lease operation failed'
    });
  }
});

/**
 * @route   GET /api/clients
 * @desc    Get all clients with enhanced error handling - FIFTH PRIORITY
 * @access  Admin only
 */
router.get('/', verifyAdmin, async (req, res) => {
  try {
    console.log('=== FETCHING CLIENTS START ===');
    console.log('Query parameters:', req.query);
    console.log('Request headers origin:', req.headers.origin);
    
    // ENHANCED ERROR HANDLING: Check database connection first
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
      console.error('Database not connected. State:', mongoose.connection.readyState);
      return res.status(500).json({
        error: 'Database connection error',
        message: 'Database is not connected',
        dbState: mongoose.connection.readyState,
        timestamp: new Date().toISOString()
      });
    }
    
    // Pagination parameters with validation
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10), 100);
    const skip = (page - 1) * limit;
    
    console.log(`Pagination: page=${page}, limit=${limit}, skip=${skip}`);
    
    // Sorting parameters
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };
    
    // Enhanced filtering with lease status
    const filter = {};
    
    // Active status filter
    if (req.query.active === 'true') filter.active = true;
    if (req.query.active === 'false') filter.active = false;
    
    // Lease status filter with enhanced logic
    if (req.query.leaseStatus) {
      const now = new Date();
      switch (req.query.leaseStatus) {
        case 'expired':
          filter['leaseConfig.isExpired'] = true;
          break;
        case 'expiring_soon':
          const threeDaysFromNow = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
          filter['leaseConfig.expirationDate'] = { $gt: now, $lt: threeDaysFromNow };
          filter['leaseConfig.isExpired'] = false;
          break;
        case 'active':
          filter['leaseConfig.expirationDate'] = { $gt: now };
          filter['leaseConfig.isExpired'] = false;
          break;
        case 'grace_period':
          filter['leaseConfig.expirationDate'] = { $lt: now };
          filter['leaseConfig.isExpired'] = false;
          break;
      }
    }
    
    // Lease duration filter
    if (req.query.leaseDuration) {
      const duration = parseInt(req.query.leaseDuration);
      if ([7, 14, 30].includes(duration)) {
        filter['leaseConfig.duration'] = duration;
      }
    }
    
    // Search filter
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { clientId: searchRegex },
        { 'chatbotConfig.widgetId': searchRegex }
      ];
    }
    
    // Date range filter
    if (req.query.createdAfter || req.query.createdBefore) {
      filter.createdAt = {};
      if (req.query.createdAfter) {
        filter.createdAt.$gte = new Date(req.query.createdAfter);
      }
      if (req.query.createdBefore) {
        filter.createdAt.$lte = new Date(req.query.createdBefore);
      }
    }
    
    console.log('Applied filter:', JSON.stringify(filter, null, 2));
    
    // ENHANCED DATABASE QUERY with timeout and error handling
    let clients = [];
    let total = 0;
    
    try {
      console.log('Executing database queries...');
      
      // Execute queries with timeout
      const queryTimeout = 10000; // 10 seconds
      
      const clientsPromise = Client.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select('-__v')
        .lean()
        .maxTimeMS(queryTimeout);
      
      const totalPromise = Client.countDocuments(filter).maxTimeMS(queryTimeout);
      
      [clients, total] = await Promise.all([clientsPromise, totalPromise]);
      
      console.log(`Found ${clients.length} clients out of ${total} total`);
      
    } catch (queryError) {
      console.error('Database query error:', queryError);
      return res.status(500).json({
        error: 'Database query failed',
        message: process.env.NODE_ENV === 'development' ? queryError.message : 'Failed to fetch clients',
        queryDetails: {
          filter: filter,
          sort: sort,
          pagination: { page, limit, skip }
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Calculate lease statistics with error handling
    let leaseStats = {
      totalActive: 0,
      totalExpired: 0,
      expiringSoon: 0,
      duration7Days: 0,
      duration14Days: 0,
      duration30Days: 0
    };
    
    try {
      console.log('Calculating lease statistics...');
      
      const statsPromises = [
        Client.countDocuments({ ...filter, 'leaseConfig.isExpired': false, active: true }),
        Client.countDocuments({ ...filter, 'leaseConfig.isExpired': true }),
        Client.countDocuments({
          ...filter,
          'leaseConfig.expirationDate': { 
            $gt: new Date(), 
            $lt: new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)) 
          },
          'leaseConfig.isExpired': false
        }),
        Client.countDocuments({ ...filter, 'leaseConfig.duration': 7 }),
        Client.countDocuments({ ...filter, 'leaseConfig.duration': 14 }),
        Client.countDocuments({ ...filter, 'leaseConfig.duration': 30 })
      ];
      
      const [totalActive, totalExpired, expiringSoon, duration7Days, duration14Days, duration30Days] = 
        await Promise.all(statsPromises);
      
      leaseStats = {
        totalActive,
        totalExpired,
        expiringSoon,
        duration7Days,
        duration14Days,
        duration30Days
      };
      
      console.log('Lease statistics calculated:', leaseStats);
      
    } catch (statsError) {
      console.warn('Failed to calculate lease statistics:', statsError);
      // Continue with default stats rather than failing
    }
    
    // Process clients with enhanced error handling
    const processedClients = clients.map(client => {
      try {
        // Create temporary client object to use instance methods
        const tempClient = new Client(client);
        const leaseStatus = tempClient.getLeaseStatus();
        
        return {
          ...client,
          // Add computed fields
          domainCount: client.allowedDomains ? client.allowedDomains.length : 0,
          hasRestrictions: client.allowedDomains && client.allowedDomains.length > 0,
          lastActiveFormatted: client.lastRequestDate ? client.lastRequestDate.toISOString() : null,
          
          // Add lease information
          leaseStatus: leaseStatus,
          leaseInfo: {
            duration: client.leaseConfig.duration,
            startDate: client.leaseConfig.startDate,
            expirationDate: client.leaseConfig.expirationDate,
            renewalCount: client.leaseConfig.renewalCount,
            isExpired: client.leaseConfig.isExpired,
            gracePeriodHours: client.leaseConfig.gracePeriodHours || 24,
            autoRenewal: client.leaseConfig.autoRenewal || false
          }
        };
      } catch (processingError) {
        console.warn(`Error processing client ${client.clientId}:`, processingError);
        // Return basic client data if processing fails
        return {
          ...client,
          leaseStatus: { status: 'unknown', daysRemaining: 0 },
          leaseInfo: { duration: 0, renewalCount: 0, isExpired: true }
        };
      }
    });
    
    const response = {
      clients: processedClients,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      },
      stats: {
        totalClients: total,
        ...leaseStats,
        totalRequests: clients.reduce((sum, client) => sum + (client.requestCount || 0), 0)
      },
      filters: {
        applied: Object.keys(filter).length > 0 ? filter : null,
        available: ['active', 'leaseStatus', 'leaseDuration', 'search', 'createdAfter', 'createdBefore', 'domain']
      },
      meta: {
        timestamp: new Date().toISOString(),
        queryTime: Date.now(),
        dbConnected: mongoose.connection.readyState === 1
      }
    };
    
    console.log(`=== FETCHING CLIENTS SUCCESS ===`);
    console.log(`Returning ${processedClients.length} clients (page ${page} of ${Math.ceil(total / limit)})`);
    
    // Enhanced response headers
    res.header('Content-Type', 'application/json');
    res.header('X-Total-Count', total.toString());
    res.header('X-Page', page.toString());
    res.header('X-Per-Page', limit.toString());
    
    res.json(response);
    
  } catch (error) {
    console.error('=== FETCHING CLIENTS ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    const errorResponse = {
      error: 'Failed to fetch clients',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        mongooseState: require('mongoose').connection.readyState,
        query: req.query
      } : undefined
    };
    
    res.status(500).json(errorResponse);
  }
});

// ... Rest of the routes (POST, PUT, DELETE, etc.) follow the same pattern with enhanced error handling

/**
 * @route   POST /api/clients
 * @desc    Create a new client with lease configuration
 * @access  Admin only
 */
router.post('/', verifyAdmin, async (req, res) => {
  try {
    console.log('Creating new client with lease config:', req.body);
    
    const { name, email, allowedDomains, widgetId, customization, leaseDuration = 30 } = req.body;
    
    // Enhanced validation
    if (!name || !email) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: 'Name and email are required fields',
        received: { name: name || 'missing', email: email || 'missing' }
      });
    }
    
    // Validate lease duration
    if (![7, 14, 30].includes(leaseDuration)) {
      return res.status(400).json({ 
        error: 'Invalid lease duration',
        message: 'Lease duration must be 7, 14, or 30 days',
        allowedDurations: [7, 14, 30],
        received: leaseDuration
      });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Invalid email format',
        email: email
      });
    }
    
    // Check if email already exists
    const existingClient = await Client.findOne({ email: email.toLowerCase() });
    if (existingClient) {
      return res.status(400).json({ 
        error: 'Email already exists',
        message: 'A client with this email address already exists',
        existingClientId: existingClient.clientId
      });
    }
    
    // Validate domain format if provided
    if (allowedDomains && Array.isArray(allowedDomains)) {
      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
      for (const domain of allowedDomains) {
        if (domain && !domainRegex.test(domain)) {
          return res.status(400).json({ 
            error: 'Invalid domain format',
            invalidDomain: domain
          });
        }
      }
    }
    
    // Generate unique client ID
    let clientId;
    let attempts = 0;
    do {
      clientId = `client-${uuidv4().slice(0, 8)}`;
      attempts++;
      if (attempts > 10) {
        throw new Error('Failed to generate unique client ID');
      }
    } while (await Client.findOne({ clientId }));
    
    // Use provided widget ID or default
    const defaultWidgetId = "6809b3a1523186af0b2c9933";
    const finalWidgetId = widgetId || defaultWidgetId;
    
    // Calculate lease dates
    const startDate = new Date();
    const durationInMs = leaseDuration * 24 * 60 * 60 * 1000;
    const expirationDate = new Date(startDate.getTime() + durationInMs);
    
    // Create new client with lease configuration
    const clientData = {
      clientId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      allowedDomains: allowedDomains ? allowedDomains.filter(d => d && d.trim()) : [],
      
      // Lease configuration
      leaseConfig: {
        duration: leaseDuration,
        startDate: startDate,
        expirationDate: expirationDate,
        renewalCount: 0,
        isExpired: false,
        autoRenewal: false,
        gracePeriodHours: 24
      },
      
      chatbotConfig: {
        widgetId: finalWidgetId,
        customization: {
          primaryColor: customization?.primaryColor || '#0084ff',
          secondaryColor: customization?.secondaryColor || '#ffffff',
          headerText: customization?.headerText || 'Chat with us',
          botName: customization?.botName || 'Assistant',
          logoUrl: customization?.logoUrl || '',
          position: customization?.position || 'right',
          autoOpen: customization?.autoOpen || false,
          ...customization
        }
      },
      
      // Initialize lease history
      leaseHistory: [{
        startDate: startDate,
        endDate: expirationDate,
        duration: leaseDuration,
        renewalType: 'initial',
        renewedBy: 'admin',
        renewedAt: startDate
      }]
    };
    
    const newClient = new Client(clientData);
    await newClient.save();
    
    console.log(`Client created successfully: ${clientId} with ${leaseDuration}-day lease`);
    
    const response = {
      message: 'Client created successfully',
      clientId,
      client: {
        id: newClient._id,
        clientId,
        name: newClient.name,
        email: newClient.email,
        active: newClient.active,
        allowedDomains: newClient.allowedDomains,
        widgetId: finalWidgetId,
        customization: newClient.chatbotConfig.customization,
        createdAt: newClient.createdAt,
        requestCount: 0,
        
        // Lease information
        leaseInfo: {
          duration: leaseDuration,
          startDate: startDate.toISOString(),
          expirationDate: expirationDate.toISOString(),
          renewalCount: 0,
          isExpired: false,
          gracePeriodHours: 24,
          autoRenewal: false
        },
        leaseStatus: newClient.getLeaseStatus()
      }
    };
    
    res.status(201).json(response);
    
  } catch (error) {
    console.error('Client creation error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ 
        error: 'Validation failed',
        details: messages,
        fields: Object.keys(error.errors)
      });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        error: 'Duplicate value',
        field: field,
        message: `A client with this ${field} already exists`
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to create client',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   GET /api/clients/:clientId
 * @desc    Get a single client by ID with detailed lease information
 * @access  Admin only
 */
router.get('/:clientId', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    console.log(`Fetching client with lease info: ${clientId}`);
    
    const client = await Client.findOne({ clientId }).select('-__v').lean();
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    // Create temporary client object to use instance methods
    const tempClient = new Client(client);
    const leaseStatus = tempClient.getLeaseStatus();
    const usageStats = tempClient.getUsageStats();
    
    // Add computed fields
    const enhancedClient = {
      ...client,
      domainCount: client.allowedDomains ? client.allowedDomains.length : 0,
      hasRestrictions: client.allowedDomains && client.allowedDomains.length > 0,
      daysSinceCreated: Math.floor((new Date() - new Date(client.createdAt)) / (1000 * 60 * 60 * 24)),
      lastActiveFormatted: client.lastRequestDate ? client.lastRequestDate.toISOString() : null,
      
      // Lease information
      leaseStatus: leaseStatus,
      leaseInfo: {
        duration: client.leaseConfig.duration,
        startDate: client.leaseConfig.startDate,
        expirationDate: client.leaseConfig.expirationDate,
        renewalCount: client.leaseConfig.renewalCount,
        isExpired: client.leaseConfig.isExpired,
        gracePeriodHours: client.leaseConfig.gracePeriodHours || 24,
        autoRenewal: client.leaseConfig.autoRenewal || false,
        lastRenewalDate: client.leaseConfig.lastRenewalDate
      },
      
      // Usage statistics with lease context
      usageStats: usageStats,
      
      // Lease history
      leaseHistory: client.leaseHistory || []
    };
    
    res.json({ 
      client: enhancedClient
    });
    
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to fetch client',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   PUT /api/clients/:clientId
 * @desc    Update a client with lease management capabilities
 * @access  Admin only
 */
router.put('/:clientId', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { name, email, customization, active, allowedDomains, widgetId, 
           leaseDuration, renewLease, extendDays, autoRenewal } = req.body;
    
    console.log(`Updating client with lease options: ${clientId}`, req.body);
    
    // Find client
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    // Store original values for comparison
    const originalValues = {
      name: client.name,
      email: client.email,
      active: client.active,
      leaseDuration: client.leaseConfig.duration
    };
    
    // Validate email if being updated
    if (email && email !== client.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ 
          error: 'Invalid email format',
          email: email
        });
      }
      
      const existingClient = await Client.findOne({ 
        email: email.toLowerCase(),
        clientId: { $ne: clientId }
      });
      
      if (existingClient) {
        return res.status(400).json({ 
          error: 'Email already exists',
          message: 'Another client already uses this email address',
          existingClientId: existingClient.clientId
        });
      }
    }
    
    // Validate domains if being updated
    if (allowedDomains && Array.isArray(allowedDomains)) {
      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
      for (const domain of allowedDomains) {
        if (domain && !domainRegex.test(domain)) {
          return res.status(400).json({ 
            error: 'Invalid domain format',
            invalidDomain: domain
          });
        }
      }
    }
    
    // Handle lease operations first
    let leaseOperationPerformed = false;
    let leaseOperationDetails = null;
    
    // Renew lease if requested
    if (renewLease && leaseDuration) {
      if (![7, 14, 30].includes(leaseDuration)) {
        return res.status(400).json({ 
          error: 'Invalid lease duration',
          message: 'Lease duration must be 7, 14, or 30 days',
          allowedDurations: [7, 14, 30]
        });
      }
      
      const oldStatus = client.getLeaseStatus();
      await client.renewLease(leaseDuration, 'admin');
      leaseOperationPerformed = true;
      leaseOperationDetails = {
        operation: 'renewed',
        oldStatus: oldStatus.status,
        newDuration: leaseDuration,
        newExpirationDate: client.leaseConfig.expirationDate.toISOString()
      };
      
      console.log(`Lease renewed for client ${clientId}: ${leaseDuration} days`);
    }
    
    // Extend lease if requested
    if (extendDays && !renewLease) {
      if (extendDays < 1 || extendDays > 90) {
        return res.status(400).json({ 
          error: 'Invalid extension days',
          message: 'Extension days must be between 1 and 90'
        });
      }
      
      const oldExpirationDate = client.leaseConfig.expirationDate;
      await client.extendLease(extendDays, 'admin');
      leaseOperationPerformed = true;
      leaseOperationDetails = {
        operation: 'extended',
        extensionDays: extendDays,
        oldExpirationDate: oldExpirationDate.toISOString(),
        newExpirationDate: client.leaseConfig.expirationDate.toISOString()
      };
      
      console.log(`Lease extended for client ${clientId}: +${extendDays} days`);
    }
    
    // Update basic fields if provided
    if (name) client.name = name.trim();
    if (email) client.email = email.toLowerCase().trim();
    if (typeof active === 'boolean') client.active = active;
    if (allowedDomains) client.allowedDomains = allowedDomains.filter(d => d && d.trim());
    if (widgetId) client.chatbotConfig.widgetId = widgetId;
    
    // Update lease settings
    if (typeof autoRenewal === 'boolean') {
      client.leaseConfig.autoRenewal = autoRenewal;
    }
    
    // Update customization if provided
    if (customization) {
      client.chatbotConfig.customization = {
        ...client.chatbotConfig.customization,
        ...customization
      };
      
      // Validate color formats
      const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
      if (customization.primaryColor && !colorRegex.test(customization.primaryColor)) {
        return res.status(400).json({ 
          error: 'Invalid primary color format',
          color: customization.primaryColor
        });
      }
      if (customization.secondaryColor && !colorRegex.test(customization.secondaryColor)) {
        return res.status(400).json({ 
          error: 'Invalid secondary color format',
          color: customization.secondaryColor
        });
      }
    }
    
    client.updatedAt = new Date();
    await client.save();
    
    console.log(`Client updated successfully: ${clientId}`);
    
    // Determine what changed
    const changes = [];
    if (name && name !== originalValues.name) changes.push('name');
    if (email && email !== originalValues.email) changes.push('email');
    if (typeof active === 'boolean' && active !== originalValues.active) changes.push('active status');
    if (allowedDomains) changes.push('domain restrictions');
    if (customization) changes.push('customization');
    if (widgetId) changes.push('widget ID');
    if (typeof autoRenewal === 'boolean') changes.push('auto-renewal setting');
    if (leaseOperationPerformed) changes.push('lease configuration');
    
    const response = {
      message: 'Client updated successfully',
      clientId,
      changes: changes,
      client: {
        clientId,
        name: client.name,
        email: client.email,
        active: client.active,
        allowedDomains: client.allowedDomains,
        widgetId: client.chatbotConfig.widgetId,
        customization: client.chatbotConfig.customization,
        updatedAt: client.updatedAt,
        requestCount: client.requestCount,
        
        // Lease information
        leaseInfo: {
          duration: client.leaseConfig.duration,
          startDate: client.leaseConfig.startDate,
          expirationDate: client.leaseConfig.expirationDate,
          renewalCount: client.leaseConfig.renewalCount,
          isExpired: client.leaseConfig.isExpired,
          gracePeriodHours: client.leaseConfig.gracePeriodHours || 24,
          autoRenewal: client.leaseConfig.autoRenewal || false
        },
        leaseStatus: client.getLeaseStatus()
      }
    };
    
    // Add lease operation details if performed
    if (leaseOperationPerformed) {
      response.leaseOperation = leaseOperationDetails;
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('Client update error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ 
        error: 'Validation failed',
        details: messages
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to update client',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * @route   DELETE /api/clients/:clientId
 * @desc    Delete a client with confirmation and lease information
 * @access  Admin only
 */
router.delete('/:clientId', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { confirm } = req.query;
    
    console.log(`Delete request for client: ${clientId}`);
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    if (confirm !== 'true') {
      const leaseStatus = client.getLeaseStatus();
      return res.status(400).json({
        error: 'Confirmation required',
        message: 'Add ?confirm=true to the URL to confirm deletion',
        client: {
          clientId: client.clientId,
          name: client.name,
          requestCount: client.requestCount,
          active: client.active,
          leaseStatus: leaseStatus,
          leaseInfo: {
            duration: client.leaseConfig.duration,
            expirationDate: client.leaseConfig.expirationDate,
            renewalCount: client.leaseConfig.renewalCount
          }
        }
      });
    }
    
    const deletedClientInfo = {
      clientId: client.clientId,
      name: client.name,
      email: client.email,
      requestCount: client.requestCount,
      createdAt: client.createdAt,
      lastRequestDate: client.lastRequestDate,
      leaseInfo: {
        duration: client.leaseConfig.duration,
        startDate: client.leaseConfig.startDate,
        expirationDate: client.leaseConfig.expirationDate,
        renewalCount: client.leaseConfig.renewalCount,
        isExpired: client.leaseConfig.isExpired,
        totalLeaseDays: (client.leaseHistory || []).reduce((sum, lease) => sum + lease.duration, client.leaseConfig.duration)
      }
    };
    
    await Client.deleteOne({ clientId });
    
    console.log(`Client deleted successfully: ${clientId}`);
    
    res.json({ 
      message: 'Client deleted successfully',
      deletedClient: deletedClientInfo,
      deletedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Client deletion error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to delete client'
    });
  }
});

/**
 * @route   POST /api/clients/:clientId/renew-lease
 * @desc    Renew lease for a specific client
 * @access  Admin only
 */
router.post('/:clientId/renew-lease', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { duration } = req.body;
    
    if (!duration || ![7, 14, 30].includes(duration)) {
      return res.status(400).json({ 
        error: 'Invalid duration',
        message: 'Duration must be 7, 14, or 30 days',
        allowedDurations: [7, 14, 30]
      });
    }
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    const oldLeaseStatus = client.getLeaseStatus();
    await client.renewLease(duration, 'admin');
    
    console.log(`Lease renewed for client ${clientId}: ${duration} days`);
    
    res.json({
      message: 'Lease renewed successfully',
      clientId: clientId,
      clientName: client.name,
      renewal: {
        previousStatus: oldLeaseStatus.status,
        newDuration: duration,
        newExpirationDate: client.leaseConfig.expirationDate.toISOString(),
        renewalCount: client.leaseConfig.renewalCount,
        renewedAt: new Date().toISOString()
      },
      leaseStatus: client.getLeaseStatus()
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
 * @route   POST /api/clients/:clientId/extend-lease
 * @desc    Extend lease for a specific client
 * @access  Admin only
 */
/**
 * @route   POST /api/clients/:clientId/extend-lease
 * @desc    Extend lease for a specific client
 * @access  Admin only
 */
router.post('/:clientId/extend-lease', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { additionalDays } = req.body;
    
    if (!additionalDays || additionalDays < 1 || additionalDays > 90) {
      return res.status(400).json({ 
        error: 'Invalid additional days',
        message: 'Additional days must be between 1 and 90'
      });
    }
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    const oldExpirationDate = client.leaseConfig.expirationDate;
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
        extendedAt: new Date().toISOString()
      },
      leaseStatus: client.getLeaseStatus()
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
 * @route   GET /api/clients/:clientId/lease-history
 * @desc    Get lease history for a specific client
 * @access  Admin only
 */
router.get('/:clientId/lease-history', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const client = await Client.findOne({ clientId }).select('clientId name leaseHistory leaseConfig');
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    const currentLeaseStatus = client.getLeaseStatus();
    
    res.json({
      clientId: clientId,
      clientName: client.name,
      currentLease: {
        status: currentLeaseStatus.status,
        duration: client.leaseConfig.duration,
        startDate: client.leaseConfig.startDate,
        expirationDate: client.leaseConfig.expirationDate,
        renewalCount: client.leaseConfig.renewalCount,
        daysRemaining: currentLeaseStatus.daysRemaining
      },
      leaseHistory: client.leaseHistory || [],
      totalRenewals: client.leaseConfig.renewalCount,
      totalLeaseDays: (client.leaseHistory || []).reduce((sum, lease) => sum + lease.duration, client.leaseConfig.duration)
    });
    
  } catch (error) {
    console.error('Lease history error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get lease history'
    });
  }
});

module.exports = router;