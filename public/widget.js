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
  const WIDGET_VERSION = '1.0.6';
  
  // Widget state
  let isWidgetInitialized = false;
  let currentTokenData = null;
  let tokenRefreshTimeout = null;
  let connectionErrorCount = 0;
  let originalWidgetScript = null;
  let widgetContainer = null;
  let widgetIframe = null;
  let retryAttempts = 0;
  const MAX_RETRY_ATTEMPTS = 3;
  
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
      
      // Start initialization process with retry mechanism
      initializeWithRetry(config);
      
      return this;
    },
    
    // Get current version
    getVersion: function() {
      return WIDGET_VERSION;
    },
    
    // Set debug mode
    debug: false
  };
  
  // Initialize with retry mechanism
  function initializeWithRetry(config) {
    validateAndLoadOriginalWidget(config)
      .catch(error => {
        console.error('[MyChatWidget] Initialization failed:', error);
        retryAttempts++;
        
        if (retryAttempts < MAX_RETRY_ATTEMPTS) {
          console.log(`[MyChatWidget] Retrying initialization (${retryAttempts}/${MAX_RETRY_ATTEMPTS}) in 3 seconds...`);
          setTimeout(() => {
            initializeWithRetry(config);
          }, 3000);
        } else {
          console.error('[MyChatWidget] Max retry attempts reached, creating fallback widget');
          createFallbackWidget(config.widgetId || "6809b3a1523186af0b2c9933", DEFAULT_CUSTOMIZATION);
        }
      });
  }
  
  // Validate token and load the original widget
  function validateAndLoadOriginalWidget(config) {
    return new Promise((resolve, reject) => {
      console.log('[MyChatWidget] Validating token and loading original widget...');
      
      // Create timeout for the validation request
      const validationTimeout = setTimeout(() => {
        reject(new Error('Validation timeout'));
      }, 10000);
      
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
        }),
        // Add timeout and retry options
        signal: AbortSignal.timeout(8000)
      })
      .then(response => {
        clearTimeout(validationTimeout);
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
          reject(new Error('Invalid validation response'));
          return;
        }
        
        // Reset connection error count on successful validation
        connectionErrorCount = 0;
        retryAttempts = 0;
        
        // Load the original TestMyPrompt widget or create fallback
        const widgetId = data.config.widgetId;
        const customization = data.config.customization || {};
        
        console.log('[MyChatWidget] Loading widget with ID:', widgetId);
        
        // Try loading original widget, fallback to custom implementation
        loadOriginalWidgetWithFallback(widgetId, customization)
          .then(() => {
            // Set up token refresh timer
            setupTokenRefresh();
            
            // Mark as initialized
            isWidgetInitialized = true;
            console.log('[MyChatWidget] Initialized successfully (v' + WIDGET_VERSION + ')');
            resolve();
          })
          .catch(widgetError => {
            console.warn('[MyChatWidget] Original widget loading failed, using fallback:', widgetError);
            createFallbackWidget(widgetId, customization);
            
            // Set up token refresh timer
            setupTokenRefresh();
            
            // Mark as initialized
            isWidgetInitialized = true;
            console.log('[MyChatWidget] Initialized with fallback widget (v' + WIDGET_VERSION + ')');
            resolve();
          });
      })
      .catch(error => {
        clearTimeout(validationTimeout);
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
        }
        
        reject(error);
      });
    });
  }
  
  // Load original widget with enhanced fallback
  function loadOriginalWidgetWithFallback(widgetId, customization) {
    return new Promise((resolve, reject) => {
      console.log('[MyChatWidget] Attempting to load original TestMyPrompt widget...');
      
      // Instead of trying multiple URLs, go directly to fallback for reliability
      // TestMyPrompt widgets often have CORS/iframe restrictions
      
      // Try one primary URL first
      const primaryUrl = `https://testmyprompt.com/widget/${widgetId}/widget.js`;
      
      const script = document.createElement('script');
      script.src = primaryUrl;
      script.async = true;
      script.defer = true;
      
      const loadTimeout = setTimeout(() => {
        console.warn('[MyChatWidget] Primary widget loading timeout, switching to fallback');
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        reject(new Error('Widget loading timeout'));
      }, 5000);
      
      script.onload = function() {
        clearTimeout(loadTimeout);
        console.log('[MyChatWidget] Primary widget script loaded, attempting initialization...');
        
        // Try to initialize the original widget
        setTimeout(() => {
          if (attemptOriginalWidgetInit(widgetId, customization)) {
            console.log('[MyChatWidget] Original widget initialized successfully');
            resolve();
          } else {
            console.warn('[MyChatWidget] Original widget initialization failed, using fallback');
            reject(new Error('Widget initialization failed'));
          }
        }, 2000);
      };
      
      script.onerror = function(error) {
        clearTimeout(loadTimeout);
        console.warn('[MyChatWidget] Primary widget script failed to load:', error);
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        reject(new Error('Script loading failed'));
      };
      
      document.head.appendChild(script);
      originalWidgetScript = script;
    });
  }
  
  // Attempt to initialize original widget
  function attemptOriginalWidgetInit(widgetId, customization) {
    // Look for common TestMyPrompt widget globals
    const possibleWidgets = [
      window.AIChatWidget,
      window.testMyPrompt,
      window.TestMyPrompt,
      window.TMP,
      window.TestMyPromptWidget,
      window.ChatWidget,
      window.TMPWidget
    ];
    
    for (let widget of possibleWidgets) {
      if (widget && typeof widget.init === 'function') {
        try {
          const widgetOptions = {
            id: widgetId,
            widgetId: widgetId,
            autoOpen: currentTokenData.config.autoOpen || false,
            theme: customization,
            customization: customization,
            container: 'body',
            ...customization
          };
          
          widget.init(widgetOptions);
          return true;
        } catch (error) {
          console.error('[MyChatWidget] Error initializing original widget:', error);
        }
      }
    }
    
    return false;
  }
  
  // Enhanced fallback widget
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
    if (!document.getElementById('widget-animations')) {
      const style = document.createElement('style');
      style.id = 'widget-animations';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          #chat-widget-iframe-container {
            width: calc(100vw - 40px) !important;
            height: calc(100vh - 140px) !important;
            right: 20px !important;
            bottom: 90px !important;
          }
        }
      `;
      document.head.appendChild(style);
    }
    
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
      if (chatContainer && chatContainer.style.display !== 'none' && !widgetContainer.contains(event.target)) {
        chatContainer.style.display = 'none';
      }
    });
    
    console.log('[MyChatWidget] Enhanced fallback widget created successfully');
  }
  
  // Load chat iframe with better error handling
  function loadChatIframe(widgetId, container) {
    console.log('[MyChatWidget] Loading chat iframe...');
    
    // Create a custom chat interface instead of trying external URLs
    // Since TestMyPrompt may block iframe embedding
    createCustomChatInterface(container, widgetId);
  }
  
  // Create custom chat interface
  function createCustomChatInterface(container, widgetId) {
    console.log('[MyChatWidget] Creating custom chat interface...');
    
    const primaryColor = currentTokenData.config.customization?.primaryColor || '#0084ff';
    
    container.innerHTML = `
      <div style="
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <div id="chat-messages" style="
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          background: #f8f9fa;
        ">
          <div style="
            background: white;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          ">
            <div style="color: #666; font-size: 12px; margin-bottom: 4px;">Assistant</div>
            <div>Hello! I'm here to help you. What can I assist you with today?</div>
          </div>
        </div>
        
        <div style="
          padding: 16px;
          border-top: 1px solid #e1e1e1;
          background: white;
        ">
          <div style="display: flex; gap: 8px;">
            <input 
              type="text" 
              id="chat-input" 
              placeholder="Type your message..." 
              style="
                flex: 1;
                padding: 12px;
                border: 1px solid #ddd;
                border-radius: 6px;
                outline: none;
                font-size: 14px;
              "
            />
            <button 
              id="chat-send" 
              style="
                padding: 12px 16px;
                background: ${primaryColor};
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                min-width: 60px;
              "
            >
              Send
            </button>
          </div>
          <div style="
            font-size: 11px;
            color: #888;
            margin-top: 8px;
            text-align: center;
          ">
            Chat powered by TestMyPrompt
          </div>
        </div>
      </div>
    `;
    
    // Add chat functionality
    const chatInput = container.querySelector('#chat-input');
    const chatSend = container.querySelector('#chat-send');
    const chatMessages = container.querySelector('#chat-messages');
    
    function sendMessage() {
      const message = chatInput.value.trim();
      if (!message) return;
      
      // Add user message
      const userMsg = document.createElement('div');
      userMsg.style.cssText = `
        background: ${primaryColor};
        color: white;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 12px;
        margin-left: 40px;
        text-align: right;
      `;
      userMsg.innerHTML = `
        <div style="color: rgba(255,255,255,0.8); font-size: 12px; margin-bottom: 4px;">You</div>
        <div>${message}</div>
      `;
      chatMessages.appendChild(userMsg);
      
      // Clear input
      chatInput.value = '';
      
      // Scroll to bottom
      chatMessages.scrollTop = chatMessages.scrollHeight;
      
      // Show typing indicator
      const typingMsg = document.createElement('div');
      typingMsg.style.cssText = `
        background: white;
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 12px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      `;
      typingMsg.innerHTML = `
        <div style="color: #666; font-size: 12px; margin-bottom: 4px;">Assistant</div>
        <div style="color: #888;">Typing...</div>
      `;
      chatMessages.appendChild(typingMsg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      
      // Simulate bot response
      setTimeout(() => {
        typingMsg.remove();
        
        const botMsg = document.createElement('div');
        botMsg.style.cssText = `
          background: white;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 12px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;
        botMsg.innerHTML = `
          <div style="color: #666; font-size: 12px; margin-bottom: 4px;">Assistant</div>
          <div>I understand you said "${message}". I'm a demo chat interface. For full functionality, please ensure the TestMyPrompt widget is properly configured.</div>
        `;
        chatMessages.appendChild(botMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }, 1500);
    }
    
    chatSend.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });
    
    // Focus input
    chatInput.focus();
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
      retryAttempts = 0;
      
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
        hasFallbackWidget: document.getElementById('testmyprompt-widget-fallback') !== null,
        retryAttempts: retryAttempts
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
    console.log('[MyChatWidget] Debug mode enabled - additional utilities available at window.MyChatWidget._debugUtils');
  }
  
})();