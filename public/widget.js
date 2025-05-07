/**
 * ChatBot Leasing Widget
 * Production-ready implementation for embedding TestMyPrompt chatbots
 */

(function() {
  'use strict';

  // Configuration
  const SERVER_URL = 'https://chatbott-5579.onrender.com';
  const WIDGET_VERSION = '1.0.2';
  
  // Widget state
  let isWidgetInitialized = false;
  let currentTokenData = null;
  let tokenRefreshTimeout = null;
  let connectionErrorCount = 0;
  let originalWidgetScript = null;
  
  // Error messages
  const ERROR_MESSAGES = {
    TOKEN_EXPIRED: 'Your session has expired. Please refresh to continue chatting.',
    DOMAIN_NOT_AUTHORIZED: 'This website is not authorized to use this chatbot.',
    CONNECTION_ERROR: 'Unable to connect to the chat service. Please try again later.',
    INITIALIZATION_ERROR: 'Failed to initialize the chat widget. Please refresh the page.',
    CLIENT_INACTIVE: 'This chatbot is currently inactive. Please contact the administrator.'
  };
  
  // Default customization options
  const DEFAULT_CUSTOMIZATION = {
    primaryColor: '#0084ff',
    secondaryColor: '#ffffff',
    headerText: 'Chat with us',
    botName: 'Assistant',
    position: 'right'
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
        clientId: config.clientId,
        config: config.config || {}
      };
      
      // Start initialization process
      validateAndLoadOriginalWidget(config);
      
      return this;
    },
    
    // Get current version
    getVersion: function() {
      return WIDGET_VERSION;
    },
    
    // Set debug mode
    debug: false
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
      
      // Load the original TestMyPrompt widget
      const widgetId = data.config.widgetId;
      loadOriginalWidget(widgetId, data.config.customization);
      
      // Set up token refresh timer
      setupTokenRefresh();
      
      // Mark as initialized
      isWidgetInitialized = true;
      console.log('[MyChatWidget] Initialized successfully (v' + WIDGET_VERSION + ')');
    })
    .catch(error => {
      console.error('[MyChatWidget] Initialization error:', error);
      
      // Handle specific errors
      if (error.message === 'token_expired') {
        console.error('[MyChatWidget] Token has expired');
        if (window.MyChatWidget.debug) {
          showErrorNotification(ERROR_MESSAGES.TOKEN_EXPIRED);
        }
      } else if (error.message === 'domain_not_authorized') {
        console.error('[MyChatWidget] This domain is not authorized to use this chatbot');
        if (window.MyChatWidget.debug) {
          showErrorNotification(ERROR_MESSAGES.DOMAIN_NOT_AUTHORIZED);
        }
      }
    });
  }
  
  // Load the original TestMyPrompt widget
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
        // Apply any customization
        const widgetOptions = {
          widgetId: widgetId,
          // Auto-open if specified
          autoOpen: currentTokenData.config.autoOpen || false
        };
        
        // Apply customization if available
        if (customization) {
          // Map our customization to TestMyPrompt options if needed
          // This depends on what options TestMyPrompt accepts
          if (customization.primaryColor) {
            widgetOptions.primaryColor = customization.primaryColor;
          }
          if (customization.headerText) {
            widgetOptions.headerText = customization.headerText;
          }
        }
        
        window.AIChatWidget.init(widgetOptions);
        console.log('[MyChatWidget] Original widget loaded successfully');
      } else {
        console.error('[MyChatWidget] Failed to find original widget initialization function');
      }
    };
  }
  
  // Set up token refresh timer
  function setupTokenRefresh() {
    // Clear any existing timeout
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
    
    // Schedule token refresh for 5 minutes before expiration
    // Assuming token is set to expire in 1 hour (3600000 ms)
    const refreshTime = 55 * 60 * 1000; // 55 minutes
    
    tokenRefreshTimeout = setTimeout(() => {
      refreshTokenInternal()
        .catch(error => {
          console.error('[MyChatWidget] Scheduled token refresh failed:', error);
          if (window.MyChatWidget.debug) {
            showErrorNotification(ERROR_MESSAGES.TOKEN_EXPIRED);
          }
        });
    }, refreshTime);
  }
  
  // Refresh token internal implementation
  function refreshTokenInternal() {
    return fetch(`${SERVER_URL}/api/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId: currentTokenData.clientId
      })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      if (data && data.token) {
        // Update current token
        currentTokenData.token = data.token;
        
        // Set up next refresh
        setupTokenRefresh();
        
        console.log('[MyChatWidget] Token refreshed successfully');
        return data.token;
      } else {
        throw new Error('Invalid token response');
      }
    });
  }
  
  // Show error notification (only in debug mode)
  function showErrorNotification(message) {
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
  
  // Add additional functionality to MyChatWidget object
  Object.assign(window.MyChatWidget, {
    refresh: function() {
      return refreshTokenInternal().then(() => {
        // Reload widget with fresh token
        if (currentTokenData && isWidgetInitialized) {
          return validateAndLoadOriginalWidget({
            token: currentTokenData.token,
            clientId: currentTokenData.clientId,
            config: currentTokenData.config
          });
        }
        return Promise.resolve();
      });
    },
    
    destroy: function() {
      if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
        tokenRefreshTimeout = null;
      }
      
      // Clean up any TestMyPrompt elements if possible
      if (window.AIChatWidget && typeof window.AIChatWidget.destroy === 'function') {
        window.AIChatWidget.destroy();
      }
      
      // Remove the script
      if (originalWidgetScript && originalWidgetScript.parentNode) {
        originalWidgetScript.parentNode.removeChild(originalWidgetScript);
      }
      
      isWidgetInitialized = false;
      currentTokenData = null;
      
      console.log('[MyChatWidget] Widget destroyed');
    }
  });
  
  // Log initialization
  console.log('[MyChatWidget] Widget script loaded (v' + WIDGET_VERSION + ')');
})();