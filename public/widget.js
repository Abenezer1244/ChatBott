/**
 * ChatBot Leasing Widget
 * Production-ready implementation for embedding TestMyPrompt chatbots
 * 
 * This script creates a customizable widget that proxies requests to TestMyPrompt
 * while providing domain validation, usage tracking, and customization.
 */

(function() {
    'use strict';
  
    // Configuration - replace with your actual deployment URL
    const SERVER_URL = 'https://chatbott-5579.onrender.com'; // Your production server URL
    
    // Version tracking for cache busting and debugging
    const WIDGET_VERSION = '1.0.1';
    
    // Widget state
    let widgetConfig = null;
    let isWidgetInitialized = false;
    let isWidgetOpen = false;
    let isWidgetMinimized = false;
    let currentTokenData = null;
    let tokenRefreshTimeout = null;
    let connectionErrorCount = 0;
    
    // Widget elements
    let widgetContainer = null;
    let chatFrame = null;
    let toggleButton = null;
    let loadingIndicator = null;
    
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
      logoUrl: '',
      position: 'right',
      width: '350px',
      height: '500px',
      mobileWidth: '100%',
      mobileHeight: '100%',
      mobileFull: true,
      showNotifications: true
    };
    
    // Main widget object
    window.MyChatWidget = {
      // Public initialization method
      init: function(config) {
        // Prevent multiple initializations
        if (isWidgetInitialized) {
          console.warn('[MyChatWidget] Widget already initialized');
          return;
        }
        
        // Merge default config with user-provided config
        const finalConfig = {
          ...config
        };
        
        // Validate required configuration
        if (!finalConfig.token || !finalConfig.clientId) {
          console.error('[MyChatWidget] Invalid widget configuration. Required parameters: token, clientId');
          return;
        }
        
        // Store token data
        currentTokenData = {
          token: finalConfig.token,
          clientId: finalConfig.clientId
        };
        
        // Set up window event listeners
        setupEventListeners();
        
        // Start initialization process
        startInitialization(finalConfig);
        
        return this;
      },
      
      // Public method to open the widget
      open: function() {
        if (!isWidgetInitialized) {
          console.warn('[MyChatWidget] Widget not initialized');
          return this;
        }
        
        openWidget();
        return this;
      },
      
      // Public method to close the widget
      close: function() {
        if (!isWidgetInitialized) {
          console.warn('[MyChatWidget] Widget not initialized');
          return this;
        }
        
        closeWidget();
        return this;
      },
      
      // Public method to toggle the widget
      toggle: function() {
        if (!isWidgetInitialized) {
          console.warn('[MyChatWidget] Widget not initialized');
          return this;
        }
        
        toggleWidget();
        return this;
      },
      
      // Public method to update customization
      updateCustomization: function(customization) {
        if (!isWidgetInitialized) {
          console.warn('[MyChatWidget] Widget not initialized');
          return this;
        }
        
        if (widgetConfig && widgetConfig.customization) {
          widgetConfig.customization = {
            ...widgetConfig.customization,
            ...customization
          };
          
          applyCustomization();
        }
        
        return this;
      },
      
      // Public method to refresh the token
      refreshToken: function() {
        if (!currentTokenData) {
          console.warn('[MyChatWidget] No token data available');
          return Promise.reject(new Error('No token data available'));
        }
        
        return refreshTokenInternal();
      },
      
      // Public method to get current version
      getVersion: function() {
        return WIDGET_VERSION;
      }
    };
    
    // Start initialization process
    function startInitialization(config) {
      // Show loading indicator while initializing
      createLoadingIndicator();
      
      // Validate token and retrieve configuration
      validateToken(config.token)
        .then(response => {
          if (!response || !response.valid) {
            showError(response?.error || 'Unknown error');
            return;
          }
          
          // Store widget configuration
          widgetConfig = {
            ...config,
            customization: {
              ...DEFAULT_CUSTOMIZATION,
              ...response.config.customization
            },
            widgetId: response.config.widgetId
          };
          
          // Create widget elements
          createWidgetElements();
          
          // Initialize TestMyPrompt widget
          initializeOriginalWidget(widgetConfig.widgetId);
          
          // Set up token refresh timer
          setupTokenRefresh();
          
          // Widget is now initialized
          isWidgetInitialized = true;
          removeLoadingIndicator();
          
          // Auto-open if specified
          if (config.autoOpen) {
            setTimeout(openWidget, 500);
          }
          
          console.log('[MyChatWidget] Initialized successfully (v' + WIDGET_VERSION + ')');
        })
        .catch(error => {
          console.error('[MyChatWidget] Initialization error:', error);
          showError(ERROR_MESSAGES.INITIALIZATION_ERROR);
          removeLoadingIndicator();
        });
    }
    
    // Validate token with the server
    function validateToken(token) {
      connectionErrorCount = 0;
      
      return fetch(`${SERVER_URL}/api/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: token,
          domain: window.location.hostname
        })
      })
      .then(response => {
        if (!response.ok) {
          // Check specific error cases
          if (response.status === 401) {
            throw new Error('token_expired');
          } else if (response.status === 403) {
            if (response.statusText.includes('inactive')) {
              throw new Error('client_inactive');
            } else {
              throw new Error('domain_not_authorized');
            }
          }
          
          throw new Error(`HTTP error ${response.status}`);
        }
        return response.json();
      })
      .catch(error => {
        // Handle specific errors
        if (error.message === 'token_expired') {
          console.error('[MyChatWidget] Token expired');
          showError(ERROR_MESSAGES.TOKEN_EXPIRED);
          return { valid: false, error: 'token_expired' };
        } else if (error.message === 'domain_not_authorized') {
          console.error('[MyChatWidget] Domain not authorized');
          showError(ERROR_MESSAGES.DOMAIN_NOT_AUTHORIZED);
          return { valid: false, error: 'domain_not_authorized' };
        } else if (error.message === 'client_inactive') {
          console.error('[MyChatWidget] Client is inactive');
          showError(ERROR_MESSAGES.CLIENT_INACTIVE);
          return { valid: false, error: 'client_inactive' };
        }
        
        // Network or other errors
        connectionErrorCount++;
        if (connectionErrorCount > 3) {
          showError(ERROR_MESSAGES.CONNECTION_ERROR);
        }
        
        console.error('[MyChatWidget] Token validation error:', error);
        return { valid: false, error: 'connection_error' };
      });
    }
    
    // Create loading indicator
    function createLoadingIndicator() {
      loadingIndicator = document.createElement('div');
      loadingIndicator.id = 'my-chat-widget-loading';
      loadingIndicator.style.position = 'fixed';
      loadingIndicator.style.bottom = '20px';
      loadingIndicator.style.right = '20px';
      loadingIndicator.style.backgroundColor = DEFAULT_CUSTOMIZATION.primaryColor;
      loadingIndicator.style.borderRadius = '50%';
      loadingIndicator.style.width = '60px';
      loadingIndicator.style.height = '60px';
      loadingIndicator.style.display = 'flex';
      loadingIndicator.style.justifyContent = 'center';
      loadingIndicator.style.alignItems = 'center';
      loadingIndicator.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
      loadingIndicator.style.zIndex = '9998';
      
      // Create spinner animation
      loadingIndicator.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${DEFAULT_CUSTOMIZATION.secondaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10">
            <animateTransform 
              attributeName="transform" 
              type="rotate"
              from="0 12 12"
              to="360 12 12" 
              dur="1s" 
              repeatCount="indefinite" />
          </path>
        </svg>
      `;
      
      document.body.appendChild(loadingIndicator);
    }
    
    // Remove loading indicator
    function removeLoadingIndicator() {
      if (loadingIndicator && loadingIndicator.parentNode) {
        loadingIndicator.parentNode.removeChild(loadingIndicator);
        loadingIndicator = null;
      }
    }
    
    // Show error message
    function showError(message) {
      if (!loadingIndicator && !widgetContainer) {
        createErrorElement(message);
        return;
      }
      
      // If widget is already created, show error inside widget
      if (widgetContainer && chatFrame) {
        const errorElement = document.createElement('div');
        errorElement.style.position = 'absolute';
        errorElement.style.top = '0';
        errorElement.style.left = '0';
        errorElement.style.width = '100%';
        errorElement.style.height = '100%';
        errorElement.style.display = 'flex';
        errorElement.style.flexDirection = 'column';
        errorElement.style.justifyContent = 'center';
        errorElement.style.alignItems = 'center';
        errorElement.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
        errorElement.style.padding = '20px';
        errorElement.style.textAlign = 'center';
        errorElement.style.zIndex = '10';
        errorElement.style.color = '#e74c3c';
        errorElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        
        const errorIcon = document.createElement('div');
        errorIcon.innerHTML = `
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        `;
        
        const errorText = document.createElement('p');
        errorText.textContent = message;
        errorText.style.marginTop = '10px';
        errorText.style.fontSize = '14px';
        
        const retryButton = document.createElement('button');
        retryButton.textContent = 'Retry';
        retryButton.style.marginTop = '15px';
        retryButton.style.padding = '8px 16px';
        retryButton.style.backgroundColor = widgetConfig?.customization?.primaryColor || DEFAULT_CUSTOMIZATION.primaryColor;
        retryButton.style.color = widgetConfig?.customization?.secondaryColor || DEFAULT_CUSTOMIZATION.secondaryColor;
        retryButton.style.border = 'none';
        retryButton.style.borderRadius = '4px';
        retryButton.style.cursor = 'pointer';
        retryButton.onclick = function() {
          chatFrame.removeChild(errorElement);
          refreshTokenInternal()
            .then(() => {
              initializeOriginalWidget(widgetConfig.widgetId);
            })
            .catch(() => {
              // If refresh fails, show error again
              showError(message);
            });
        };
        
        errorElement.appendChild(errorIcon);
        errorElement.appendChild(errorText);
        errorElement.appendChild(retryButton);
        
        chatFrame.appendChild(errorElement);
      } else if (loadingIndicator) {
        // Replace loading indicator with error
        removeLoadingIndicator();
        createErrorElement(message);
      }
    }
    
    // Create standalone error element
    function createErrorElement(message) {
      const errorElement = document.createElement('div');
      errorElement.id = 'my-chat-widget-error';
      errorElement.style.position = 'fixed';
      errorElement.style.bottom = '20px';
      errorElement.style.right = '20px';
      errorElement.style.backgroundColor = '#fff';
      errorElement.style.borderRadius = '10px';
      errorElement.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
      errorElement.style.padding = '15px';
      errorElement.style.zIndex = '9998';
      errorElement.style.maxWidth = '300px';
      errorElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      
      const errorHeader = document.createElement('div');
      errorHeader.style.display = 'flex';
      errorHeader.style.alignItems = 'center';
      errorHeader.style.marginBottom = '10px';
      
      const errorIcon = document.createElement('div');
      errorIcon.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      `;
      
      const errorTitle = document.createElement('span');
      errorTitle.textContent = 'Chat Widget Error';
      errorTitle.style.marginLeft = '10px';
      errorTitle.style.fontWeight = 'bold';
      
      const closeButton = document.createElement('div');
      closeButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      closeButton.style.marginLeft = 'auto';
      closeButton.style.cursor = 'pointer';
      closeButton.onclick = function() {
        if (errorElement.parentNode) {
          errorElement.parentNode.removeChild(errorElement);
        }
      };
      
      errorHeader.appendChild(errorIcon);
      errorHeader.appendChild(errorTitle);
      errorHeader.appendChild(closeButton);
      
      const errorText = document.createElement('p');
      errorText.textContent = message;
      errorText.style.margin = '0';
      errorText.style.fontSize = '14px';
      
      const retryButton = document.createElement('button');
      retryButton.textContent = 'Retry';
      retryButton.style.marginTop = '15px';
      retryButton.style.padding = '8px 16px';
      retryButton.style.backgroundColor = DEFAULT_CUSTOMIZATION.primaryColor;
      retryButton.style.color = DEFAULT_CUSTOMIZATION.secondaryColor;
      retryButton.style.border = 'none';
      retryButton.style.borderRadius = '4px';
      retryButton.style.cursor = 'pointer';
      retryButton.onclick = function() {
        if (errorElement.parentNode) {
          errorElement.parentNode.removeChild(errorElement);
        }
        
        // Reinitialize widget
        if (currentTokenData) {
          MyChatWidget.init(currentTokenData);
        }
      };
      
      errorElement.appendChild(errorHeader);
      errorElement.appendChild(errorText);
      errorElement.appendChild(retryButton);
      
      document.body.appendChild(errorElement);
    }
    
    // Set up global event listeners
    function setupEventListeners() {
      // Listen for messages from iframe or parent window
      window.addEventListener('message', function(event) {
        // Handle any messages from the widget iframe
        if (event.data && event.data.type === 'chatbot-event') {
          console.log('[MyChatWidget] Received message from chatbot:', event.data);
          
          // Handle token expiration if indicated
          if (event.data.error === 'token_expired') {
            handleTokenExpiration();
          }
        }
      });
      
      // Handle errors and exceptions
      window.addEventListener('error', function(event) {
        console.error('[MyChatWidget] Widget error:', event.error);
        // Could send error reports to your server here
      });
      
      // Handle window resize for responsive adjustments
      window.addEventListener('resize', debounce(function() {
        if (isWidgetInitialized && widgetContainer) {
          adjustWidgetForMobile();
        }
      }, 250));
    }
    
    // Create widget elements
    function createWidgetElements() {
      // Create main container
      widgetContainer = document.createElement('div');
      widgetContainer.id = 'my-chat-widget-container';
      widgetContainer.style.position = 'fixed';
      widgetContainer.style.bottom = '20px';
      widgetContainer.style.right = '20px';
      widgetContainer.style.zIndex = '9999';
      widgetContainer.style.display = 'flex';
      widgetContainer.style.flexDirection = 'column';
      widgetContainer.style.alignItems = 'flex-end';
      document.body.appendChild(widgetContainer);
      
      // Create chat container
      chatFrame = document.createElement('div');
      chatFrame.id = 'my-chat-widget-frame';
      chatFrame.style.width = widgetConfig.customization.width;
      chatFrame.style.height = widgetConfig.customization.height;
      chatFrame.style.backgroundColor = '#ffffff';
      chatFrame.style.borderRadius = '10px';
      chatFrame.style.boxShadow = '0 5px 40px rgba(0, 0, 0, 0.16)';
      chatFrame.style.marginBottom = '16px';
      chatFrame.style.overflow = 'hidden';
      chatFrame.style.transition = 'all 0.3s ease';
      chatFrame.style.opacity = '0';
      chatFrame.style.transform = 'translateY(20px) scale(0.9)';
      chatFrame.style.display = 'none';
      chatFrame.style.position = 'relative';
      
      // Create toggle button
      toggleButton = document.createElement('div');
      toggleButton.id = 'my-chat-widget-toggle';
      toggleButton.style.width = '60px';
      toggleButton.style.height = '60px';
      toggleButton.style.borderRadius = '50%';
      toggleButton.style.backgroundColor = widgetConfig.customization.primaryColor;
      toggleButton.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
      toggleButton.style.cursor = 'pointer';
      toggleButton.style.display = 'flex';
      toggleButton.style.justifyContent = 'center';
      toggleButton.style.alignItems = 'center';
      toggleButton.style.transition = 'all 0.3s ease';
      toggleButton.style.marginTop = '10px';
      
      // Chat icon
      toggleButton.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${widgetConfig.customization.secondaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `;
      
      // Hover effect
      toggleButton.onmouseover = function() {
        this.style.transform = 'scale(1.1)';
      };
      toggleButton.onmouseout = function() {
        this.style.transform = 'scale(1)';
      };
      
      // Click handler
      toggleButton.onclick = function() {
        toggleWidget();
      };
      
      // Add to container in the right order
      widgetContainer.appendChild(chatFrame);
      widgetContainer.appendChild(toggleButton);
      
      // Adjust for mobile if needed
      adjustWidgetForMobile();
      
      // Add close button to chat frame
      addCloseButton();
    }
    
    // Add a close button to the chat frame
    function addCloseButton() {
      const closeButton = document.createElement('div');
      closeButton.id = 'my-chat-widget-close';
      closeButton.style.position = 'absolute';
      closeButton.style.top = '10px';
      closeButton.style.right = '10px';
      closeButton.style.width = '30px';
      closeButton.style.height = '30px';
      closeButton.style.borderRadius = '50%';
      closeButton.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
      closeButton.style.display = 'flex';
      closeButton.style.justifyContent = 'center';
      closeButton.style.alignItems = 'center';
      closeButton.style.cursor = 'pointer';
      closeButton.style.zIndex = '100';
      closeButton.style.transition = 'background-color 0.3s ease';
      
      closeButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      
      closeButton.onmouseover = function() {
        this.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
      };
      closeButton.onmouseout = function() {
        this.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';
      };
      closeButton.onclick = function(e) {
        e.stopPropagation();
        closeWidget();
      };
      
      chatFrame.appendChild(closeButton);
    }
    
    // Adjust widget for mobile devices
    function adjustWidgetForMobile() {
      const isMobile = window.innerWidth <= 768;
      
      if (isMobile) {
        if (widgetConfig.customization.mobileFull) {
          // Full screen on mobile
          chatFrame.style.width = widgetConfig.customization.mobileWidth;
          chatFrame.style.height = widgetConfig.customization.mobileHeight;
          chatFrame.style.position = 'fixed';
          chatFrame.style.bottom = '0';
          chatFrame.style.right = '0';
          chatFrame.style.left = '0';
          chatFrame.style.top = '0';
          chatFrame.style.margin = '0';
          chatFrame.style.maxWidth = '100%';
          chatFrame.style.maxHeight = '100%';
          chatFrame.style.borderRadius = '0';
          chatFrame.style.zIndex = '999999';
        } else {
          // Responsive but not full screen
          chatFrame.style.width = widgetConfig.customization.mobileWidth;
          chatFrame.style.maxWidth = '90vw';
          chatFrame.style.height = widgetConfig.customization.mobileHeight;
          chatFrame.style.maxHeight = '80vh';
        }
      } else {
        // Desktop layout
        chatFrame.style.width = widgetConfig.customization.width;
        chatFrame.style.height = widgetConfig.customization.height;
        chatFrame.style.position = 'relative';
        chatFrame.style.bottom = 'auto';
        chatFrame.style.right = 'auto';
        chatFrame.style.left = 'auto';
        chatFrame.style.top = 'auto';
        chatFrame.style.margin = '0 0 16px 0';
        chatFrame.style.borderRadius = '10px';
        chatFrame.style.zIndex = '9999';
      }
    }
    
    // Apply customization to widget elements
    function applyCustomization() {
      if (!widgetConfig || !widgetContainer) return;
      
      // Apply to toggle button
      if (toggleButton) {
        toggleButton.style.backgroundColor = widgetConfig.customization.primaryColor;
        toggleButton.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${widgetConfig.customization.secondaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        `;
      }
      
      // Adjust position if specified
      if (widgetConfig.customization.position === 'left') {
        widgetContainer.style.right = 'auto';
        widgetContainer.style.left = '20px';
        widgetContainer.style.alignItems = 'flex-start';
      } else {
        widgetContainer.style.right = '20px';
        widgetContainer.style.left = 'auto';
        widgetContainer.style.alignItems = 'flex-end';
      }
      
      // Resize if dimensions changed
      chatFrame.style.width = widgetConfig.customization.width;
      chatFrame.style.height = widgetConfig.customization.height;
      
      // Re-apply mobile adjustments
      adjustWidgetForMobile();
      
      // If frame is open, reinitialize the inner widget
      if (isWidgetOpen) {
        initializeOriginalWidget(widgetConfig.widgetId);
      }
    }
    
    // Toggle widget visibility
    function toggleWidget() {
      if (isWidgetOpen) {
        closeWidget();
      } else {
        openWidget();
      }
    }
    
    // Open the widget
    function openWidget() {
      if (!isWidgetInitialized) return;
      
      // Display the frame
      chatFrame.style.display = 'block';
      
      // Use a delay to trigger animation
      setTimeout(() => {
        chatFrame.style.opacity = '1';
        chatFrame.style.transform = 'translateY(0) scale(1)';
      }, 10);
      
      // Update state
      isWidgetOpen = true;
      
      // Toggle icon to close icon
      toggleButton.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${widgetConfig.customization.secondaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      
      // Dispatch event that widget was opened
      dispatchWidgetEvent('open');
    }
    
    // Close the widget
    function closeWidget() {
      if (!isWidgetInitialized || !isWidgetOpen) return;
      
      // Animate out
      chatFrame.style.opacity = '0';
      chatFrame.style.transform = 'translateY(20px) scale(0.9)';
      
      // Hide after animation completes
      setTimeout(() => {
        chatFrame.style.display = 'none';
      }, 300);
      
      // Update state
      isWidgetOpen = false;
      
      // Toggle icon back to chat icon
      toggleButton.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${widgetConfig.customization.secondaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `;
      
      // Dispatch event that widget was closed
      dispatchWidgetEvent('close');
    }
    
    // Minimize widget (make it smaller but still visible)
    function minimizeWidget() {
      if (!isWidgetInitialized || !isWidgetOpen) return;
      
      chatFrame.style.height = '50px';
      isWidgetMinimized = true;
      
      dispatchWidgetEvent('minimize');
    }
    
    // Maximize widget (restore from minimized state)
    function maximizeWidget() {
      if (!isWidgetInitialized || !isWidgetOpen || !isWidgetMinimized) return;
      
      chatFrame.style.height = widgetConfig.customization.height;
      isWidgetMinimized = false;
      
      dispatchWidgetEvent('maximize');
    }
    
    // Initialize the original TestMyPrompt widget
    function initializeOriginalWidget(widgetId) {
      // Clear any existing content
      while (chatFrame.firstChild) {
        chatFrame.removeChild(chatFrame.firstChild);
      }
      
      // Add close button back
      addCloseButton();
      
      // Create a hidden iframe to isolate the TestMyPrompt widget
      const iframe = document.createElement('iframe');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      chatFrame.appendChild(iframe);
      
      // Write content to iframe
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Chat</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
              overflow: hidden;
            }
            
            /* Override TestMyPrompt's default styles */
            .tms-chat-widget-toggle {
              display: none !important; /* Hide their toggle button */
            }
            
            .tms-chat-widget-container {
              position: static !important;
              width: 100% !important;
              height: 100% !important;
              max-height: 100% !important;
            }
            
            .tms-chat-widget-frame {
              position: static !important;
              width: 100% !important;
              height: 100% !important;
              max-height: 100% !important;
              box-shadow: none !important;
              border-radius: 0 !important;
              margin: 0 !important;
            }
            
            /* Custom header styles */
            .tms-chat-header {
              background-color: ${widgetConfig.customization.primaryColor} !important;
              color: ${widgetConfig.customization.secondaryColor} !important;
            }
            
            /* Custom scrollbar */
            ::-webkit-scrollbar {
              width: 8px;
            }
            
            ::-webkit-scrollbar-track {
              background: #f1f1f1;
            }
            
            ::-webkit-scrollbar-thumb {
              background: #ccc;
              border-radius: 4px;
            }
            
            ::-webkit-scrollbar-thumb:hover {
              background: #999;
            }
          </style>
        </head>
        <body>
          <!-- TestMyPrompt Widget Script -->
          <script src="https://testmyprompt.com/widget/${widgetId}/widget.js"><\/script>
          <script>
            // Initialize the TestMyPrompt widget
            document.addEventListener('DOMContentLoaded', function() {
              if (window.AIChatWidget) {
                window.AIChatWidget.init({
                  widgetId: "${widgetId}",
                  autoOpen: true  // Always open in our frame
                });
                
                // Apply custom styles after widget is loaded
                setTimeout(function() {
                  // Update header text
                  const header = document.querySelector('.tms-chat-header');
                  if (header) {
                    header.textContent = "${widgetConfig.customization.headerText}";
                  }
                  
                  // Additional customizations
                  const widgetContainer = document.querySelector('.tms-chat-widget-container');
                  if (widgetContainer) {
                    // Add branded footer if specified
                    if ("${widgetConfig.customization.botName}" !== 'Assistant') {
                      const footer = document.createElement('div');
                      footer.style.padding = '8px';
                      footer.style.textAlign = 'center';
                      footer.style.fontSize = '12px';
                      footer.style.color = '#999';
                      footer.style.borderTop = '1px solid #eee';
                      footer.textContent = "Powered by ${widgetConfig.customization.botName}";
                      widgetContainer.appendChild(footer);
                    }
                    
                    // Add logo if specified
                    if ("${widgetConfig.customization.logoUrl}") {
                      const logoContainer = document.createElement('div');
                      logoContainer.style.position = 'absolute';
                      logoContainer.style.top = '10px';
                      logoContainer.style.right = '10px';
                      logoContainer.style.width = '24px';
                      logoContainer.style.height = '24px';
                      
                      const logo = document.createElement('img');
                      logo.src = "${widgetConfig.customization.logoUrl}";
                      logo.style.width = '100%';
                      logo.style.height = '100%';
                      logo.style.objectFit = 'contain';
                      
                      logoContainer.appendChild(logo);
                      const header = document.querySelector('.tms-chat-header');
                      if (header) {
                        header.style.position = 'relative';
                        header.appendChild(logoContainer);
                      }
                    }
                  }
                  
                  // Forward error messages to parent window
                  window.addEventListener('error', function(event) {
                    window.parent.postMessage({
                      type: 'chatbot-event',
                      event: 'error',
                      error: event.error ? event.error.toString() : 'Unknown error'
                    }, '*');
                  });
                  
                  // Add message bus to communicate between frames
                  window.addEventListener('message', function(event) {
                    if (event.data && event.data.type === 'chatbot-command') {
                      // Handle commands from parent window
                      switch(event.data.command) {
                        case 'clear':
                          // Clear chat history
                          const resetButton = document.querySelector('.tms-chat-reset-button');
                          if (resetButton) resetButton.click();
                          break;
                      }
                    }
                  });
                }, 500);
              }
            });
          <\/script>
        </body>
        </html>
      `);
      iframeDoc.close();
    }
    
    // Refresh token internal implementation
    function refreshTokenInternal() {
      // Clear any existing refresh timeout
      if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
        tokenRefreshTimeout = null;
      }
      
      return fetch(`${SERVER_URL}/api/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          clientId: currentTokenData.clientId,
          refreshToken: currentTokenData.refreshToken
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
      })
      .catch(error => {
        console.error('[MyChatWidget] Token refresh error:', error);
        throw error;
      });
    }
    
    // Set up token refresh timer
    function setupTokenRefresh() {
      // Clear any existing timeout
      if (tokenRefreshTimeout) {
        clearTimeout(tokenRefreshTimeout);
      }
      
      // Schedule token refresh for 5 minutes before expiration
      // Assuming token is set to expire in 1 hour (3600000 ms)
      const refreshTime = 55 * 60 * 1000; // 55 minutes (5 minutes before expiry)
      
      tokenRefreshTimeout = setTimeout(() => {
        refreshTokenInternal()
          .catch(error => {
            console.error('[MyChatWidget] Scheduled token refresh failed:', error);
            showError(ERROR_MESSAGES.TOKEN_EXPIRED);
          });
      }, refreshTime);
    }
    
    // Handle token expiration error
    function handleTokenExpiration() {
      // Show a message to the user
      const expirationMessage = document.createElement('div');
      expirationMessage.style.position = 'absolute';
      expirationMessage.style.top = '0';
      expirationMessage.style.left = '0';
      expirationMessage.style.width = '100%';
      expirationMessage.style.height = '100%';
      expirationMessage.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
      expirationMessage.style.display = 'flex';
      expirationMessage.style.flexDirection = 'column';
      expirationMessage.style.justifyContent = 'center';
      expirationMessage.style.alignItems = 'center';
      expirationMessage.style.textAlign = 'center';
      expirationMessage.style.padding = '20px';
      expirationMessage.style.zIndex = '1000';
      expirationMessage.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      
      const messageText = document.createElement('p');
      messageText.textContent = ERROR_MESSAGES.TOKEN_EXPIRED;
      messageText.style.marginBottom = '20px';
      messageText.style.color = '#333';
      messageText.style.fontWeight = 'bold';
      
      const refreshButton = document.createElement('button');
      refreshButton.textContent = 'Refresh Session';
      refreshButton.style.padding = '10px 20px';
      refreshButton.style.backgroundColor = widgetConfig?.customization?.primaryColor || DEFAULT_CUSTOMIZATION.primaryColor;
      refreshButton.style.color = widgetConfig?.customization?.secondaryColor || DEFAULT_CUSTOMIZATION.secondaryColor;
      refreshButton.style.border = 'none';
      refreshButton.style.borderRadius = '5px';
      refreshButton.style.cursor = 'pointer';
      
      refreshButton.onclick = function() {
        // Remove the message
        if (expirationMessage.parentNode) {
          expirationMessage.parentNode.removeChild(expirationMessage);
        }
        
        // Try to refresh the token
        refreshTokenInternal()
          .then(() => {
            // Reinitialize the widget
            initializeOriginalWidget(widgetConfig.widgetId);
          })
          .catch(error => {
            console.error('[MyChatWidget] Failed to refresh token:', error);
            messageText.textContent = 'Failed to refresh your session. Please reload the page.';
            if (expirationMessage.parentNode === null) {
              chatFrame.appendChild(expirationMessage);
            }
          });
      };
      
      expirationMessage.appendChild(messageText);
      expirationMessage.appendChild(refreshButton);
      
      chatFrame.appendChild(expirationMessage);
    }
    
    // Dispatch a widget event
    function dispatchWidgetEvent(eventName, data = {}) {
      const event = new CustomEvent('MyChatWidget:' + eventName, {
        detail: {
          ...data,
          timestamp: new Date().toISOString(),
          clientId: currentTokenData ? currentTokenData.clientId : null
        }
      });
      
      document.dispatchEvent(event);
      
      // Also dispatch to parent window if in iframe
      if (window !== window.parent) {
        window.parent.postMessage({
          type: 'MyChatWidget:event',
          event: eventName,
          data: {
            ...data,
            timestamp: new Date().toISOString(),
            clientId: currentTokenData ? currentTokenData.clientId : null
          }
        }, '*');
      }
    }
    
    // Utility: Debounce function to limit frequency of function calls
    function debounce(func, wait) {
      let timeout;
      return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          func.apply(context, args);
        }, wait);
      };
    }
    
    // Initialize with custom settings if available from script tag
    const scriptTag = document.currentScript || (function() {
      const scripts = document.getElementsByTagName('script');
      return scripts[scripts.length - 1];
    })();
    
    if (scriptTag) {
      const dataSettings = scriptTag.getAttribute('data-settings');
      if (dataSettings) {
        try {
          const settings = JSON.parse(dataSettings);
          if (settings && typeof settings === 'object') {
            // Auto-initialize if token and clientId are provided
            if (settings.token && settings.clientId) {
              setTimeout(() => {
                window.MyChatWidget.init(settings);
              }, 0);
            }
          }
        } catch (e) {
          console.error('[MyChatWidget] Failed to parse widget settings:', e);
        }
      }
    }
    
    // Expose additional functionality through window.MyChatWidget
    Object.assign(window.MyChatWidget, {
      /**
       * Checks if the widget is initialized
       * @returns {boolean} Whether the widget is initialized
       */
      isInitialized: function() {
        return isWidgetInitialized;
      },
      
      /**
       * Checks if the widget is open
       * @returns {boolean} Whether the widget is open
       */
      isOpen: function() {
        return isWidgetOpen;
      },
      
      /**
       * Sets additional user data to be sent with messages
       * @param {Object} data User data to attach to messages
       * @returns {Object} MyChatWidget for chaining
       */
      setUserData: function(data) {
        if (typeof data !== 'object' || data === null) {
          console.error('[MyChatWidget] User data must be an object');
          return this;
        }
        
        if (window.MyChatWidget._userData) {
          window.MyChatWidget._userData = {
            ...window.MyChatWidget._userData,
            ...data
          };
        } else {
          window.MyChatWidget._userData = data;
        }
        
        // Send to iframe if active
        if (isWidgetInitialized && chatFrame) {
          const iframe = chatFrame.querySelector('iframe');
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              type: 'chatbot-command',
              command: 'setUserData',
              data: window.MyChatWidget._userData
            }, '*');
          }
        }
        
        return this;
      },
      
      /**
       * Gets the current widget configuration
       * @returns {Object} Current widget configuration
       */
      getConfig: function() {
        return widgetConfig ? { ...widgetConfig } : null;
      },
      
      /**
       * Sends a command to the chat widget iframe
       * @param {string} command The command to send
       * @param {*} data Additional data for the command
       * @returns {Object} MyChatWidget for chaining
       */
      sendCommand: function(command, data = {}) {
        if (!isWidgetInitialized || !chatFrame) {
          console.warn('[MyChatWidget] Widget not initialized');
          return this;
        }
        
        const iframe = chatFrame.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'chatbot-command',
            command,
            data
          }, '*');
        }
        
        return this;
      },
      
      /**
       * Destroys the widget and removes all elements
       * @returns {void}
       */
      destroy: function() {
        if (tokenRefreshTimeout) {
          clearTimeout(tokenRefreshTimeout);
          tokenRefreshTimeout = null;
        }
        
        if (widgetContainer && widgetContainer.parentNode) {
          widgetContainer.parentNode.removeChild(widgetContainer);
        }
        
        if (loadingIndicator && loadingIndicator.parentNode) {
          loadingIndicator.parentNode.removeChild(loadingIndicator);
        }
        
        const errorElement = document.getElementById('my-chat-widget-error');
        if (errorElement && errorElement.parentNode) {
          errorElement.parentNode.removeChild(errorElement);
        }
        
        isWidgetInitialized = false;
        isWidgetOpen = false;
        isWidgetMinimized = false;
        widgetConfig = null;
        currentTokenData = null;
        
        console.log('[MyChatWidget] Widget destroyed');
      },
      
      /**
       * Registers a callback function for widget events
       * @param {string} eventName The name of the event to listen for
       * @param {Function} callback The callback function to execute
       * @returns {Object} MyChatWidget for chaining
       */
      on: function(eventName, callback) {
        if (typeof callback !== 'function') {
          console.error('[MyChatWidget] Event callback must be a function');
          return this;
        }
        
        document.addEventListener('MyChatWidget:' + eventName, function(event) {
          callback(event.detail);
        });
        
        return this;
      }
    });
    
    // Log initialization
    console.log('[MyChatWidget] Widget script loaded (v' + WIDGET_VERSION + ')');
  })();