/**
 * ⚠️ LOCAL-ONLY MIGRATION SCRIPT
 *
 * Purpose:
 *  - One-time migration to convert 'zonal' level to 'national' in MySQL results tables
 *  - Rebuilds MySQL projections after updating source data
 *  - This fixes the issue where Zonal (South Zone) results don't appear in the UI
 *
 * How to run:
 *  - Start backend locally
 *  - Run: node scripts/migrate-zonal-level.js
 *
 * ❌ DO NOT:
 *  - Import this file anywhere
 *  - Run during deployment
 *  - Run on Vercel / serverless
 *
 * ✅ This script is for MANUAL execution only.
 */

const { pool } = require('../src/config/mysql');
const Result = require('../src/models/result.model');
const GroupResult = require('../src/models/groupResult.model');
const { ensureResultsBoardProjection } = require('../src/services/resultsBoard.service');

async function runMigration() {
  try {
    console.log('🔄 Starting zonal level migration...');
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL');

    // ==========================================
    // STEP 1: Update Individual Results with 'zonal' level
    // ==========================================
    console.log('\n📋 STEP 1: Updating Individual Results with level="zonal"...');
    
    const [individualResults] = await connection.query(
      "SELECT id, data FROM app_documents WHERE collection_name = 'results' AND JSON_EXTRACT(data, '$.level') = ?",
      ['zonal']
    );
    console.log(`   Found ${individualResults.length} individual results with level="zonal"`);
    
    let updatedIndividual = 0;
    for (const row of individualResults) {
      const data = JSON.parse(row.data);
      data.level = 'national';
      await connection.query(
        'UPDATE app_documents SET data = ? WHERE id = ?',
        [JSON.stringify(data), row.id]
      );
      updatedIndividual++;
      console.log(`   ✅ Updated result: ${data.name || 'Unknown'} (${data.year || '-'}) - ${data.event || '-'}`);
    }
    
    console.log(`   📊 Individual results updated: ${updatedIndividual}`);

    // ==========================================
    // STEP 2: Update Group Results with 'zonal' level
    // ==========================================
    console.log('\n📋 STEP 2: Updating Group Results with level="zonal"...');
    
    const [groupResults] = await connection.query(
      "SELECT id, data FROM app_documents WHERE collection_name = 'group_results' AND JSON_EXTRACT(data, '$.level') = ?",
      ['zonal']
    );
    console.log(`   Found ${groupResults.length} group results with level="zonal"`);
    
    let updatedGroup = 0;
    for (const row of groupResults) {
      const data = JSON.parse(row.data);
      data.level = 'national';
      await connection.query(
        'UPDATE app_documents SET data = ? WHERE id = ?',
        [JSON.stringify(data), row.id]
      );
      updatedGroup++;
      console.log(`   ✅ Updated group: ${data.teamName || 'Unknown'} (${data.year || '-'}) - ${data.event || '-'}`);
    }
    
    console.log(`   📊 Group results updated: ${updatedGroup}`);

    connection.release();

    // ==========================================
    // STEP 3: Rebuild MySQL Projections
    // ==========================================
    console.log('\n📋 STEP 3: Rebuilding MySQL projections...');
    
    try {
      await ensureResultsBoardProjection({ force: true });
      console.log('   ✅ MySQL projections rebuilt successfully');
    } catch (err) {
      console.log('   ⚠️ MySQL projection rebuild skipped or failed:', err.message);
      console.log('   Note: Projections will auto-rebuild on next API call.');
    }

    // ==========================================
    // STEP 4: Also check for any other non-standard levels
    // ==========================================
    console.log('\n📋 STEP 4: Checking for other non-standard levels...');
    
    const validLevels = ['state', 'national'];
    const conn2 = await pool.getConnection();
    
    const [otherIndividual] = await conn2.query(
      "SELECT COUNT(*) as count FROM app_documents WHERE collection_name = 'results' AND JSON_EXTRACT(data, '$.level') NOT IN (?, ?)",
      validLevels
    );
    const [otherGroup] = await conn2.query(
      "SELECT COUNT(*) as count FROM app_documents WHERE collection_name = 'group_results' AND JSON_EXTRACT(data, '$.level') NOT IN (?, ?)",
      validLevels
    );
    
    if (otherIndividual[0].count > 0 || otherGroup[0].count > 0) {
      console.log(`   ⚠️ Found ${otherIndividual[0].count} individual and ${otherGroup[0].count} group results with non-standard levels`);
      console.log('   These will default to "state" in the current normalization logic.');
    } else {
      console.log('   ✅ All results have standard levels');
    }
    
    conn2.release();

    // ==========================================
    // STEP 5: Final Summary
    // ==========================================
    console.log('\n🎉 Migration complete!');
    console.log(`   Individual results updated: ${updatedIndividual}`);
    console.log(`   Group results updated: ${updatedGroup}`);
    
    // Verify counts
    const conn3 = await pool.getConnection();
    const [finalZonalIndividual] = await conn3.query(
      "SELECT COUNT(*) as count FROM app_documents WHERE collection_name = 'results' AND JSON_EXTRACT(data, '$.level') = ?",
      ['zonal']
    );
    const [finalNationalIndividual] = await conn3.query(
      "SELECT COUNT(*) as count FROM app_documents WHERE collection_name = 'results' AND JSON_EXTRACT(data, '$.level') = ?",
      ['national']
    );
    const [finalZonalGroup] = await conn3.query(
      "SELECT COUNT(*) as count FROM app_documents WHERE collection_name = 'group_results' AND JSON_EXTRACT(data, '$.level') = ?",
      ['zonal']
    );
    const [finalNationalGroup] = await conn3.query(
      "SELECT COUNT(*) as count FROM app_documents WHERE collection_name = 'group_results' AND JSON_EXTRACT(data, '$.level') = ?",
      ['national']
    );
    conn3.release();
    
    console.log('\n📊 Final MySQL state:');
    console.log(`   Individual results with level='zonal': ${finalZonalIndividual[0].count}`);
    console.log(`   Individual results with level='national': ${finalNationalIndividual[0].count}`);
    console.log(`   Group results with level='zonal': ${finalZonalGroup[0].count}`);
    console.log(`   Group results with level='national': ${finalNationalGroup[0].count}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
