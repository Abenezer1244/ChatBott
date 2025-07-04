/**
 * ChatBot Leasing Widget - COMPLETE LEASE MANAGEMENT VERSION
 * Production-ready implementation with comprehensive lease handling
 */

(function() {
  'use strict';

  // Dynamic server URL detection - Universal solution
  const SERVER_URL = (function() {
    // Only use localhost for actual local development
    const isLocalDev = (window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' ||
                        window.location.hostname === '0.0.0.0') &&
                       (window.location.protocol === 'http:' || window.location.port);
    
    if (isLocalDev) {
      return 'http://localhost:10000';
    }
    
    // For all production, staging, testing, and live environments
    return 'https://chatbott-5579.onrender.com';
  })();
  
  const WIDGET_VERSION = '2.1.0';
  
  // Widget state management
  let isWidgetInitialized = false;
  let currentTokenData = null;
  let tokenRefreshTimeout = null;
  let connectionErrorCount = 0;
  let testMyPromptLoaded = false;
  let retryAttempts = 0;
  let leaseStatus = null;
  let leaseCheckInterval = null;
  let expirationWarningShown = false;
  const MAX_RETRY_ATTEMPTS = 3;
  const LEASE_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
  
  // Error and notification messages
  const MESSAGES = {
    LEASE_EXPIRED: 'Your chatbot lease has expired. Please contact support to renew your service.',
    LEASE_EXPIRING: 'Your chatbot lease is expiring soon. Please contact support to renew.',
    TOKEN_EXPIRED: 'Your session has expired. Please refresh to continue chatting.',
    DOMAIN_NOT_AUTHORIZED: 'This website is not authorized to use this chatbot.',
    CONNECTION_ERROR: 'Unable to connect to the chat service. Please try again later.',
    INITIALIZATION_ERROR: 'Failed to initialize the chat widget. Please refresh the page.',
    CLIENT_INACTIVE: 'This chatbot is currently inactive. Please contact the administrator.',
    TESTMYPROMPT_LOAD_ERROR: 'Failed to load the TestMyPrompt widget. Please try refreshing the page.'
  };
  
  // Main widget object
  window.MyChatWidget = {
    /**
     * Initialize the chat widget with lease management
     */
    init: function(config) {
      if (isWidgetInitialized) {
        console.warn('[MyChatWidget] Widget already initialized');
        return this;
      }
      
      if (!config.token || !config.clientId) {
        console.error('[MyChatWidget] Invalid configuration. Required: token, clientId');
        showErrorNotification(MESSAGES.INITIALIZATION_ERROR);
        return this;
      }
      
      currentTokenData = {
        token: config.token,
        clientId: config.clientId,
        config: config.config || {}
      };
      
      console.log('[MyChatWidget] Starting initialization with lease management...');
      console.log('[MyChatWidget] Server URL:', SERVER_URL);
      
      initializeWithRetry(config);
      return this;
    },
    
    /**
     * Get widget version
     */
    getVersion: function() {
      return WIDGET_VERSION;
    },
    
    /**
     * Get current lease status
     */
    getLeaseStatus: function() {
      return leaseStatus;
    },
    
    /**
     * Enable debug mode
     */
    debug: false
  };
  
  /**
   * Initialize widget with retry mechanism
   */
  function initializeWithRetry(config) {
    validateTokenAndInitialize(config)
      .catch(error => {
        console.error('[MyChatWidget] Initialization failed:', error);
        
        // Check if it's a lease expiration error
        if (error.message.includes('lease') || error.message.includes('expired')) {
          showLeaseExpiredMessage();
          return;
        }
        
        retryAttempts++;
        
        if (retryAttempts < MAX_RETRY_ATTEMPTS) {
          console.log(`[MyChatWidget] Retrying initialization (${retryAttempts}/${MAX_RETRY_ATTEMPTS}) in 3 seconds...`);
          setTimeout(() => {
            initializeWithRetry(config);
          }, 3000);
        } else {
          console.error('[MyChatWidget] Max retry attempts reached');
          showErrorNotification(MESSAGES.INITIALIZATION_ERROR);
        }
      });
  }
  
  /**
   * Validate token and initialize widget with comprehensive lease checking
   */
  function validateTokenAndInitialize(config) {
    return new Promise((resolve, reject) => {
      console.log('[MyChatWidget] Validating token and lease status...');
      
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
            
            if (response.status === 403 && errorData.error === 'Lease expired') {
              throw new Error('lease_expired');
            } else if (response.status === 401) {
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
        
        // Store lease status for monitoring
        leaseStatus = data.lease || null;
        console.log('[MyChatWidget] Lease status:', leaseStatus);
        
        // Handle lease warnings
        if (data.warning) {
          console.warn('[MyChatWidget] Lease warning:', data.warning);
          if (leaseStatus.status === 'expiring_soon' && leaseStatus.daysRemaining <= 3) {
            showLeaseExpiringWarning(leaseStatus.daysRemaining);
          } else if (leaseStatus.status === 'grace_period') {
            showGracePeriodWarning();
          }
        }
        
        connectionErrorCount = 0;
        retryAttempts = 0;
        
        const widgetId = data.config.widgetId;
        const customization = data.config.customization || {};
        
        console.log('[MyChatWidget] Loading TestMyPrompt widget with ID:', widgetId);
        
        loadTestMyPromptWidget(widgetId, customization)
          .then(() => {
            setupTokenRefresh();
            setupLeaseMonitoring();
            isWidgetInitialized = true;
            console.log('[MyChatWidget] Initialized successfully with lease management (v' + WIDGET_VERSION + ')');
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
        
        if (error.message === 'lease_expired') {
          console.error('[MyChatWidget] Lease has expired');
          showLeaseExpiredMessage();
        } else if (error.message === 'token_expired') {
          console.error('[MyChatWidget] Token has expired');
          if (window.MyChatWidget.debug) {
            showErrorNotification(MESSAGES.TOKEN_EXPIRED);
          }
        } else if (error.message === 'domain_not_authorized') {
          console.error('[MyChatWidget] Domain not authorized');
          if (window.MyChatWidget.debug) {
            showErrorNotification(MESSAGES.DOMAIN_NOT_AUTHORIZED);
          }
        } else if (error.name === 'AbortError') {
          console.error('[MyChatWidget] Request timeout');
          if (window.MyChatWidget.debug) {
            showErrorNotification(MESSAGES.CONNECTION_ERROR);
          }
        } else {
          console.error('[MyChatWidget] Connection error:', error);
          if (window.MyChatWidget.debug) {
            showErrorNotification(MESSAGES.CONNECTION_ERROR);
          }
        }
        
        reject(error);
      });
    });
  }
  
  /**
   * Setup continuous lease monitoring
   */
  function setupLeaseMonitoring() {
    if (leaseCheckInterval) {
      clearInterval(leaseCheckInterval);
    }
    
    leaseCheckInterval = setInterval(() => {
      checkLeaseStatus();
    }, LEASE_CHECK_INTERVAL);
    
    console.log('[MyChatWidget] Lease monitoring started - checking every 5 minutes');
  }
  
  /**
   * Check lease status periodically
   */
  function checkLeaseStatus() {
    if (!currentTokenData || !currentTokenData.token) return;
    
    fetch(`${SERVER_URL}/api/lease/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: currentTokenData.token
      })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      const newLeaseStatus = data.lease;
      const oldStatus = leaseStatus ? leaseStatus.status : null;
      
      leaseStatus = newLeaseStatus;
      
      // Handle lease status changes
      if (newLeaseStatus.status === 'expired' && oldStatus !== 'expired') {
        console.error('[MyChatWidget] Lease has expired during session');
        handleLeaseExpiration();
      } else if (newLeaseStatus.status === 'expiring_soon' && newLeaseStatus.daysRemaining <= 1 && !expirationWarningShown) {
        console.warn('[MyChatWidget] Lease expiring very soon');
        showLeaseExpiringWarning(newLeaseStatus.daysRemaining);
        expirationWarningShown = true;
      } else if (newLeaseStatus.status === 'grace_period' && oldStatus !== 'grace_period') {
        console.warn('[MyChatWidget] Lease entered grace period');
        showGracePeriodWarning();
      }
    })
    .catch(error => {
      console.error('[MyChatWidget] Lease status check failed:', error);
    });
  }
  
  /**
   * Handle lease expiration - disable widget and show message
   */
  function handleLeaseExpiration() {
    // Disable the widget immediately
    if (window.AIChatWidget && typeof window.AIChatWidget.hide === 'function') {
      window.AIChatWidget.hide();
    }
    
    // Show expiration message
    showLeaseExpiredMessage();
    
    // Stop all monitoring and refresh timers
    if (leaseCheckInterval) {
      clearInterval(leaseCheckInterval);
      leaseCheckInterval = null;
    }
    
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
      tokenRefreshTimeout = null;
    }
    
    // Mark as not initialized to prevent further use
    isWidgetInitialized = false;
    
    console.log('[MyChatWidget] Widget disabled due to lease expiration');
  }
  
  /**
   * Show lease expired message with prominent styling
   */
  function showLeaseExpiredMessage() {
    // Remove any existing lease notifications
    removeExistingNotifications();
    
    const notification = document.createElement('div');
    notification.id = 'mychatwidget-lease-expired';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #dc3545, #c82333);
      color: white;
      padding: 20px 24px;
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(220, 53, 69, 0.4);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 400px;
      min-width: 300px;
      line-height: 1.5;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.5s cubic-bezier(0.23, 1, 0.32, 1);
      border-left: 5px solid #fff;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 16px;">
        <div style="flex-shrink: 0; font-size: 24px;">⚠️</div>
        <div style="flex: 1;">
          <div style="font-weight: 700; margin-bottom: 8px; font-size: 16px;">Lease Expired</div>
          <div style="opacity: 0.95; margin-bottom: 12px;">${MESSAGES.LEASE_EXPIRED}</div>
          <div style="font-size: 12px; opacity: 0.8;">
            Service will be unavailable until lease renewal.
          </div>
        </div>
        <button id="lease-expired-close" style="
          background: transparent;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.8;
          transition: opacity 0.2s;
        ">&times;</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    const closeButton = notification.querySelector('#lease-expired-close');
    closeButton.addEventListener('click', () => {
      hideNotification(notification);
    });
    
    // Animate in
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 100);
    
    // This notification doesn't auto-hide as it's critical
  }
  
  /**
   * Show lease expiring warning
   */
  function showLeaseExpiringWarning(daysRemaining) {
    removeExistingNotifications();
    
    const notification = document.createElement('div');
    notification.id = 'mychatwidget-lease-expiring';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #fd7e14, #e55100);
      color: white;
      padding: 18px 22px;
      border-radius: 10px;
      box-shadow: 0 10px 35px rgba(253, 126, 20, 0.4);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 380px;
      min-width: 280px;
      line-height: 1.4;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
      border-left: 4px solid #fff;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 14px;">
        <div style="flex-shrink: 0; font-size: 20px;">⏰</div>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 6px;">Lease Expiring Soon</div>
          <div style="opacity: 0.95; margin-bottom: 8px;">
            Your chatbot lease expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}. 
            Please contact support to renew your service.
          </div>
        </div>
        <button id="lease-expiring-close" style="
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
    
    const closeButton = notification.querySelector('#lease-expiring-close');
    closeButton.addEventListener('click', () => {
      hideNotification(notification);
    });
    
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto-hide after 15 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        hideNotification(notification);
      }
    }, 15000);
  }
  
  /**
   * Show grace period warning
   */
  function showGracePeriodWarning() {
    removeExistingNotifications();
    
    const notification = document.createElement('div');
    notification.id = 'mychatwidget-grace-period';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #ffc107, #ff8f00);
      color: #000;
      padding: 18px 22px;
      border-radius: 10px;
      box-shadow: 0 10px 35px rgba(255, 193, 7, 0.4);
      z-index: 10001;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 380px;
      min-width: 280px;
      line-height: 1.4;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.4s cubic-bezier(0.23, 1, 0.32, 1);
      border-left: 4px solid #000;
    `;
    
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 14px;">
        <div style="flex-shrink: 0; font-size: 20px;">🚨</div>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 6px;">Grace Period Active</div>
          <div style="opacity: 0.9; margin-bottom: 8px;">
            Your lease has expired but you're in the grace period. 
            Please renew immediately to avoid service interruption.
          </div>
        </div>
        <button id="grace-period-close" style="
          background: transparent;
          border: none;
          color: #000;
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
    
    const closeButton = notification.querySelector('#grace-period-close');
    closeButton.addEventListener('click', () => {
      hideNotification(notification);
    });
    
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto-hide after 12 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        hideNotification(notification);
      }
    }, 12000);
  }
  
  /**
   * Load actual TestMyPrompt widget
   */
  function loadTestMyPromptWidget(widgetId, customization) {
    return new Promise((resolve, reject) => {
      console.log('[MyChatWidget] Loading TestMyPrompt widget:', widgetId);
      
      // Clean up any existing scripts and containers
      const existingScripts = document.querySelectorAll('script[src*="testmyprompt.com"]');
      existingScripts.forEach(script => script.remove());
      
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
      
      document.head.appendChild(script);
    });
  }
  
  /**
   * Initialize TestMyPrompt widget with configuration
   */
  function initializeTestMyPromptWidget(widgetId, customization) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 30; // 3 seconds total
      
      function checkTestMyPrompt() {
        attempts++;
        
        if (window.AIChatWidget) {
          console.log('[MyChatWidget] AIChatWidget found, initializing...');
          
          try {
            const initConfig = {
              widgetId: widgetId
            };
            
            // Add customization if available
            if (customization && Object.keys(customization).length > 0) {
              initConfig.customization = customization;
              initConfig.theme = customization;
              initConfig.config = customization;
            }
            
            window.AIChatWidget.init(initConfig);
            
            console.log('[MyChatWidget] TestMyPrompt widget initialized successfully');
            testMyPromptLoaded = true;
            
            // Track widget usage
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
      
      checkTestMyPrompt();
    });
  }
  
  /**
   * Track widget usage with lease validation
   */
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
    })
    .then(response => response.json())
    .then(data => {
      if (data.success === false && data.error === 'Lease expired') {
        console.error('[MyChatWidget] Usage tracking blocked - lease expired');
        handleLeaseExpiration();
      }
    })
    .catch(error => {
      console.warn('[MyChatWidget] Failed to track usage:', error);
    });
  }
  
  /**
   * Set up token refresh timer
   */
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
            showErrorNotification(MESSAGES.TOKEN_EXPIRED);
          }
        });
    }, refreshTime);
  }
  
  /**
   * Refresh token internal implementation
   */
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
  
  /**
   * Show generic error notification
   */
  function showErrorNotification(message) {
    console.error('[MyChatWidget] Error:', message);
    
    removeExistingNotifications();
    
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
  
  /**
   * Remove existing notifications to prevent overlap
   */
  function removeExistingNotifications() {
    const existingNotifications = document.querySelectorAll('[id^="mychatwidget-"]');
    existingNotifications.forEach(notification => {
      if (notification.id !== 'mychatwidget-lease-expired') { // Keep critical expired message
        hideNotification(notification);
      }
    });
  }
  
  /**
   * Hide notification with animation
   */
  function hideNotification(notification) {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 400);
  }
  
  // Enhanced MyChatWidget object with lease management methods
  Object.assign(window.MyChatWidget, {
    /**
     * Refresh widget and token
     */
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
    
    /**
     * Destroy widget and clean up all resources
     */
    destroy: function() {
      // Clear all timers
      if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
        tokenRefreshTimeout = null;
      }
      
      if (leaseCheckInterval) {
        clearInterval(leaseCheckInterval);
        leaseCheckInterval = null;
      }
      
      // Remove TestMyPrompt scripts
      const scripts = document.querySelectorAll('script[src*="testmyprompt.com"]');
      scripts.forEach(script => script.remove());
      
      // Remove all widget notifications
      const notifications = document.querySelectorAll('[id^="mychatwidget-"]');
      notifications.forEach(notification => notification.remove());
      
      // Destroy TestMyPrompt widget if available
      if (window.AIChatWidget && typeof window.AIChatWidget.destroy === 'function') {
        try {
          window.AIChatWidget.destroy();
        } catch (error) {
          console.warn('[MyChatWidget] Error destroying TestMyPrompt widget:', error);
        }
      }
      
      // Reset all state variables
      isWidgetInitialized = false;
      currentTokenData = null;
      connectionErrorCount = 0;
      testMyPromptLoaded = false;
      retryAttempts = 0;
      leaseStatus = null;
      expirationWarningShown = false;
      
      console.log('[MyChatWidget] Widget destroyed and cleaned up successfully');
    },
    
    /**
     * Show widget (with lease validation)
     */
    show: function() {
      if (leaseStatus && leaseStatus.status === 'expired') {
        console.warn('[MyChatWidget] Cannot show widget - lease expired');
        showLeaseExpiredMessage();
        return;
      }
      
      if (window.AIChatWidget && typeof window.AIChatWidget.show === 'function') {
        window.AIChatWidget.show();
      }
    },
    
    /**
     * Hide widget
     */
    hide: function() {
      if (window.AIChatWidget && typeof window.AIChatWidget.hide === 'function') {
        window.AIChatWidget.hide();
      }
    },
    
    /**
     * Toggle widget visibility (with lease validation)
     */
    toggle: function() {
      if (leaseStatus && leaseStatus.status === 'expired') {
        console.warn('[MyChatWidget] Cannot toggle widget - lease expired');
        showLeaseExpiredMessage();
        return;
      }
      
      if (window.AIChatWidget && typeof window.AIChatWidget.toggle === 'function') {
        window.AIChatWidget.toggle();
      }
    },
    
    /**
     * Check lease status manually
     */
    checkLease: function() {
      return new Promise((resolve, reject) => {
        if (!currentTokenData || !currentTokenData.token) {
          reject(new Error('No token available'));
          return;
        }
        
        fetch(`${SERVER_URL}/api/lease/check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token: currentTokenData.token
          })
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          leaseStatus = data.lease;
          resolve(data);
        })
        .catch(error => {
          reject(error);
        });
      });
    },
    
    /**
     * Get comprehensive widget status
     */
    getStatus: function() {
      return {
        initialized: isWidgetInitialized,
        tokenValid: currentTokenData !== null,
        connectionErrors: connectionErrorCount,
        version: WIDGET_VERSION,
        serverUrl: SERVER_URL,
        retryAttempts: retryAttempts,
        testMyPromptLoaded: testMyPromptLoaded,
        testMyPromptAvailable: !!window.AIChatWidget,
        leaseStatus: leaseStatus,
        leaseMonitoring: !!leaseCheckInterval,
        expirationWarningShown: expirationWarningShown
      };
    },
    
    /**
     * Get current token (debug mode only)
     */
    getToken: function() {
      if (this.debug && currentTokenData) {
        return currentTokenData.token;
      }
      return null;
    },
    
    /**
     * Force lease expiration handling (debug only)
     */
    _forceExpiration: function() {
      if (this.debug) {
        handleLeaseExpiration();
      }
    }
  });
  
  // Page lifecycle event handlers
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
  
  // Handle visibility change for token refresh and lease check
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isWidgetInitialized && currentTokenData) {
      // Refresh token when page becomes visible
      refreshTokenInternal().catch(error => {
        console.warn('[MyChatWidget] Token refresh on visibility change failed:', error);
      });
      
      // Also check lease status immediately
      checkLeaseStatus();
    }
  });
  
  // Handle page unload cleanup
  window.addEventListener('beforeunload', () => {
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
    if (leaseCheckInterval) {
      clearInterval(leaseCheckInterval);
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
  
  // Console logging
  console.log('[MyChatWidget] Enhanced widget script loaded with comprehensive lease management (v' + WIDGET_VERSION + ')');
  console.log('[MyChatWidget] Server URL configured as:', SERVER_URL);
  console.log('[MyChatWidget] Features: Lease Management, Auto-Expiration, Grace Period, Real-time Monitoring');
  
  // Development debugging utilities
  if (window.location.hostname === 'localhost' || 
      window.location.hostname.includes('dev') || 
      window.location.hostname.includes('staging')) {
    
    window.MyChatWidget.debug = true;
    
    // Debug utilities for development
    window.MyChatWidget._debugUtils = {
      // Notification testing
      showNotification: showErrorNotification,
      showLeaseExpired: showLeaseExpiredMessage,
      showLeaseExpiring: (days = 1) => showLeaseExpiringWarning(days),
      showGracePeriod: showGracePeriodWarning,
      
      // Widget management
      trackUsage: trackWidgetUsage,
      getCurrentToken: () => currentTokenData,
      getLeaseStatus: () => leaseStatus,
      getConnectionErrors: () => connectionErrorCount,
      getServerUrl: () => SERVER_URL,
      
      // Testing functions
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
      
      checkLease: checkLeaseStatus,
      forceExpiration: handleLeaseExpiration,
      
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
      },
      
      // State inspection
      getState: () => ({
        isWidgetInitialized,
        currentTokenData,
        connectionErrorCount,
        testMyPromptLoaded,
        retryAttempts,
        leaseStatus,
        expirationWarningShown,
        hasLeaseMonitoring: !!leaseCheckInterval,
        hasTokenRefresh: !!tokenRefreshTimeout
      }),
      
      // Cleanup functions
      clearTimers: () => {
        if (tokenRefreshTimeout) clearTimeout(tokenRefreshTimeout);
        if (leaseCheckInterval) clearInterval(leaseCheckInterval);
      },
      
      // Testing scenarios
      simulateLeaseExpiry: () => {
        leaseStatus = { status: 'expired', daysRemaining: 0 };
        handleLeaseExpiration();
      },
      
      simulateLeaseExpiring: (days = 1) => {
        leaseStatus = { status: 'expiring_soon', daysRemaining: days };
        showLeaseExpiringWarning(days);
      },
      
      simulateGracePeriod: () => {
        leaseStatus = { status: 'grace_period', daysRemaining: 0 };
        showGracePeriodWarning();
      }
    };
    
    console.log('[MyChatWidget] Debug mode enabled with comprehensive utilities');
    console.log('[MyChatWidget] Access debug functions via: window.MyChatWidget._debugUtils');
  }
  
})();

/*
USAGE EXAMPLE:

<!-- Add to your website -->
<script src="https://your-server.com/widget.js"></script>
<script>
  window.MyChatWidget.init({
    token: "your-jwt-token-here",
    clientId: "your-client-id-here"
  });
</script>

FEATURES:
✅ Complete lease management and validation
✅ Real-time lease monitoring (every 5 minutes)
✅ Automatic widget disabling on lease expiration
✅ Grace period handling with notifications
✅ Progressive expiry warnings (3 days, 1 day)
✅ Comprehensive error handling and recovery
✅ Token refresh and session management
✅ TestMyPrompt integration with customization
✅ Production-ready with debug utilities
✅ Memory leak prevention and cleanup
✅ Cross-domain support and CORS handling
✅ Responsive notification system
✅ Performance monitoring and logging

LEASE STATUSES:
- active: Normal operation
- expiring_soon: Shows warning notifications
- grace_period: Urgent warnings, still functional
- expired: Widget disabled, critical notifications

API METHODS:
- MyChatWidget.init(config) - Initialize widget
- MyChatWidget.show() - Show widget (checks lease)
- MyChatWidget.hide() - Hide widget
- MyChatWidget.toggle() - Toggle widget (checks lease)
- MyChatWidget.checkLease() - Manual lease check
- MyChatWidget.getStatus() - Get widget status
- MyChatWidget.getLeaseStatus() - Get lease info
- MyChatWidget.refresh() - Refresh token and widget
- MyChatWidget.destroy() - Clean up everything
*/