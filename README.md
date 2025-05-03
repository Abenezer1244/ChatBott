Chatbot Leasing System
This system allows you to lease TestMyPrompt chatbots to clients by providing them with a custom widget integration. The system includes token generation, client management, and domain restrictions.
Features

Token-based Authentication: Generate secure JWT tokens for clients
Domain Restrictions: Limit where the chatbot can be embedded
Admin Dashboard: Manage clients and generate tokens
Customization: Allow clients to customize their chatbot appearance
Usage Tracking: Monitor client usage of the chatbot

Installation

Clone this repository
Install dependencies:
npm install

Create a .env file based on the .env.template file
Start the server:
npm start


Deployment on Render.com

Create a new Web Service on Render.com
Connect your GitHub repository
Configure the following settings:

Environment: Node
Build Command: npm install
Start Command: npm start


Add environment variables from your .env file
Deploy the service

System Architecture
The system consists of:

Server: Handles API requests, token generation, and client validation
Widget.js: Client-side script that renders the chatbot
Admin Dashboard: Web interface for managing clients

API Endpoints
Authentication

POST /api/token: Generate a new token for a client

Request: { "clientId": "client-id", "adminKey": "admin-key" }
Response: { "token": "jwt-token" }



Client Management

POST /api/clients: Create a new client

Request: { "adminKey": "admin-key", "name": "Client Name", "email": "client@example.com", "allowedDomains": ["example.com"], "widgetId": "testmyprompt-widget-id" }
Response: { "message": "Client created successfully", "clientId": "client-id" }


PUT /api/clients/:clientId: Update client configuration

Request: { "adminKey": "admin-key", "active": true, "allowedDomains": ["example.com"], "customization": { "primaryColor": "#0084ff" } }
Response: { "message": "Client updated successfully" }


GET /api/clients/:clientId/stats: Get client usage statistics

Request: Query param ?adminKey=admin-key
Response: { "requestCount": 100, "lastRequestDate": "2025-05-03T12:00:00Z", "active": true }



Widget Validation

POST /api/validate: Validate token and get chatbot configuration

Request: { "token": "jwt-token", "domain": "example.com" }
Response: { "valid": true, "config": { "widgetId": "testmyprompt-widget-id", "customization": { ... } } }



Client Integration
Clients need to add the following code to their website:
html<script src="https://your-render-domain.onrender.com/widget.js"></script>
<script>
  window.MyChatWidget.init({
    token: "YOUR_TOKEN",
    clientId: "YOUR_CLIENT_ID"
  });
</script>
Security Considerations

Always use HTTPS in production
Change the JWT_SECRET and ADMIN_KEY values in the .env file
Set appropriate domain restrictions for clients
Consider implementing additional rate limiting for production use

Monitoring and Maintenance
Monitor your Render.com dashboard for:

Service uptime and performance
Error logs
Resource usage

Regularly back up your MongoDB database.
License
This project is proprietary and confidential. Unauthorized copying or distribution is prohibited.