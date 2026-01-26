// app.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const logger = require('./utils/logger');
const queueSocketHandler = require('./utils/queueSocketHandler');
require('dotenv').config();

// Import routes
const mockEpisRoutes = require('./routes/mockEpis');
const checkinRoutes = require('./routes/checkin');
const tokenRoutes = require('./routes/tokenRoutes');
const staffRoutes = require('./routes/staff');
const queueRoutes = require('./routes/queue');

const app = express();
const server = http.createServer(app);

// Socket.IO configuration
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Initialize queue socket handler
queueSocketHandler.initialize(io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes registration
app.use('/api/mock-epis', mockEpisRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/queues', queueRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'NSHQMS API is running',
    timestamp: new Date().toISOString(),
    socketIO: 'enabled'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack 
  });
  
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nshqms', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    logger.info('MongoDB connected successfully');

    // Register all models to prevent "Schema hasn't been registered" errors
    require('./models/role');
    require('./models/Department');
    require('./models/staff');
    logger.info('Models registered successfully');

  } catch (err) {
    logger.error('MongoDB connection error', { error: err.message });
    process.exit(1);
  }
};

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  await connectDB();
  
  // Use server.listen() instead of app.listen()
  server.listen(PORT, () => {
    logger.info(`NSHQMS server running on port ${PORT}`);
    logger.info(`Socket.IO enabled on ws://localhost:${PORT}`);
  });
};

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Export both app and server for testing
module.exports = { app, server, io };