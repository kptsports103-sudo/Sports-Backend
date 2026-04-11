const { createMySQLModel } = require('../../lib/mysqlDocumentModel');

module.exports = createMySQLModel('Home', {
  collectionName: 'home_content',
  timestamps: true,
  fieldTypes: {
    welcomeText: 'text',
    about: 'text',
    history: 'text',
    bigText: 'text',
  },
  defaults: {
    heroTitle: 'Champions in Spirit, Champions in Action',
    heroSubtitle: 'Karnataka Government Polytechnic, Mangaluru Sports Portal',
    heroButtons: [],
    banners: [],
    achievements: [],
    achievementSettings: {
      sportsMeetsConducted: '',
      yearsOfExcellence: '',
    },
    sportsCategories: [],
    gallery: [],
    upcomingEvents: [],
    clubs: [],
    announcements: [],
    welcomeText: '',
    highlights: [],
    about: '',
    history: '',
    bannerImages: [],
    boxes: [],
    bigHeader: '',
    bigText: '',
    timeline: {
      state: [],
      national: [],
    },
  },
});
