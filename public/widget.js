/**
 * ChatBot Leasing Widget - Fixed Production Version
 * Complete implementation for embedding TestMyPrompt chatbots
 */

(function() {
  'use strict';

  // Configuration
  const SERVER_URL = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1') 
    ? 'http://localhost:10000' 
    : 'https://chatbott-5579.onrender.com';
  const WIDGET_VERSION = '1.0.5';
  
  // Widget state
  let isWidgetInitialized = false;
  let currentTokenData = null;
  let tokenRefreshTimeout = null;
  let connectionErrorCount = 0;
  let originalWidgetScript = null;
  let widgetContainer = null;
  let widgetIframe = null;
  
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
      
      console.log('[MyChatWidget] Starting initialization...');
      
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
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        token: config.token,
        domain: window.location.hostname
      })
    })
    .then(response => {
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
      console.log('[MyChatWidget] Validation response:', data);
      
      if (!data || !data.valid) {
        console.error('[MyChatWidget] Invalid token response');
        showErrorNotification(ERROR_MESSAGES.INITIALIZATION_ERROR);
        return;
      }
      
      // Reset connection error count on successful validation
      connectionErrorCount = 0;
      
      // Load the original TestMyPrompt widget
      const widgetId = data.config.widgetId;
      const customization = data.config.customization || {};
      
      console.log('[MyChatWidget] Loading widget with ID:', widgetId);
      
      loadOriginalWidget(widgetId, customization);
      
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
  
  // Load the original TestMyPrompt widget with comprehensive URL testing
  function loadOriginalWidget(widgetId, customization) {
    console.log('[MyChatWidget] Loading original widget with ID:', widgetId);
    
    // Remove any previous instances of the script
    if (originalWidgetScript && originalWidgetScript.parentNode) {
      originalWidgetScript.parentNode.removeChild(originalWidgetScript);
    }
    
    // Comprehensive list of possible TestMyPrompt widget URLs
    const possibleUrls = [
      // Primary TestMyPrompt URLs
      `https://testmyprompt.com/widget/${widgetId}/widget.js`,
      `https://testmyprompt.com/api/widget/${widgetId}/script.js`,
      `https://testmyprompt.com/widgets/${widgetId}.js`,
      `https://testmyprompt.com/embed/${widgetId}.js`,
      
      // Alternative subdomains
      `https://widget.testmyprompt.com/${widgetId}.js`,
      `https://widgets.testmyprompt.com/${widgetId}/embed.js`,
      `https://cdn.testmyprompt.com/widgets/${widgetId}.js`,
      `https://app.testmyprompt.com/embed/${widgetId}.js`,
      `https://api.testmyprompt.com/widget/${widgetId}.js`,
      
      // Static file variations
      `https://testmyprompt.com/static/widgets/${widgetId}.js`,
      `https://testmyprompt.com/assets/widgets/${widgetId}.js`,
      
      // Version-specific URLs
      `https://testmyprompt.com/v1/widget/${widgetId}.js`,
      `https://testmyprompt.com/v2/widget/${widgetId}.js`
    ];
    
    console.log('[MyChatWidget] Trying to load widget from multiple URLs...');
    
    // Try to load the widget with fallback URLs
    tryLoadWidgetScript(possibleUrls, 0, widgetId, customization);
  }
  
  // Enhanced fallback mechanism for loading widget script
  function tryLoadWidgetScript(urls, index, widgetId, customization) {
    if (index >= urls.length) {
      console.warn('[MyChatWidget] Failed to load widget from all possible URLs, creating fallback widget');
      createFallbackWidget(widgetId, customization);
      return;
    }
    
    const currentUrl = urls[index];
    console.log(`[MyChatWidget] Attempting to load widget from: ${currentUrl}`);
    
    // Create and load the original widget script
    originalWidgetScript = document.createElement('script');
    originalWidgetScript.src = currentUrl;
    originalWidgetScript.async = true;
    originalWidgetScript.defer = true;
    
    // Set timeout for script loading
    const loadTimeout = setTimeout(() => {
      console.warn(`[MyChatWidget] Script loading timeout for ${currentUrl}`);
      if (originalWidgetScript && originalWidgetScript.parentNode) {
        originalWidgetScript.parentNode.removeChild(originalWidgetScript);
      }
      tryLoadWidgetScript(urls, index + 1, widgetId, customization);
    }, 8000); // 8 second timeout
    
    originalWidgetScript.onload = function() {
      clearTimeout(loadTimeout);
      console.log('[MyChatWidget] Widget script loaded successfully from:', currentUrl);
      
      // Initialize the original widget once loaded
      setTimeout(() => {
        initializeTestMyPromptWidget(widgetId, customization, currentUrl);
      }, 1000);
    };
    
    originalWidgetScript.onerror = function(error) {
      clearTimeout(loadTimeout);
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
  
  // Enhanced TestMyPrompt widget initialization
  function initializeTestMyPromptWidget(widgetId, customization, loadedUrl) {
    console.log('[MyChatWidget] Initializing TestMyPrompt widget...');
    
    // Wait for the script to fully load and initialize
    let attempts = 0;
    const maxAttempts = 15;
    
    function tryInitialize() {
      attempts++;
      console.log(`[MyChatWidget] Initialization attempt ${attempts}/${maxAttempts}`);
      
      // Comprehensive list of possible global objects that TestMyPrompt might use
      const possibleWidgets = [
        // Common TestMyPrompt globals
        window.AIChatWidget,
        window.testMyPrompt,
        window.TestMyPrompt,
        window.TMP,
        window.TestMyPromptWidget,
        window.ChatWidget,
        window.TMPWidget,
        
        // Alternative naming conventions
        window.PromptWidget,
        window.AIWidget,
        window.EmbedWidget,
        window.ChatBot,
        window.Chatbot,
        
        // Possible dynamic globals based on widget ID
        window[`widget_${widgetId}`],
        window[`tmp_${widgetId}`],
        
        // Check for any widget-like objects
        ...Object.keys(window).map(key => 
          key.toLowerCase().includes('widget') || 
          key.toLowerCase().includes('chat') || 
          key.toLowerCase().includes('prompt') ? window[key] : null
        ).filter(Boolean)
      ];
      
      let widgetFound = false;
      
      for (let widget of possibleWidgets) {
        if (widget && (typeof widget.init === 'function' || typeof widget.embed === 'function' || typeof widget.render === 'function')) {
          console.log('[MyChatWidget] Found TestMyPrompt widget:', widget);
          
          // Apply customization and initialize
          const widgetOptions = {
            id: widgetId,
            widgetId: widgetId,
            autoOpen: currentTokenData.config.autoOpen || false,
            theme: customization,
            customization: customization,
            container: 'body',
            ...customization
          };
          
          try {
            // Try different initialization methods
            if (typeof widget.init === 'function') {
              console.log('[MyChatWidget] Calling widget.init()');
              widget.init(widgetOptions);
            } else if (typeof widget.embed === 'function') {
              console.log('[MyChatWidget] Calling widget.embed()');
              widget.embed(widgetOptions);
            } else if (typeof widget.render === 'function') {
              console.log('[MyChatWidget] Calling widget.render()');
              widget.render(widgetOptions);
            }
            
            console.log('[MyChatWidget] TestMyPrompt widget initialized successfully');
            widgetFound = true;
            break;
          } catch (error) {
            console.error('[MyChatWidget] Error initializing TestMyPrompt widget:', error);
          }
        }
      }
      
      // Also check for initialization functions that might exist globally
      if (!widgetFound) {
        const initFunctions = [
          'initAIChatWidget',
          'initTestMyPrompt',
          'initChatWidget',
          'initWidget',
          `init_${widgetId}`,
          'renderWidget'
        ];
        
        for (let funcName of initFunctions) {
          if (typeof window[funcName] === 'function') {
            try {
              console.log(`[MyChatWidget] Calling global function: ${funcName}`);
              window[funcName]({
                widgetId: widgetId,
                ...customization
              });
              widgetFound = true;
              break;
            } catch (error) {
              console.error(`[MyChatWidget] Error calling ${funcName}:`, error);
            }
          }
        }
      }
      
      if (!widgetFound && attempts < maxAttempts) {
        // Wait and try again
        setTimeout(tryInitialize, 1500);
      } else if (!widgetFound) {
        console.warn('[MyChatWidget] TestMyPrompt widget not found after all attempts, creating fallback');
        createFallbackWidget(widgetId, customization);
      }
    }
    
    tryInitialize();
  }
  
  // Enhanced fallback widget with direct TestMyPrompt integration
  function createFallbackWidget(widgetId, customization) {
    console.log('[MyChatWidget] Creating enhanced fallback widget');
    
    // Remove any existing fallback widget
    const existingFallback = document.getElementById('testmyprompt-widget-fallback');
    if (existingFallback) {
      existingFallback.remove();
    }
    
    const primaryColor = customization?.primaryColor || '#0084ff';
    const secondaryColor = customization?.secondaryColor || '#ffffff';
    const headerText = customization?.headerText || 'Chat with us';
    
    // Create enhanced fallback widget container
    widgetContainer = document.createElement('div');
    widgetContainer.id = 'testmyprompt-widget-fallback';
    widgetContainer.innerHTML = `
      <div id="chat-widget-button" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, ${primaryColor}, ${primaryColor}dd);
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${secondaryColor};
        font-size: 24px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 9999;
        transition: all 0.3s ease;
        border: none;
        outline: none;
      " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
        💬
      </div>
      
      <div id="chat-widget-iframe-container" style="
        position: fixed;
        bottom: 90px;
        right: 20px;
        width: 400px;
        height: 600px;
        background: ${secondaryColor};
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        z-index: 9998;
        display: none;
        overflow: hidden;
        border: 1px solid #e1e1e1;
      ">
        <div style="
          background: ${primaryColor};
          color: ${secondaryColor};
          padding: 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-weight: 600;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <span>${headerText}</span>
          <button id="close-chat-widget" style="
            background: transparent;
            border: none;
            color: ${secondaryColor};
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
          ">&times;</button>
        </div>
        <div id="chat-iframe-content" style="
          width: 100%;
          height: calc(100% - 60px);
          background: ${secondaryColor};
          position: relative;
        ">
          <div id="loading-message" style="
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: #666;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          ">
            <div style="margin-bottom: 10px;">Loading chat...</div>
            <div style="
              width: 40px;
              height: 40px;
              border: 3px solid #f3f3f3;
              border-top: 3px solid ${primaryColor};
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin: 0 auto;
            "></div>
          </div>
        </div>
      </div>
    `;
    
    // Add CSS animation for loading spinner
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(widgetContainer);
    
    // Add event listeners
    const chatButton = document.getElementById('chat-widget-button');
    const chatContainer = document.getElementById('chat-widget-iframe-container');
    const closeButton = document.getElementById('close-chat-widget');
    const iframeContent = document.getElementById('chat-iframe-content');
    
    chatButton.addEventListener('click', function() {
      const isVisible = chatContainer.style.display !== 'none';
      
      if (!isVisible) {
        chatContainer.style.display = 'block';
        
        // Load iframe if not already loaded
        if (!widgetIframe) {
          loadChatIframe(widgetId, iframeContent);
        }
        
        // Track usage
        trackWidgetUsage();
      } else {
        chatContainer.style.display = 'none';
      }
    });
    
    closeButton.addEventListener('click', function() {
      chatContainer.style.display = 'none';
    });
    
    // Close widget when clicking outside
    document.addEventListener('click', function(event) {
      if (!widgetContainer.contains(event.target)) {
        chatContainer.style.display = 'none';
      }
    });
    
    console.log('[MyChatWidget] Enhanced fallback widget created successfully');
  }
  
  // Load chat iframe with multiple URL attempts
  function loadChatIframe(widgetId, container) {
    console.log('[MyChatWidget] Loading chat iframe...');
    
    const possibleIframeUrls = [
      `https://testmyprompt.com/chat/${widgetId}?embedded=true`,
      `https://testmyprompt.com/embed/${widgetId}`,
      `https://app.testmyprompt.com/chat/${widgetId}`,
      `https://widget.testmyprompt.com/chat/${widgetId}`,
      `https://testmyprompt.com/widget/${widgetId}/chat`
    ];
    
    function tryIframeUrl(urls, index) {
      if (index >= urls.length) {
        // All URLs failed, show error message
        container.innerHTML = `
          <div style="
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            text-align: center;
            color: #666;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
          ">
            <div style="margin-bottom: 10px;">Chat temporarily unavailable</div>
            <div style="font-size: 12px;">Please try again later</div>
          </div>
        `;
        return;
      }
      
      const currentUrl = possibleIframeUrls[index];
      console.log(`[MyChatWidget] Trying iframe URL: ${currentUrl}`);
      
      widgetIframe = document.createElement('iframe');
      widgetIframe.src = currentUrl;
      widgetIframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
        background: #ffffff;
      `;
      widgetIframe.title = 'Chat Widget';
      widgetIframe.loading = 'lazy';
      
      // Handle iframe load/error
      const loadTimeout = setTimeout(() => {
        console.warn(`[MyChatWidget] Iframe loading timeout for ${currentUrl}`);
        if (widgetIframe && widgetIframe.parentNode) {
          widgetIframe.parentNode.removeChild(widgetIframe);
        }
        tryIframeUrl(urls, index + 1);
      }, 10000);
      
      widgetIframe.onload = function() {
        clearTimeout(loadTimeout);
        console.log('[MyChatWidget] Iframe loaded successfully from:', currentUrl);
        // Remove loading message
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
          loadingMessage.remove();
        }
      };
      
      widgetIframe.onerror = function() {
        clearTimeout(loadTimeout);
        console.warn(`[MyChatWidget] Iframe failed to load from ${currentUrl}`);
        if (widgetIframe && widgetIframe.parentNode) {
          widgetIframe.parentNode.removeChild(widgetIframe);
        }
        tryIframeUrl(urls, index + 1);
      };
      
      // Clear container and add iframe
      container.innerHTML = '';
      container.appendChild(widgetIframe);
    }
    
    tryIframeUrl(possibleIframeUrls, 0);
  }
  
  // Track widget usage
  function trackWidgetUsage() {
    if (!currentTokenData) return;
    
    // Send usage tracking request
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
    // Clear any existing timeout
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
    
    // Schedule token refresh for 50 minutes (assuming 1 hour token expiry)
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
  
  // Enhanced error notification
  function showErrorNotification(message) {
    console.error('[MyChatWidget] Error:', message);
    
    // Remove any existing notifications
    const existingNotification = document.getElementById('mychatwidget-error-notification');
    if (existingNotification) {
      existingNotification.remove();
    }
    
    // Create enhanced notification
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
    
    // Add close button functionality
    const closeButton = notification.querySelector('#notification-close');
    closeButton.addEventListener('click', () => {
      hideNotification(notification);
    });
    
    // Animate in
    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        hideNotification(notification);
      }
    }, 8000);
  }
  
  // Hide notification with animation
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
    // Refresh widget and token
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
    
    // Destroy widget and clean up
    destroy: function() {
      if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
        tokenRefreshTimeout = null;
      }
      
      // Clean up TestMyPrompt widgets
      const possibleWidgets = [
        window.testMyPrompt,
        window.TestMyPrompt,
        window.TMP,
        window.AIChatWidget,
        window.TestMyPromptWidget,
        window.ChatWidget,
        window.TMPWidget
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
      
      // Remove scripts and containers
      if (originalWidgetScript && originalWidgetScript.parentNode) {
        originalWidgetScript.parentNode.removeChild(originalWidgetScript);
      }
      
      if (widgetContainer && widgetContainer.parentNode) {
        widgetContainer.parentNode.removeChild(widgetContainer);
      }
      
      // Remove error notifications
      const errorNotification = document.getElementById('mychatwidget-error-notification');
      if (errorNotification) {
        errorNotification.remove();
      }
      
      // Reset state
      isWidgetInitialized = false;
      currentTokenData = null;
      connectionErrorCount = 0;
      originalWidgetScript = null;
      widgetContainer = null;
      widgetIframe = null;
      
      console.log('[MyChatWidget] Widget destroyed successfully');
    },
    
    // Show widget
    show: function() {
      // Try to show TestMyPrompt widget
      const possibleWidgets = [
        window.testMyPrompt,
        window.TestMyPrompt,
        window.TMP,
        window.AIChatWidget,
        window.TestMyPromptWidget,
        window.ChatWidget,
        window.TMPWidget
      ];
      
      for (let widget of possibleWidgets) {
        if (widget && typeof widget.show === 'function') {
          widget.show();
          return;
        }
      }
      
      // Show fallback widget
      const fallbackWidget = document.getElementById('testmyprompt-widget-fallback');
      if (fallbackWidget) {
        fallbackWidget.style.display = 'block';
      }
    },
    
    // Hide widget
    hide: function() {
      // Try to hide TestMyPrompt widget
      const possibleWidgets = [
        window.testMyPrompt,
        window.TestMyPrompt,
        window.TMP,
        window.AIChatWidget,
        window.TestMyPromptWidget,
        window.ChatWidget,
        window.TMPWidget
      ];
      
      for (let widget of possibleWidgets) {
        if (widget && typeof widget.hide === 'function') {
          widget.hide();
          return;
        }
      }
      
      // Hide fallback widget
      const fallbackWidget = document.getElementById('testmyprompt-widget-fallback');
      if (fallbackWidget) {
        fallbackWidget.style.display = 'none';
      }
    },
    
    // Toggle widget visibility
    toggle: function() {
      const fallbackWidget = document.getElementById('testmyprompt-widget-fallback');
      const chatContainer = document.getElementById('chat-widget-iframe-container');
      
      if (chatContainer) {
        const isVisible = chatContainer.style.display !== 'none';
        if (isVisible) {
          this.hide();
        } else {
          this.show();
          // Also open the chat container for fallback widget
          chatContainer.style.display = 'block';
        }
      }
    },
    
    // Get widget status
    getStatus: function() {
      return {
        initialized: isWidgetInitialized,
        tokenValid: currentTokenData !== null,
        connectionErrors: connectionErrorCount,
        version: WIDGET_VERSION,
        hasOriginalWidget: originalWidgetScript !== null,
        hasFallbackWidget: document.getElementById('testmyprompt-widget-fallback') !== null
      };
    },
    
    // Update customization
    updateCustomization: function(newCustomization) {
      if (!currentTokenData) {
        console.error('[MyChatWidget] Widget not initialized');
        return;
      }
      
      // Update stored customization
      currentTokenData.config.customization = {
        ...currentTokenData.config.customization,
        ...newCustomization
      };
      
      // Apply to fallback widget if it exists
      const fallbackWidget = document.getElementById('testmyprompt-widget-fallback');
      if (fallbackWidget && newCustomization.primaryColor) {
        const button = document.getElementById('chat-widget-button');
        if (button) {
          button.style.background = `linear-gradient(135deg, ${newCustomization.primaryColor}, ${newCustomization.primaryColor}dd)`;
        }
      }
    },
    
    // Get current token (for debugging)
    getToken: function() {
      if (this.debug && currentTokenData) {
        return currentTokenData.token;
      }
      return null;
    }
  });
  
  // Enhanced page lifecycle handling
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
  
  // Handle visibility change for token refresh
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isWidgetInitialized && currentTokenData) {
      // Refresh token when page becomes visible
      refreshTokenInternal().catch(error => {
        console.warn('[MyChatWidget] Token refresh on visibility change failed:', error);
      });
    }
  });
  
  // Handle page unload
  window.addEventListener('beforeunload', () => {
    // Clean up timers
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
  });
  
  // Mobile responsiveness for fallback widget
  function handleMobileLayout() {
    const fallbackWidget = document.getElementById('testmyprompt-widget-fallback');
    const chatContainer = document.getElementById('chat-widget-iframe-container');
    
    if (fallbackWidget && chatContainer) {
      const isMobile = window.innerWidth <= 768;
      
      if (isMobile) {
        chatContainer.style.width = 'calc(100vw - 40px)';
        chatContainer.style.height = 'calc(100vh - 140px)';
        chatContainer.style.right = '20px';
        chatContainer.style.bottom = '90px';
      } else {
        chatContainer.style.width = '400px';
        chatContainer.style.height = '600px';
        chatContainer.style.right = '20px';
        chatContainer.style.bottom = '90px';
      }
    }
  }
  
  // Handle window resize for mobile responsiveness
  window.addEventListener('resize', handleMobileLayout);
  
  // Initialize mobile layout check
  document.addEventListener('DOMContentLoaded', handleMobileLayout);
  
  // Enhanced error handling for network issues
  window.addEventListener('online', () => {
    console.log('[MyChatWidget] Network connection restored');
    if (currentTokenData && !isWidgetInitialized) {
      setTimeout(() => {
        validateAndLoadOriginalWidget({
          token: currentTokenData.token,
          clientId: currentTokenData.clientId,
          config: currentTokenData.config
        });
      }, 1000);
    }
  });
  
  window.addEventListener('offline', () => {
    console.log('[MyChatWidget] Network connection lost');
    if (window.MyChatWidget.debug) {
      showErrorNotification('Network connection lost. Chat may not function properly.');
    }
  });
  
  // Log initialization
  console.log('[MyChatWidget] Enhanced widget script loaded (v' + WIDGET_VERSION + ')');
  
  // Expose debugging utilities in development
  if (window.location.hostname === 'localhost' || 
      window.location.hostname.includes('dev') || 
      window.location.hostname.includes('staging')) {
    window.MyChatWidget.debug = true;
    window.MyChatWidget._debugUtils = {
      showNotification: showErrorNotification,
      trackUsage: trackWidgetUsage,
      getCurrentToken: () => currentTokenData,
      getConnectionErrors: () => connectionErrorCount,
      validateToken: () => {
        if (currentTokenData) {
          return validateAndLoadOriginalWidget({
            token: currentTokenData.token,
            clientId: currentTokenData.clientId,
            config: currentTokenData.config
          });
        }
        return Promise.reject('No token data available');
      },
      testIframe: (url) => {
        const container = document.getElementById('chat-iframe-content');
        if (container) {
          loadChatIframe(url.split('/').pop(), container);
        }
      }
    };
    console.log('[MyChatWidget] Debug mode enabled - additional utilities available at window.MyChatWidget._debugUtils');
  }
  
  // Global error handler for widget-related errors
  window.addEventListener('error', (event) => {
    if (event.filename && event.filename.includes('widget')) {
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
  
})();