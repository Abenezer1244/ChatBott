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
// FIXED: Changed from '/validate' to '/' since this router is already mounted on /api
router.post('/', async (req, res) => {
  try {
    // Add logging to debug the request
    console.log('Validate route called. Request body:', req.body);
    
    // Handle case where req.body might be undefined
    if (!req.body) {
      return res.status(400).json({ error: 'Request body is missing' });
    }
    
    const { token, domain } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify token
    let decodedToken;
    try {
      decodedToken = jwt.verify(token, process.env.JWT_SECRET);
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

/**
 * @route   POST /api/usage/track
 * @desc    Track widget usage
 * @access  Public
 */
router.post('/usage/track', async (req, res) => {
  try {
    const { clientId, url, referrer } = req.body;
    
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID is required' });
    }
    
    // Find the client
    const client = await Client.findOne({ clientId });
    
    if (client) {
      // Update usage stats
      client.requestCount += 1;
      client.lastRequestDate = new Date();
      
      // Could add more detailed analytics here
      
      await client.save();
    }
    
    // Always return success, even if client not found
    // This prevents leaking information
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Usage tracking error:', error);
    // Still return success to prevent errors in the beacon call
    res.status(200).json({ success: true });
  }
});

/**
 * @route   GET /api/health
 * @desc    Health check endpoint
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

module.exports = router;