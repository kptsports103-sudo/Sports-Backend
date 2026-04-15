const { createMySQLModel } = require('../../lib/mysqlDocumentModel');
const { DEFAULT_GALLERY_CATEGORY } = require('../utils/galleryCategories');

module.exports = createMySQLModel('Gallery', {
  collectionName: 'galleries',
  fieldTypes: {
    category: 'string',
    createdAt: 'date',
  },
  defaults: {
    title: '',
    category: DEFAULT_GALLERY_CATEGORY,
    media: [],
    visibility: true,
    createdAt: () => new Date().toISOString(),
  },
});
