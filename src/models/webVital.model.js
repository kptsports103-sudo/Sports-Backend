const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('WebVital', {
  collectionName: 'web_vitals',
  timestamps: true,
  indexes: [['metricName'], ['path'], ['receivedAtClient']],
  fieldTypes: {
    value: 'number',
    viewportWidth: 'integer',
    viewportHeight: 'integer',
    deviceMemory: 'number',
    hardwareConcurrency: 'integer',
    receivedAtClient: 'date',
  },
  defaults: {
    metricName: '',
    value: 0,
    rating: 'unknown',
    metricId: '',
    path: '/',
    navigationType: '',
    userAgent: '',
    effectiveType: '',
    language: '',
    viewportWidth: 0,
    viewportHeight: 0,
    deviceMemory: 0,
    hardwareConcurrency: 0,
    ipAddress: '',
    receivedAtClient: null,
  },
});
