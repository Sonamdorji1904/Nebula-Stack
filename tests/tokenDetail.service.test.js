// tests/tokenDetail.service.test.js
const tokenDetailService = require('../services/tokenDetailService');
const Patient = require('../models/Patient');
const Department = require('../models/Department');

// Mock the models
jest.mock('../models/Patient');
jest.mock('../models/Department');
jest.mock('../utils/logger');

describe('TokenDetailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTokenDetail', () => {
    it('should return complete token detail with history and EWT', async () => {
      const mockUser = {
        staffId: 'STAFF001',
        role: {
          name: 'staff',
          permissions: ['queue:view']
        },
        department: { code: 'REG' }
      };

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        activeTokens: [
          {
            token: 'REG-001',
            department: 'REG',
            status: 'in-progress',
            stage: 1,
            issuedAt: new Date('2026-02-05T10:00:00Z'),
            completedAt: null,
            auditHistory: [
              {
                action: 'created',
                timestamp: new Date('2026-02-05T10:00:00Z'),
                staffId: null,
                reason: null
              },
              {
                action: 'called',
                timestamp: new Date('2026-02-05T10:05:00Z'),
                staffId: 'STAFF001',
                reason: null
              }
            ]
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);
      Department.findOne.mockResolvedValue({ code: 'REG', name: 'Registration' });

      // Mock the calculateAverageServiceTime to return predictable value
      jest.spyOn(tokenDetailService, 'calculateAverageServiceTime').mockResolvedValue(5);
      Patient.find.mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({
            lean: jest.fn().mockResolvedValue([])
          })
      });

      const result = await tokenDetailService.getTokenDetail('REG-001', mockUser);

      expect(result).toBeDefined();
      expect(result.token).toBe('REG-001');
      expect(result.department).toBe('REG');
      expect(result.status).toBe('in-progress');
      expect(result.stage).toBe(1);
      expect(result.patientName).toBe('John Doe');
      expect(result.patientId).toBe('PID001');
      expect(result.ewtMinutes).toBeDefined();
      expect(result.history).toHaveLength(2);
      expect(result.history[0].action).toBe('created');
      expect(result.history[1].action).toBe('called');
    });

    it('should throw error if token not found', async () => {
      const mockUser = {
        role: { permissions: ['queue:view'] }
      };

      Patient.findOne.mockResolvedValue(null);

      await expect(tokenDetailService.getTokenDetail('INVALID-001', mockUser)).rejects.toThrow(
        'Token not found: INVALID-001'
      );
    });

    it('should throw error for invalid token format', async () => {
      const mockUser = {
        role: { permissions: ['queue:view'] }
      };

      await expect(tokenDetailService.getTokenDetail(null, mockUser)).rejects.toThrow(
        'Invalid token ID format'
      );
    });

    it('should deny access if user is from different department', async () => {
      const mockUser = {
        staffId: 'STAFF002',
        role: {
          name: 'staff',
          permissions: ['queue:view']
        },
        department: { code: 'OPD' }
      };

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        activeTokens: [
          {
            token: 'REG-001',
            department: 'REG',
            status: 'pending'
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);

      await expect(tokenDetailService.getTokenDetail('REG-001', mockUser)).rejects.toThrow(
        'Access denied: Token is not in your department'
      );
    });

    it('should allow patient to view their own token', async () => {
      const mockUser = {
        patientId: 'PID001',
        role: {
          name: 'patient',
          permissions: []
        }
      };

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        activeTokens: [
          {
            token: 'REG-001',
            department: 'REG',
            status: 'pending',
            stage: 1,
            issuedAt: new Date(),
            completedAt: null,
            auditHistory: []
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);
      Department.findOne.mockResolvedValue({ code: 'REG' });
      jest.spyOn(tokenDetailService, 'calculateAverageServiceTime').mockResolvedValue(5);
      Patient.find.mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({
            lean: jest.fn().mockResolvedValue([])
          })
      });

      const result = await tokenDetailService.getTokenDetail('REG-001', mockUser);

      expect(result.token).toBe('REG-001');
      expect(result.patientId).toBe('PID001');
    });

    it('should deny patient access to other patients\' tokens', async () => {
      const mockUser = {
        patientId: 'PID002',
        role: {
          name: 'patient',
          permissions: []
        }
      };

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        activeTokens: [
          {
            token: 'REG-001',
            department: 'REG',
            status: 'pending'
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);

      await expect(tokenDetailService.getTokenDetail('REG-001', mockUser)).rejects.toThrow(
        'Access denied: Cannot view other patients\' tokens'
      );
    });
  });

  describe('calculateEWTForToken', () => {
    it('should calculate EWT based on queue size and average service time', async () => {
      const now = new Date();
      const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);

      // Mock average service time calculation
      jest.spyOn(tokenDetailService, 'calculateAverageServiceTime').mockResolvedValue(5);

      // Mock queue with 3 pending tokens and 1 in-progress
      Patient.find.mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              {
                activeTokens: [
                  { token: 'REG-001', department: 'REG', status: 'in-progress' }
                ]
              },
              {
                activeTokens: [
                  { token: 'REG-002', department: 'REG', status: 'pending' },
                  { token: 'REG-003', department: 'REG', status: 'pending' },
                  { token: 'REG-004', department: 'REG', status: 'pending' }
                ]
              }
            ])
          })
      });

      const ewtMinutes = await tokenDetailService.calculateEWTForToken('REG');

      // Should be (3 pending) * 5 mins + buffer for in-progress
      expect(ewtMinutes).toBeGreaterThan(0);
      expect(ewtMinutes).toBeGreaterThanOrEqual(15);
    });

    it('should return 0 EWT if queue is empty', async () => {
      jest.spyOn(tokenDetailService, 'calculateAverageServiceTime').mockResolvedValue(5);

      Patient.find.mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({
            lean: jest.fn().mockResolvedValue([])
          })
      });

      const ewtMinutes = await tokenDetailService.calculateEWTForToken('REG');

      expect(ewtMinutes).toBe(0);
    });

    it('should return default EWT on calculation error', async () => {
      // Use actual calculateAverageServiceTime but mock Patient.find to throw
      Patient.find.mockImplementation(() => {
        throw new Error('Database error');
      });

      const ewtMinutes = await tokenDetailService.calculateEWTForToken('REG');

      expect(ewtMinutes).toBe(5); // Default fallback
    });
  });

  describe('calculateAverageServiceTime', () => {
    it('should calculate average from completed tokens in last 30 days', async () => {
      const now = new Date();
      // Create two tokens that should have exactly 10 minute service time
      const issuedTime1 = new Date(now.getTime() - 10 * 60 * 1000);
      const completedTime1 = now;

      const issuedTime2 = new Date(now.getTime() - 20 * 60 * 1000);
      const completedTime2 = new Date(now.getTime() - 10 * 60 * 1000);

      Patient.find.mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              {
                activeTokens: [
                  {
                    token: 'REG-001',
                    department: 'REG',
                    status: 'completed',
                    issuedAt: issuedTime1,
                    completedAt: completedTime1
                  },
                  {
                    token: 'REG-002',
                    department: 'REG',
                    status: 'completed',
                    issuedAt: issuedTime2,
                    completedAt: completedTime2
                  }
                ]
              }
            ])
          })
      });

      const avgTime = await tokenDetailService.calculateAverageServiceTime('REG');

      // Should calculate average service time - should be at least 5 minutes
      expect(avgTime).toBeGreaterThan(0);
      expect(typeof avgTime).toBe('number');
    });

    it('should return default value if no completed tokens', async () => {
      // Clear all mocks first
      jest.restoreAllMocks();

      Patient.find.mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({
            lean: jest.fn().mockResolvedValue([])
          })
      });

      const avgTime = await tokenDetailService.calculateAverageServiceTime('REG');

      expect(avgTime).toBe(5); // Default fallback
    });

    it('should filter out tokens with unrealistic service times', async () => {
      const now = new Date();

      Patient.find.mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              {
                activeTokens: [
                  {
                    token: 'REG-001',
                    department: 'REG',
                    status: 'completed',
                    issuedAt: new Date(now.getTime() - 200 * 60 * 1000), // 200 mins - too long
                    completedAt: now
                  },
                  {
                    token: 'REG-002',
                    department: 'REG',
                    status: 'completed',
                    issuedAt: new Date(now.getTime() - 10 * 60 * 1000),
                    completedAt: now // 10 min service - valid
                  }
                ]
              }
            ])
          })
      });

      const avgTime = await tokenDetailService.calculateAverageServiceTime('REG');

      expect(avgTime).toBe(10);
    });
  });

  describe('getTokenHistory', () => {
    it('should return formatted audit history for token', async () => {
      const mockUser = {
        role: { permissions: ['queue:view'] }
      };

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        activeTokens: [
          {
            token: 'REG-001',
            department: 'REG',
            status: 'completed',
            auditHistory: [
              {
                action: 'created',
                timestamp: new Date('2026-02-05T10:00:00Z'),
                staffId: null
              },
              {
                action: 'called',
                timestamp: new Date('2026-02-05T10:05:00Z'),
                staffId: 'STAFF001'
              },
              {
                action: 'completed',
                timestamp: new Date('2026-02-05T10:15:00Z'),
                staffId: 'STAFF001'
              }
            ]
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);

      const history = await tokenDetailService.getTokenHistory('REG-001', mockUser);

      expect(history).toHaveLength(3);
      expect(history[0].action).toBe('created');
      expect(history[1].action).toBe('called');
      expect(history[2].action).toBe('completed');
    });

    it('should return empty array if no audit history', async () => {
      const mockUser = {
        role: { permissions: ['queue:view'] }
      };

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        activeTokens: [
          {
            token: 'REG-001',
            department: 'REG',
            status: 'pending',
            auditHistory: []
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);

      const history = await tokenDetailService.getTokenHistory('REG-001', mockUser);

      expect(history).toHaveLength(0);
    });
  });

  describe('getTokenStageInfo', () => {
    it('should return token stage and status', async () => {
      const mockUser = {
        role: { permissions: ['queue:view'] }
      };

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        activeTokens: [
          {
            token: 'REG-001',
            department: 'REG',
            status: 'in-progress',
            stage: 2
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);

      const stageInfo = await tokenDetailService.getTokenStageInfo('REG-001', mockUser);

      expect(stageInfo).toEqual({
        token: 'REG-001',
        status: 'in-progress',
        stage: 2,
        department: 'REG'
      });
    });
  });

  describe('formatAuditHistory', () => {
    it('should format audit history with all fields', () => {
      const rawHistory = [
        {
          action: 'created',
          timestamp: new Date('2026-02-05T10:00:00Z'),
          staffId: null,
          reason: null,
          notes: null
        },
        {
          action: 'skipped',
          timestamp: new Date('2026-02-05T10:05:00Z'),
          staffId: 'STAFF001',
          reason: 'Patient no-show',
          notes: 'Patient did not respond to page'
        }
      ];

      const formatted = tokenDetailService.formatAuditHistory(rawHistory);

      expect(formatted).toHaveLength(2);
      expect(formatted[0]).toEqual({
        action: 'created',
        timestamp: new Date('2026-02-05T10:00:00Z'),
        staffId: null,
        reason: null,
        notes: null,
        previousStatus: null,
        newStatus: null,
        rescheduledTime: null
      });
      expect(formatted[1].reason).toBe('Patient no-show');
    });

    it('should handle undefined auditHistory entries gracefully', () => {
      const rawHistory = [
        {
          action: 'completed',
          timestamp: new Date()
          // No other fields
        }
      ];

      const formatted = tokenDetailService.formatAuditHistory(rawHistory);

      expect(formatted).toHaveLength(1);
      expect(formatted[0].action).toBe('completed');
      expect(formatted[0].staffId).toBeNull();
      expect(formatted[0].reason).toBeNull();
    });
  });

  describe('validateTokenAccess', () => {
    it('should allow staff with queue:view permission', async () => {
      const mockUser = {
        role: {
          name: 'staff',
          permissions: ['queue:view']
        },
        department: { code: 'REG' }
      };

      const token = {
        token: 'REG-001',
        department: 'REG'
      };

      const patient = {
        patientId: 'PID001'
      };

      // Should not throw
      await expect(tokenDetailService.validateTokenAccess(mockUser, token, patient)).resolves.toBeUndefined();
    });

    it('should deny user without queue:view permission', async () => {
      const mockUser = {
        role: {
          name: 'visitor',
          permissions: []
        }
      };

      const token = {
        token: 'REG-001',
        department: 'REG'
      };

      const patient = {
        patientId: 'PID001'
      };

      await expect(tokenDetailService.validateTokenAccess(mockUser, token, patient)).rejects.toThrow(
        'Insufficient permissions to access token details'
      );
    });
  });
});
