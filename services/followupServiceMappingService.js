// services/followupServiceMappingService.js
const FollowupServiceMapping = require('../models/FollowupServiceMapping');
const logger = require('../utils/logger');

class FollowupServiceMappingService {
  constructor() {
    // In-memory cache for mappings with TTL
    this.mappingCache = new Map();
    this.cacheExpiry = new Map();
    this.CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get mapping for a specific service type
   * Uses cache for performance
   * @param {string} serviceType - Service type code (e.g., 'LAB', 'PHARMACY')
   * @param {boolean} forceRefresh - Skip cache and fetch fresh data
   * @returns {Promise<Object>} Service mapping
   * @throws {Error} If service not found or inactive
   */
  async getMappingByServiceType(serviceType, forceRefresh = false) {
    try {
      const cacheKey = `service:${serviceType}`;

      // Check cache first (if not forcing refresh)
      if (!forceRefresh && this.mappingCache.has(cacheKey)) {
        const expiry = this.cacheExpiry.get(cacheKey);
        if (expiry && expiry > Date.now()) {
          logger.debug(`Cache hit for service type: ${serviceType}`);
          return this.mappingCache.get(cacheKey);
        } else {
          // Cache expired
          this.mappingCache.delete(cacheKey);
          this.cacheExpiry.delete(cacheKey);
        }
      }

      // Fetch from database
      const mapping = await FollowupServiceMapping.findOne({
        service_code: serviceType.toUpperCase(),
        is_active: true
      }).lean();

      if (!mapping) {
        throw new Error(`Service type "${serviceType}" not found or inactive`);
      }

      // Store in cache
      this.mappingCache.set(cacheKey, mapping);
      this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_TTL_MS);

      logger.debug(`Loaded service mapping from database: ${serviceType}`);
      return mapping;
    } catch (error) {
      logger.error('Failed to get service mapping', {
        serviceType,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate if a service type exists and is active
   * @param {string} serviceType - Service type code
   * @returns {Promise<boolean>} True if valid, false otherwise
   */
  async validateServiceType(serviceType) {
    try {
      const mapping = await this.getMappingByServiceType(serviceType);
      return !!mapping;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate multiple service types at once
   * @param {string[]} serviceTypes - Array of service type codes
   * @returns {Promise<Object>} { valid: [], invalid: [] }
   */
  async validateServiceTypes(serviceTypes) {
    try {
      const validationResults = {
        valid: [],
        invalid: []
      };

      for (const serviceType of serviceTypes) {
        const isValid = await this.validateServiceType(serviceType);
        if (isValid) {
          validationResults.valid.push(serviceType);
        } else {
          validationResults.invalid.push(serviceType);
        }
      }

      return validationResults;
    } catch (error) {
      logger.error('Failed to validate service types', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all active service mappings with optional caching
   * @param {boolean} forceRefresh - Skip cache
   * @returns {Promise<Array>} Array of all active service mappings
   */
  async getAllMappings(forceRefresh = false) {
    try {
      const cacheKey = 'all:mappings';

      // Check cache first
      if (!forceRefresh && this.mappingCache.has(cacheKey)) {
        const expiry = this.cacheExpiry.get(cacheKey);
        if (expiry && expiry > Date.now()) {
          logger.debug('Cache hit for all mappings');
          return this.mappingCache.get(cacheKey);
        } else {
          this.mappingCache.delete(cacheKey);
          this.cacheExpiry.delete(cacheKey);
        }
      }

      // Fetch from database
      const mappings = await FollowupServiceMapping.find({
        is_active: true
      })
        .sort({ service_code: 1 })
        .lean();

      // Store in cache
      this.mappingCache.set(cacheKey, mappings);
      this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_TTL_MS);

      logger.info(`Loaded ${mappings.length} active service mappings`);
      return mappings;
    } catch (error) {
      logger.error('Failed to get all mappings', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get mapping by department code
   * Returns all services available in a department
   * @param {string} departmentCode - Department code (e.g., 'LAB', 'PH')
   * @returns {Promise<Array>} Service mappings for the department
   */
  async getMappingsByDepartment(departmentCode) {
    try {
      const cacheKey = `dept:${departmentCode}`;

      // Check cache
      if (this.mappingCache.has(cacheKey)) {
        const expiry = this.cacheExpiry.get(cacheKey);
        if (expiry && expiry > Date.now()) {
          return this.mappingCache.get(cacheKey);
        } else {
          this.mappingCache.delete(cacheKey);
          this.cacheExpiry.delete(cacheKey);
        }
      }

      // Fetch from database
      const mappings = await FollowupServiceMapping.find({
        target_department: departmentCode.toUpperCase(),
        is_active: true
      })
        .sort({ service_code: 1 })
        .lean();

      // Store in cache
      this.mappingCache.set(cacheKey, mappings);
      this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_TTL_MS);

      return mappings;
    } catch (error) {
      logger.error('Failed to get mappings by department', {
        department: departmentCode,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Clear cache for a specific service or all
   * @param {string} serviceType - Specific service type to clear, or null for all
   */
  clearCache(serviceType = null) {
    if (serviceType) {
      const cacheKey = `service:${serviceType}`;
      this.mappingCache.delete(cacheKey);
      this.cacheExpiry.delete(cacheKey);
      logger.debug(`Cleared cache for service: ${serviceType}`);
    } else {
      this.mappingCache.clear();
      this.cacheExpiry.clear();
      logger.debug('Cleared all mapping cache');
    }
  }

  /**
   * Create or update a service mapping
   * @param {Object} mappingData - Service mapping data
   * @returns {Promise<Object>} Created/updated mapping
   */
  async upsertMapping(mappingData) {
    try {
      const { service_code, ...updateData } = mappingData;

      const mapping = await FollowupServiceMapping.findOneAndUpdate(
        { service_code: service_code.toUpperCase() },
        { service_code: service_code.toUpperCase(), ...updateData },
        { new: true, upsert: true }
      );

      // Invalidate cache for this service
      this.clearCache(service_code);

      logger.info(`Service mapping upserted: ${service_code}`);
      return mapping;
    } catch (error) {
      logger.error('Failed to upsert service mapping', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get cache statistics for monitoring
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    return {
      size: this.mappingCache.size,
      expired: Array.from(this.cacheExpiry.entries()).filter(
        ([, expiry]) => expiry <= Date.now()
      ).length,
      ttlMs: this.CACHE_TTL_MS
    };
  }
}

// Export singleton instance
module.exports = new FollowupServiceMappingService();
