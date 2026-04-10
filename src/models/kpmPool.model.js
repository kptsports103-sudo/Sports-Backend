const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('KpmPool', {
  collectionName: 'kpm_pool',
  timestamps: true,
  idDefault: () => 'GLOBAL',
  defaults: {
    _id: 'GLOBAL',
    available: [],
    allocated: [],
  },
});
