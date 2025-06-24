/**
 * ChatBot Leasing Widget - CORRECTED Production Version
 * Real TestMyPrompt integration without fake fallbacks
 */

(function() {
  'use strict';

  // Dynamic server URL detection - Universal solution
  const SERVER_URL = (function() {
    // Only use localhost for actual local development
    // This covers true localhost development only
    const isLocalDev = (window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' ||
                        window.location.hostname === '0.0.0.0') &&
                       (window.location.protocol === 'http:' || window.location.port);
    
    if (isLocalDev) {
      return 'http://localhost:10000';
    }
    
    // For all production, staging, testing, and live environments
    // Always use the production server
    return 'https://chatbott-5579.onrender.com';
  })();
  
  const WIDGET_VERSION = '2.0.0';
  
  // Widget state
  let isWidgetInitialized = false;
  let currentTokenData = null;
  let tokenRefreshTimeout = null;
  let connectionErrorCount = 0;
  let testMyPromptLoaded = false;
  let retryAttempts = 0;
  const MAX_RETRY_ATTEMPTS = 3;
  
  // Error messages
  const ERROR_MESSAGES = {
    TOKEN_EXPIRED: 'Your session has expired. Please refresh to continue chatting.',
    DOMAIN_NOT_AUTHORIZED: 'This website is not authorized to use this chatbot.',
    CONNECTION_ERROR: 'Unable to connect to the chat service. Please try again later.',
    INITIALIZATION_ERROR: 'Failed to initialize the chat widget. Please refresh the page.',
    CLIENT_INACTIVE: 'This chatbot is currently inactive. Please contact the administrator.',
    TESTMYPROMPT_LOAD_ERROR: 'Failed to load the TestMyPrompt widget. Please try refreshing the page.'
  };
  
  // Main widget object
  window.MyChatWidget = {
    init: function(config) {
      if (isWidgetInitialized) {
        console.warn('[MyChatWidget] Widget already initialized');
        return this;
      }
      
      if (!config.token || !config.clientId) {
        console.error('[MyChatWidget] Invalid configuration. Required: token, clientId');
        showErrorNotification(ERROR_MESSAGES.INITIALIZATION_ERROR);
        return this;
      }
      
      currentTokenData = {
        token: config.token,
        clientId: config.clientId,
        config: config.config || {}
      };
      
      console.log('[MyChatWidget] Starting initialization...');
      console.log('[MyChatWidget] Server URL:', SERVER_URL);
      
      initializeWithRetry(config);
      return this;
    },
    
    getVersion: function() {
      return WIDGET_VERSION;
    },
    
    debug: false
  };
  
  // Initialize with retry mechanism
  function initializeWithRetry(config) {
    validateTokenAndInitialize(config)
      .catch(error => {
        console.error('[MyChatWidget] Initialization failed:', error);
        retryAttempts++;
        
        if (retryAttempts < MAX_RETRY_ATTEMPTS) {
          console.log(`[MyChatWidget] Retrying initialization (${retryAttempts}/${MAX_RETRY_ATTEMPTS}) in 3 seconds...`);
          setTimeout(() => {
            initializeWithRetry(config);
          }, 3000);
        } else {
          console.error('[MyChatWidget] Max retry attempts reached');
          showErrorNotification(ERROR_MESSAGES.INITIALIZATION_ERROR);
        }
      });
  }
  
  // Validate token and initialize
  function validateTokenAndInitialize(config) {
    return new Promise((resolve, reject) => {
      console.log('[MyChatWidget] Validating token...');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 15000);
      
      fetch(`${SERVER_URL}/api/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          token: config.token,
          domain: window.location.hostname
        }),
        signal: controller.signal
      })
      .then(response => {
        clearTimeout(timeoutId);
        console.log('[MyChatWidget] Validation response status:', response.status);
        
        if (!response.ok) {
          return response.json().then(errorData => {
            console.error('[MyChatWidget] Validation failed:', errorData);
            if (response.status === 401) {
              throw new Error('token_expired');
            } else if (response.status === 403) {
              throw new Error('domain_not_authorized');
            }
            throw new Error(errorData.error || `HTTP error ${response.status}`);
          });
        }
        return response.json();
      })
      .then(data => {
        clearTimeout(timeoutId);
        console.log('[MyChatWidget] Validation successful:', data);
        
        if (!data || !data.valid) {
          console.error('[MyChatWidget] Invalid token response');
          reject(new Error('Invalid validation response'));
          return;
        }
        
        connectionErrorCount = 0;
        retryAttempts = 0;
        
        const widgetId = data.config.widgetId;
        const customization = data.config.customization || {};
        
        console.log('[MyChatWidget] Loading TestMyPrompt widget with ID:', widgetId);
        
        loadTestMyPromptWidget(widgetId, customization)
          .then(() => {
            setupTokenRefresh();
            isWidgetInitialized = true;
            console.log('[MyChatWidget] Initialized successfully (v' + WIDGET_VERSION + ')');
            resolve();
          })
          .catch(widgetError => {
            console.error('[MyChatWidget] TestMyPrompt widget loading failed:', widgetError);
            reject(widgetError);
          });
      })
      .catch(error => {
        clearTimeout(timeoutId);
        console.error('[MyChatWidget] Validation error:', error);
        
        connectionErrorCount++;
        
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
        } else if (error.name === 'AbortError') {
          console.error('[MyChatWidget] Request timeout');
          if (window.MyChatWidget.debug) {
            showErrorNotification(ERROR_MESSAGES.CONNECTION_ERROR);
          }
        } else {
          console.error('[MyChatWidget] Connection error:', error);
          if (window.MyChatWidget.debug) {
            showErrorNotification(ERROR_MESSAGES.CONNECTION_ERROR);
          }
        }
        
        reject(error);
      });
    });
  }
  
  // Load actual TestMyPrompt widget
  function loadTestMyPromptWidget(widgetId, customization) {
    return new Promise((resolve, reject) => {
      console.log('[MyChatWidget] Loading TestMyPrompt widget:', widgetId);
      
      // Remove any existing TestMyPrompt scripts
      const existingScripts = document.querySelectorAll('script[src*="testmyprompt.com"]');
      existingScripts.forEach(script => script.remove());
      
      // Remove any existing widget containers
      const existingWidget = document.getElementById('testmyprompt-widget-container');
      if (existingWidget) {
        existingWidget.remove();
      }
      
      // Load TestMyPrompt widget script
      const script = document.createElement('script');
      script.src = `https://testmyprompt.com/widget/${widgetId}/widget.js`;
      script.async = true;
      
      // Set up loading timeout
      const loadTimeout = setTimeout(() => {
        console.error('[MyChatWidget] TestMyPrompt script load timeout');
        script.remove();
        reject(new Error('Script load timeout'));
      }, 15000);
      
      script.onload = function() {
        clearTimeout(loadTimeout);
        console.log('[MyChatWidget] TestMyPrompt script loaded successfully');
        
        // Initialize TestMyPrompt widget
        initializeTestMyPromptWidget(widgetId, customization)
          .then(resolve)
          .catch(reject);
      };
      
      script.onerror = function() {
        clearTimeout(loadTimeout);
        console.error('[MyChatWidget] TestMyPrompt script failed to load');
        script.remove();
        reject(new Error('Script load failed'));
      };
      
      // Add script to head
      document.head.appendChild(script);
    });
  }
  
  // Initialize TestMyPrompt widget
  function initializeTestMyPromptWidget(widgetId, customization) {
    return new Promise((resolve, reject) => {
      // Wait for TestMyPrompt to be available
      let attempts = 0;
      const maxAttempts = 30; // 3 seconds total
      
      function checkTestMyPrompt() {
        attempts++;
        
        if (window.AIChatWidget) {
          console.log('[MyChatWidget] AIChatWidget found, initializing...');
          
          try {
            // Initialize with customization if supported
            const initConfig = {
              widgetId: widgetId
            };
            
            // Add customization if TestMyPrompt supports it
            if (customization && Object.keys(customization).length > 0) {
              initConfig.customization = customization;
              initConfig.theme = customization;
              initConfig.config = customization;
            }
            
            window.AIChatWidget.init(initConfig);
            
            console.log('[MyChatWidget] TestMyPrompt widget initialized successfully');
            testMyPromptLoaded = true;
            
            // Track usage
            trackWidgetUsage();
            
            resolve();
            
          } catch (error) {
            console.error('[MyChatWidget] TestMyPrompt initialization error:', error);
            reject(error);
          }
          
        } else if (attempts < maxAttempts) {
          setTimeout(checkTestMyPrompt, 100);
        } else {
          console.error('[MyChatWidget] TestMyPrompt widget not found after timeout');
          reject(new Error('AIChatWidget not found'));
        }
      }
      
      // Start checking for TestMyPrompt
      checkTestMyPrompt();
    });
  }
  
  // Track widget usage
  function trackWidgetUsage() {
    if (!currentTokenData) return;
    
    fetch(`${SERVER_URL}/api/usage/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId: currentTokenData.clientId,
        url: window.location.href,
        referrer: document.referrer || '',
        timestamp: new Date().toISOString()
      })
    }).catch(error => {
      console.warn('[MyChatWidget] Failed to track usage:', error);
    });
  }
  
  // Set up token refresh timer
  function setupTokenRefresh() {
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
    
    const refreshTime = 50 * 60 * 1000; // 50 minutes
    
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
        return response.json().then(errorData => {
          throw new Error(errorData.error || `HTTP error ${response.status}`);
        });
      }
      return response.json();
    })
    .then(data => {
      if (data && data.token) {
        currentTokenData.token = data.token;
        setupTokenRefresh();
        console.log('[MyChatWidget] Token refreshed successfully');
        return data.token;
      } else {
        throw new Error('Invalid token response');
      }
    });
  }
  
  // Error notification
  function showErrorNotification(message) {
    console.error('[MyChatWidget] Error:', message);
    
    const existingNotification = document.getElementById('mychatwidget-error-notification');
    if (existingNotification) {
      existingNotification.remove();
    }
    
    const notification = document.createElement('div');
    notification.id = 'mychatwidget-error-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #ff4757, #ff3838);
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(255, 71, 87, 0.3);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 350px;
      min-width: 250px;
      line-height: 1.4;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
      border-left: 4px solid #ff1744;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="flex-shrink: 0; font-size: 18px;">⚠️</div>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 4px;">Widget Error</div>
          <div style="opacity: 0.9;">${message}</div>
        </div>
        <button id="notification-close" style="
          background: transparent;
          border: none;
          color: white;
          font-size: 18px;
          cursor: pointer;
          padding: 0;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.8;
          transition: opacity 0.2s;
        ">&times;</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    const closeButton = notification.querySelector('#notification-close');
    closeButton.addEventListener('click', () => {
      hideNotification(notification);
    });
    
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 10);
    
    setTimeout(() => {
      if (notification.parentNode) {
        hideNotification(notification);
      }
    }, 8000);
  }
  
  function hideNotification(notification) {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 400);
  }
  
  // Enhanced MyChatWidget object with additional functionality
  Object.assign(window.MyChatWidget, {
    refresh: function() {
      return refreshTokenInternal().then(() => {
        if (currentTokenData && isWidgetInitialized) {
          return validateTokenAndInitialize({
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
      
      // Remove TestMyPrompt scripts
      const scripts = document.querySelectorAll('script[src*="testmyprompt.com"]');
      scripts.forEach(script => script.remove());
      
      // Remove error notifications
      const errorNotification = document.getElementById('mychatwidget-error-notification');
      if (errorNotification) {
        errorNotification.remove();
      }
      
      // Destroy TestMyPrompt widget if available
      if (window.AIChatWidget && typeof window.AIChatWidget.destroy === 'function') {
        try {
          window.AIChatWidget.destroy();
        } catch (error) {
          console.warn('[MyChatWidget] Error destroying TestMyPrompt widget:', error);
        }
      }
      
      // Reset state
      isWidgetInitialized = false;
      currentTokenData = null;
      connectionErrorCount = 0;
      testMyPromptLoaded = false;
      retryAttempts = 0;
      
      console.log('[MyChatWidget] Widget destroyed successfully');
    },
    
    show: function() {
      if (window.AIChatWidget && typeof window.AIChatWidget.show === 'function') {
        window.AIChatWidget.show();
      }
    },
    
    hide: function() {
      if (window.AIChatWidget && typeof window.AIChatWidget.hide === 'function') {
        window.AIChatWidget.hide();
      }
    },
    
    toggle: function() {
      if (window.AIChatWidget && typeof window.AIChatWidget.toggle === 'function') {
        window.AIChatWidget.toggle();
      }
    },
    
    getStatus: function() {
      return {
        initialized: isWidgetInitialized,
        tokenValid: currentTokenData !== null,
        connectionErrors: connectionErrorCount,
        version: WIDGET_VERSION,
        serverUrl: SERVER_URL,
        retryAttempts: retryAttempts,
        testMyPromptLoaded: testMyPromptLoaded,
        testMyPromptAvailable: !!window.AIChatWidget
      };
    },
    
    getToken: function() {
      if (this.debug && currentTokenData) {
        return currentTokenData.token;
      }
      return null;
    }
  });
  
  // Page lifecycle handling
  window.addEventListener('load', () => {
    if (!isWidgetInitialized && currentTokenData) {
      console.log('[MyChatWidget] Page loaded, retrying widget initialization...');
      setTimeout(() => {
        if (!isWidgetInitialized && currentTokenData) {
          initializeWithRetry({
            token: currentTokenData.token,
            clientId: currentTokenData.clientId,
            config: currentTokenData.config
          });
        }
      }, 2000);
    }
  });
  
  // Handle visibility change for token refresh
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isWidgetInitialized && currentTokenData) {
      refreshTokenInternal().catch(error => {
        console.warn('[MyChatWidget] Token refresh on visibility change failed:', error);
      });
    }
  });
  
  // Handle page unload
  window.addEventListener('beforeunload', () => {
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
  });
  
  // Global error handler for widget-related errors
  window.addEventListener('error', (event) => {
    if (event.filename && (event.filename.includes('widget') || event.filename.includes('testmyprompt'))) {
      console.error('[MyChatWidget] Widget script error:', event.error);
      if (window.MyChatWidget.debug) {
        showErrorNotification('Widget script error detected');
      }
    }
  });
  
  // Performance monitoring
  if (window.performance && window.performance.mark) {
    window.performance.mark('mychatwidget-script-loaded');
  }
  
  console.log('[MyChatWidget] Enhanced widget script loaded (v' + WIDGET_VERSION + ')');
  console.log('[MyChatWidget] Server URL configured as:', SERVER_URL);
  
  // Development debugging utilities
  if (window.location.hostname === 'localhost' || 
      window.location.hostname.includes('dev') || 
      window.location.hostname.includes('staging')) {
    window.MyChatWidget.debug = true;
    window.MyChatWidget._debugUtils = {
      showNotification: showErrorNotification,
      trackUsage: trackWidgetUsage,
      getCurrentToken: () => currentTokenData,
      getConnectionErrors: () => connectionErrorCount,
      getServerUrl: () => SERVER_URL,
      validateToken: () => {
        if (currentTokenData) {
          return validateTokenAndInitialize({
            token: currentTokenData.token,
            clientId: currentTokenData.clientId,
            config: currentTokenData.config
          });
        }
        return Promise.reject('No token data available');
      },
      reinitialize: () => {
        if (currentTokenData) {
          retryAttempts = 0;
          return initializeWithRetry({
            token: currentTokenData.token,
            clientId: currentTokenData.clientId,
            config: currentTokenData.config
          });
        }
        return Promise.reject('No token data available');
      }
    };
    console.log('[MyChatWidget] Debug mode enabled');
  }
  
})();