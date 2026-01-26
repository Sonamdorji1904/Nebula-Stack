// utils/queueSocketHandler.js
/**
 * Real-time queue update handler using Socket.IO
 * This module handles broadcasting queue updates to connected clients
 */

const queueService = require('../services/queueService');
const logger = require('../utils/logger');

class QueueSocketHandler {
  constructor() {
    this.io = null;
  }

  /**
   * Initialize socket.io instance
   * @param {SocketIO.Server} io - Socket.IO server instance
   */
  initialize(io) {
    this.io = io;
    this.setupNamespace();
    logger.info('Queue socket handler initialized');
  }

  /**
   * Setup queue-specific namespace and event handlers
   */
  setupNamespace() {
    const queueNamespace = this.io.of('/queue');

    queueNamespace.on('connection', (socket) => {
      logger.info('Client connected to queue namespace', {
        socketId: socket.id,
        ip: socket.handshake.address
      });

      // Handle department subscription
      socket.on('subscribe:department', (department) => {
        if (department && /^[A-Z]{2,5}$/.test(department)) {
          socket.join(department);
          logger.info('Client subscribed to department queue', {
            socketId: socket.id,
            department
          });

          // Send initial queue state
          this.emitQueueUpdate(department);
        }
      });

      // Handle department unsubscription
      socket.on('unsubscribe:department', (department) => {
        socket.leave(department);
        logger.info('Client unsubscribed from department queue', {
          socketId: socket.id,
          department
        });
      });

      socket.on('disconnect', () => {
        logger.info('Client disconnected from queue namespace', {
          socketId: socket.id
        });
      });
    });
  }

  /**
   * Emit queue update to all subscribed clients
   * @param {string} department - Department code
   * @param {Object} options - Additional options
   */
  async emitQueueUpdate(department, options = {}) {
    try {
      if (!this.io) {
        logger.warn('Socket.IO not initialized, skipping queue update');
        return;
      }

      const queue = await queueService.getLiveQueue(department);
      const queueNamespace = this.io.of('/queue');

      queueNamespace.to(department).emit('queue:update', {
        ...queue,
        ...options
      });

      logger.debug('Queue update emitted', {
        department,
        currentToken: queue.currentToken?.token,
        pendingCount: queue.nextTokens.length
      });
    } catch (error) {
      logger.error('Failed to emit queue update', {
        department,
        error: error.message
      });
    }
  }

  /**
   * Emit token status change
   * @param {string} department - Department code
   * @param {string} token - Token number
   * @param {string} status - New status
   */
  async emitTokenStatusChange(department, token, status) {
    try {
      if (!this.io) return;

      const queueNamespace = this.io.of('/queue');
      
      queueNamespace.to(department).emit('token:status-changed', {
        department,
        token,
        status,
        timestamp: new Date()
      });

      // Also emit full queue update
      await this.emitQueueUpdate(department);

      logger.info('Token status change emitted', {
        department,
        token,
        status
      });
    } catch (error) {
      logger.error('Failed to emit token status change', {
        department,
        token,
        error: error.message
      });
    }
  }
}

module.exports = new QueueSocketHandler();