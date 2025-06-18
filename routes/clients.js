// Client management routes
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { verifyAdmin } = require('../middleware/auth');
const Client = require('../models/Client');

/**
 * @route   GET /api/clients
 * @desc    Get all clients with enhanced filtering and pagination
 * @access  Admin only
 */
router.get('/', verifyAdmin, async (req, res) => {
  try {
    console.log('Fetching clients with query:', req.query);
    
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 100); // Cap at 100
    const skip = (page - 1) * limit;
    
    // Sorting parameters
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };
    
    // Enhanced filtering
    const filter = {};
    
    // Active status filter
    if (req.query.active === 'true') filter.active = true;
    if (req.query.active === 'false') filter.active = false;
    
    // Search filter (supports multiple fields)
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
    
    // Domain filter
    if (req.query.domain) {
      filter.allowedDomains = { $in: [req.query.domain] };
    }
    
    console.log('Applied filter:', filter);
    console.log('Applied sort:', sort);
    
    // Execute query with pagination
    const clients = await Client.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-__v') // Exclude version field
      .lean(); // Use lean for better performance
    
    // Get total count for pagination
    const total = await Client.countDocuments(filter);
    
    // Calculate additional statistics
    const stats = {
      totalActive: await Client.countDocuments({ ...filter, active: true }),
      totalInactive: await Client.countDocuments({ ...filter, active: false }),
      totalRequests: clients.reduce((sum, client) => sum + (client.requestCount || 0), 0)
    };
    
    const response = {
      clients: clients.map(client => ({
        ...client,
        // Add computed fields
        domainCount: client.allowedDomains ? client.allowedDomains.length : 0,
        hasRestrictions: client.allowedDomains && client.allowedDomains.length > 0,
        lastActiveFormatted: client.lastRequestDate ? client.lastRequestDate.toISOString() : null
      })),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      },
      stats,
      filters: {
        applied: Object.keys(filter).length > 0 ? filter : null,
        available: ['active', 'search', 'createdAfter', 'createdBefore', 'domain']
      }
    };
    
    console.log(`Returning ${clients.length} clients (page ${page} of ${Math.ceil(total / limit)})`);
    res.json(response);
    
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to fetch clients'
    });
  }
});

/**
 * @route   POST /api/clients
 * @desc    Create a new client with enhanced validation
 * @access  Admin only
 */
router.post('/', verifyAdmin, async (req, res) => {
  try {
    console.log('Creating new client:', req.body);
    
    const { name, email, allowedDomains, widgetId, customization } = req.body;
    
    // Enhanced validation
    if (!name || !email) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: 'Name and email are required fields',
        received: { name: name || 'missing', email: email || 'missing' }
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
            invalidDomain: domain,
            message: 'Domain names must be valid DNS names'
          });
        }
      }
    }
    
    // Generate a unique client ID
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
    
    // Create new client with enhanced configuration
    const clientData = {
      clientId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      allowedDomains: allowedDomains ? allowedDomains.filter(d => d && d.trim()) : [],
      chatbotConfig: {
        widgetId: finalWidgetId,
        customization: {
          primaryColor: customization?.primaryColor || '#0084ff',
          secondaryColor: customization?.secondaryColor || '#ffffff',
          headerText: customization?.headerText || 'Chat with us',
          botName: customization?.botName || 'Assistant',
          logoUrl: customization?.logoUrl || '',
          ...customization
        }
      }
    };
    
    const newClient = new Client(clientData);
    await newClient.save();
    
    console.log(`Client created successfully: ${clientId}`);
    
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
        requestCount: 0
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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to create client'
    });
  }
});

/**
 * @route   GET /api/clients/:clientId
 * @desc    Get a single client by ID with detailed information
 * @access  Admin only
 */
router.get('/:clientId', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    console.log(`Fetching client: ${clientId}`);
    
    const client = await Client.findOne({ clientId })
      .select('-__v')
      .lean();
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    // Add computed fields
    const enhancedClient = {
      ...client,
      domainCount: client.allowedDomains ? client.allowedDomains.length : 0,
      hasRestrictions: client.allowedDomains && client.allowedDomains.length > 0,
      daysSinceCreated: Math.floor((new Date() - new Date(client.createdAt)) / (1000 * 60 * 60 * 24)),
      lastActiveFormatted: client.lastRequestDate ? client.lastRequestDate.toISOString() : null,
      averageRequestsPerDay: client.requestCount && client.createdAt ? 
        (client.requestCount / Math.max(1, Math.floor((new Date() - new Date(client.createdAt)) / (1000 * 60 * 60 * 24)))).toFixed(2) : 0
    };
    
    res.json({ 
      client: enhancedClient
    });
    
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to fetch client'
    });
  }
});

/**
 * @route   PUT /api/clients/:clientId
 * @desc    Update a client with enhanced validation
 * @access  Admin only
 */
router.put('/:clientId', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { name, email, customization, active, allowedDomains, widgetId } = req.body;
    
    console.log(`Updating client: ${clientId}`, req.body);
    
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
      active: client.active
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
      
      // Check if new email already exists
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
    
    // Update basic fields if provided
    if (name) client.name = name.trim();
    if (email) client.email = email.toLowerCase().trim();
    if (typeof active === 'boolean') client.active = active;
    if (allowedDomains) client.allowedDomains = allowedDomains.filter(d => d && d.trim());
    if (widgetId) client.chatbotConfig.widgetId = widgetId;
    
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
        requestCount: client.requestCount
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Client update error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ 
        error: 'Validation failed',
        details: messages
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to update client'
    });
  }
});

/**
 * @route   DELETE /api/clients/:clientId
 * @desc    Delete a client with confirmation
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
    
    // Require confirmation for deletion
    if (confirm !== 'true') {
      return res.status(400).json({
        error: 'Confirmation required',
        message: 'Add ?confirm=true to the URL to confirm deletion',
        client: {
          clientId: client.clientId,
          name: client.name,
          requestCount: client.requestCount,
          active: client.active
        }
      });
    }
    
    // Store client info before deletion
    const deletedClientInfo = {
      clientId: client.clientId,
      name: client.name,
      email: client.email,
      requestCount: client.requestCount,
      createdAt: client.createdAt,
      lastRequestDate: client.lastRequestDate
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
 * @route   GET /api/clients/:clientId/stats
 * @desc    Get detailed client usage statistics
 * @access  Admin only
 */
router.get('/:clientId/stats', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    // Calculate detailed statistics
    const now = new Date();
    const createdAt = new Date(client.createdAt);
    const daysSinceCreated = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
    const averageRequestsPerDay = daysSinceCreated > 0 ? (client.requestCount / daysSinceCreated).toFixed(2) : 0;
    
    // Calculate recent activity (if lastRequestDate exists)
    let daysSinceLastRequest = null;
    if (client.lastRequestDate) {
      daysSinceLastRequest = Math.floor((now - new Date(client.lastRequestDate)) / (1000 * 60 * 60 * 24));
    }
    
    const stats = {
      clientId,
      name: client.name,
      email: client.email,
      basic: {
        totalRequests: client.requestCount || 0,
        active: client.active,
        createdAt: client.createdAt,
        lastRequestDate: client.lastRequestDate,
        daysSinceCreated: daysSinceCreated,
        daysSinceLastRequest: daysSinceLastRequest
      },
      usage: {
        averageRequestsPerDay: parseFloat(averageRequestsPerDay),
        requestsThisMonth: client.requestCount || 0, // Would need more detailed tracking for accurate monthly stats
        status: daysSinceLastRequest === null ? 'never_used' : 
                daysSinceLastRequest <= 1 ? 'very_active' :
                daysSinceLastRequest <= 7 ? 'active' :
                daysSinceLastRequest <= 30 ? 'moderate' : 'inactive'
      },
      configuration: {
        widgetId: client.chatbotConfig.widgetId,
        domainRestrictions: client.allowedDomains && client.allowedDomains.length > 0,
        allowedDomains: client.allowedDomains || [],
        customization: client.chatbotConfig.customization
      },
      timeline: {
        created: client.createdAt,
        lastUpdated: client.updatedAt,
        lastRequest: client.lastRequestDate
      }
    };
    
    res.json(stats);
    
  } catch (error) {
    console.error('Stats retrieval error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to get client stats'
    });
  }
});

/**
 * @route   POST /api/clients/:clientId/reset-stats
 * @desc    Reset client usage statistics
 * @access  Admin only
 */
router.post('/:clientId/reset-stats', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { confirm } = req.body;
    
    if (!confirm) {
      return res.status(400).json({
        error: 'Confirmation required',
        message: 'Set confirm: true in request body to reset statistics'
      });
    }
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ 
        error: 'Client not found',
        clientId: clientId
      });
    }
    
    const oldStats = {
      requestCount: client.requestCount,
      lastRequestDate: client.lastRequestDate
    };
    
    // Reset statistics
    client.requestCount = 0;
    client.lastRequestDate = null;
    client.updatedAt = new Date();
    
    await client.save();
    
    console.log(`Statistics reset for client: ${clientId}`);
    
    res.json({
      message: 'Statistics reset successfully',
      clientId: clientId,
      previousStats: oldStats,
      resetAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Stats reset error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to reset statistics'
    });
  }
});

/**
 * @route   POST /api/clients/:clientId/test-domain
 * @desc    Test if a domain is allowed for a client
 * @access  Admin only
 */
router.post('/:clientId/test-domain', verifyAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { domain } = req.body;
    
    if (!domain) {
      return res.status(400).json({
        error: 'Domain is required',
        message: 'Provide a domain to test'
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
    const hasRestrictions = client.allowedDomains && client.allowedDomains.length > 0;
    
    res.json({
      clientId: clientId,
      domain: domain,
      allowed: isAllowed,
      hasRestrictions: hasRestrictions,
      allowedDomains: client.allowedDomains || [],
      message: isAllowed ? 
        'Domain is allowed' : 
        hasRestrictions ? 'Domain is not in the allowed list' : 'No domain restrictions configured'
    });
    
  } catch (error) {
    console.error('Domain test error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to test domain'
    });
  }
});

/**
 * @route   GET /api/clients/search/:query
 * @desc    Search clients by various fields
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
    .select('clientId name email active requestCount lastRequestDate createdAt allowedDomains')
    .lean();
    
    const results = clients.map(client => ({
      ...client,
      matchType: 
        client.name.toLowerCase().includes(query.toLowerCase()) ? 'name' :
        client.email.toLowerCase().includes(query.toLowerCase()) ? 'email' :
        client.clientId.toLowerCase().includes(query.toLowerCase()) ? 'clientId' :
        'other'
    }));
    
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
 * @desc    Update multiple clients at once
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
    const allowedFields = ['active', 'allowedDomains'];
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
      updates: updates
    });
    
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Bulk update failed'
    });
  }
});

module.exports = router;