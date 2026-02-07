// tests/nurse-queue.service.test.js
const nurseQueueService = require('../services/nurseQueueService');
const Patient = require('../models/Patient');
const Staff = require('../models/staff');
const Department = require('../models/Department');

// Mock the models
jest.mock('../models/Patient');
jest.mock('../models/Staff');
jest.mock('../models/Department');
jest.mock('../utils/logger');

describe('NurseQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getNurseDepartments', () => {
    it('should return nurse department assignments', async () => {
      const mockNurse = {
        _id: 'NURSE-001',
        staffId: 'N001',
        department: {
          code: 'OPD',
          name: 'Outpatient Department'
        }
      };

      Staff.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockNurse)
        })
      });

      const departments = await nurseQueueService.getNurseDepartments('NURSE-001');

      expect(departments).toEqual(['OPD']);
      expect(Staff.findById).toHaveBeenCalledWith('NURSE-001');
    });

    it('should return empty array if nurse has no department', async () => {
      Staff.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: 'NURSE-001',
            department: null
          })
        })
      });

      const departments = await nurseQueueService.getNurseDepartments('NURSE-001');

      expect(departments).toEqual([]);
    });

    it('should throw error if nurse not found', async () => {
      Staff.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null)
        })
      });

      await expect(
        nurseQueueService.getNurseDepartments('INVALID-ID')
      ).rejects.toThrow('not found');
    });
  });

  describe('getNurseQueueMonitoring', () => {
    it('should return queue monitoring data for nurse department', async () => {
      const mockNurse = {
        _id: 'NURSE-001',
        department: {
          code: 'OPD',
          name: 'Outpatient Department'
        }
      };

      Staff.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockNurse)
        })
      });

      const mockQueueData = {
        department: { code: 'OPD', name: 'Outpatient Department' },
        currentToken: {
          token: 'OPD-001',
          status: 'in-progress',
          prepStatus: 'in-prep'
        },
        nextTokens: [
          {
            token: 'OPD-002',
            status: 'pending',
            prepStatus: 'waiting'
          }
        ],
        totalPending: 1,
        averageServiceTimeMinutes: 5,
        statistics: {
          waitingCount: 1,
          inPrepCount: 0,
          readyCount: 0
        }
      };

      // Mock the method call
      const serviceMethod = jest.spyOn(
        nurseQueueService,
        'getDepartmentQueueForNurse'
      );
      serviceMethod.mockResolvedValue(mockQueueData);

      const result = await nurseQueueService.getNurseQueueMonitoring('NURSE-001');

      expect(result.success).toBe(true);
      expect(result.nurse.staffId).toBe('NURSE-001');
      expect(result.departments).toEqual(['OPD']);
      expect(result.queues).toHaveLength(1);
      expect(result.summary.totalTokens).toBe(2); // Current + next

      serviceMethod.mockRestore();
    });

    it('should filter queues by prepStatus', async () => {
      const mockNurse = {
        _id: 'NURSE-001',
        department: {
          code: 'OPD',
          name: 'Outpatient Department'
        }
      };

      Staff.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockNurse)
        })
      });

      const serviceMethod = jest.spyOn(
        nurseQueueService,
        'getDepartmentQueueForNurse'
      );
      serviceMethod.mockResolvedValue({
        department: { code: 'OPD', name: 'OPD' },
        currentToken: null,
        nextTokens: [
          {
            token: 'OPD-001',
            prepStatus: 'ready'
          }
        ],
        statistics: { readyCount: 1 }
      });

      const result = await nurseQueueService.getNurseQueueMonitoring('NURSE-001', {
        prepStatus: 'ready'
      });

      expect(result.queues[0].nextTokens[0].prepStatus).toBe('ready');

      serviceMethod.mockRestore();
    });
  });

  describe('getDepartmentQueueForNurse', () => {
    it('should return current and next tokens with prep status', async () => {
      Department.findOne.mockResolvedValue({
        code: 'OPD',
        name: 'Outpatient Department'
      });

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'PID001',
              firstName: 'John',
              lastName: 'Doe',
              multiStageTokens: [
                {
                  token: 'OPD-001',
                  department: 'OPD',
                  status: 'in-progress',
                  prepStatus: 'in-prep',
                  stage: 1,
                  createdAt: new Date('2026-01-22T09:00:00Z'),
                  issuedAt: new Date('2026-01-22T09:00:00Z'),
                  auditHistory: []
                }
              ]
            },
            {
              patientId: 'PID002',
              firstName: 'Jane',
              lastName: 'Smith',
              multiStageTokens: [
                {
                  token: 'OPD-002',
                  department: 'OPD',
                  status: 'pending',
                  prepStatus: 'waiting',
                  stage: 1,
                  createdAt: new Date('2026-01-22T09:05:00Z'),
                  issuedAt: new Date('2026-01-22T09:05:00Z'),
                  auditHistory: []
                }
              ]
            }
          ])
        })
      });

      const serviceMethod = jest.spyOn(
        nurseQueueService,
        'calculateAverageServiceTimeForDepartment'
      );
      serviceMethod.mockResolvedValue(5);

      const result = await nurseQueueService.getDepartmentQueueForNurse('OPD');

      expect(result.department.code).toBe('OPD');
      expect(result.currentToken.token).toBe('OPD-001');
      expect(result.currentToken.prepStatus).toBe('in-prep');
      expect(result.nextTokens).toHaveLength(1);
      expect(result.nextTokens[0].token).toBe('OPD-002');
      expect(result.nextTokens[0].prepStatus).toBe('waiting');
      expect(result.statistics.waitingCount).toBe(1);
      expect(result.statistics.inPrepCount).toBe(0);

      serviceMethod.mockRestore();
    });

    it('should throw error if department not found', async () => {
      Department.findOne.mockResolvedValue(null);

      await expect(
        nurseQueueService.getDepartmentQueueForNurse('INVALID')
      ).rejects.toThrow('Department INVALID not found');
    });

    it('should apply prepStatus filter correctly', async () => {
      Department.findOne.mockResolvedValue({
        code: 'OPD',
        name: 'Outpatient Department'
      });

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              patientId: 'PID001',
              firstName: 'John',
              lastName: 'Doe',
              multiStageTokens: [
                {
                  token: 'OPD-001',
                  department: 'OPD',
                  status: 'pending',
                  prepStatus: 'waiting',
                  createdAt: new Date('2026-01-22T09:00:00Z'),
                  auditHistory: []
                }
              ]
            },
            {
              patientId: 'PID002',
              firstName: 'Jane',
              lastName: 'Smith',
              multiStageTokens: [
                {
                  token: 'OPD-002',
                  department: 'OPD',
                  status: 'pending',
                  prepStatus: 'ready',
                  createdAt: new Date('2026-01-22T09:05:00Z'),
                  auditHistory: []
                }
              ]
            }
          ])
        })
      });

      const serviceMethod = jest.spyOn(
        nurseQueueService,
        'calculateAverageServiceTimeForDepartment'
      );
      serviceMethod.mockResolvedValue(5);

      const result = await nurseQueueService.getDepartmentQueueForNurse('OPD', {
        prepStatus: 'ready'
      });

      expect(result.nextTokens).toHaveLength(1);
      expect(result.nextTokens[0].prepStatus).toBe('ready');

      serviceMethod.mockRestore();
    });
  });

  describe('updateTokenPrepStatus', () => {
    it('should successfully update token prep status', async () => {
      const mockNurse = {
        _id: 'NURSE-001',
        department: {
          code: 'OPD',
          name: 'Outpatient Department'
        }
      };

      Staff.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockNurse)
        })
      });

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        multiStageTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            status: 'pending',
            prepStatus: 'waiting',
            auditHistory: []
          }
        ],
        updatePrepStatus: jest.fn(),
        save: jest.fn().mockResolvedValue(true)
      };

      Patient.findOne.mockResolvedValue(mockPatient);

      module.exports.updateTokenPrepStatus = jest
        .fn()
        .mockResolvedValue({
          success: true,
          token: 'OPD-001',
          department: 'OPD',
          prepStatus: 'ready',
          patientId: 'PID001',
          patientName: 'John Doe'
        });

      // Mock the getNurseDepartments
      const deptMethod = jest.spyOn(
        nurseQueueService,
        'getNurseDepartments'
      );
      deptMethod.mockResolvedValue(['OPD']);

      const result = await nurseQueueService.updateTokenPrepStatus(
        'NURSE-001',
        'OPD-001',
        'OPD',
        'ready',
        'Patient prepared'
      );

      expect(result.success).toBe(true);
      expect(result.prepStatus).toBe('ready');

      deptMethod.mockRestore();
    });

    it('should throw error if nurse does not have access to department', async () => {
      const deptMethod = jest.spyOn(
        nurseQueueService,
        'getNurseDepartments'
      );
      deptMethod.mockResolvedValue(['OPD']);

      await expect(
        nurseQueueService.updateTokenPrepStatus(
          'NURSE-001',
          'OPD-001',
          'LAB',
          'ready'
        )
      ).rejects.toThrow('does not have access');

      deptMethod.mockRestore();
    });
  });

  describe('getTokenDetails', () => {
    it('should return detailed token information', async () => {
      const deptMethod = jest.spyOn(
        nurseQueueService,
        'getNurseDepartments'
      );
      deptMethod.mockResolvedValue(['OPD']);

      const mockPatient = {
        patientId: 'PID001',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: new Date('1990-01-01'),
        gender: 'Male',
        contactNumber: '1234567890',
        multiStageTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            status: 'pending',
            prepStatus: 'waiting',
            auditHistory: [
              {
                action: 'created',
                timestamp: new Date(),
                staffId: 'SYS'
              }
            ]
          }
        ]
      };

      Patient.findOne.mockResolvedValue(mockPatient);

      module.exports.getTokenDetails = jest.fn().mockResolvedValue({
        success: true,
        token: {
          token: 'OPD-001',
          status: 'pending',
          prepStatus: 'waiting'
        },
        patient: {
          id: 'PID001',
          name: 'John Doe'
        }
      });

      const result = await nurseQueueService.getTokenDetails(
        'NURSE-001',
        'OPD-001',
        'OPD'
      );

      expect(result.success).toBe(true);
      expect(result.token.token).toBe('OPD-001');
      expect(result.patient.id).toBe('PID001');

      deptMethod.mockRestore();
    });
  });

  describe('calculateAverageServiceTimeForDepartment', () => {
    it('should calculate average service time from completed tokens', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              multiStageTokens: [
                {
                  department: 'OPD',
                  status: 'completed',
                  issuedAt: new Date(thirtyDaysAgo.getTime() + 60000),
                  completedAt: new Date(thirtyDaysAgo.getTime() + 360000) // 5 minutes later
                }
              ]
            }
          ])
        })
      });

      const avgTime = await nurseQueueService.calculateAverageServiceTimeForDepartment('OPD');

      expect(avgTime).toBe(5);
    });

    it('should return default fallback if no completed tokens', async () => {
      Patient.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([])
        })
      });

      const avgTime = await nurseQueueService.calculateAverageServiceTimeForDepartment('OPD');

      expect(avgTime).toBe(5); // Default fallback
    });
  });
});
