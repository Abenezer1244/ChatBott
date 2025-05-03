// Authentication routes for token generation
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { verifyAdmin } = require('../middleware/auth');
const Client = require('../models/Client');

/**
 * @route   POST /api/auth/token
 * @desc    Generate a new token for a client
 * @access  Admin only
 */
router.post('/token', verifyAdmin, async (req, res) => {
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
    }, process.env.JWT_SECRET, { 
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

/**
 * @route   POST /api/auth/verify
 * @desc    Verify a token's validity without increasing usage count
 * @access  Public
 */
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Verify token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
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

module.exports = router;