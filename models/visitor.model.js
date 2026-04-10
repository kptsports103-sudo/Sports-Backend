const { createMySQLModel } = require('../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Visitor', {
  collectionName: 'visitors',
  unique: [['date']],
  fieldTypes: {
    count: 'integer',
  },
  defaults: {
    date: '',
    count: 1,
  },
});
