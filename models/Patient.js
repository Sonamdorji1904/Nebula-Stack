// models/Patient.js
const mongoose = require('mongoose');

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
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Patient', patientSchema);