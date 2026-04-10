const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Result', {
  collectionName: 'results',
  timestamps: true,
  unique: [['playerMasterId', 'event', 'year']],
  indexes: [['year'], ['medal'], ['event'], ['playerMasterId']],
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
    diplomaYear: 1,
    medal: 'Participation',
    imageUrl: '',
    imagePublicId: '',
    order: 0,
  },
});
