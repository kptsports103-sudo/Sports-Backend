const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('AdminNotepadPage', {
  collectionName: 'admin_notepad_pages',
  timestamps: true,
  unique: [['adminId', 'pageNumber']],
  indexes: [['adminId'], ['pageNumber']],
  fieldTypes: {
    content: 'text',
  },
  defaults: {
    adminId: '',
    adminEmail: '',
    heading: 'Darya Admin Notepad',
    pageNumber: 1,
    title: '',
    content: '',
    lineCount: 10,
  },
});
