// tests/ewtCalculationEngine.test.js
/**
 * EWT Calculation Engine Tests
 * Comprehensive tests for EWT algorithm accuracy and edge cases
 */

const ewtCalculationEngine = require('../services/ewtCalculationEngineService');
const Patient = require('../models/Patient');
const Staff = require('../models/staff');
const Department = require('../models/Department');
const HistoricalServiceTime = require('../models/HistoricalServiceTime');
const historicalDataCollectionService = require('../services/historicalDataCollectionService');
const logger = require('../utils/logger');

// Mock dependencies
jest.mock('../models/Patient');
jest.mock('../models/Staff');
jest.mock('../models/Department');
jest.mock('../models/HistoricalServiceTime');
jest.mock('../services/historicalDataCollectionService');
jest.mock('../utils/logger');

// Helper to mock Mongoose query chains
const mockMongooseQuery = (resolveValue) => ({
  select: jest.fn(function() {
    // Return an object that can be awaited and also has lean()
    return {
      lean: jest.fn().mockResolvedValue(resolveValue),
      then: function(onFulfilled) {
        return Promise.resolve(resolveValue).then(onFulfilled);
      },
      catch: function(onRejected) {
        return Promise.resolve(resolveValue).catch(onRejected);
      },
      // Make this directly awaitable
      [Symbol.toStringTag]: 'Promise'
    };
  }),
  lean: jest.fn().mockResolvedValue(resolveValue),
  then: function(onFulfilled) {
    return Promise.resolve(resolveValue).then(onFulfilled);
  },
  catch: function(onRejected) {
    return Promise.resolve(resolveValue).catch(onRejected);
  },
  [Symbol.toStringTag]: 'Promise'
});

describe('EWT Calculation Engine Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ewtCalculationEngine.clearCache();
    
    // Setup default historical data mock
    historicalDataCollectionService.getBestEstimate.mockResolvedValue({
      baseEstimate: 5,
      estimate: 8,
      confidence: 0.8,
      sampleCount: 150,
      source: 'historical_daily'
    });
  });

  describe('calculateEWT - main calculation', () => {
    it('should calculate EWT for a token in queue', async () => {
      // Setup
      Patient.findOne.mockResolvedValue({
        activeTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            status: 'pending',
            issuedAt: new Date(Date.now() - 2 * 60000),
            followup_priority: 'normal'
          }
        ]
      });

      Patient.find.mockReturnValue(mockMongooseQuery([
        {
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'pending',
              issuedAt: new Date(Date.now() - 2 * 60000),
              followup_priority: 'normal'
            }
          ]
        }
      ]));

      Department.findOne.mockResolvedValue({
        _id: 'dept123',
        code: 'OPD'
      });

      Staff.find.mockReturnValue(mockMongooseQuery([
        { currentStatus: 'available', staffId: 'S001' },
        { currentStatus: 'busy', staffId: 'S002' }
      ]));

      // Execute
      const result = await ewtCalculationEngine.calculateEWT(
        'OPD-001',
        'OPD'
      );

      // Assert
      expect(result).toHaveProperty('ewt');
      expect(result).toHaveProperty('tokenPosition');
      expect(result).toHaveProperty('confidence');
      expect(result.ewt).toBeGreaterThanOrEqual(0);
      expect(result.ewt).toBeLessThanOrEqual(480);
    });

    it('should handle empty queue (token is currently being served)', async () => {
      Patient.findOne.mockResolvedValueOnce({
        activeTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            status: 'in-progress',
            issuedAt: new Date(Date.now() - 1 * 60000),
            followup_priority: 'normal'
          }
        ]
      });

      Patient.find.mockReturnValueOnce(mockMongooseQuery([
        {
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'in-progress',
              issuedAt: new Date(Date.now() - 1 * 60000),
              followup_priority: 'normal'
            }
          ]
        }
      ]));

      Department.findOne.mockResolvedValueOnce({
        _id: 'dept123',
        code: 'OPD'
      });

      Staff.find.mockReturnValueOnce(mockMongooseQuery([
        { currentStatus: 'available', staffId: 'S001' }
      ]));

      const result = await ewtCalculationEngine.calculateEWT(
        'OPD-001',
        'OPD'
      );

      expect(result.ewt).toBeGreaterThanOrEqual(0);
      expect(result.ewt).toBeLessThanOrEqual(480);
    });

    it('should return fallback EWT when token not found', async () => {
      Patient.findOne.mockResolvedValueOnce(null);

      const result = await ewtCalculationEngine.calculateEWT(
        'INVALID',
        'OPD'
      );

      expect(result.ewt).toBe(10);
      expect(result.confidence).toBe(0.1);
      expect(result.error).toBeDefined();
    });

    it('should handle no available staff', async () => {
      Patient.findOne.mockResolvedValueOnce({
        activeTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            status: 'pending',
            issuedAt: new Date(Date.now() - 2 * 60000),
            followup_priority: 'normal'
          }
        ]
      });

      Patient.find.mockReturnValueOnce(mockMongooseQuery([
        {
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'pending',
              issuedAt: new Date(Date.now() - 2 * 60000),
              followup_priority: 'normal'
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'pending',
              issuedAt: new Date(Date.now() - 1 * 60000),
              followup_priority: 'normal'
            }
          ]
        }
      ]));

      Department.findOne.mockResolvedValueOnce({
        _id: 'dept123',
        code: 'OPD'
      });

      Staff.find.mockReturnValueOnce(mockMongooseQuery([
        { currentStatus: 'offline', staffId: 'S001' },
        { currentStatus: 'offline', staffId: 'S002' }
      ]));

      const result = await ewtCalculationEngine.calculateEWT(
        'OPD-001',
        'OPD'
      );

      expect(result.ewt).toBeGreaterThan(0);
      expect(result.confidence).toBeDefined();
    });
  });

  describe('getQueueData', () => {
    it('should count pending and in-progress tokens correctly', async () => {
      Patient.find.mockReturnValueOnce(mockMongooseQuery([
        {
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'in-progress',
              issuedAt: new Date(Date.now() - 5 * 60000)
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'pending',
              issuedAt: new Date(Date.now() - 2 * 60000)
            }
          ]
        },
        {
          activeTokens: [
            {
              token: 'OPD-003',
              department: 'OPD',
              status: 'pending',
              issuedAt: new Date()
            }
          ]
        }
      ]));

      const result = await ewtCalculationEngine.getQueueData('OPD');

      expect(result.inProgressCount).toBe(1);
      expect(result.pendingCount).toBe(2);
      expect(result.totalActive).toBe(3);
      expect(result.currentToken).toBeDefined();
    });

    it('should calculate queue pressure correctly', async () => {
      Patient.find.mockReturnValueOnce(mockMongooseQuery([]));

      const result = await ewtCalculationEngine.getQueueData('OPD');

      expect(result.queuePressure).toBe(0);
    });
  });

  describe('getStaffData', () => {
    it('should aggregate staff availability correctly', async () => {
      Staff.find.mockReturnValueOnce(mockMongooseQuery([
        { currentStatus: 'available', staffId: 'S001' },
        { currentStatus: 'available', staffId: 'S002' },
        { currentStatus: 'busy', staffId: 'S003' },
        { currentStatus: 'on-break', staffId: 'S004' }
      ]));

      const result = await ewtCalculationEngine.getStaffData('dept123');

      expect(result.totalStaff).toBe(4);
      expect(result.availableStaff).toBe(2);
      expect(result.busyStaff).toBe(1);
      expect(result.effectiveStaff).toBeGreaterThan(0);
    });

    it('should handle no staff available', async () => {
      Staff.find.mockReturnValueOnce(mockMongooseQuery([]));

      const result = await ewtCalculationEngine.getStaffData('dept123');

      expect(result.totalStaff).toBe(0);
      expect(result.availableStaff).toBe(0);
      expect(result.effectiveStaff).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('getTokenPosition', () => {
    it('should calculate token position correctly (FIFO)', async () => {
      Patient.find.mockReturnValueOnce(mockMongooseQuery([
        {
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'in-progress',
              createdAt: new Date(Date.now() - 10000),
              followup_priority: 'normal'
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(Date.now() - 5000),
              followup_priority: 'normal'
            }
          ]
        },
        {
          activeTokens: [
            {
              token: 'OPD-003',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(),
              followup_priority: 'normal'
            }
          ]
        }
      ]));

      const position = await ewtCalculationEngine.getTokenPosition(
        'OPD-002',
        'OPD'
      );

      expect(position).toBe(2);
    });

    it('should prioritize high-priority tokens', async () => {
      const now = new Date();

      Patient.find.mockResolvedValueOnce([
        {
          activeTokens: [
            {
              token: 'OPD-001',
              department: 'OPD',
              status: 'pending',
              createdAt: now,
              followup_priority: 'normal'
            },
            {
              token: 'OPD-002',
              department: 'OPD',
              status: 'pending',
              createdAt: new Date(now.getTime() + 1000),
              followup_priority: 'high'
            }
          ]
        }
      ]);

      const position = await ewtCalculationEngine.getTokenPosition(
        'OPD-002',
        'OPD'
      );

      expect(position).toBeLessThan(2);
    });
  });

  describe('getTimePattern', () => {
    it('should return peak factor for peak hours', () => {
      const originalDate = Date;
      global.Date = class extends originalDate {
        constructor() {
          super();
          return new originalDate(2026, 2, 2, 10, 0, 0); // 10 AM = peak
        }

        static now() {
          return new originalDate(2026, 2, 2, 10, 0, 0).getTime();
        }
      };

      const pattern = ewtCalculationEngine.getTimePattern();

      expect(pattern.peakFactor).toBeGreaterThan(1.2);

      global.Date = originalDate;
    });

    it('should return lower factor for off-hours', () => {
      const originalDate = Date;
      global.Date = class extends originalDate {
        constructor() {
          super();
          return new originalDate(2026, 2, 2, 22, 0, 0); // 10 PM = off-hours
        }

        static now() {
          return new originalDate(2026, 2, 2, 22, 0, 0).getTime();
        }
      };

      const pattern = ewtCalculationEngine.getTimePattern();

      expect(pattern.peakFactor).toBeLessThan(1);

      global.Date = originalDate;
    });
  });

  describe('applyAlgorithm', () => {
    it('should apply algorithm weights correctly', () => {
      const components = {
        tokenPosition: 3,
        queueData: {
          pendingCount: 2,
          inProgressCount: 1,
          totalActive: 3,
          queuePressure: 0.3,
          currentToken: { elapsedMinutes: 2 }
        },
        staffData: {
          totalStaff: 2,
          availableStaff: 2,
          effectiveStaff: 2,
          staffUtilization: 0
        },
        historicalData: {
          mean: 5,
          percentile90: 8,
          confidence: 0.8,
          sampleCount: 100
        },
        timePattern: {
          peakFactor: 1.0,
          weekendFactor: 1.0,
          combinedFactor: 1.0
        },
        calculationMode: 'balanced',
        percentile: 90,
        returnRanges: true,
        token: { followup_priority: 'normal' }
      };

      const result = ewtCalculationEngine.applyAlgorithm(components);

      expect(result.ewt).toBeGreaterThan(0);
      expect(result.ewt).toBeLessThanOrEqual(480);
      expect(result.uncertaintyRange).toBeDefined();
      expect(result.breakdown).toBeDefined();
    });

    it('should apply optimistic mode reduction', () => {
      const components = {
        tokenPosition: 2,
        queueData: {
          pendingCount: 1,
          inProgressCount: 1,
          totalActive: 2,
          queuePressure: 0.1,
          currentToken: { elapsedMinutes: 0 }
        },
        staffData: {
          totalStaff: 1,
          availableStaff: 1,
          effectiveStaff: 1,
          staffUtilization: 0
        },
        historicalData: {
          mean: 10,
          percentile90: 15,
          confidence: 0.8,
          sampleCount: 100
        },
        timePattern: {
          peakFactor: 1.0,
          weekendFactor: 1.0,
          combinedFactor: 1.0
        },
        calculationMode: 'optimistic',
        percentile: 90,
        returnRanges: false,
        token: { followup_priority: 'normal' }
      };

      const result = ewtCalculationEngine.applyAlgorithm(components);

      expect(result.ewt).toBeGreaterThan(0);
    });

    it('should cap EWT at maximum', () => {
      const components = {
        tokenPosition: 100,
        queueData: {
          pendingCount: 99,
          inProgressCount: 1,
          totalActive: 100,
          queuePressure: 1,
          currentToken: { elapsedMinutes: 0 }
        },
        staffData: {
          totalStaff: 1,
          availableStaff: 0.5,
          effectiveStaff: 0.5,
          staffUtilization: 1
        },
        historicalData: {
          mean: 20,
          percentile90: 30,
          confidence: 0.8,
          sampleCount: 100
        },
        timePattern: {
          peakFactor: 1.5,
          weekendFactor: 1.0,
          combinedFactor: 1.5
        },
        calculationMode: 'pessimistic',
        percentile: 90,
        returnRanges: false,
        token: { followup_priority: 'normal' }
      };

      const result = ewtCalculationEngine.applyAlgorithm(components);

      expect(result.ewt).toBeLessThanOrEqual(480);
    });
  });

  describe('caching', () => {
    it('should cache EWT calculations', async () => {
      Patient.findOne.mockResolvedValue({
        activeTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            status: 'pending',
            issuedAt: new Date(),
            followup_priority: 'normal'
          }
        ]
      });

      Department.findOne.mockResolvedValue({
        _id: 'dept123',
        code: 'OPD'
      });

      Staff.find.mockResolvedValue([
        { currentStatus: 'available', staffId: 'S001' }
      ]);

      HistoricalServiceTime.findOne.mockResolvedValue({
        statistics: {
          mean_service_time: 5,
          percentile_90: 8
        },
        data_quality: { confidence_score: 0.8 },
        getAdjustedEstimate: () => 8
      });

      // First call - no cache
      const result1 = await ewtCalculationEngine.calculateEWT(
        'OPD-001',
        'OPD',
        { useCache: true }
      );

      // Second call - should use cache
      const result2 = await ewtCalculationEngine.calculateEWT(
        'OPD-001',
        'OPD',
        { useCache: true }
      );

      expect(result1.ewt).toBe(result2.ewt);
      expect(Patient.findOne).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should bypass cache when requested', async () => {
      Patient.findOne.mockResolvedValue({
        activeTokens: [
          {
            token: 'OPD-001',
            department: 'OPD',
            status: 'pending',
            issuedAt: new Date(),
            followup_priority: 'normal'
          }
        ]
      });

      Department.findOne.mockResolvedValue({
        _id: 'dept123',
        code: 'OPD'
      });

      Staff.find.mockResolvedValue([
        { currentStatus: 'available', staffId: 'S001' }
      ]);

      HistoricalServiceTime.findOne.mockResolvedValue({
        statistics: {
          mean_service_time: 5,
          percentile_90: 8
        },
        data_quality: { confidence_score: 0.8 },
        getAdjustedEstimate: () => 8
      });

      // Two calls not using cache
      await ewtCalculationEngine.calculateEWT('OPD-001', 'OPD', {
        useCache: false
      });
      await ewtCalculationEngine.calculateEWT('OPD-001', 'OPD', {
        useCache: false
      });

      expect(Patient.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('setWeights', () => {
    it('should allow setting custom algorithm weights', () => {
      const customWeights = {
        queue_position: 0.5,
        staff_availability: 0.3
      };

      ewtCalculationEngine.setWeights(customWeights);

      expect(ewtCalculationEngine.weights.queue_position).toBe(0.5);
      expect(ewtCalculationEngine.weights.staff_availability).toBe(0.3);
    });

    it('should validate weights object', () => {
      expect(() => {
        ewtCalculationEngine.setWeights(null);
      }).toThrow();
    });
  });
});
