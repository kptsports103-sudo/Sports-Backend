const { createMySQLModel } = require('../../lib/mysqlDocumentModel');
const { DEFAULT_RESULT_LEVEL } = require('../utils/resultLevels');

module.exports = createMySQLModel('Result', {
  collectionName: 'results',
  timestamps: true,
  unique: [['playerMasterId', 'event', 'year', 'level']],
  indexes: [['year'], ['level'], ['medal'], ['event'], ['playerMasterId']],
  fieldTypes: {
    year: 'integer',
    diplomaYear: 'integer',
    order: 'integer',
    imageUrl: 'text',
    imagePublicId: 'text',
  },
  defaults: {
    playerMasterId: '',
    playerId: '',
    name: '',
    branch: '',
    event: '',
    year: null,
    level: DEFAULT_RESULT_LEVEL,
    diplomaYear: 1,
    medal: 'Participation',
    imageUrl: '',
    imagePublicId: '',
    order: 0,
  },
});
