// tests/staffStatus.service.test.js
/**
 * Staff Status Service Tests
 * Tests for status updates, transitions, history tracking, and EWT integration
 */

const staffStatusService = require('../services/staffStatusService');
const Staff = require('../models/staff');
const logger = require('../utils/logger');

// Mock the Staff model and logger
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

describe('StaffStatusService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateStatusTransition', () => {
    it('should allow valid status transitions', () => {
      const result = staffStatusService.validateStatusTransition('offline', 'available');
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid status values', () => {
      const result = staffStatusService.validateStatusTransition('offline', 'invalid');
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('Invalid status');
    });

    it('should reject same status transition', () => {
      const result = staffStatusService.validateStatusTransition('available', 'available');
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('already in');
    });

    it('should reject invalid status transition path', () => {
      const result = staffStatusService.validateStatusTransition('offline', 'busy');
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('Cannot transition');
    });

    it('should allow on-break -> offline transition', () => {
      const result = staffStatusService.validateStatusTransition('on-break', 'offline');
      expect(result.isValid).toBe(true);
    });
  });

  describe('updateStatus', () => {
    it('should successfully update staff status', async () => {
      const mockStaff = {
        _id: 'staff123',
        staffId: 'DR001',
        fullName: 'Dr. John Doe',
        displayName: 'Dr. John',
        currentStatus: 'offline',
        previousStatus: null,
        statusUpdatedAt: new Date(),
        statusHistory: [],
        isActive: true,
        role: { name: 'Doctor' },
        department: { code: 'OPD' },
        save: jest.fn().mockResolvedValue(true)
      };

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      const result = await staffStatusService.updateStatus('staff123', 'available', {
        changedBy: 'self',
        reason: 'Started shift'
      });

      expect(result.currentStatus).toBe('available');
      expect(mockStaff.save).toHaveBeenCalled();
      expect(mockStaff.statusHistory.length).toBeGreaterThan(0);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should reject update for inactive staff', async () => {
      const mockStaff = {
        _id: 'staff123',
        staffId: 'DR001',
        isActive: false
      };

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      await expect(
        staffStatusService.updateStatus('staff123', 'available')
      ).rejects.toThrow('Cannot update status for inactive staff');
    });

    it('should throw error if staff not found', async () => {
      Staff.findOne.mockReturnValue(createMockQuery(null));

      await expect(
        staffStatusService.updateStatus('nonexistent', 'available')
      ).rejects.toThrow('Staff not found');
    });

    it('should track status history', async () => {
      const mockStaff = {
        _id: 'staff123',
        staffId: 'DR001',
        fullName: 'Dr. John Doe',
        displayName: 'Dr. John',
        currentStatus: 'offline',
        statusHistory: [],
        isActive: true,
        role: { name: 'Doctor' },
        department: { code: 'OPD' },
        save: jest.fn().mockResolvedValue(true)
      };

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      await staffStatusService.updateStatus('staff123', 'available', {
        changedBy: 'self',
        reason: 'Test reason'
      });

      expect(mockStaff.statusHistory[0].status).toBe('available');
      expect(mockStaff.statusHistory[0].reason).toBe('Test reason');
      expect(mockStaff.statusHistory[0].changedBy).toBe('self');
    });

    it('should limit history to 100 entries', async () => {
      const mockStaff = {
        _id: 'staff123',
        staffId: 'DR001',
        fullName: 'Dr. John Doe',
        displayName: 'Dr. John',
        currentStatus: 'available',
        statusHistory: Array.from({ length: 100 }, (_, i) => ({
          status: 'available',
          changedAt: new Date(),
          changedBy: 'self'
        })),
        isActive: true,
        role: { name: 'Doctor' },
        department: { code: 'OPD' },
        save: jest.fn().mockResolvedValue(true)
      };

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      await staffStatusService.updateStatus('staff123', 'busy');

      expect(mockStaff.statusHistory.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getStatus', () => {
    it('should retrieve staff status', async () => {
      const mockStaff = {
        _id: 'staff123',
        staffId: 'DR001',
        fullName: 'Dr. John Doe',
        displayName: 'Dr. John',
        currentStatus: 'available',
        statusUpdatedAt: new Date('2026-02-07T10:00:00Z'),
        previousStatus: 'offline',
        department: { code: 'OPD' }
      };

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      const result = await staffStatusService.getStatus('staff123');

      expect(result.staffCode).toBe('DR001');
      expect(result.currentStatus).toBe('available');
      expect(result.department).toBe('OPD');
    });

    it('should throw error if staff not found', async () => {
      Staff.findOne.mockReturnValue(createMockQuery(null));

      await expect(
        staffStatusService.getStatus('nonexistent')
      ).rejects.toThrow('Staff not found');
    });
  });

  describe('getAvailableStaffCount', () => {
    it('should return count of available staff', async () => {
      Staff.countDocuments.mockResolvedValue(5);

      const count = await staffStatusService.getAvailableStaffCount('dept123');

      expect(count).toBe(5);
      expect(Staff.countDocuments).toHaveBeenCalledWith({
        department: 'dept123',
        isActive: true,
        currentStatus: 'available'
      });
    });

    it('should return 0 if query fails', async () => {
      Staff.countDocuments.mockRejectedValue(new Error('Database error'));

      const count = await staffStatusService.getAvailableStaffCount('dept123');

      expect(count).toBe(0);
    });
  });

  describe('getDepartmentStaffStatus', () => {
    it('should return all staff status for a department', async () => {
      const mockStaffList = [
        {
          staffId: 'DR001',
          fullName: 'Dr. John',
          currentStatus: 'available',
          statusUpdatedAt: new Date()
        },
        {
          staffId: 'DR002',
          fullName: 'Dr. Jane',
          currentStatus: 'busy',
          statusUpdatedAt: new Date()
        }
      ];

      Staff.find.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockStaffList)
      });

      const result = await staffStatusService.getDepartmentStaffStatus('dept123');

      expect(result).toHaveLength(2);
      expect(result[0].staffId).toBe('DR001');
    });
  });

  describe('setOfflineForLogout', () => {
    it('should set staff to offline on logout', async () => {
      const mockStaff = {
        _id: 'staff123',
        staffId: 'DR001',
        fullName: 'Dr. John Doe',
        displayName: 'Dr. John',
        currentStatus: 'available',
        statusHistory: [],
        isActive: true,
        save: jest.fn().mockResolvedValue(true)
      };

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      const result = await staffStatusService.setOfflineForLogout('staff123');

      expect(mockStaff.currentStatus).toBe('offline');
      expect(mockStaff.statusHistory[0].reason).toBe('Logout');
      expect(mockStaff.save).toHaveBeenCalled();
    });

    it('should skip update if already offline', async () => {
      const mockStaff = {
        _id: 'staff123',
        staffId: 'DR001',
        fullName: 'Dr. John Doe',
        displayName: 'Dr. John',
        currentStatus: 'offline',
        statusHistory: [],
        isActive: true,
        save: jest.fn()
      };

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      await staffStatusService.setOfflineForLogout('staff123');

      expect(mockStaff.save).not.toHaveBeenCalled();
    });
  });

  describe('getStatusHistory', () => {
    it('should return status history with limit', async () => {
      const mockHistory = Array.from({ length: 30 }, (_, i) => ({
        status: 'available',
        changedAt: new Date(),
        changedBy: 'self',
        reason: `Change ${i}`
      }));

      const mockStaff = {
        statusHistory: mockHistory
      };

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      const result = await staffStatusService.getStatusHistory('staff123', 10);

      expect(result.length).toBe(10);
    });
  });

  describe('bulkUpdateStatus', () => {
    it('should update multiple staff statuses', async () => {
      const mockStaff = {
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

      Staff.findOne.mockReturnValue(createMockQuery(mockStaff));

      const staffIds = ['staff1', 'staff2'];
      const result = await staffStatusService.bulkUpdateStatus(staffIds, 'available');

      expect(result.successful.length).toBeGreaterThan(0);
      expect(logger.info).toHaveBeenCalled();
    });
  });

  describe('calculateStatusDuration', () => {
    it('should calculate status duration in minutes', () => {
      const pastTime = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
      const duration = staffStatusService.calculateStatusDuration(pastTime);

      expect(duration).toBeGreaterThanOrEqual(29);
      expect(duration).toBeLessThanOrEqual(31);
    });

    it('should return 0 for null timestamp', () => {
      const duration = staffStatusService.calculateStatusDuration(null);
      expect(duration).toBe(0);
    });
  });
});
