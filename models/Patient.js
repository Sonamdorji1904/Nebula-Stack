// models/Patient.js
const mongoose = require('mongoose');

/**
 * Audit history schema for token state changes
 */
const auditHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['created', 'called', 'completed', 'skipped', 'rescheduled', 'cancelled'],
      required: true
    },
    reason: String,
    staffId: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    notes: String,
    previousStatus: String,
    newStatus: String,
    rescheduledTime: Date
  },
  { _id: false }
);

/**
 * Token schema for queue management
 * Each department gets its own token for the queue
 */
const tokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true
    },
    department: {
      type: String,
      required: true
    },
    stage: {
      type: Number,
      required: true,
      default: 1
    },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'cancelled', 'skipped', 'rescheduled'],
      default: 'pending'
    },
    prepStatus: {
      type: String,
      enum: ['waiting', 'in-prep', 'ready', 'completed'],
      default: 'waiting',
      description: 'Token readiness status for nursing workflow'
    },
    issuedAt: {
      type: Date,
      default: Date.now
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    completedAt: {
      type: Date
    },
    skippedAt: {
      type: Date
    },
    skippedReason: String,
    skippedBy: String,
    rescheduledAt: {
      type: Date
    },
    rescheduledTime: {
      type: Date,
      description: 'New scheduled time for rescheduled token'
    },
    rescheduledBy: String,
    rescheduledReason: String,
    prepStartedAt: {
      type: Date,
      description: 'Timestamp when prep status transitioned to in-prep'
    },
    prepReadyAt: {
      type: Date,
      description: 'Timestamp when prep status transitioned to ready'
    },
    auditHistory: {
      type: [auditHistorySchema],
      default: []
    }
  },
  { _id: false }
);

// Main Patient schema
const patientSchema = new mongoose.Schema(
  {
    patientId: {
      type: String,
      required: true,
      unique: true
    },
    firstName: {
      type: String,
      required: true
    },
    middleName: {
      type: String
    },
    lastName: {
      type: String,
      required: true
    },
    dateOfBirth: {
      type: Date,
      required: true
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      required: true
    },
    contactNumber: {
      type: String,
      required: true
    },
    email: {
      type: String
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String
    },
    insuranceInfo: {
      provider: String,
      policyNumber: String
    },
    checkinTimestamp: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['checked-in', 'waiting', 'in-treatment', 'completed'],
      default: 'checked-in'
    },
    currentDepartment: {
      type: String
    },
    assignedDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor'
    },
    /**
     * All tokens (past and present) for queue tracking
     */
    multiStageTokens: {
      type: [tokenSchema],
      default: []
    },
    /**
     * Active tokens - shows on queue displays
     * Only includes pending or in-progress tokens
     */
    activeTokens: {
      type: [
        {
          token: String,
          department: String
        }
      ],
      default: []
    },
    lastStageCompletedAt: {
      type: Date
    },
    createdBy: {
      type: String
    },
    updatedBy: {
      type: String
    }
  },
  { timestamps: true }
);

/**
 * Indexes
 */
patientSchema.index({ patientId: 1 }, { unique: true });
patientSchema.index({ status: 1 });
patientSchema.index({ currentDepartment: 1 });

// Token lookup for query performance
patientSchema.index({ 'multiStageTokens.token': 1 });
patientSchema.index({ 'multiStageTokens.department': 1 });

// Fast lookup for queue display
patientSchema.index({ 'activeTokens.token': 1, 'activeTokens.department': 1 });

/**
 * DB-level validation: Ensure token uniqueness per department
 * This catches duplicates even if issueToken() is bypassed
 */
patientSchema.path('multiStageTokens').validate(function (tokens) {
  const seen = new Set();
  
  for (const token of tokens) {
    const key = `${token.token}:${token.department}`;
    if (seen.has(key)) {
      return false; // Duplicate found
    }
    seen.add(key);
  }
  
  return true;
}, 'Duplicate token found for the same department');

/**
 * Pre-save middleware: Auto-sync activeTokens from multiStageTokens
 */
patientSchema.pre('save', function (next) {
  if (this.isModified('multiStageTokens')) {
    this.activeTokens = this.multiStageTokens
      .filter(t => t.status === 'pending' || t.status === 'in-progress')
      .map(t => ({
        token: t.token,
        department: t.department
      }));
  }
  next();
});

/**
 * Virtual helpers
 */
patientSchema.virtual('hasActiveTokens').get(function () {
  return this.activeTokens && this.activeTokens.length > 0;
});

/**
 * Issue new token for a department (for follow-up)
 */
patientSchema.methods.issueToken = function (department, token, stage = 1) {
  // Check if token already exists for this department
  const exists = this.multiStageTokens.some(
    t => t.token === token && t.department === department
  );
  
  if (exists) {
    throw new Error(`Token ${token} already exists for department ${department}`);
  }
  
  this.multiStageTokens.push({
    token,
    department,
    stage,
    status: 'pending',
    createdAt: new Date()
  });
  
  // activeTokens will auto-sync on save
};

/**
 * Call token - mark as in-progress (shown on display)
 */
patientSchema.methods.callToken = function (token, department) {
  const tokenEntry = this.multiStageTokens.find(
    t => t.token === token && t.department === department
  );
  
  if (!tokenEntry) {
    throw new Error(`Token ${token} not found for department ${department}`);
  }
  
  if (tokenEntry.status !== 'pending') {
    throw new Error(`Token ${token} is not pending`);
  }
  
  tokenEntry.status = 'in-progress';
  this.currentDepartment = department;
  this.status = 'in-treatment';
  
  // Add audit entry
  tokenEntry.auditHistory = tokenEntry.auditHistory || [];
  tokenEntry.auditHistory.push({
    action: 'called',
    timestamp: new Date(),
    previousStatus: 'pending',
    newStatus: 'in-progress'
  });
};

/**
 * Skip token - temporarily remove from queue with reason
 */
patientSchema.methods.skipToken = function (token, department, reason, staffId, notes = '') {
  const tokenEntry = this.multiStageTokens.find(
    t => t.token === token && t.department === department
  );
  
  if (!tokenEntry) {
    throw new Error(`Token ${token} not found for department ${department}`);
  }
  
  if (!['pending', 'in-progress'].includes(tokenEntry.status)) {
    throw new Error(`Token ${token} cannot be skipped. Current status: ${tokenEntry.status}`);
  }
  
  const previousStatus = tokenEntry.status;
  
  tokenEntry.status = 'skipped';
  tokenEntry.skippedAt = new Date();
  tokenEntry.skippedReason = reason;
  tokenEntry.skippedBy = staffId;
  
  // Add audit entry
  tokenEntry.auditHistory = tokenEntry.auditHistory || [];
  tokenEntry.auditHistory.push({
    action: 'skipped',
    reason,
    staffId,
    timestamp: new Date(),
    notes,
    previousStatus,
    newStatus: 'skipped'
  });
};

/**
 * Reschedule token - adjust scheduled time
 */
patientSchema.methods.rescheduleToken = function (token, department, rescheduledTime, staffId, reason, notes = '') {
  const tokenEntry = this.multiStageTokens.find(
    t => t.token === token && t.department === department
  );
  
  if (!tokenEntry) {
    throw new Error(`Token ${token} not found for department ${department}`);
  }
  
  if (!['pending', 'in-progress', 'skipped'].includes(tokenEntry.status)) {
    throw new Error(`Token ${token} cannot be rescheduled. Current status: ${tokenEntry.status}`);
  }
  
  const previousStatus = tokenEntry.status;
  
  tokenEntry.status = 'rescheduled';
  tokenEntry.rescheduledAt = new Date();
  tokenEntry.rescheduledTime = rescheduledTime;
  tokenEntry.rescheduledBy = staffId;
  tokenEntry.rescheduledReason = reason;
  
  // Add audit entry
  tokenEntry.auditHistory = tokenEntry.auditHistory || [];
  tokenEntry.auditHistory.push({
    action: 'rescheduled',
    reason,
    staffId,
    timestamp: new Date(),
    notes,
    previousStatus,
    newStatus: 'rescheduled',
    rescheduledTime
  });
};

/**
 * Reactivate skipped token (put back in queue)
 */
patientSchema.methods.reactivateToken = function (token, department, staffId, notes = '') {
  const tokenEntry = this.multiStageTokens.find(
    t => t.token === token && t.department === department
  );
  
  if (!tokenEntry) {
    throw new Error(`Token ${token} not found for department ${department}`);
  }
  
  if (tokenEntry.status === 'rescheduled') {
    // If rescheduled, return to pending at scheduled time
    tokenEntry.status = 'pending';
  } else if (tokenEntry.status === 'skipped') {
    // If skipped, return to pending immediately
    tokenEntry.status = 'pending';
  } else {
    throw new Error(`Token ${token} cannot be reactivated. Current status: ${tokenEntry.status}`);
  }
  
  const previousStatus = tokenEntry.status;
  
  // Add audit entry
  tokenEntry.auditHistory = tokenEntry.auditHistory || [];
  tokenEntry.auditHistory.push({
    action: 'created', // Back to normal pending state
    staffId,
    timestamp: new Date(),
    notes: `Reactivated. ${notes}`,
    previousStatus,
    newStatus: 'pending'
  });
};

/**
 * Complete token - service done
 */
patientSchema.methods.completeToken = function (token, department) {
  const tokenEntry = this.multiStageTokens.find(
    t => t.token === token && t.department === department
  );
  
  if (!tokenEntry) {
    throw new Error(`Token ${token} not found for department ${department}`);
  }
  
  tokenEntry.status = 'completed';
  tokenEntry.completedAt = new Date();
  this.lastStageCompletedAt = new Date();
  
  // Check if there are any more active tokens
  const hasMoreTokens = this.multiStageTokens.some(
    t => t.status === 'pending' || t.status === 'in-progress'
  );
  
  if (!hasMoreTokens) {
    this.status = 'completed';
  } else {
    this.status = 'waiting';
  }
  
  // activeTokens will auto-sync on save
};

/**
 * Update prep status - nurse workflow status tracking
 */
patientSchema.methods.updatePrepStatus = function (token, department, newStatus, staffId, notes = '') {
  const tokenEntry = this.multiStageTokens.find(
    t => t.token === token && t.department === department
  );
  
  if (!tokenEntry) {
    throw new Error(`Token ${token} not found for department ${department}`);
  }
  
  const validStatuses = ['waiting', 'in-prep', 'ready', 'completed'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid prep status: ${newStatus}`);
  }
  
  const previousPrepStatus = tokenEntry.prepStatus;
  
  // Track timing for prep transitions
  if (newStatus === 'in-prep' && previousPrepStatus !== 'in-prep') {
    tokenEntry.prepStartedAt = new Date();
  }
  
  if (newStatus === 'ready' && previousPrepStatus !== 'ready') {
    tokenEntry.prepReadyAt = new Date();
  }
  
  tokenEntry.prepStatus = newStatus;
  
  // Add audit entry
  tokenEntry.auditHistory = tokenEntry.auditHistory || [];
  tokenEntry.auditHistory.push({
    action: 'prep-status-updated',
    staffId,
    timestamp: new Date(),
    notes: `Prep status changed from ${previousPrepStatus} to ${newStatus}. ${notes}`,
    previousStatus: previousPrepStatus,
    newStatus: newStatus
  });
};

/**
 * Get active token for a department (for queue display)
 */
patientSchema.methods.getActiveTokenForDepartment = function (department) {
  const token = this.activeTokens.find(t => t.department === department);
  return token ? token.token : null;
};

module.exports = mongoose.model('Patient', patientSchema);