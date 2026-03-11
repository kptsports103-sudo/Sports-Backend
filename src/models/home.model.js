const mongoose = require('mongoose');

const homeSchema = new mongoose.Schema({
  // Hero Section
  heroTitle: {
    type: String,
    default: 'Champions in Spirit, Champions in Action'
  },
  heroSubtitle: {
    type: String,
    default: 'Karnataka Government Polytechnic, Mangaluru Sports Portal'
  },
  heroButtons: [{
    text: {
      type: String,
      default: ''
    },
    link: {
      type: String,
      default: ''
    }
  }],
  // Banners
  banners: [{
    image: {
      type: String,
      default: ''
    },
    video: {
      type: String,
      default: ''
    },
    year: {
      type: String,
      default: ''
    }
  }],
  // Achievements
  achievements: [{
    title: {
      type: String,
      default: ''
    },
    value: {
      type: String,
      default: ''
    }
  }],
  achievementSettings: {
    sportsMeetsConducted: {
      type: String,
      default: ''
    },
    yearsOfExcellence: {
      type: String,
      default: ''
    }
  },
  // Sports Categories
  sportsCategories: [{
    name: {
      type: String,
      default: ''
    },
    image: {
      type: String,
      default: ''
    }
  }],
  // Gallery
  gallery: [{
    image: {
      type: String,
      default: ''
    },
    caption: {
      type: String,
      default: ''
    }
  }],
  // Upcoming Events
  upcomingEvents: [{
    name: {
      type: String,
      default: ''
    },
    date: {
      type: String,
      default: ''
    },
    venue: {
      type: String,
      default: ''
    },
    image: {
      type: String,
      default: ''
    }
  }],
  // Clubs
  clubs: [{
    name: {
      type: String,
      default: ''
    },
    url: {
      type: String,
      default: ''
    },
    description: {
      type: String,
      default: ''
    },
    image: {
      type: String,
      default: ''
    },
    theme: {
      type: String,
      default: 'blue'
    }
  }],
  // Announcements
  announcements: [{
    type: String,
    default: ''
  }],
  // Legacy fields (kept for backward compatibility)
  welcomeText: {
    type: String,
    default: ''
  },
  highlights: [{
    title: {
      type: String,
      required: true
    },
    overview: {
      type: String,
      required: true
    },
    url: {
      type: String,
      default: ''
    },
    urlFixed: {
      type: Boolean,
      default: false
    }
  }],
  about: {
    type: String,
    default: ''
  },
  history: {
    type: String,
    default: ''
  },
  // About page specific fields
  bannerImages: [{
    image: {
      type: String,
      default: ''
    },
    year: {
      type: Number,
      default: 0
    },
    fixed: {
      type: Boolean,
      default: false
    }
  }],
  boxes: [{
    type: String
  }],
  bigHeader: {
    type: String,
    default: ''
  },
  bigText: {
    type: String,
    default: ''
  },
  timeline: [{
    year: {
      type: String,
      default: ''
    },
    host: {
      type: String,
      default: ''
    },
    venue: {
      type: String,
      default: ''
    }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Home', homeSchema);
