const { createMySQLModel } = require('../../lib/mysqlDocumentModel');
const { DEFAULT_RESULT_LEVEL } = require('../utils/resultLevels');

module.exports = createMySQLModel('GroupResult', {
  collectionName: 'group_results',
  timestamps: true,
  indexes: [['year'], ['level'], ['medal'], ['event']],
  fieldTypes: {
    year: 'integer',
    imageUrl: 'text',
    imagePublicId: 'text',
  },
  defaults: {
    teamName: '',
    event: '',
    year: null,
    level: DEFAULT_RESULT_LEVEL,
    members: [],
    memberIds: [],
    memberMasterIds: [],
    medal: 'Participation',
    imageUrl: '',
    imagePublicId: '',
  },
});
