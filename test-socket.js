require('dotenv').config();
const io = require('socket.io-client');
const fs = require('fs');

// Load the JWT token
const token = fs.readFileSync('token.txt', 'utf8').trim();

console.log('🔌 Connecting to Socket.IO...');
console.log('Token:', token.substring(0, 30) + '...\n');

// Connect to the queue namespace
const socket = io('http://localhost:3000/queue', {
  auth: {
    token: token
  },
  transports: ['websocket']
});

// Connection events
socket.on('connect', () => {
  console.log('✅ Connected to queue namespace');
  console.log('Socket ID:', socket.id);
  console.log('');
  
  // Subscribe to REG department
  console.log('📡 Subscribing to REG department...');
  socket.emit('subscribe:department', 'REG');
  
  // Subscribe to OPD department
  setTimeout(() => {
    console.log('📡 Subscribing to OPD department...');
    socket.emit('subscribe:department', 'OPD');
  }, 1000);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection error:', error.message);
  console.error('Details:', error);
});

socket.on('disconnect', (reason) => {
  console.log('❌ Disconnected:', reason);
});

// Queue events
socket.on('queue:update', (queue) => {
  console.log('\n📊 Queue Update Received:');
  console.log('Department:', queue.department);
  console.log('Current Token:', queue.currentToken);
  console.log('Next Tokens:', queue.nextTokens?.length || 0);
  console.log('Total Pending:', queue.totalPending);
  console.log('Generated At:', queue.generatedAt);
  console.log('---');
});

socket.on('token:status-changed', (event) => {
  console.log('\n🔔 Token Status Changed:');
  console.log('Token:', event.token);
  console.log('Old Status:', event.oldStatus);
  console.log('New Status:', event.newStatus);
  console.log('Department:', event.department);
  console.log('Timestamp:', event.timestamp);
  console.log('---');
});

socket.on('subscription:confirmed', (data) => {
  console.log('✅ Subscription confirmed:', data.department);
});

socket.on('error', (error) => {
  console.error('❌ Socket error:', error);
});

// Keep the script running
console.log('\n👂 Listening for real-time updates...');
console.log('Press Ctrl+C to exit\n');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Closing connection...');
  socket.disconnect();
  process.exit(0);
});
