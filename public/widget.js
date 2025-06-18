/**
 * ChatBot Leasing Widget
 * Production-ready implementation for embedding TestMyPrompt chatbots
 */

(function() {
  'use strict';

  // Configuration
  const SERVER_URL = 'https://chatbott-5579.onrender.com';
  const WIDGET_VERSION = '1.0.3';
  
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
    CLIENT_INACTIVE: 'This chatbot is currently inactive. Please contact the administrator.',
    SCRIPT_LOAD_ERROR: 'Failed to load the chat widget. Please try refreshing the page.'
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
        showErrorNotification(ERROR_MESSAGES.INITIALIZATION_ERROR);
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
        showErrorNotification(ERROR_MESSAGES.INITIALIZATION_ERROR);
        return;
      }
      
      // Reset connection error count on successful validation
      connectionErrorCount = 0;
      
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
      
      // Increment connection error count
      connectionErrorCount++;
      
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
      } else {
        console.error('[MyChatWidget] Connection error:', error);
        if (window.MyChatWidget.debug) {
          showErrorNotification(ERROR_MESSAGES.CONNECTION_ERROR);
        }
        
        // Retry mechanism for connection errors (max 3 retries)
        if (connectionErrorCount < 3) {
          console.log('[MyChatWidget] Retrying initialization in 5 seconds...');
          setTimeout(() => {
            validateAndLoadOriginalWidget(config);
          }, 5000);
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
    
    // FIXED: Updated TestMyPrompt widget URL format
    // Try multiple possible URL formats for TestMyPrompt
    const possibleUrls = [
      `https://testmyprompt.com/widget.js?id=${widgetId}`,
      `https://testmyprompt.com/widgets/${widgetId}.js`,
      `https://testmyprompt.com/embed/${widgetId}/widget.js`,
      `https://cdn.testmyprompt.com/widget/${widgetId}.js`
    ];
    
    // Try to load the widget with fallback URLs
    tryLoadWidgetScript(possibleUrls, 0, widgetId, customization);
  }
  
  // FIXED: Added fallback mechanism for loading widget script
  function tryLoadWidgetScript(urls, index, widgetId, customization) {
    if (index >= urls.length) {
      console.error('[MyChatWidget] Failed to load widget from all possible URLs');
      showErrorNotification(ERROR_MESSAGES.SCRIPT_LOAD_ERROR);
      return;
    }
    
    const currentUrl = urls[index];
    console.log(`[MyChatWidget] Attempting to load widget from: ${currentUrl}`);
    
    // Create and load the original widget script
    originalWidgetScript = document.createElement('script');
    originalWidgetScript.src = currentUrl;
    originalWidgetScript.async = true;
    
    // FIXED: Added proper error handling for script loading
    originalWidgetScript.onload = function() {
      console.log('[MyChatWidget] Widget script loaded successfully from:', currentUrl);
      
      // Initialize the original widget once loaded
      initializeTestMyPromptWidget(widgetId, customization);
    };
    
    originalWidgetScript.onerror = function(error) {
      console.warn(`[MyChatWidget] Failed to load widget from ${currentUrl}:`, error);
      
      // Remove the failed script
      if (originalWidgetScript && originalWidgetScript.parentNode) {
        originalWidgetScript.parentNode.removeChild(originalWidgetScript);
      }
      
      // Try the next URL
      tryLoadWidgetScript(urls, index + 1, widgetId, customization);
    };
    
    // Add the script to the document
    document.head.appendChild(originalWidgetScript);
  }
  
  // FIXED: Separate function to initialize TestMyPrompt widget
  function initializeTestMyPromptWidget(widgetId, customization) {
    // Wait a bit for the script to fully load and initialize
    setTimeout(() => {
      // Try different possible global objects that TestMyPrompt might use
      const possibleWidgets = [
        window.AIChatWidget,
        window.TestMyPromptWidget,
        window.ChatWidget,
        window.TMPWidget,
        window.testMyPrompt
      ];
      
      let widgetFound = false;
      
      for (let widget of possibleWidgets) {
        if (widget && typeof widget.init === 'function') {
          console.log('[MyChatWidget] Found TestMyPrompt widget:', widget);
          
          // Apply customization and initialize
          const widgetOptions = {
            widgetId: widgetId,
            autoOpen: currentTokenData.config.autoOpen || false,
            ...customization
          };
          
          try {
            widget.init(widgetOptions);
            console.log('[MyChatWidget] TestMyPrompt widget initialized successfully');
            widgetFound = true;
            break;
          } catch (error) {
            console.error('[MyChatWidget] Error initializing TestMyPrompt widget:', error);
          }
        }
      }
      
      if (!widgetFound) {
        console.error('[MyChatWidget] TestMyPrompt widget not found or not properly loaded');
        
        // Try to initialize using a generic approach
        tryGenericWidgetInitialization(widgetId, customization);
      }
    }, 1000);
  }
  
  // FIXED: Added generic initialization approach
  function tryGenericWidgetInitialization(widgetId, customization) {
    console.log('[MyChatWidget] Attempting generic widget initialization');
    
    // Create a fallback widget container if TestMyPrompt widget fails
    const fallbackContainer = document.createElement('div');
    fallbackContainer.id = 'testmyprompt-widget-fallback';
    fallbackContainer.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        background-color: ${customization?.primaryColor || '#0084ff'};
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 24px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 9999;
        transition: all 0.3s ease;
      " onclick="window.open('https://testmyprompt.com/chat/${widgetId}', '_blank', 'width=400,height=600')">
        💬
      </div>
    `;
    
    document.body.appendChild(fallbackContainer);
    console.log('[MyChatWidget] Fallback widget created');
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
  
  // Show error notification (enhanced with better styling)
  function showErrorNotification(message) {
    console.error('[MyChatWidget] Error:', message);
    
    // Remove any existing notifications
    const existingNotification = document.getElementById('mychatwidget-error-notification');
    if (existingNotification) {
      existingNotification.remove();
    }
    
    // Create a small notification that auto-dismisses
    const notification = document.createElement('div');
    notification.id = 'mychatwidget-error-notification';
    notification.style.position = 'fixed';
    notification.style.bottom = '20px';
    notification.style.right = '20px';
    notification.style.backgroundColor = '#f44336';
    notification.style.color = 'white';
    notification.style.padding = '12px 20px';
    notification.style.borderRadius = '6px';
    notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    notification.style.zIndex = '10000';
    notification.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    notification.style.fontSize = '14px';
    notification.style.maxWidth = '300px';
    notification.style.lineHeight = '1.4';
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(10px)';
    notification.style.transition = 'all 0.3s ease';
    notification.textContent = message;
    
    // Add close button
    const closeButton = document.createElement('span');
    closeButton.innerHTML = '&times;';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '5px';
    closeButton.style.right = '10px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.fontSize = '18px';
    closeButton.style.fontWeight = 'bold';
    closeButton.onclick = () => notification.remove();
    notification.appendChild(closeButton);
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateY(0)';
    }, 10);
    
    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(10px)';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }
    }, 8000);
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
      const possibleWidgets = [
        window.AIChatWidget,
        window.TestMyPromptWidget,
        window.ChatWidget,
        window.TMPWidget,
        window.testMyPrompt
      ];
      
      for (let widget of possibleWidgets) {
        if (widget && typeof widget.destroy === 'function') {
          try {
            widget.destroy();
          } catch (error) {
            console.warn('[MyChatWidget] Error destroying widget:', error);
          }
        }
      }
      
      // Remove the script
      if (originalWidgetScript && originalWidgetScript.parentNode) {
        originalWidgetScript.parentNode.removeChild(originalWidgetScript);
      }
      
      // Remove fallback widget if it exists
      const fallbackWidget = document.getElementById('testmyprompt-widget-fallback');
      if (fallbackWidget) {
        fallbackWidget.remove();
      }
      
      // Remove any error notifications
      const errorNotification = document.getElementById('mychatwidget-error-notification');
      if (errorNotification) {
        errorNotification.remove();
      }
      
      isWidgetInitialized = false;
      currentTokenData = null;
      connectionErrorCount = 0;
      
      console.log('[MyChatWidget] Widget destroyed');
    },
    
    // FIXED: Added method to manually show/hide widget
    show: function() {
      const possibleWidgets = [
        window.AIChatWidget,
        window.TestMyPromptWidget,
        window.ChatWidget,
        window.TMPWidget,
        window.testMyPrompt
      ];
      
      for (let widget of possibleWidgets) {
        if (widget && typeof widget.show === 'function') {
          widget.show();
          return;
        }
      }
      
      // Show fallback widget if exists
      const fallbackWidget = document.getElementById('testmyprompt-widget-fallback');
      if (fallbackWidget) {
        fallbackWidget.style.display = 'flex';
      }
    },
    
    hide: function() {
      const possibleWidgets = [
        window.AIChatWidget,
        window.TestMyPromptWidget,
        window.ChatWidget,
        window.TMPWidget,
        window.testMyPrompt
      ];
      
      for (let widget of possibleWidgets) {
        if (widget && typeof widget.hide === 'function') {
          widget.hide();
          return;
        }
      }
      
      // Hide fallback widget if exists
      const fallbackWidget = document.getElementById('testmyprompt-widget-fallback');
      if (fallbackWidget) {
        fallbackWidget.style.display = 'none';
      }
    },
    
    // FIXED: Added method to get widget status
    getStatus: function() {
      return {
        initialized: isWidgetInitialized,
        tokenValid: currentTokenData !== null,
        connectionErrors: connectionErrorCount,
        version: WIDGET_VERSION
      };
    }
  });
  
  // FIXED: Added automatic retry mechanism on page load
  // If the widget fails to initialize, retry after a delay
  window.addEventListener('load', () => {
    if (!isWidgetInitialized && currentTokenData) {
      console.log('[MyChatWidget] Page loaded, retrying widget initialization...');
      setTimeout(() => {
        if (!isWidgetInitialized && currentTokenData) {
          validateAndLoadOriginalWidget({
            token: currentTokenData.token,
            clientId: currentTokenData.clientId,
            config: currentTokenData.config
          });
        }
      }, 2000);
    }
  });
  
  // FIXED: Added visibility change handler to refresh when page becomes visible
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isWidgetInitialized && currentTokenData) {
      // Refresh token when page becomes visible (user returns to tab)
      refreshTokenInternal().catch(error => {
        console.warn('[MyChatWidget] Token refresh on visibility change failed:', error);
      });
    }
  });
  
  // Log initialization
  console.log('[MyChatWidget] Widget script loaded (v' + WIDGET_VERSION + ')');
})();