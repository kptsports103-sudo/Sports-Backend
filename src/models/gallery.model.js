const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Gallery', {
  collectionName: 'galleries',
  fieldTypes: {
    createdAt: 'date',
  },
  defaults: {
    title: '',
    media: [],
    visibility: true,
    createdAt: () => new Date().toISOString(),
  },
});
