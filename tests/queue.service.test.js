// tests/queue.service.test.js
const queueService = require('../services/queueService');
const Patient = require('../models/Patient');
const Department = require('../models/Department');

// Mock the models
jest.mock('../models/Patient');
jest.mock('../models/Department');
jest.mock('../utils/logger');

describe('QueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getActiveTokensByDepartment', () => {
    it('should return active tokens for a department in FIFO order', async () => {
      // Mock department exists
      Department.findOne.mockResolvedValue({
        code: 'REG',
        name: 'Registration'
      });

      // Mock patients with active tokens
      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'PID001',
              firstName: 'John',
              lastName: 'Doe',
              activeTokens: [
                {
                  token: 'REG-001',
                  department: 'REG',
                  status: 'in-progress',
                  createdAt: new Date('2026-01-22T09:00:00Z'),
                  issuedAt: new Date('2026-01-22T09:00:00Z')
                }
              ]
            },
            {
              patientId: 'PID002',
              firstName: 'Jane',
              lastName: 'Smith',
              activeTokens: [
                {
                  token: 'REG-002',
                  department: 'REG',
                  status: 'pending',
                  createdAt: new Date('2026-01-22T09:05:00Z'),
                  issuedAt: new Date('2026-01-22T09:05:00Z')
                }
              ]
            },
            {
              patientId: 'PID003',
              firstName: 'Bob',
              lastName: 'Johnson',
              activeTokens: [
                {
                  token: 'REG-003',
                  department: 'REG',
                  status: 'pending',
                  createdAt: new Date('2026-01-22T09:03:00Z'),
                  issuedAt: new Date('2026-01-22T09:03:00Z')
                }
              ]
            }
          ])
        })
      });

      const tokens = await queueService.getActiveTokensByDepartment('REG');

      expect(tokens).toHaveLength(3);
      expect(tokens[0].token).toBe('REG-001');
      expect(tokens[1].token).toBe('REG-003'); // Earlier timestamp
      expect(tokens[2].token).toBe('REG-002');
      expect(tokens[0].patientName).toBe('John Doe');
    });

    it('should throw error if department does not exist', async () => {
      Department.findOne.mockResolvedValue(null);

      await expect(
        queueService.getActiveTokensByDepartment('INVALID')
      ).rejects.toThrow('Department INVALID not found');
    });

    it('should filter out completed and cancelled tokens', async () => {
      Department.findOne.mockResolvedValue({ code: 'REG' });

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'PID001',
              firstName: 'John',
              lastName: 'Doe',
              activeTokens: [
                {
                  token: 'REG-001',
                  department: 'REG',
                  status: 'completed',
                  createdAt: new Date()
                },
                {
                  token: 'REG-002',
                  department: 'REG',
                  status: 'pending',
                  createdAt: new Date(),
                  issuedAt: new Date()
                }
              ]
            }
          ])
        })
      });

      const tokens = await queueService.getActiveTokensByDepartment('REG');

      expect(tokens).toHaveLength(1);
      expect(tokens[0].token).toBe('REG-002');
    });
  });

  describe('calculateAverageServiceTime', () => {
    it('should calculate average service time from historical data', async () => {
      const now = new Date();
      const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              activeTokens: [
                {
                  department: 'REG',
                  status: 'completed',
                  issuedAt: twentyMinsAgo,
                  completedAt: tenMinsAgo // 10 min service
                }
              ]
            },
            {
              activeTokens: [
                {
                  department: 'REG',
                  status: 'completed',
                  issuedAt: new Date(now.getTime() - 30 * 60 * 1000),
                  completedAt: new Date(now.getTime() - 15 * 60 * 1000) // 15 min service
                }
              ]
            }
          ])
        })
      });

      const result = await queueService.calculateAverageServiceTime('REG');

      expect(result.averageServiceTime).toBeGreaterThan(0);
      // Should be around 12-13 minutes (average of 10 and 15)
      expect(result.averageServiceTime).toBeGreaterThanOrEqual(12);
      expect(result.averageServiceTime).toBeLessThanOrEqual(13);
      expect(result.basedOnSamples).toBe(2);
    });

    it('should return default 5 minutes if no historical data', async () => {
      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const result = await queueService.calculateAverageServiceTime('REG');

      expect(result.averageServiceTime).toBe(5);
      expect(result.basedOnSamples).toBe(0);
    });
  });

  describe('getLiveQueue', () => {
    it('should return current token and next tokens with EWT', async () => {
      // This test has longer setup, increase timeout
      jest.setTimeout(15000);
      
      // Mock department
      Department.findOne.mockResolvedValue({ code: 'REG' });

      // Mock active tokens
      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'PID001',
              firstName: 'John',
              lastName: 'Doe',
              activeTokens: [
                {
                  token: 'REG-001',
                  department: 'REG',
                  status: 'in-progress',
                  createdAt: new Date('2026-01-22T09:00:00Z'),
                  issuedAt: new Date('2026-01-22T09:00:00Z')
                }
              ]
            },
            {
              patientId: 'PID002',
              firstName: 'Jane',
              lastName: 'Smith',
              activeTokens: [
                {
                  token: 'REG-002',
                  department: 'REG',
                  status: 'pending',
                  createdAt: new Date('2026-01-22T09:05:00Z'),
                  issuedAt: new Date('2026-01-22T09:05:00Z')
                }
              ]
            },
            {
              patientId: 'PID003',
              firstName: 'Bob',
              lastName: 'Johnson',
              activeTokens: [
                {
                  token: 'REG-003',
                  department: 'REG',
                  status: 'pending',
                  createdAt: new Date('2026-01-22T09:10:00Z'),
                  issuedAt: new Date('2026-01-22T09:10:00Z')
                }
              ]
            }
          ])
        })
      });

      const queue = await queueService.getLiveQueue('REG');

      expect(queue.department).toBe('REG');
      expect(queue.currentToken).toBeDefined();
      expect(queue.currentToken.token).toBe('REG-001');
      expect(queue.currentToken.ewtMinutes).toBe(0);
      expect(queue.nextTokens).toHaveLength(2);
      expect(queue.nextTokens[0].token).toBe('REG-002');
      expect(queue.nextTokens[0].ewtMinutes).toBeGreaterThan(0);
      expect(queue.nextTokens[1].ewtMinutes).toBeGreaterThan(
        queue.nextTokens[0].ewtMinutes
      );
      expect(queue.totalPending).toBe(2);
    });

    it('should handle queue with no current token', async () => {
      jest.setTimeout(15000);
      
      Department.findOne.mockResolvedValue({ code: 'REG' });

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'PID001',
              firstName: 'John',
              lastName: 'Doe',
              activeTokens: [
                {
                  token: 'REG-001',
                  department: 'REG',
                  status: 'pending',
                  createdAt: new Date(),
                  issuedAt: new Date()
                }
              ]
            }
          ])
        })
      });

      const queue = await queueService.getLiveQueue('REG');

      expect(queue.currentToken).toBeNull();
      expect(queue.nextTokens).toHaveLength(1);
    });
  });

  describe('getQueueStats', () => {
    it('should return correct queue statistics', async () => {
      Department.findOne.mockResolvedValue({ code: 'REG' });

      const oldDate = new Date(Date.now() - 30 * 60 * 1000); // 30 mins ago

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'PID001',
              firstName: 'John',
              lastName: 'Doe',
              activeTokens: [
                {
                  token: 'REG-001',
                  department: 'REG',
                  status: 'in-progress',
                  createdAt: oldDate,
                  issuedAt: oldDate
                }
              ]
            },
            {
              patientId: 'PID002',
              firstName: 'Jane',
              lastName: 'Smith',
              activeTokens: [
                {
                  token: 'REG-002',
                  department: 'REG',
                  status: 'pending',
                  createdAt: new Date(),
                  issuedAt: new Date()
                }
              ]
            }
          ])
        })
      });

      const stats = await queueService.getQueueStats('REG');

      expect(stats.totalActive).toBe(2);
      expect(stats.inProgress).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.oldestTokenAge).toBeGreaterThanOrEqual(29);
    });
  });
});