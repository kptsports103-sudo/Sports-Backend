const Home = require('../models/home.model');
const Player = require('../models/player.model');
const Result = require('../models/result.model');
const GroupResult = require('../models/groupResult.model');
const KpmPool = require('../models/kpmPool.model');
const multer = require('multer');
const {
  parseKpmSequence,
  MAX_KPM_SEQUENCE
} = require('../services/kpmSequence.service');
const { mapPlayersToGroupedResponse } = require('../services/playerRoster.service');
const { submitPlayerChangeRequest } = require('../services/playerApproval.service');
const { storeUploadedBuffer } = require('../services/hybridStorage.service');
const { getHistoryTimelineTotal, normalizeHistoryTimeline } = require('../utils/historyTimeline');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const PRIZE_MEDALS = ['Gold', 'Silver', 'Bronze'];
const YEARS_OF_EXCELLENCE_BASE = 12;
const SPORTS_MEETS_EXCELLENCE_BASELINE = 45;

const normalizeAchievementSettings = (settings = {}) => ({
  sportsMeetsConducted: String(settings?.sportsMeetsConducted || '').trim(),
  yearsOfExcellence: String(settings?.yearsOfExcellence || '').trim(),
});

const getSportsMeetsConductedValue = (timeline = []) =>
  String(getHistoryTimelineTotal(timeline));

const getYearsOfExcellenceValue = (timeline = []) => {
  const sportsCount = Number(getSportsMeetsConductedValue(timeline) || 0);
  const growth = Math.max(0, sportsCount - SPORTS_MEETS_EXCELLENCE_BASELINE);
  return String(YEARS_OF_EXCELLENCE_BASE + growth);
};

const extractLegacyAchievementValue = (achievements = [], title = '') => {
  const expectedTitle = String(title || '').trim().toLowerCase();
  if (!expectedTitle) return '';

  const item = (Array.isArray(achievements) ? achievements : []).find((entry) => {
    const normalizedTitle = String(entry?.title || '').trim().toLowerCase();
    return normalizedTitle === expectedTitle || normalizedTitle.includes(expectedTitle);
  });

  return String(item?.value || '').trim();
};

const deriveAchievementSettings = (home) => {
  return {
    sportsMeetsConducted: getSportsMeetsConductedValue(home?.timeline),
    yearsOfExcellence: getYearsOfExcellenceValue(home?.timeline),
  };
};

const getAchievementDisplayYear = async () => {
  const currentYear = new Date().getFullYear();
  const [resultYears, groupResultYears, playerYears] = await Promise.all([
    Result.distinct('year'),
    GroupResult.distinct('year'),
    Player.distinct('year'),
  ]);

  const availableYears = Array.from(
    new Set(
      [...resultYears, ...groupResultYears, ...playerYears]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).sort((left, right) => right - left);

  return {
    currentYear,
    availableYears,
    displayYear: availableYears.includes(currentYear) ? currentYear : (availableYears[0] || currentYear),
  };
};

const getAutomaticAchievementMetrics = async () => {
  const { currentYear, displayYear, availableYears } = await getAchievementDisplayYear();
  const totalPlayers = await Player.countDocuments({});

  if (availableYears.length === 0) {
    return {
      currentYear,
      displayYear,
      totalPrizesWon: 0,
      activePlayers: totalPlayers,
      hasAnyData: totalPlayers > 0,
      usingFallbackYear: false,
    };
  }

  const [individualPrizes, groupPrizes] = await Promise.all([
    Result.countDocuments({ year: displayYear, medal: { $in: PRIZE_MEDALS } }),
    GroupResult.countDocuments({ year: displayYear, medal: { $in: PRIZE_MEDALS } }),
  ]);

  return {
    currentYear,
    displayYear,
    totalPrizesWon: individualPrizes + groupPrizes,
    activePlayers: totalPlayers,
    hasAnyData: true,
    usingFallbackYear: displayYear !== currentYear,
  };
};

const buildHomeAchievements = (settings, metrics) => ([
  {
    key: 'totalPrizesWon',
    title: 'Total Prizes Won',
    value: String(metrics?.totalPrizesWon ?? 0),
    icon: 'trophy',
    mode: 'auto',
  },
  {
    key: 'activePlayers',
    title: 'Active Players',
    value: String(metrics?.activePlayers ?? 0),
    icon: 'users',
    mode: 'auto',
  },
  {
    key: 'sportsMeetsConducted',
    title: 'Sports Meets Conducted',
    value: String(settings?.sportsMeetsConducted || '0'),
    icon: 'calendar',
    mode: 'auto',
  },
  {
    key: 'yearsOfExcellence',
    title: 'Years of Excellence',
    value: String(settings?.yearsOfExcellence || '0'),
    icon: 'medal',
    mode: 'auto',
  },
]);

exports.uploadBanner = [
  upload.single('banner'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }
      const storedFile = await storeUploadedBuffer({
        req,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
        folder: 'banners',
        cloudinaryOptions: {
          folder: 'banners',
          resource_type: 'image'
        }
      });
      res.json({
        url: storedFile.url,
        public_id: storedFile.publicId,
        storage: storedFile.storage,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Upload failed' });
    }
  }
];

exports.getHome = async (req, res) => {
  try {
    let home = await Home.findOne();
    if (!home) {
      home = new Home();
      await home.save();
    }

    const achievementSettings = deriveAchievementSettings(home);
    const achievementMetrics = await getAutomaticAchievementMetrics();
    const response = home.toObject();

    response.achievementSettings = achievementSettings;
    response.achievementDisplayYear = achievementMetrics.displayYear;
    response.achievementDataStatus = {
      currentYear: achievementMetrics.currentYear,
      displayYear: achievementMetrics.displayYear,
      hasAnyData: achievementMetrics.hasAnyData,
      usingFallbackYear: achievementMetrics.usingFallbackYear,
    };
    response.achievements = buildHomeAchievements(achievementSettings, achievementMetrics);

    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateHome = async (req, res) => {
  try {
    const { 
      heroTitle, 
      heroSubtitle, 
      heroButtons, 
      banners, 
      achievementSettings,
      achievements, 
      sportsCategories, 
      gallery, 
      upcomingEvents, 
      clubs, 
      announcements,
      welcomeText, 
      highlights, 
      about, 
      history, 
      bannerImages, 
      boxes, 
      bigHeader, 
      bigText 
    } = req.body;
    
    console.log('Received update data:', req.body);
    
    let home = await Home.findOne();
    if (!home) {
      home = new Home();
    }

    const automaticSportsMeetsConducted = getSportsMeetsConductedValue(home.timeline);
    const automaticYearsOfExcellence = getYearsOfExcellenceValue(home.timeline);

    // Update new CMS fields
    if (heroTitle !== undefined) home.heroTitle = heroTitle;
    if (heroSubtitle !== undefined) home.heroSubtitle = heroSubtitle;
    if (heroButtons !== undefined) home.heroButtons = heroButtons;
    if (banners !== undefined) home.banners = banners;
    if (achievementSettings !== undefined) {
      home.achievementSettings = {
        sportsMeetsConducted: automaticSportsMeetsConducted,
        yearsOfExcellence: automaticYearsOfExcellence,
      };
    } else if (achievements !== undefined) {
      home.achievementSettings = {
        sportsMeetsConducted: automaticSportsMeetsConducted,
        yearsOfExcellence: automaticYearsOfExcellence,
      };
    } else {
      home.achievementSettings = {
        ...normalizeAchievementSettings(home.achievementSettings || {}),
        sportsMeetsConducted: automaticSportsMeetsConducted,
        yearsOfExcellence: automaticYearsOfExcellence,
      };
    }
    if (achievements !== undefined) home.achievements = achievements;
    if (sportsCategories !== undefined) home.sportsCategories = sportsCategories;
    if (gallery !== undefined) home.gallery = gallery;
    if (upcomingEvents !== undefined) home.upcomingEvents = upcomingEvents;
    if (clubs !== undefined) home.clubs = clubs;
    if (announcements !== undefined) home.announcements = announcements;

    // Update legacy fields
    if (welcomeText !== undefined) home.welcomeText = welcomeText;
    if (banners !== undefined) home.banners = banners;
    if (highlights !== undefined) {
      // Handle migration from string array to object array
      if (Array.isArray(highlights) && highlights.length > 0) {
        // Check if first element is a string (old format)
        if (typeof highlights[0] === 'string') {
          // Convert strings to objects
          home.highlights = highlights.map(str => ({
            title: str,
            overview: '',
            url: '',
            urlFixed: false
          }));
        } else {
          // Already in object format
          home.highlights = highlights;
        }
      } else {
        home.highlights = highlights;
      }
    }
    if (about !== undefined) home.about = about;
    if (history !== undefined) home.history = history;
    // Update About page fields
    if (bannerImages !== undefined) home.bannerImages = bannerImages;
    if (boxes !== undefined) home.boxes = boxes;
    if (bigHeader !== undefined) home.bigHeader = bigHeader;
    if (bigText !== undefined) home.bigText = bigText;
    
    try {
      await home.save();
      console.log('Home updated successfully');
      res.json(home);
    } catch (validationError) {
      console.error('Validation error:', validationError);
      // If validation fails, try to save without highlights
      if (validationError.name === 'ValidationError') {
        console.log('Validation failed, trying to save without highlights...');
        home.highlights = []; // Clear highlights to avoid validation issues
        await home.save();
        console.log('Home saved without highlights');
        res.json(home);
      } else {
        throw validationError;
      }
    }
  } catch (error) {
    console.error('Error updating home:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getAboutTimeline = async (req, res) => {
  try {
    let home = await Home.findOne();
    if (!home) {
      home = new Home();
      await home.save();
    }
    res.json({ timeline: normalizeHistoryTimeline(home.timeline) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateAboutTimeline = async (req, res) => {
  try {
    const timeline = normalizeHistoryTimeline(req.body?.timeline);
    console.log('Received timeline update:', timeline);
    let home = await Home.findOne();
    if (!home) {
      home = new Home();
    }
    home.timeline = timeline;
    home.achievementSettings = {
      ...normalizeAchievementSettings(home.achievementSettings || {}),
      sportsMeetsConducted: getSportsMeetsConductedValue(timeline),
      yearsOfExcellence: getYearsOfExcellenceValue(timeline),
    };
    await home.save();
    console.log('Timeline updated successfully');
    res.json({ message: 'Timeline updated successfully' });
  } catch (error) {
    console.error('Error updating timeline:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getStudentParticipation = async (req, res) => {
  try {
    const { year } = req.query;
    const targetYear = parseInt(year) || new Date().getFullYear();

    // Fetch players from database for the year
    const players = await Player.find({ year: targetYear }).sort({ createdAt: -1 });
    const seenProfiles = new Set();

    const students = players.reduce((acc, p) => {
      const profileKey = buildYearPlayerProfileKey(p);
      if (profileKey && seenProfiles.has(profileKey)) {
        return acc;
      }

      if (profileKey) {
        seenProfiles.add(profileKey);
      }

      acc.push({
        id: p.playerId || String(p._id),
        masterId: p.masterId || '',
        name: p.name,
        branch: p.branch,
        diplomaYear: p.currentDiplomaYear || p.baseDiplomaYear || null,
        semester: p.semester || '1',
        status: p.status || 'ACTIVE',
        kpmNo: p.kpmNo || ''
      });
      return acc;
    }, []);

    res.json({
      year: targetYear,
      students
    });
  } catch (error) {
    console.error('Error fetching student participation:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getPlayers = async (req, res) => {
  try {
    const players = await Player.find({}).sort({ year: -1, createdAt: -1 });
    const useRawRows = ['1', 'true', 'yes', 'raw'].includes(String(req.query?.raw || '').trim().toLowerCase());
    const grouped = mapPlayersToGroupedResponse(players, { dedupeProfiles: !useRawRows });
    res.json(grouped);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getKpmPoolStatus = async (req, res) => {
  try {
    const TOTAL_CAPACITY = MAX_KPM_SEQUENCE;
    const pool = await KpmPool.findById('GLOBAL').lean();

    let allocated = Array.isArray(pool?.allocated) ? pool.allocated.length : null;
    let available = Array.isArray(pool?.available) ? pool.available.length : null;

    // Fallback for legacy deployments where the pool doc is missing or still sized for 99 slots.
    if (allocated === null || available === null || allocated + available !== TOTAL_CAPACITY) {
      const activePlayers = await Player.find({ status: 'ACTIVE' }, { kpmNo: 1 }).lean();
      const used = new Set();
      activePlayers.forEach((p) => {
        const seq = parseKpmSequence(p?.kpmNo);
        if (seq) {
          used.add(seq);
        }
      });
      allocated = used.size;
      available = TOTAL_CAPACITY - allocated;
    }

    const usagePercent = Math.round((allocated / TOTAL_CAPACITY) * 100);
    return res.json({
      total: TOTAL_CAPACITY,
      allocated,
      available,
      usagePercent
    });
  } catch (error) {
    console.error('Error fetching KPM pool status:', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.savePlayers = async (req, res) => {
  try {
    const request = await submitPlayerChangeRequest({
      data: req.body?.data,
      user: req.user,
      requestNote: req.body?.requestNote,
    });

    return res.status(202).json({
      message: 'Player changes submitted for approval successfully.',
      request,
    });
  } catch (error) {
    console.error('Error saving players:', error);
    res.status(error?.statusCode || 500).json({ message: error?.message || 'Server error' });
  }
};
