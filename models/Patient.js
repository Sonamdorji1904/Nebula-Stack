// models/Patient.js
const mongoose = require('mongoose');

// MongoDB Connection String - Add your connection here
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nshqms';

// Connect to MongoDB (only once when model loads)
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected successfully'))
.catch((err) => console.error('MongoDB connection error:', err));

// Token schema for multi-stage follow-ups
const tokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  stage: { type: Number, required: true },
  department: { type: String, required: true },
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
  assignedDoctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Doctor'
  },
  multiStageTokens: [tokenSchema],
  activeTokens: [tokenSchema],
  lastStageCompletedAt: { type: Date },
  createdBy: { type: String },
  updatedBy: { type: String }
}, { timestamps: true });

// Indexes for performance
patientSchema.index({ patientId: 1 }, { unique: true });
patientSchema.index({ status: 1 });
patientSchema.index({ 'activeTokens.token': 1 });

module.exports = mongoose.model('Patient', patientSchema);