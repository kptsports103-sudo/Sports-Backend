const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('GroupResult', {
  collectionName: 'group_results',
  timestamps: true,
  indexes: [['year'], ['medal'], ['event']],
  fieldTypes: {
    year: 'integer',
    imageUrl: 'text',
  },
  defaults: {
    teamName: '',
    event: '',
    year: null,
    members: [],
    memberIds: [],
    memberMasterIds: [],
    medal: 'Participation',
    imageUrl: '',
  },
});
