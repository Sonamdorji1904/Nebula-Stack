const mongoose = require("mongoose");

const FollowUpTokenSchema = new mongoose.Schema({
  patient_id: { type: String, required: true },
  consultation_id: { type: String, required: true },

  token_number: { type: String, unique: true },

  department: { type: String, required: true },
  priority_level: { type: String, required: true },

  estimated_wait_time: { type: Number },

  status: {
    type: String,
    enum: ["CREATED", "SENT_TO_DWE", "FAILED"],
    default: "CREATED"
  },

  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model("FollowUpToken", FollowUpTokenSchema);
