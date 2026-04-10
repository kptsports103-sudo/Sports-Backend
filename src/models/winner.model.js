const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Winner', {
  collectionName: 'winners',
  timestamps: true,
  indexes: [['year'], ['medal'], ['linkedResultId']],
  fieldTypes: {
    year: 'integer',
    imageUrl: 'text',
  },
  defaults: {
    eventName: '',
    playerName: '',
    teamName: '',
    branch: '',
    year: null,
    medal: 'Gold',
    linkedResultType: 'manual',
    linkedResultId: '',
    imageUrl: '',
    imagePublicId: '',
  },
});
