// models/Patient.js
const mongoose = require('mongoose');

// Token schema for multi-stage follow-ups
const tokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true }, // Unique token per stage/department
  stage: { type: Number, required: true },              // Stage number
  department: { type: String, required: true },         // e.g., Registration, Lab, Pharmacy
  status: { 
    type: String, 
    enum: ['pending','in-progress','completed','cancelled'], 
    default: 'pending' 
  },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  expiresAt: { type: Date }
});

// Main Patient schema
const patientSchema = new mongoose.Schema({
  patientId: {
    type: String,
    required: true,
    unique: true
  },
  firstName: {
    type: String,
    required: true
  },
  middleName: {              // New field
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
  assignedDoctorId: {                      // Future-proof for doctor assignment
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Doctor'
  },
  multiStageTokens: [tokenSchema],         // All follow-up stages
  activeTokens: [tokenSchema],             // Only pending/in-progress tokens
  lastStageCompletedAt: { type: Date },    // Tracks latest completed stage
  createdBy: { type: String },             // Audit: who created
  updatedBy: { type: String }              // Audit: who last updated
}, { timestamps: true });

// Indexes for performance
patientSchema.index({ patientId: 1 }, { unique: true });
patientSchema.index({ status: 1 });
patientSchema.index({ 'activeTokens.token': 1 });

module.exports = mongoose.model('Patient', patientSchema);