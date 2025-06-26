// Simple debug script to test OAuth configuration
const https = require('https');

const clientId = '1386703364036759762';
const redirectUri = 'https://f11710d6-e245-4975-b814-c2ff623077b5-00-2ie9nzseqsf22.worf.replit.dev/api/auth/discord/callback';

console.log('Testing Discord OAuth Configuration:');
console.log('Client ID:', clientId);
console.log('Redirect URI:', redirectUri);

// Test if the Discord API endpoint is accessible
const testUrl = `https://discord.com/api/oauth2/applications/${clientId}/rpc`;

https.get(testUrl, (res) => {
  console.log('\nDiscord API Response:');
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response Body:', data);
  });
}).on('error', (err) => {
  console.log('Error accessing Discord API:', err.message);
});

// Generate different OAuth URL variations
console.log('\n--- OAuth URL Variations ---');

const variations = [
  { scope: 'identify', name: 'Basic identify only' },
  { scope: 'identify%20email', name: 'Identify + email' },
  { scope: 'identify%20guilds', name: 'Identify + guilds' },
  { scope: 'identify%20email%20guilds', name: 'All scopes' }
];

variations.forEach((variation, index) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${variation.scope}`;
  console.log(`\n${index + 1}. ${variation.name}:`);
  console.log(url);
});