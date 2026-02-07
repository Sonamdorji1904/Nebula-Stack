const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['available', 'busy', 'on-break', 'offline'],
      required: true
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    changedBy: String,
    reason: String,
    durationMinutes: Number
  },
  { _id: false, timestamps: false }
);

const staffSchema = new mongoose.Schema(
  {
    staffId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    displayName: String,
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: true
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true
    },
    specialization: String,
    counterNumber: String,
    isActive: {
      type: Boolean,
      default: true
    },
    isOnDuty: {
      type: Boolean,
      default: false
    },
    currentStatus: {
      type: String,
      enum: ['available', 'busy', 'on-break', 'offline'],
      default: 'offline'
    },
    statusUpdatedAt: {
      type: Date,
      default: Date.now
    },
    previousStatus: String,
    statusHistory: [statusHistorySchema],
    lastLoginAt: Date,
    createdBy: {
      type: String,
      default: 'system'
    }
  },
  { timestamps: true }
);

// Indexes
staffSchema.index({ staffId: 1 });
staffSchema.index({ email: 1 });
staffSchema.index({ role: 1, department: 1 });
staffSchema.index({ currentStatus: 1, department: 1 });
staffSchema.index({ statusUpdatedAt: -1 });

// Auto display name
staffSchema.pre('save', function (next) {
  if (!this.displayName && this.fullName) {
    const counter = this.counterNumber ? ` (${this.counterNumber})` : '';
    this.displayName = `${this.fullName}${counter}`;
  }
  next();
});

module.exports = mongoose.model('Staff', staffSchema);
