// tests/ewtIntegration.test.js
/**
 * EWT Integration Tests
 * Tests for EWT recalculation when staff status changes
 */

const queueService = require('../services/queueService');
const staffStatusService = require('../services/staffStatusService');
const Patient = require('../models/Patient');
const Department = require('../models/Department');
const Staff = require('../models/staff');
const logger = require('../utils/logger');

// Mock dependencies
jest.mock('../models/Patient');
jest.mock('../models/Department');
jest.mock('../models/staff');
jest.mock('../utils/logger');

// Helper to create chainable mock query
const createMockQuery = (data) => ({
  populate: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(data),
  then: jest.fn((onFulfilled) => Promise.resolve(data).then(onFulfilled))
});

describe('EWT Integration with Staff Status Changes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('EWT recalculation with staff availability', () => {
    it('should reduce EWT when staff becomes available', async () => {
      // Setup: 2 pending tokens, 1 available staff initially
      Department.findOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const activeTokensData = [
        {
          patientId: 'P001',
          firstName: 'John',
          lastName: 'Doe',
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'in-progress',
              createdAt: new Date(),
              issuedAt: new Date(),
              completedAt: null
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(Date.now() + 60000),
              issuedAt: new Date(Date.now() + 60000),
              completedAt: null
            }
          ]
        },
        {
          patientId: 'P002',
          firstName: 'Jane',
          lastName: 'Smith',
          activeTokens: [
            {
              token: 'OPD-003',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(Date.now() + 120000),
              issuedAt: new Date(Date.now() + 120000),
              completedAt: null
            }
          ]
        }
      ];

      const completedTokensData = [
        {
          patientId: 'P003',
          activeTokens: [
            {
              token: 'OPD-100',
              department: 'OPD',
              status: 'completed',
              issuedAt: new Date(thirtyDaysAgo.getTime() + 100000),
              completedAt: new Date(thirtyDaysAgo.getTime() + 400000)
            }
          ]
        }
      ];

      // Setup Patient.find to return different data for each call
      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(activeTokensData)
        })
      });

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(completedTokensData)
        })
      });

      Staff.countDocuments.mockResolvedValueOnce(1);
      const queueBefore = await queueService.getLiveQueue('OPD');

      expect(queueBefore.availableStaffCount).toBe(1);
      expect(queueBefore.nextTokens.length).toBe(2);
      const ewtBefore = queueBefore.nextTokens[0].ewtMinutes;

      // Setup mocks again for second call
      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(activeTokensData)
        })
      });

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(completedTokensData)
        })
      });

      Staff.countDocuments.mockResolvedValueOnce(2);
      const queueAfter = await queueService.getLiveQueue('OPD');

      expect(queueAfter.availableStaffCount).toBe(2);
      expect(queueAfter.nextTokens.length).toBe(2);
      const ewtAfter = queueAfter.nextTokens[0].ewtMinutes;

      expect(ewtAfter).toBeLessThan(ewtBefore);
    });

    it('should increase EWT when staff becomes unavailable', async () => {
      Department.findOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      const activeTokensData = [
        {
          patientId: 'P001',
          firstName: 'John',
          lastName: 'Doe',
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'in-progress',
              createdAt: new Date(),
              issuedAt: new Date()
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(Date.now() + 60000),
              issuedAt: new Date(Date.now() + 60000)
            }
          ]
        }
      ];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const completedTokensData = [
        {
          patientId: 'P003',
          activeTokens: [
            {
              token: 'OPD-100',
              department: 'OPD',
              status: 'completed',
              issuedAt: new Date(thirtyDaysAgo.getTime() + 100000),
              completedAt: new Date(thirtyDaysAgo.getTime() + 400000)
            }
          ]
        }
      ];

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(activeTokensData)
        })
      });

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(completedTokensData)
        })
      });

      Staff.countDocuments.mockResolvedValueOnce(3);
      const queueBefore = await queueService.getLiveQueue('OPD');

      expect(queueBefore.availableStaffCount).toBe(3);
      const ewtBefore = queueBefore.nextTokens[0].ewtMinutes;

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(activeTokensData)
        })
      });

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(completedTokensData)
        })
      });

      Staff.countDocuments.mockResolvedValueOnce(1);
      const queueAfter = await queueService.getLiveQueue('OPD');

      expect(queueAfter.availableStaffCount).toBe(1);
      const ewtAfter = queueAfter.nextTokens[0].ewtMinutes;

      expect(ewtAfter).toBeGreaterThan(ewtBefore);
    });

    it('should handle case with no available staff', async () => {
      Department.findOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      const activeTokensData = [
        {
          patientId: 'P001',
          firstName: 'John',
          lastName: 'Doe',
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(),
              issuedAt: new Date()
            }
          ]
        }
      ];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const completedTokensData = [
        {
          patientId: 'P002',
          activeTokens: [
            {
              token: 'OPD-100',
              department: 'OPD',
              status: 'completed',
              issuedAt: new Date(thirtyDaysAgo.getTime() + 100000),
              completedAt: new Date(thirtyDaysAgo.getTime() + 400000)
            }
          ]
        }
      ];

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(activeTokensData)
        })
      });

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(completedTokensData)
        })
      });

      Staff.countDocuments.mockResolvedValueOnce(0);
      const queue = await queueService.getLiveQueue('OPD');

      expect(queue.availableStaffCount).toBe(0);
      expect(queue.ewtCalculationNote).toContain('WARNING');
      expect(queue.nextTokens[0].ewtMinutes).toBeGreaterThan(0);
    });
  });

  describe('recalculateEWT method', () => {
    it('should provide EWT recalculation details', async () => {
      Department.findOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      const activeTokensData = [
        {
          patientId: 'P001',
          firstName: 'John',
          lastName: 'Doe',
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'in-progress',
              createdAt: new Date(),
              issuedAt: new Date()
            }
          ]
        }
      ];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(activeTokensData)
        })
      });

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'P003',
              activeTokens: [
                {
                  token: 'OPD-100',
                  department: 'OPD',
                  status: 'completed',
                  issuedAt: new Date(thirtyDaysAgo.getTime() + 100000),
                  completedAt: new Date(thirtyDaysAgo.getTime() + 400000)
                }
              ]
            }
          ])
        })
      });

      Staff.countDocuments.mockResolvedValue(2);

      const ewtDetails = await queueService.recalculateEWT('OPD');

      expect(ewtDetails.department).toBe('OPD');
      expect(ewtDetails.availableStaffCount).toBe(2);
      expect(ewtDetails.pendingTokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAffectedTokens method', () => {
    it('should return affected tokens when staff status changes', async () => {
      Department.findOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      const mockTokens = [
        {
          patientId: 'P001',
          firstName: 'John',
          lastName: 'Doe',
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'in-progress',
              createdAt: new Date(),
              issuedAt: new Date()
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(Date.now() + 60000),
              issuedAt: new Date(Date.now() + 60000)
            }
          ]
        }
      ];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockTokens)
        })
      });

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'P003',
              activeTokens: [
                {
                  token: 'OPD-100',
                  department: 'OPD',
                  status: 'completed',
                  issuedAt: new Date(thirtyDaysAgo.getTime() + 100000),
                  completedAt: new Date(thirtyDaysAgo.getTime() + 400000)
                }
              ]
            }
          ])
        })
      });

      Staff.countDocuments.mockResolvedValueOnce(2);

      const affectedTokens = await queueService.getAffectedTokens('OPD');

      expect(Array.isArray(affectedTokens)).toBe(true);
      expect(affectedTokens.length).toBeGreaterThan(0);
      expect(affectedTokens[0]).toHaveProperty('token');
      expect(affectedTokens[0]).toHaveProperty('status');
      expect(affectedTokens[0]).toHaveProperty('newEwt');
    });
  });

  describe('Concurrent status updates', () => {
    it('should handle multiple concurrent status updates safely', async () => {
      const mockStaff1 = {
        _id: 'staff1',
        staffId: 'DR001',
        fullName: 'Dr. John',
        currentStatus: 'offline',
        statusHistory: [],
        isActive: true,
        role: { name: 'Doctor' },
        department: { code: 'OPD' },
        save: jest.fn().mockResolvedValue(true)
      };

      const mockStaff2 = {
        _id: 'staff2',
        staffId: 'DR002',
        fullName: 'Dr. Jane',
        currentStatus: 'offline',
        statusHistory: [],
        isActive: true,
        role: { name: 'Doctor' },
        department: { code: 'OPD' },
        save: jest.fn().mockResolvedValue(true)
      };

      Staff.findOne
        .mockReturnValueOnce(createMockQuery(mockStaff1))
        .mockReturnValueOnce(createMockQuery(mockStaff2));

      // Simulate concurrent updates
      const promise1 = staffStatusService.updateStatus('staff1', 'available');
      const promise2 = staffStatusService.updateStatus('staff2', 'available');

      const results = await Promise.all([promise1, promise2]);

      expect(results).toHaveLength(2);
      expect(results[0].currentStatus).toBe('available');
      expect(results[1].currentStatus).toBe('available');
      expect(mockStaff1.save).toHaveBeenCalled();
      expect(mockStaff2.save).toHaveBeenCalled();
    });
  });

  describe('EWT formula validation', () => {
    it('should apply correct staff adjustment factor', async () => {
      Department.findOne.mockResolvedValue({
        code: 'OPD',
        _id: 'dept123'
      });

      const activeTokensData = [
        {
          patientId: 'P001',
          firstName: 'John',
          lastName: 'Doe',
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'in-progress',
              createdAt: new Date(),
              issuedAt: new Date()
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(Date.now() + 60000),
              issuedAt: new Date(Date.now() + 60000)
            }
          ]
        }
      ];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const completedTokensData = [
        {
          patientId: 'P003',
          activeTokens: [
            {
              token: 'OPD-100',
              department: 'OPD',
              status: 'completed',
              issuedAt: new Date(thirtyDaysAgo.getTime() + 100000),
              completedAt: new Date(thirtyDaysAgo.getTime() + 600000)
            }
          ]
        }
      ];

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(activeTokensData)
        })
      });

      Patient.find.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(completedTokensData)
        })
      });

      Staff.countDocuments.mockResolvedValueOnce(2);

      const queue = await queueService.getLiveQueue('OPD');

      expect(queue.staffAdjustmentFactor).toBe(2);
      expect(queue.availableStaffCount).toBe(2);
      const firstPendingEwt = queue.nextTokens[0].ewtMinutes;
      expect(firstPendingEwt).toBeLessThan(queue.averageServiceTimeMinutes);
    });
  });
});
