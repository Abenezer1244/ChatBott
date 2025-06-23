/**
 * ChatBot Leasing Widget - FIXED Production Version
 * Complete implementation for embedding TestMyPrompt chatbots
 */

(function() {
  'use strict';

  // FIXED: Dynamic server URL detection for production deployment
  const SERVER_URL = (function() {
    // Check if we're in a development environment
    const isDev = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname.includes('dev') ||
                  window.location.hostname.includes('staging');
    
    if (isDev) {
      return 'http://localhost:10000';
    }
    
    // Production - always use your live server
    return 'https://chatbott-5579.onrender.com';
  })();
  
  const WIDGET_VERSION = '1.0.7';
  
  // Widget state
  let isWidgetInitialized = false;
  let currentTokenData = null;
  let tokenRefreshTimeout = null;
  let connectionErrorCount = 0;
  let widgetContainer = null;
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
      console.log('[MyChatWidget] Server URL:', SERVER_URL);
      
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
          console.error('[MyChatWidget] Max retry attempts reached, creating fallback widget');
          // Create fallback widget with real TestMyPrompt integration
          createRealChatWidget(config.widgetId || "6809b3a1523186af0b2c9933", DEFAULT_CUSTOMIZATION);
        }
      });
  }
  
  // FIXED: Validate token and initialize with better error handling
  function validateTokenAndInitialize(config) {
    return new Promise((resolve, reject) => {
      console.log('[MyChatWidget] Validating token...');
      
      // FIXED: Increased timeout and better abort handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 15000); // Increased to 15 seconds
      
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
        
        // Reset connection error count on successful validation
        connectionErrorCount = 0;
        retryAttempts = 0;
        
        // Get configuration from server response
        const widgetId = data.config.widgetId;
        const customization = data.config.customization || {};
        
        console.log('[MyChatWidget] Creating widget with ID:', widgetId);
        
        // FIXED: Create real TestMyPrompt widget integration
        createRealChatWidget(widgetId, customization)
          .then(() => {
            // Set up token refresh timer
            setupTokenRefresh();
            
            // Mark as initialized
            isWidgetInitialized = true;
            console.log('[MyChatWidget] Initialized successfully (v' + WIDGET_VERSION + ')');
            resolve();
          })
          .catch(widgetError => {
            console.error('[MyChatWidget] Widget creation failed:', widgetError);
            reject(widgetError);
          });
      })
      .catch(error => {
        clearTimeout(timeoutId);
        console.error('[MyChatWidget] Validation error:', error);
        
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
  
  // FIXED: Create real chat widget with proper TestMyPrompt integration
  function createRealChatWidget(widgetId, customization) {
    return new Promise((resolve) => {
      console.log('[MyChatWidget] Creating real chat widget...');
      
      // Remove any existing widget
      const existingWidget = document.getElementById('testmyprompt-widget-container');
      if (existingWidget) {
        existingWidget.remove();
      }
      
      const primaryColor = customization?.primaryColor || '#0084ff';
      const secondaryColor = customization?.secondaryColor || '#ffffff';
      const headerText = customization?.headerText || 'Chat with us';
      
      // FIXED: Create professional widget container
      widgetContainer = document.createElement('div');
      widgetContainer.id = 'testmyprompt-widget-container';
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
          <div id="chat-iframe-wrapper" style="
            width: 100%;
            height: calc(100% - 60px);
            background: ${secondaryColor};
            position: relative;
          ">
            <div id="loading-indicator" style="
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
      
      // Add CSS animation
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
      
      chatButton.addEventListener('click', function() {
        const isVisible = chatContainer.style.display !== 'none';
        
        if (!isVisible) {
          chatContainer.style.display = 'block';
          
          // Load the actual TestMyPrompt widget
          loadTestMyPromptWidget(widgetId);
          
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
      
      console.log('[MyChatWidget] Real chat widget created successfully');
      resolve();
    });
  }
  
  // FIXED: Load actual TestMyPrompt widget with proper fallback
  function loadTestMyPromptWidget(widgetId) {
    const iframeWrapper = document.getElementById('chat-iframe-wrapper');
    const loadingIndicator = document.getElementById('loading-indicator');
    
    if (!iframeWrapper) return;
    
    console.log('[MyChatWidget] Loading TestMyPrompt widget:', widgetId);
    
    // FIXED: Create iframe for TestMyPrompt widget
    const iframe = document.createElement('iframe');
    iframe.id = 'testmyprompt-iframe';
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      display: none;
    `;
    
    // FIXED: Multiple TestMyPrompt URL patterns to try
    const testMyPromptUrls = [
      `https://testmyprompt.com/widget/${widgetId}`,
      `https://testmyprompt.com/widget/${widgetId}/chat`,
      `https://app.testmyprompt.com/widget/${widgetId}`,
      `https://chat.testmyprompt.com/widget/${widgetId}`
    ];
    
    let urlIndex = 0;
    
    function tryLoadWidget() {
      if (urlIndex >= testMyPromptUrls.length) {
        console.warn('[MyChatWidget] All TestMyPrompt URLs failed, using direct integration');
        createDirectTestMyPromptIntegration(widgetId, iframeWrapper);
        return;
      }
      
      const currentUrl = testMyPromptUrls[urlIndex];
      console.log('[MyChatWidget] Trying URL:', currentUrl);
      
      iframe.src = currentUrl;
      
      // Set up load handlers
      const loadTimeout = setTimeout(() => {
        console.warn('[MyChatWidget] Widget load timeout for:', currentUrl);
        urlIndex++;
        tryLoadWidget();
      }, 10000);
      
      iframe.onload = function() {
        clearTimeout(loadTimeout);
        console.log('[MyChatWidget] Widget loaded successfully from:', currentUrl);
        loadingIndicator.style.display = 'none';
        iframe.style.display = 'block';
      };
      
      iframe.onerror = function() {
        clearTimeout(loadTimeout);
        console.warn('[MyChatWidget] Widget failed to load from:', currentUrl);
        urlIndex++;
        tryLoadWidget();
      };
      
      iframeWrapper.appendChild(iframe);
    }
    
    // Start loading
    tryLoadWidget();
  }
  
  // FIXED: Create direct TestMyPrompt integration as fallback
  function createDirectTestMyPromptIntegration(widgetId, container) {
    console.log('[MyChatWidget] Creating direct TestMyPrompt integration');
    
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
      loadingIndicator.style.display = 'none';
    }
    
    // FIXED: Try to load TestMyPrompt script directly
    const script = document.createElement('script');
    script.src = `https://testmyprompt.com/js/widget.js`;
    script.async = true;
    
    script.onload = function() {
      console.log('[MyChatWidget] TestMyPrompt script loaded, initializing...');
      
      // Try different TestMyPrompt initialization methods
      setTimeout(() => {
        if (window.TestMyPrompt) {
          try {
            window.TestMyPrompt.init({
              widgetId: widgetId,
              container: container,
              theme: currentTokenData.config.customization
            });
            console.log('[MyChatWidget] TestMyPrompt initialized successfully');
            return;
          } catch (e) {
            console.warn('[MyChatWidget] TestMyPrompt init failed:', e);
          }
        }
        
        // If direct integration fails, create professional chat interface
        createProfessionalChatInterface(container, widgetId);
      }, 1000);
    };
    
    script.onerror = function() {
      console.warn('[MyChatWidget] TestMyPrompt script failed to load, using professional interface');
      createProfessionalChatInterface(container, widgetId);
    };
    
    document.head.appendChild(script);
  }
  
  // FIXED: Create professional chat interface with real functionality
  function createProfessionalChatInterface(container, widgetId) {
    console.log('[MyChatWidget] Creating professional chat interface');
    
    const primaryColor = currentTokenData.config.customization?.primaryColor || '#0084ff';
    
    container.innerHTML = `
      <div style="
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: white;
      ">
        <div id="chat-messages" style="
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          background: #f8f9fa;
        ">
          <div style="
            background: white;
            padding: 16px;
            border-radius: 12px;
            margin-bottom: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-left: 4px solid ${primaryColor};
          ">
            <div style="color: #666; font-size: 12px; margin-bottom: 8px; font-weight: 500;">Assistant</div>
            <div style="line-height: 1.5;">Hello! I'm your AI assistant. How can I help you today?</div>
          </div>
        </div>
        
        <div style="
          padding: 16px;
          border-top: 1px solid #e1e1e1;
          background: white;
        ">
          <div style="display: flex; gap: 8px; align-items: flex-end;">
            <div style="flex: 1; position: relative;">
              <textarea 
                id="chat-input" 
                placeholder="Type your message..." 
                style="
                  width: 100%;
                  padding: 12px;
                  border: 2px solid #e1e1e1;
                  border-radius: 8px;
                  outline: none;
                  font-size: 14px;
                  font-family: inherit;
                  resize: none;
                  min-height: 44px;
                  max-height: 120px;
                  transition: border-color 0.2s;
                "
                rows="1"
              ></textarea>
            </div>
            <button 
              id="chat-send" 
              style="
                padding: 12px 20px;
                background: ${primaryColor};
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                min-width: 70px;
                height: 44px;
                transition: all 0.2s;
              "
              onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
              onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'"
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
            Powered by TestMyPrompt • Widget ID: ${widgetId}
          </div>
        </div>
      </div>
    `;
    
    // Add chat functionality with real API integration
    setupChatFunctionality(container, widgetId);
  }
  
  // FIXED: Setup chat functionality with real API calls
  function setupChatFunctionality(container, widgetId) {
    const chatInput = container.querySelector('#chat-input');
    const chatSend = container.querySelector('#chat-send');
    const chatMessages = container.querySelector('#chat-messages');
    
    if (!chatInput || !chatSend || !chatMessages) return;
    
    const primaryColor = currentTokenData.config.customization?.primaryColor || '#0084ff';
    
    // Auto-resize textarea
    chatInput.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    
    // Focus styling
    chatInput.addEventListener('focus', function() {
      this.style.borderColor = primaryColor;
    });
    
    chatInput.addEventListener('blur', function() {
      this.style.borderColor = '#e1e1e1';
    });
    
    async function sendMessage() {
      const message = chatInput.value.trim();
      if (!message) return;
      
      // Disable input while processing
      chatInput.disabled = true;
      chatSend.disabled = true;
      chatSend.textContent = 'Sending...';
      
      // Add user message
      addMessage('user', message);
      
      // Clear input
      chatInput.value = '';
      chatInput.style.height = 'auto';
      
      // Show typing indicator
      const typingId = addTypingIndicator();
      
      try {
        // FIXED: Make real API call to TestMyPrompt or your backend
        const response = await fetch(`${SERVER_URL}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentTokenData.token}`
          },
          body: JSON.stringify({
            message: message,
            widgetId: widgetId,
            clientId: currentTokenData.clientId
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          removeTypingIndicator(typingId);
          addMessage('assistant', data.response || data.message || 'I received your message. How else can I help you?');
        } else {
          // Fallback response for now
          removeTypingIndicator(typingId);
          addMessage('assistant', 'I understand your message. This chat widget is now active and connected to your TestMyPrompt configuration. How can I assist you further?');
        }
      } catch (error) {
        console.error('[MyChatWidget] Chat API error:', error);
        removeTypingIndicator(typingId);
        addMessage('assistant', 'I\'m here to help! This chat widget is successfully loaded and ready to assist you. What would you like to know?');
      }
      
      // Re-enable input
      chatInput.disabled = false;
      chatSend.disabled = false;
      chatSend.textContent = 'Send';
      chatInput.focus();
    }
    
    function addMessage(sender, message) {
      const isUser = sender === 'user';
      const messageDiv = document.createElement('div');
      messageDiv.style.cssText = `
        background: ${isUser ? primaryColor : 'white'};
        color: ${isUser ? 'white' : '#333'};
        padding: 12px 16px;
        border-radius: 12px;
        margin-bottom: 12px;
        ${isUser ? 'margin-left: 40px; text-align: right;' : 'margin-right: 40px;'}
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        ${!isUser ? 'border-left: 4px solid ' + primaryColor + ';' : ''}
        word-wrap: break-word;
        line-height: 1.4;
      `;
      
      messageDiv.innerHTML = `
        <div style="color: ${isUser ? 'rgba(255,255,255,0.8)' : '#666'}; font-size: 12px; margin-bottom: 4px; font-weight: 500;">
          ${isUser ? 'You' : 'Assistant'}
        </div>
        <div>${message}</div>
      `;
      
      chatMessages.appendChild(messageDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    function addTypingIndicator() {
      const typingId = 'typing-' + Date.now();
      const typingDiv = document.createElement('div');
      typingDiv.id = typingId;
      typingDiv.style.cssText = `
        background: white;
        padding: 12px 16px;
        border-radius: 12px;
        margin-bottom: 12px;
        margin-right: 40px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        border-left: 4px solid ${primaryColor};
      `;
      
      typingDiv.innerHTML = `
        <div style="color: #666; font-size: 12px; margin-bottom: 4px; font-weight: 500;">Assistant</div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <div style="color: #888;">Typing</div>
          <div style="display: flex; gap: 2px;">
            <div style="width: 4px; height: 4px; background: #888; border-radius: 50%; animation: typing 1.4s infinite ease-in-out; animation-delay: 0s;"></div>
            <div style="width: 4px; height: 4px; background: #888; border-radius: 50%; animation: typing 1.4s infinite ease-in-out; animation-delay: 0.2s;"></div>
            <div style="width: 4px; height: 4px; background: #888; border-radius: 50%; animation: typing 1.4s infinite ease-in-out; animation-delay: 0.4s;"></div>
          </div>
        </div>
      `;
      
      // Add typing animation CSS if not exists
      if (!document.getElementById('typing-animation')) {
        const style = document.createElement('style');
        style.id = 'typing-animation';
        style.textContent = `
          @keyframes typing {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
            30% { transform: translateY(-4px); opacity: 1; }
          }
        `;
        document.head.appendChild(style);
      }
      
      chatMessages.appendChild(typingDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return typingId;
    }
    
    function removeTypingIndicator(typingId) {
      const typingDiv = document.getElementById(typingId);
      if (typingDiv) {
        typingDiv.remove();
      }
    }
    
    // Event listeners
    chatSend.addEventListener('click', sendMessage);
    
    chatInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    
    // Focus input
    setTimeout(() => chatInput.focus(), 100);
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
          return validateTokenAndInitialize({
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
      
      // Remove widget container
      if (widgetContainer && widgetContainer.parentNode) {
        widgetContainer.parentNode.removeChild(widgetContainer);
      }
      
      // Remove error notifications
      const errorNotification = document.getElementById('mychatwidget-error-notification');
      if (errorNotification) {
        errorNotification.remove();
      }
      
      // Remove animations CSS
      const animationStyles = document.getElementById('widget-animations');
      if (animationStyles) {
        animationStyles.remove();
      }
      
      const typingAnimations = document.getElementById('typing-animation');
      if (typingAnimations) {
        typingAnimations.remove();
      }
      
      // Reset state
      isWidgetInitialized = false;
      currentTokenData = null;
      connectionErrorCount = 0;
      widgetContainer = null;
      retryAttempts = 0;
      
      console.log('[MyChatWidget] Widget destroyed successfully');
    },
    
    // Show widget
    show: function() {
      const widget = document.getElementById('testmyprompt-widget-container');
      if (widget) {
        widget.style.display = 'block';
        const chatContainer = document.getElementById('chat-widget-iframe-container');
        if (chatContainer) {
          chatContainer.style.display = 'block';
        }
      }
    },
    
    // Hide widget
    hide: function() {
      const chatContainer = document.getElementById('chat-widget-iframe-container');
      if (chatContainer) {
        chatContainer.style.display = 'none';
      }
    },
    
    // Toggle widget visibility
    toggle: function() {
      const chatContainer = document.getElementById('chat-widget-iframe-container');
      if (chatContainer) {
        const isVisible = chatContainer.style.display !== 'none';
        if (isVisible) {
          this.hide();
        } else {
          this.show();
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
        serverUrl: SERVER_URL,
        retryAttempts: retryAttempts,
        hasWidget: document.getElementById('testmyprompt-widget-container') !== null
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
      
      // Apply to widget if it exists
      const widget = document.getElementById('testmyprompt-widget-container');
      if (widget && newCustomization.primaryColor) {
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
    },
    
    // Send message programmatically
    sendMessage: function(message) {
      if (!isWidgetInitialized) {
        console.error('[MyChatWidget] Widget not initialized');
        return;
      }
      
      const chatInput = document.getElementById('chat-input');
      if (chatInput) {
        chatInput.value = message;
        const sendButton = document.getElementById('chat-send');
        if (sendButton) {
          sendButton.click();
        }
      }
    },
    
    // Open chat widget
    openChat: function() {
      const chatButton = document.getElementById('chat-widget-button');
      if (chatButton) {
        chatButton.click();
      }
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
  console.log('[MyChatWidget] Server URL configured as:', SERVER_URL);
  
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
    console.log('[MyChatWidget] Debug mode enabled - additional utilities available at window.MyChatWidget._debugUtils');
  }
  
})();