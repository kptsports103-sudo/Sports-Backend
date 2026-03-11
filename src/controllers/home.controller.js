const Home = require('../models/home.model');
const Player = require('../models/player.model');
const Result = require('../models/result.model');
const GroupResult = require('../models/groupResult.model');
const KpmPool = require('../models/kpmPool.model');
const cloudinary = require('../config/cloudinary');
const multer = require('multer');
const mongoose = require('mongoose');
const { assignGlobalKpms, syncKpmPoolFromDocs } = require('../services/kpmSequence.service');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const PRIZE_MEDALS = ['Gold', 'Silver', 'Bronze'];

const normalizeAchievementSettings = (settings = {}) => ({
  sportsMeetsConducted: String(settings?.sportsMeetsConducted || '').trim(),
  yearsOfExcellence: String(settings?.yearsOfExcellence || '').trim(),
});

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
  const normalizedSettings = normalizeAchievementSettings(home?.achievementSettings || {});
  const legacyAchievements = Array.isArray(home?.achievements) ? home.achievements : [];

  return {
    sportsMeetsConducted:
      normalizedSettings.sportsMeetsConducted ||
      extractLegacyAchievementValue(legacyAchievements, 'sports meets conducted'),
    yearsOfExcellence:
      normalizedSettings.yearsOfExcellence ||
      extractLegacyAchievementValue(legacyAchievements, 'years of excellence'),
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

  if (availableYears.length === 0) {
    return {
      currentYear,
      displayYear,
      totalPrizesWon: 0,
      activePlayers: 0,
      hasAnyData: false,
      usingFallbackYear: false,
    };
  }

  const [individualPrizes, groupPrizes, activePlayers, playersForYear] = await Promise.all([
    Result.countDocuments({ year: displayYear, medal: { $in: PRIZE_MEDALS } }),
    GroupResult.countDocuments({ year: displayYear, medal: { $in: PRIZE_MEDALS } }),
    Player.countDocuments({ year: displayYear, status: 'ACTIVE' }),
    Player.countDocuments({ year: displayYear }),
  ]);

  return {
    currentYear,
    displayYear,
    totalPrizesWon: individualPrizes + groupPrizes,
    activePlayers: activePlayers > 0 ? activePlayers : playersForYear,
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
    mode: 'manual',
  },
  {
    key: 'yearsOfExcellence',
    title: 'Years of Excellence',
    value: String(settings?.yearsOfExcellence || '0'),
    icon: 'medal',
    mode: 'manual',
  },
]);

const mapPlayersToGroupedResponse = (players) => {
  return (players || []).reduce((acc, player) => {
    if (!acc[player.year]) acc[player.year] = [];
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
      const result = await cloudinary.uploader.upload(req.file.buffer, {
        folder: 'banners',
        resource_type: 'image'
      });
      res.json({ url: result.secure_url });
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

    // Update new CMS fields
    if (heroTitle !== undefined) home.heroTitle = heroTitle;
    if (heroSubtitle !== undefined) home.heroSubtitle = heroSubtitle;
    if (heroButtons !== undefined) home.heroButtons = heroButtons;
    if (banners !== undefined) home.banners = banners;
    if (achievementSettings !== undefined) {
      home.achievementSettings = normalizeAchievementSettings(achievementSettings);
    } else if (achievements !== undefined) {
      home.achievementSettings = normalizeAchievementSettings({
        sportsMeetsConducted: extractLegacyAchievementValue(achievements, 'sports meets conducted'),
        yearsOfExcellence: extractLegacyAchievementValue(achievements, 'years of excellence'),
      });
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

    const students = players.map(p => ({
      id: p.playerId || String(p._id),
      masterId: p.masterId || '',
      name: p.name,
      branch: p.branch,
      diplomaYear: p.currentDiplomaYear || p.baseDiplomaYear || null,
      semester: p.semester || '1',
      status: p.status || 'ACTIVE',
      kpmNo: p.kpmNo || ''
    }));

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
    const grouped = mapPlayersToGroupedResponse(players);
    res.json(grouped);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getKpmPoolStatus = async (req, res) => {
  try {
    const TOTAL_CAPACITY = 99;
    const pool = await KpmPool.findById('GLOBAL').lean();

    let allocated = Array.isArray(pool?.allocated) ? pool.allocated.length : null;
    let available = Array.isArray(pool?.available) ? pool.available.length : null;

    // Fallback for legacy deployments where pool doc is missing.
    if (allocated === null || available === null) {
      const activePlayers = await Player.find({ status: 'ACTIVE' }, { kpmNo: 1 }).lean();
      const used = new Set();
      activePlayers.forEach((p) => {
        const safeKpm = String(p?.kpmNo || '').trim();
        if (safeKpm.length < 6) return;
        const seq = Number.parseInt(safeKpm.slice(-2), 10);
        if (!Number.isNaN(seq) && seq >= 1 && seq <= 99) {
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
    if (!coachId || !mongoose.Types.ObjectId.isValid(coachId)) {
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
        const safeMasterId = String(player?.masterId || new mongoose.Types.ObjectId()).trim();
        const playerId = String(player?.id || player?.playerId || new mongoose.Types.ObjectId());

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
    // - last 2 digits are globally unique across ACTIVE players
    // - released automatically when status is COMPLETED/DROPPED (derived via availability)
    const normalizedDocs = assignGlobalKpms(docs);

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
