const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('MediaItem', {
  collectionName: 'media_items',
  timestamps: true,
  indexes: [['category'], ['title']],
  fieldTypes: {
    description: 'text',
    link: 'text',
    files: 'json',
  },
  defaults: {
    category: '',
    title: '',
    description: '',
    link: '',
    files: [],
  },
});
