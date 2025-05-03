// Rate limiting middleware to prevent API abuse
const rateLimit = require('express-rate-limit');

// Configure rate limiting based on environment variables or defaults
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes default
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // 100 requests per windowMs default
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: 'Too many requests, please try again later.' },
  skipSuccessfulRequests: false, // Count successful requests against the rate limit
  keyGenerator: (req) => {
    // Use IP address as default key, fall back to a random identifier if IP is not available
    return req.ip || req.headers['x-forwarded-for'] || Math.random().toString();
  }
});

module.exports = apiLimiter;