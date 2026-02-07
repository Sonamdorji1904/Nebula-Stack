const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      enum: ['Doctor', 'Nurse', 'Admin'],
      required: true,
      unique: true
    },
    permissions: [
      {
        type: String,
        enum: [
          'queue:view',
          'queue:call',
          'queue:transfer',
          'queue:serve',
          'queue:manage',
          'queue:nurse-monitor',
          'token:complete',
          'token:cancel',
          'patient:register',
          'patient:edit',
          'staff:manage',
          'reports:view'
        ]
      }
    ]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Role', roleSchema);
