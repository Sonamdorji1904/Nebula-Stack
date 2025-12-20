// app.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const logger = require('./utils/logger');
require('dotenv').config();

// Import routes
const mockEpisRoutes = require('./routes/mockEpis');
const checkinRoutes = require('./routes/checkin');
const tokenRoutes = require('./routes/tokenRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/mock-epis', mockEpisRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/tokens', tokenRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'NSHQMS API is running',
    timestamp: new Date().toISOString()
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
      useUnifiedTopology: true,
      tls: true
    });
    logger.info('MongoDB connected successfully');
  } catch (err) {
    logger.error('MongoDB connection error', { error: err.message });
    process.exit(1);
  }
};

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`NSHQMS server running on port ${PORT}`);
  });
};

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = app;