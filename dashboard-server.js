const express = require('express');
const path = require('path');
const { createServer } = require('http');

const app = express();
const PORT = process.env.PORT || 5000;

// Basic middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/dist')));

// Simple routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/discord/invite', (req, res) => {
  const botId = process.env.REPL_ID || 'YOUR_BOT_ID';
  const permissions = '1099816856646';
  const scopes = 'bot%20applications.commands';
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${botId}&permissions=${permissions}&scope=${scopes}`;
  res.redirect(inviteUrl);
});

// Catch all for React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'));
});

const server = createServer(app);
server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Dashboard server running on port ${PORT}`);
  console.log(`📊 Access at: http://localhost:${PORT}`);
});

module.exports = server;