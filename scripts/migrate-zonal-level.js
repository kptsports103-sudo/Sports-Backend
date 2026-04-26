
const mongoose = require('mongoose');
const Result = require('../src/models/result.model');
const GroupResult = require('../src/models/groupResult.model');

// MongoDB connection string (uses cloud URI if available)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://kptwebsite103:kptwebsite103@kpt.syjmrn1.mongodb.net/';

async function runMigration() {
  try {
    console.log('🔄 Starting zonal level migration...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // ==========================================
    // STEP 1: Update Individual Results with 'zonal' level
    // ==========================================
    console.log('\n📋 STEP 1: Updating Individual Results with level="zonal"...');
    
    const individualResults = await Result.find({ level: 'zonal' });
    console.log(`   Found ${individualResults.length} individual results with level="zonal"`);
    
    let updatedIndividual = 0;
    for (const result of individualResults) {
      result.level = 'national';
      await result.save();
      updatedIndividual++;
      console.log(`   ✅ Updated result: ${result.name} (${result.year}) - ${result.event}`);
    }
    
    console.log(`   📊 Individual results updated: ${updatedIndividual}`);

    // ==========================================
    // STEP 2: Update Group Results with 'zonal' level
    // ==========================================
    console.log('\n📋 STEP 2: Updating Group Results with level="zonal"...');
    
    const groupResults = await GroupResult.find({ level: 'zonal' });
    console.log(`   Found ${groupResults.length} group results with level="zonal"`);
    
    let updatedGroup = 0;
    for (const group of groupResults) {
      group.level = 'national';
      await group.save();
      updatedGroup++;
      console.log(`   ✅ Updated group: ${group.teamName} (${group.year}) - ${group.event}`);
    }
    
    console.log(`   📊 Group results updated: ${updatedGroup}`);

    // ==========================================
    // STEP 3: Also check for any other non-standard levels
    // ==========================================
    console.log('\n📋 STEP 3: Checking for other non-standard levels...');
    
    const validLevels = ['state', 'national', 'zonal'];
    const otherIndividual = await Result.find({
      level: { $nin: validLevels }
    });
    const otherGroup = await GroupResult.find({
      level: { $nin: validLevels }
    });
    
    if (otherIndividual.length > 0 || otherGroup.length > 0) {
      console.log(`   ⚠️ Found ${otherIndividual.length} individual and ${otherGroup.length} group results with non-standard levels`);
      console.log('   These will default to "state" in the current normalization logic.');
    } else {
      console.log('   ✅ All results have standard levels');
    }

    // ==========================================
    // STEP 4: Final Summary
    // ==========================================
    console.log('\n🎉 Migration complete!');
    console.log(`   Individual results updated: ${updatedIndividual}`);
    console.log(`   Group results updated: ${updatedGroup}`);
    
    // Verify counts
    const finalZonalIndividual = await Result.countDocuments({ level: 'zonal' });
    const finalZonalGroup = await GroupResult.countDocuments({ level: 'zonal' });
    const finalNationalIndividual = await Result.countDocuments({ level: 'national' });
    const finalNationalGroup = await GroupResult.countDocuments({ level: 'national' });
    
    console.log('\n📊 Final database state:');
    console.log(`   Individual results with level='zonal': ${finalZonalIndividual}`);
    console.log(`   Individual results with level='national': ${finalNationalIndividual}`);
    console.log(`   Group results with level='zonal': ${finalZonalGroup}`);
    console.log(`   Group results with level='national': ${finalNationalGroup}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
