const Home = require('../models/home.model');
const Player = require('../models/player.model');
const Result = require('../models/result.model');
const GroupResult = require('../models/groupResult.model');
const KpmPool = require('../models/kpmPool.model');
const multer = require('multer');
const { createObjectId, isValidObjectId } = require('../../lib/objectId');
const {
  assignGlobalKpms,
  syncKpmPoolFromDocs,
  parseKpmSequence,
  MAX_KPM_SEQUENCE
} = require('../services/kpmSequence.service');
const { storeUploadedBuffer } = require('../services/hybridStorage.service');

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
  String(Array.isArray(timeline) ? timeline.length : 0);

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

const ensureUniquePlayerMasterIds = (players = []) => {
  const usedYearMasterIds = new Set();

  return (players || []).map((player) => {
    const safePlayer = { ...player };
    const safeYear = Number(safePlayer?.year || 0);
    let safeMasterId = String(safePlayer?.masterId || '').trim() || createObjectId();

    while (usedYearMasterIds.has(`${safeYear}|${safeMasterId}`)) {
      safeMasterId = createObjectId();
    }

    usedYearMasterIds.add(`${safeYear}|${safeMasterId}`);
    safePlayer.masterId = safeMasterId;
    return safePlayer;
  });
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

const normalizePlayerKeyPart = (value) =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const buildYearPlayerProfileKey = (player) => {
  const year = String(player?.year || '').trim();
  const name = normalizePlayerKeyPart(player?.name);
  const branch = normalizePlayerKeyPart(player?.branch);
  const diplomaYear = String(player?.currentDiplomaYear || player?.baseDiplomaYear || player?.diplomaYear || '').trim();
  const semester = String(player?.semester || '1').trim();
  const status = String(player?.status || 'ACTIVE').trim().toUpperCase();
  const kpmNo = String(player?.kpmNo || '').trim().toUpperCase();
  const fallbackId = String(player?.playerId || player?._id || player?.masterId || '').trim();

  return [year, name, branch, diplomaYear, semester, status, kpmNo || fallbackId].join('|');
};

const mapPlayersToGroupedResponse = (players, options = {}) => {
  const { dedupeProfiles = true } = options;
  const seenByYear = {};

  return (players || []).reduce((acc, player) => {
    if (!acc[player.year]) acc[player.year] = [];
    if (dedupeProfiles) {
      if (!seenByYear[player.year]) seenByYear[player.year] = new Set();

      const profileKey = buildYearPlayerProfileKey(player);
      if (profileKey && seenByYear[player.year].has(profileKey)) {
        return acc;
      }

      if (profileKey) {
        seenByYear[player.year].add(profileKey);
      }
    }

    acc[player.year].push({
      id: player.playerId || String(player._id),
      masterId: player.masterId || '',
      name: player.name,
      branch: player.branch,
      diplomaYear: player.currentDiplomaYear || player.baseDiplomaYear || null,
      semester: player.semester || '1',
      status: player.status || 'ACTIVE',
      kpmNo: player.kpmNo || ''
    });
    return acc;
  }, {});
};

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
    res.json({ timeline: home.timeline || [] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateAboutTimeline = async (req, res) => {
  try {
    const { timeline } = req.body;
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
    const { data } = req.body; // data is array of {year, players: []}
    if (!Array.isArray(data)) {
      return res.status(400).json({ message: 'Invalid payload. Expected data: [{ year, players: [] }].' });
    }

    const coachId = req.user?.id;
    if (!coachId || !isValidObjectId(coachId)) {
      return res.status(401).json({ message: 'Invalid authentication user.' });
    }

    // Build and validate docs before deleting current data.
    const docs = [];
    for (const yearData of data) {
      const year = Number(yearData?.year);
      if (!year || !Array.isArray(yearData?.players)) continue;

      for (const player of yearData.players) {
        const name = (player?.name || '').trim();
        const branch = (player?.branch || '').trim();
        if (!name || !branch) continue;

        const parsedDiplomaYear = Number(player?.diplomaYear);
        const safeDiplomaYear = [1, 2, 3].includes(parsedDiplomaYear) ? parsedDiplomaYear : 1;
        const parsedSemester = String(player?.semester || '1').trim();
        const safeSemester = ['1', '2', '3', '4', '5', '6'].includes(parsedSemester) ? parsedSemester : '1';
        const parsedStatus = String(player?.status || 'ACTIVE').trim().toUpperCase();
        const safeStatus = ['ACTIVE', 'COMPLETED', 'DROPPED'].includes(parsedStatus) ? parsedStatus : 'ACTIVE';
        const safeKpmNo = String(player?.kpmNo || '').trim();
        const safeMasterId = String(player?.masterId || createObjectId()).trim();
        const playerId = String(player?.id || player?.playerId || createObjectId());

        docs.push({
          name,
          playerId,
          masterId: safeMasterId,
          branch,
          kpmNo: safeKpmNo,
          firstParticipationYear: year,
          baseDiplomaYear: safeDiplomaYear,
          currentDiplomaYear: safeDiplomaYear,
          semester: safeSemester,
          status: safeStatus,
          year,
          coachId
        });
      }
    }

    if (docs.length === 0) {
      return res.status(400).json({ message: 'No valid players to save.' });
    }

    // Backend-owned enterprise KPM policy:
    // - sequence suffix is globally unique across ACTIVE players
    // - current capacity is 001-999, while legacy 2-digit KPMs are still recognized
    // - released automatically when status is COMPLETED/DROPPED (derived via availability)
    const normalizedDocs = assignGlobalKpms(ensureUniquePlayerMasterIds(docs).map((doc) => ({
      ...doc,
      playerId: String(doc.playerId || createObjectId()),
      masterId: String(doc.masterId || createObjectId()).trim(),
    })));

    // Clear existing and save new set.
    await Player.deleteMany({});
    const savedPlayers = await Player.insertMany(normalizedDocs);
    await syncKpmPoolFromDocs(normalizedDocs);

    return res.json({
      message: 'Players saved successfully',
      players: mapPlayersToGroupedResponse(savedPlayers)
    });
  } catch (error) {
    console.error('Error saving players:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
