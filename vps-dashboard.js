const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Get domain from environment or default
const APP_DOMAIN = process.env.APP_DOMAIN || 'localhost:5000';

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`${new Date().toISOString()} - ${req.method} ${pathname}`);

  // Health check
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      domain: APP_DOMAIN
    }));
    return;
  }

  // Discord OAuth start
  if (pathname === '/api/auth/discord') {
    const clientId = process.env.DISCORD_CLIENT_ID;
    
    if (!clientId) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Discord client ID not configured' }));
      return;
    }
    
    // Use APP_DOMAIN for VPS deployment
    const host = APP_DOMAIN;
    const redirectUri = encodeURIComponent(`https://${host}/api/auth/discord/callback`);
    const scopes = 'identify%20email%20guilds';
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}`;
    
    console.log('🔐 Discord OAuth Request:');
    console.log('  Client ID:', clientId);
    console.log('  Domain:', host);
    console.log('  Redirect URI:', `https://${host}/api/auth/discord/callback`);
    console.log('  Full OAuth URL:', authUrl);
    
    res.writeHead(302, { 'Location': authUrl });
    res.end();
    return;
  }

  // Discord OAuth callback
  if (pathname === '/api/auth/discord/callback') {
    const code = parsedUrl.query.code;
    
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing authorization code' }));
      return;
    }

    // Exchange code for access token
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const host = APP_DOMAIN;
    const redirectUri = `https://${host}/api/auth/discord/callback`;

    const tokenData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    });

    // Make request to Discord
    const https = require('https');
    const postData = tokenData.toString();

    const options = {
      hostname: 'discord.com',
      port: 443,
      path: '/api/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const tokenReq = https.request(options, (tokenRes) => {
      let data = '';
      tokenRes.on('data', (chunk) => {
        data += chunk;
      });

      tokenRes.on('end', () => {
        try {
          const tokenInfo = JSON.parse(data);
          
          if (tokenInfo.error) {
            console.error('Discord OAuth error:', tokenInfo);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: tokenInfo.error_description || tokenInfo.error }));
            return;
          }

          // Get user information
          const userOptions = {
            hostname: 'discord.com',
            port: 443,
            path: '/api/users/@me',
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${tokenInfo.access_token}`
            }
          };

          const userReq = https.request(userOptions, (userRes) => {
            let userData = '';
            userRes.on('data', (chunk) => {
              userData += chunk;
            });

            userRes.on('end', () => {
              try {
                const user = JSON.parse(userData);
                console.log('User authenticated:', user.username);
                
                // Store user session (in production, use proper session management)
                const sessionData = {
                  user: user,
                  accessToken: tokenInfo.access_token,
                  timestamp: Date.now()
                };

                // Redirect to dashboard with success
                res.writeHead(302, { 
                  'Location': '/?auth=success',
                  'Set-Cookie': `discord_session=${Buffer.from(JSON.stringify(sessionData)).toString('base64')}; HttpOnly; Path=/; Max-Age=86400`
                });
                res.end();
              } catch (err) {
                console.error('Error parsing user data:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to get user information' }));
              }
            });
          });

          userReq.on('error', (err) => {
            console.error('Error getting user info:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to get user information' }));
          });

          userReq.end();

        } catch (err) {
          console.error('Error parsing token response:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to exchange authorization code' }));
        }
      });
    });

    tokenReq.on('error', (err) => {
      console.error('Error exchanging code for token:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OAuth token exchange failed' }));
    });

    tokenReq.write(postData);
    tokenReq.end();
    return;
  }

  // Get current user
  if (pathname === '/api/auth/user') {
    const cookies = req.headers.cookie;
    if (!cookies) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not authenticated' }));
      return;
    }

    const sessionCookie = cookies.split(';').find(c => c.trim().startsWith('discord_session='));
    if (!sessionCookie) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not authenticated' }));
      return;
    }

    try {
      const sessionData = JSON.parse(Buffer.from(sessionCookie.split('=')[1], 'base64').toString());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessionData.user));
    } catch (err) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid session' }));
    }
    return;
  }

  // Logout
  if (pathname === '/api/auth/logout') {
    res.writeHead(302, { 
      'Location': '/',
      'Set-Cookie': 'discord_session=; HttpOnly; Path=/; Max-Age=0'
    });
    res.end();
    return;
  }

  // Bot invitation
  if (pathname === '/api/discord/invite') {
    const botId = process.env.DISCORD_CLIENT_ID;
    
    if (!botId) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bot ID not configured' }));
      return;
    }
    
    const permissions = '1099816856646';
    const scopes = 'bot%20applications.commands';
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${botId}&permissions=${permissions}&scope=${scopes}`;
    
    res.writeHead(302, { 'Location': inviteUrl });
    res.end();
    return;
  }

  // Static file serving
  let filePath = path.join(__dirname, 'client/dist', pathname === '/' ? 'index.html' : pathname);
  
  // Security check
  if (!filePath.startsWith(path.join(__dirname, 'client/dist'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // If file not found, serve index.html for client-side routing
      if (err.code === 'ENOENT') {
        filePath = path.join(__dirname, 'client/dist/index.html');
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data);
        });
      } else {
        res.writeHead(500);
        res.end('Server Error');
      }
      return;
    }

    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dashboard server running on port ${PORT}`);
  console.log(`🌐 Domain: ${APP_DOMAIN}`);
  console.log(`📊 Access at: http://localhost:${PORT}`);
  
  if (process.env.NODE_ENV === 'production') {
    console.log(`🔒 Production mode - HTTPS access at: https://${APP_DOMAIN}`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});