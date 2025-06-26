const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 5000;

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
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

  // API routes
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  if (pathname === '/api/auth/discord') {
    // Use DISCORD_CLIENT_ID if available, otherwise extract from DISCORD_TOKEN
    let clientId = process.env.DISCORD_CLIENT_ID;
    
    if (!clientId && process.env.DISCORD_TOKEN) {
      // Extract client ID from bot token (first part before the dot)
      const tokenParts = process.env.DISCORD_TOKEN.split('.');
      if (tokenParts.length > 0) {
        // Decode the first part which contains the bot ID
        try {
          clientId = Buffer.from(tokenParts[0], 'base64').toString('utf8');
        } catch (e) {
          // If decoding fails, the first part might already be the ID
          clientId = tokenParts[0];
        }
      }
    }
    
    if (!clientId) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Discord client ID not configured' }));
      return;
    }
    
    // Get the public Replit domain
    let host = process.env.REPLIT_DOMAINS ? process.env.REPLIT_DOMAINS.split(',')[0] : req.headers.host;
    
    // Fallback to other patterns if needed
    if (!host || host.includes('localhost')) {
      host = `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
    }
    const redirectUri = encodeURIComponent('https://' + host + '/api/auth/discord/callback');
    // Try with just basic identify scope first
    const scopes = 'identify';
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}`;
    
    console.log('🔐 Discord OAuth Request:');
    console.log('  Client ID:', clientId);
    console.log('  Redirect URI:', 'https://' + host + '/api/auth/discord/callback');
    console.log('  Full OAuth URL:', authUrl);
    console.log('  Troubleshooting: If denied, check Discord Developer Portal OAuth2 settings');
    
    res.writeHead(302, { 'Location': authUrl });
    res.end();
    return;
  }

  if (pathname === '/api/auth/discord/callback') {
    // Handle Discord OAuth callback
    const code = parsedUrl.query.code;
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing authorization code' }));
      return;
    }

    // Exchange code for access token
    let clientId = process.env.DISCORD_CLIENT_ID;
    
    if (!clientId && process.env.DISCORD_TOKEN) {
      // Extract client ID from bot token (first part before the dot)
      const tokenParts = process.env.DISCORD_TOKEN.split('.');
      if (tokenParts.length > 0) {
        try {
          clientId = Buffer.from(tokenParts[0], 'base64').toString('utf8');
        } catch (e) {
          clientId = tokenParts[0];
        }
      }
    }
    
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    
    // Get the public Replit domain  
    let host = process.env.REPLIT_DOMAINS ? process.env.REPLIT_DOMAINS.split(',')[0] : req.headers.host;
    
    // Fallback to other patterns if needed
    if (!host || host.includes('localhost')) {
      host = `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
    }
    const redirectUri = 'https://' + host + '/api/auth/discord/callback';

    const tokenData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    });

    // Make request to Discord API
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
      tokenRes.on('data', (chunk) => data += chunk);
      tokenRes.on('end', () => {
        try {
          const tokenResponse = JSON.parse(data);
          if (tokenResponse.access_token) {
            // Set session cookie and redirect to dashboard
            res.writeHead(302, { 
              'Set-Cookie': `discord_token=${tokenResponse.access_token}; HttpOnly; Path=/; Max-Age=604800`,
              'Location': '/'
            });
            res.end();
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to get access token' }));
          }
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid response from Discord' }));
        }
      });
    });

    tokenReq.on('error', (error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to contact Discord API' }));
    });

    tokenReq.write(postData);
    tokenReq.end();
    return;
  }

  if (pathname === '/api/auth/user') {
    // Get user info from Discord
    const cookies = req.headers.cookie;
    let discordToken = null;
    
    if (cookies) {
      const cookieArray = cookies.split(';');
      for (let cookie of cookieArray) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'discord_token') {
          discordToken = value;
          break;
        }
      }
    }

    if (!discordToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not authenticated' }));
      return;
    }

    // Fetch user data from Discord
    const https = require('https');
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: '/api/users/@me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${discordToken}`
      }
    };

    const userReq = https.request(options, (userRes) => {
      let data = '';
      userRes.on('data', (chunk) => data += chunk);
      userRes.on('end', () => {
        try {
          const userData = JSON.parse(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: userData.id,
            username: userData.username,
            discriminator: userData.discriminator,
            avatar: userData.avatar,
            email: userData.email
          }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to parse user data' }));
        }
      });
    });

    userReq.on('error', (error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch user data' }));
    });

    userReq.end();
    return;
  }

  if (pathname === '/api/auth/logout') {
    res.writeHead(302, { 
      'Set-Cookie': 'discord_token=; HttpOnly; Path=/; Max-Age=0',
      'Location': '/'
    });
    res.end();
    return;
  }

  if (pathname === '/api/discord/invite') {
    let botId = process.env.DISCORD_CLIENT_ID;
    
    if (!botId && process.env.DISCORD_TOKEN) {
      // Extract client ID from bot token
      const tokenParts = process.env.DISCORD_TOKEN.split('.');
      if (tokenParts.length > 0) {
        try {
          botId = Buffer.from(tokenParts[0], 'base64').toString('utf8');
        } catch (e) {
          botId = tokenParts[0];
        }
      }
    }
    
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dashboard server running on port ${PORT}`);
  console.log(`📊 Access at: http://localhost:${PORT}`);
});

module.exports = server;