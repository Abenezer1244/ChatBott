/**
 * ChatBot Leasing Widget - Simplified Direct Integration
 * This script directly loads the TestMyPrompt widget after token validation
 */

(function() {
  'use strict';

  // Configuration - replace with your actual deployment URL
  const SERVER_URL = 'https://chatbott-5579.onrender.com';
  
  // Version tracking for cache busting and debugging
  const WIDGET_VERSION = '1.0.2';
  
  // Widget state
  let isWidgetInitialized = false;
  let currentTokenData = null;
  let originalWidgetScript = null;
  
  // Error messages
  const ERROR_MESSAGES = {
    TOKEN_EXPIRED: 'Your session has expired. Please refresh to continue chatting.',
    DOMAIN_NOT_AUTHORIZED: 'This website is not authorized to use this chatbot.',
    CONNECTION_ERROR: 'Unable to connect to the chat service. Please try again later.',
    INITIALIZATION_ERROR: 'Failed to initialize the chat widget. Please refresh the page.',
    CLIENT_INACTIVE: 'This chatbot is currently inactive. Please contact the administrator.'
  };
  
  // Main widget object
  window.MyChatWidget = {
    // Public initialization method
    init: function(config) {
      // Prevent multiple initializations
      if (isWidgetInitialized) {
        console.warn('[MyChatWidget] Widget already initialized');
        return this;
      }
      
      // Validate required configuration
      if (!config.token || !config.clientId) {
        console.error('[MyChatWidget] Invalid widget configuration. Required parameters: token, clientId');
        return this;
      }
      
      // Store token data
      currentTokenData = {
        token: config.token,
        clientId: config.clientId
      };
      
      // Start initialization process
      validateAndLoadOriginalWidget(config);
      
      return this;
    },
    
    // Get current version
    getVersion: function() {
      return WIDGET_VERSION;
    }
  };
  
  // Validate token and load the original widget
  function validateAndLoadOriginalWidget(config) {
    console.log('[MyChatWidget] Validating token and loading original widget...');
    
    // Validate token with the server
    fetch(`${SERVER_URL}/api/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: config.token,
        domain: window.location.hostname
      })
    })
    .then(response => {
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('token_expired');
        } else if (response.status === 403) {
          throw new Error('domain_not_authorized');
        }
        throw new Error(`HTTP error ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (!data || !data.valid) {
        console.error('[MyChatWidget] Invalid token response');
        return;
      }
      
      // Load the original TestMyPrompt widget directly
      const widgetId = data.config.widgetId;
      loadOriginalWidget(widgetId, data.config.customization);
      
      // Mark as initialized
      isWidgetInitialized = true;
      console.log('[MyChatWidget] Initialized successfully (v' + WIDGET_VERSION + ')');
      
      // Update usage tracking
      trackUsage(config.clientId);
    })
    .catch(error => {
      console.error('[MyChatWidget] Initialization error:', error);
      
      // Handle specific errors
      if (error.message === 'token_expired') {
        console.error('[MyChatWidget] Token has expired');
        showErrorNotification(ERROR_MESSAGES.TOKEN_EXPIRED);
      } else if (error.message === 'domain_not_authorized') {
        console.error('[MyChatWidget] This domain is not authorized to use this chatbot');
        showErrorNotification(ERROR_MESSAGES.DOMAIN_NOT_AUTHORIZED);
      } else {
        showErrorNotification(ERROR_MESSAGES.INITIALIZATION_ERROR);
      }
    });
  }
  
  // Load the original TestMyPrompt widget directly
  function loadOriginalWidget(widgetId, customization) {
    // Remove any previous instances of the script
    if (originalWidgetScript && originalWidgetScript.parentNode) {
      originalWidgetScript.parentNode.removeChild(originalWidgetScript);
    }
    
    // Create and load the original widget script
    originalWidgetScript = document.createElement('script');
    originalWidgetScript.src = `https://testmyprompt.com/widget/${widgetId}/widget.js`;
    originalWidgetScript.async = true;
    
    // Add the script to the document
    document.body.appendChild(originalWidgetScript);
    
    // Initialize the original widget once loaded
    originalWidgetScript.onload = function() {
      if (window.AIChatWidget) {
        window.AIChatWidget.init({
          widgetId: widgetId,
          // Auto-open if specified
          autoOpen: currentTokenData.autoOpen || false,
          // Pass any other configuration options directly to TestMyPrompt
          ...currentTokenData.config
        });
        
        console.log('[MyChatWidget] Original widget loaded successfully');
      } else {
        console.error('[MyChatWidget] Failed to find original widget initialization function');
        showErrorNotification(ERROR_MESSAGES.INITIALIZATION_ERROR);
      }
    };
  }
  
  // Track usage for analytics
  function trackUsage(clientId) {
    // Simple ping to track usage
    navigator.sendBeacon(`${SERVER_URL}/api/usage/track`, JSON.stringify({
      clientId: clientId,
      timestamp: new Date().toISOString(),
      url: window.location.hostname,
      referrer: document.referrer || 'direct'
    }));
  }
  
  // Show error notification
  function showErrorNotification(message) {
    // Only show in development or with debug flag
    if (window.MyChatWidget.debug) {
      console.error('[MyChatWidget] Error:', message);
      
      // Create a small notification that auto-dismisses
      const notification = document.createElement('div');
      notification.style.position = 'fixed';
      notification.style.bottom = '20px';
      notification.style.right = '20px';
      notification.style.backgroundColor = '#f44336';
      notification.style.color = 'white';
      notification.style.padding = '10px 20px';
      notification.style.borderRadius = '4px';
      notification.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
      notification.style.zIndex = '9999';
      notification.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      notification.style.fontSize = '14px';
      notification.textContent = message;
      
      document.body.appendChild(notification);
      
      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 5000);
    }
  }
  
  // Add debug mode
  window.MyChatWidget.debug = false;
  
  // Log initialization
  console.log('[MyChatWidget] Direct integration widget loaded (v' + WIDGET_VERSION + ')');
})();