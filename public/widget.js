// Widget Implementation for ChatBot Leasing System
// File: public/widget.js

(function() {
    // Configuration
    const SERVER_URL = 'https://your-render-domain.onrender.com'; // Change to your Render.com deployment URL
    
    // Widget state
    let widgetConfig = null;
    let isWidgetInitialized = false;
    let isWidgetOpen = false;
    let originalWidgetScript = null;
    let currentTokenData = null;
    
    // Widget elements
    let widgetContainer = null;
    let chatFrame = null;
    
    // Main widget initialization function
    window.MyChatWidget = {
      init: function(config) {
        if (isWidgetInitialized) {
          console.warn('Widget already initialized');
          return;
        }
        
        if (!config || !config.token || !config.clientId) {
          console.error('Invalid widget configuration. Required parameters: token, clientId');
          return;
        }
        
        currentTokenData = {
          token: config.token,
          clientId: config.clientId
        };
        
        // Validate token and retrieve configuration
        validateToken(config.token)
          .then(response => {
            if (!response || !response.valid) {
              console.error('Token validation failed:', response?.error || 'Unknown error');
              return;
            }
            
            widgetConfig = response.config;
            createWidgetElements();
            initializeOriginalWidget(widgetConfig.widgetId);
            
            isWidgetInitialized = true;
            console.log('Chat widget initialized successfully');
          })
          .catch(error => {
            console.error('Failed to initialize widget:', error);
          });
      }
    };
    
    // Validate token with the server
    function validateToken(token) {
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
          throw new Error(`HTTP error ${response.status}`);
        }
        return response.json();
      });
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
      
      // Create toggle button
      const toggleButton = document.createElement('div');
      toggleButton.id = 'my-chat-widget-toggle';
      toggleButton.style.width = '60px';
      toggleButton.style.height = '60px';
      toggleButton.style.borderRadius = '50%';
      toggleButton.style.backgroundColor = widgetConfig.customization?.primaryColor || '#0084ff';
      toggleButton.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
      toggleButton.style.cursor = 'pointer';
      toggleButton.style.display = 'flex';
      toggleButton.style.justifyContent = 'center';
      toggleButton.style.alignItems = 'center';
      toggleButton.style.transition = 'all 0.3s ease';
      toggleButton.style.marginTop = '10px';
      
      // Chat icon
      toggleButton.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${widgetConfig.customization?.secondaryColor || '#ffffff'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
      
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
      
      widgetContainer.appendChild(toggleButton);
      
      // Create chat container
      chatFrame = document.createElement('div');
      chatFrame.id = 'my-chat-widget-frame';
      chatFrame.style.width = '350px';
      chatFrame.style.height = '500px';
      chatFrame.style.backgroundColor = '#ffffff';
      chatFrame.style.borderRadius = '10px';
      chatFrame.style.boxShadow = '0 5px 40px rgba(0, 0, 0, 0.16)';
      chatFrame.style.marginBottom = '16px';
      chatFrame.style.overflow = 'hidden';
      chatFrame.style.transition = 'all 0.3s ease';
      chatFrame.style.opacity = '0';
      chatFrame.style.transform = 'translateY(20px) scale(0.9)';
      chatFrame.style.display = 'none';
      
      widgetContainer.insertBefore(chatFrame, toggleButton);
    }
    
    // Toggle widget visibility
    function toggleWidget() {
      if (isWidgetOpen) {
        // Close the widget
        chatFrame.style.opacity = '0';
        chatFrame.style.transform = 'translateY(20px) scale(0.9)';
        setTimeout(() => {
          chatFrame.style.display = 'none';
        }, 300);
      } else {
        // Open the widget
        chatFrame.style.display = 'block';
        setTimeout(() => {
          chatFrame.style.opacity = '1';
          chatFrame.style.transform = 'translateY(0) scale(1)';
        }, 10);
      }
      
      isWidgetOpen = !isWidgetOpen;
    }
    
    // Initialize the original TestMyPrompt widget
    function initializeOriginalWidget(widgetId) {
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
              background-color: ${widgetConfig.customization?.primaryColor || '#0084ff'} !important;
              color: ${widgetConfig.customization?.secondaryColor || '#ffffff'} !important;
            }
          </style>
        </head>
        <body>
          <!-- TestMyPrompt Widget Script -->
          <script src="https://testmyprompt.com/widget/${widgetId}/widget.js"></script>
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
                  const header = document.querySelector('.tms-chat-header');
                  if (header) {
                    header.textContent = "${widgetConfig.customization?.headerText || 'Chat with us'}";
                  }
                }, 500);
              }
            });
          </script>
        </body>
        </html>
      `);
      iframeDoc.close();
    }
    
    // Helper function to refresh token when needed
    function refreshToken() {
      // This would be implemented if you want to auto-refresh tokens
      // For now, just logging the error
      console.error('Token has expired. Please refresh the page to get a new token.');
    }
    
    // Listen for messages from iframe or parent window
    window.addEventListener('message', function(event) {
      // Handle any messages if needed
      if (event.data && event.data.type === 'chatbot-event') {
        console.log('Received message from chatbot:', event.data);
      }
    });
  })();