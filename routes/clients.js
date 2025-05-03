// Client management routes
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { verifyAdmin } = require('../middleware/auth');
const Client = require('../models/Client');

/**
 * @route   GET /api/clients
 * @desc    Get all clients
 * @access  Admin only
 */
router.get('/', verifyAdmin, async (req, res) => {
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

/**
 * @route   POST /api/clients
 * @desc    Create a new client
 * @access  Admin only
 */
router.post('/', verifyAdmin, async (req, res) => {
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

/**
 * @route   GET /api/clients/:clientId
 * @desc    Get a single client by ID
 * @access  Admin only
 */
router.get('/:clientId', verifyAdmin, async (req, res) => {
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

/**
 * @route   PUT /api/clients/:clientId
 * @desc    Update a client
 * @access  Admin only
 */
router.put('/:clientId', verifyAdmin, async (req, res) => {
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

/**
 * @route   DELETE /api/clients/:clientId
 * @desc    Delete a client
 * @access  Admin only
 */
router.delete('/:clientId', verifyAdmin, async (req, res) => {
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

/**
 * @route   GET /api/clients/:clientId/stats
 * @desc    Get client usage statistics
 * @access  Admin only
 */
router.get('/:clientId/stats', verifyAdmin, async (req, res) => {
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

module.exports = router;