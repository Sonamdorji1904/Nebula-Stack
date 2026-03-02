// scripts/seedFollowupServiceMappings.js
const mongoose = require('mongoose');
const FollowupServiceMapping = require('../models/FollowupServiceMapping');
const logger = require('../utils/logger');
require('dotenv').config();

/**
 * Standard service types available for post-consultation followups
 */
const STANDARD_SERVICES = [
  {
    service_code: 'LAB',
    service_name: 'Laboratory Tests',
    description: 'Blood tests, CBC, biochemistry, culture and sensitivity, etc.',
    target_department: 'LAB',
    estimated_duration: 30,
    default_priority: 'normal',
    allow_override_priority: true,
    allow_override_duration: false
  },
  {
    service_code: 'PHARMACY',
    service_name: 'Pharmacy',
    description: 'Medication dispensing and consultation',
    target_department: 'PH',
    estimated_duration: 15,
    default_priority: 'normal',
    allow_override_priority: true,
    allow_override_duration: false
  },
  {
    service_code: 'IMAGING',
    service_name: 'Medical Imaging / Radiology',
    description: 'X-ray, CT scan, ultrasound, MRI',
    target_department: 'RAD',
    estimated_duration: 45,
    default_priority: 'normal',
    allow_override_priority: true,
    allow_override_duration: false
  },
  {
    service_code: 'ECG',
    service_name: 'Electrocardiogram',
    description: 'Heart rhythm and function testing',
    target_department: 'ECG',
    estimated_duration: 20,
    default_priority: 'normal',
    allow_override_priority: true,
    allow_override_duration: false
  },
  {
    service_code: 'SPECIALTY',
    service_name: 'Specialist Consultation',
    description: 'Referral to specialist departments',
    target_department: 'OPD',
    estimated_duration: 60,
    default_priority: 'normal',
    allow_override_priority: true,
    allow_override_duration: true
  },
  {
    service_code: 'NURSING',
    service_name: 'Nursing Care',
    description: 'Post-treatment nursing interventions',
    target_department: 'NURSING',
    estimated_duration: 30,
    default_priority: 'normal',
    allow_override_priority: true,
    allow_override_duration: true
  },
  {
    service_code: 'PHYSIO',
    service_name: 'Physical Therapy',
    description: 'Physiotherapy and rehabilitation',
    target_department: 'PHYSIO',
    estimated_duration: 45,
    default_priority: 'normal',
    allow_override_priority: true,
    allow_override_duration: true
  },
  {
    service_code: 'NUTRITION',
    service_name: 'Nutrition Consultation',
    description: 'Dietary counseling and meal planning',
    target_department: 'NUTRITION',
    estimated_duration: 30,
    default_priority: 'low',
    allow_override_priority: true,
    allow_override_duration: true
  },
  {
    service_code: 'VACCINATION',
    service_name: 'Vaccination',
    description: 'Immunization and vaccination services',
    target_department: 'VAC',
    estimated_duration: 15,
    default_priority: 'normal',
    allow_override_priority: false,
    allow_override_duration: false
  },
  {
    service_code: 'FOLLOWUP_CONSULTATION',
    service_name: 'Follow-up Consultation',
    description: 'Scheduled follow-up doctor consultation',
    target_department: 'OPD',
    estimated_duration: 20,
    default_priority: 'normal',
    allow_override_priority: true,
    allow_override_duration: true
  }
];

async function seedMappings() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nshqms';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    logger.info('Connected to MongoDB');

    // Check existing count
    const existingCount = await FollowupServiceMapping.countDocuments();
    logger.info(`Found ${existingCount} existing service mappings`);

    // Upsert each standard service
    let createdCount = 0;
    let updatedCount = 0;

    for (const service of STANDARD_SERVICES) {
      const existing = await FollowupServiceMapping.findOne({
        service_code: service.service_code
      });

      if (existing) {
        // Update existing service (except service_code)
        await FollowupServiceMapping.findOneAndUpdate(
          { service_code: service.service_code },
          { ...service, is_active: true },
          { new: true }
        );
        updatedCount++;
        logger.info(`✓ Updated service: ${service.service_code} - ${service.service_name}`);
      } else {
        // Create new service
        await FollowupServiceMapping.create({
          ...service,
          is_active: true
        });
        createdCount++;
        logger.info(`✓ Created service: ${service.service_code} - ${service.service_name}`);
      }
    }

    logger.info(
      `\n✅ Seed completed: ${createdCount} created, ${updatedCount} updated, ${STANDARD_SERVICES.length} total`
    );

    // Display summary
    const finalCount = await FollowupServiceMapping.countDocuments({
      is_active: true
    });
    logger.info(`Total active service mappings: ${finalCount}`);

    // Close connection
    await mongoose.connection.close();
    logger.info('Database connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('Failed to seed followup service mappings', {
      error: error.message,
      stack: error.stack
    });
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run seed if this script is executed directly
if (require.main === module) {
  seedMappings();
}

module.exports = seedMappings;
