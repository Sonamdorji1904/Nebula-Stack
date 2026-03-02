// models/FollowupServiceMapping.js
const mongoose = require('mongoose');

/**
 * Followup Service Mapping Schema
 * Maps service types (Lab, Pharmacy, etc.) to target departments
 * and provides default configuration for followup token creation
 */
const followupServiceMappingSchema = new mongoose.Schema(
  {
    service_code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      description: 'Unique code for the service type (e.g., LAB, PHARMACY, RAD)'
    },
    service_name: {
      type: String,
      required: true,
      description: 'Human-readable service name (e.g., Laboratory Tests)'
    },
    description: {
      type: String,
      description: 'Detailed description of the service'
    },
    target_department: {
      type: String,
      required: true,
      description: 'Department code that provides this service (e.g., LAB, PH, RAD)'
    },
    estimated_duration: {
      type: Number,
      required: true,
      min: 5,
      max: 480,
      default: 30,
      description: 'Estimated service duration in minutes'
    },
    default_priority: {
      type: String,
      enum: ['high', 'normal', 'low'],
      default: 'normal',
      description: 'Default priority level for this service type'
    },
    is_active: {
      type: Boolean,
      default: true,
      description: 'Whether this service mapping is currently active'
    },
    allow_override_priority: {
      type: Boolean,
      default: true,
      description: 'Whether ePIS can override the default priority'
    },
    allow_override_duration: {
      type: Boolean,
      default: false,
      description: 'Whether ePIS can override estimated duration'
    },
    max_followups_per_consultation: {
      type: Number,
      default: null,
      description: 'Limit on how many times this service can be ordered per consultation (null = unlimited)'
    },
    requires_approval: {
      type: Boolean,
      default: false,
      description: 'Whether followup token creation requires staff approval'
    },
    notes: {
      type: String,
      description: 'Internal notes about the service'
    }
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  }
);

// Indexes for efficient lookups
followupServiceMappingSchema.index({ service_code: 1 });
followupServiceMappingSchema.index({ target_department: 1 });
followupServiceMappingSchema.index({ is_active: 1 });
followupServiceMappingSchema.index({ service_code: 1, is_active: 1 });

module.exports = mongoose.model('FollowupServiceMapping', followupServiceMappingSchema);
