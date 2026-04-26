const Result = require('../models/result.model');
const Player = require('../models/player.model');
const { deleteStoredFile, storeUploadedBuffer } = require('../services/hybridStorage.service');
const {
  ensureResultsBoardProjection,
  getResultsBoard,
} = require('../services/resultsBoard.service');
const { normalizeResultLevel } = require('../utils/resultLevels');
const { ensureResultLevelStorage } = require('../utils/resultStorageMigration');

const normalizeImageUrl = (value) => {
  const safeValue = String(value || '').trim();
  return safeValue || null;
};

exports.getResults = async (req, res) => {
  try {
    await ensureResultLevelStorage({ Result });
    const { year, medal, search, level } = req.query;

    const query = {};
    if (year && year !== 'all') query.year = Number(year);
    if (level && level !== 'all') query.level = normalizeResultLevel(level);
    if (medal && medal !== 'all') query.medal = medal;
    if (search) query.name = new RegExp(search, 'i');

    const results = await Result.find(query).sort({ order: 1 });
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.createResult = async (req, res) => {
  try {
    const {
      playerMasterId,
      event,
      year,
      level,
      medal,
      imageUrl,
      imagePublicId
    } = req.body;
    await ensureResultLevelStorage({ Result });
    const normalizedMasterId = String(playerMasterId || '').trim();
    const normalizedEvent = String(event || '').trim();
    const normalizedYear = Number(year);
    const normalizedLevel = normalizeResultLevel(level);

    if (!normalizedMasterId || !normalizedEvent || !normalizedYear || !medal) {
      return res.status(400).json({ message: 'playerMasterId, event, year and medal are required.' });
    }

    const player = await Player.findOne({ masterId: normalizedMasterId })
      .sort({ year: -1, updatedAt: -1, createdAt: -1 })
      .lean();

    if (!player) {
      return res.status(400).json({ message: 'Selected player not found in players master data.' });
    }

    const resolvedDiplomaYear = Number(player.currentDiplomaYear || player.baseDiplomaYear || player.diplomaYear || null);
    if (![1, 2, 3].includes(resolvedDiplomaYear)) {
      return res.status(400).json({ message: 'Selected player has invalid diploma year in master data.' });
    }

    const existing = await Result.findOne({
      playerMasterId: normalizedMasterId,
      event: normalizedEvent,
      year: normalizedYear,
      level: normalizedLevel
    }).lean();

    if (existing) {
      return res.status(400).json({
        message: 'Result already exists for this player in this event and level.'
      });
    }

    const storedImage = req.file
      ? await storeUploadedBuffer({
          req,
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          originalName: req.file.originalname,
          folder: 'results',
          cloudinaryOptions: {
            folder: 'results',
            resource_type: 'image',
            quality: 'auto',
            fetch_format: 'auto',
            transformation: [{ width: 2000, crop: 'limit' }],
          }
        })
      : null;

    const result = new Result({
      name: player.name || '',
      playerMasterId: normalizedMasterId,
      playerId: String(player.playerId || '').trim(),
      branch: player.branch || '',
      event: normalizedEvent,
      year: normalizedYear,
      level: normalizedLevel,
      medal,
      diplomaYear: resolvedDiplomaYear,
      imageUrl: storedImage ? storedImage.url : normalizeImageUrl(imageUrl),
      imagePublicId: storedImage ? storedImage.publicId : String(imagePublicId || '').trim(),
    });

    await result.save();
    await ensureResultsBoardProjection({ force: true }).catch((projectionError) => {
      console.error('Results board projection sync failed after create:', projectionError);
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Create result error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    if (error?.code === 11000) {
      return res.status(400).json({
        message: 'Result already exists for this player in this event and level.'
      });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getResultsBoard = async (req, res) => {
  try {
    const board = await getResultsBoard({
      year: req.query?.year,
      level: req.query?.level,
    });

    res.json(board);
  } catch (error) {
    console.error('Get results board error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateResult = async (req, res) => {
  try {
    await ensureResultLevelStorage({ Result });
    const updateData = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(updateData, 'event')) {
      updateData.event = String(updateData.event || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'level')) {
      updateData.level = normalizeResultLevel(updateData.level);
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'year')) {
      updateData.year = Number(updateData.year);
      if (!updateData.year) {
        return res.status(400).json({ message: 'year is required.' });
      }
    }
    if (Object.prototype.hasOwnProperty.call(updateData, 'playerMasterId')) {
      updateData.playerMasterId = String(updateData.playerMasterId || '').trim();
      if (!updateData.playerMasterId) {
        return res.status(400).json({ message: 'playerMasterId is required.' });
      }

      const player = await Player.findOne({ masterId: updateData.playerMasterId })
        .sort({ year: -1, updatedAt: -1, createdAt: -1 })
        .lean();

      if (!player) {
        return res.status(400).json({ message: 'Selected player not found in players master data.' });
      }

      updateData.name = player.name || '';
      updateData.branch = player.branch || '';
      updateData.playerId = String(player.playerId || '').trim();
      updateData.diplomaYear = Number(player.currentDiplomaYear || player.baseDiplomaYear || player.diplomaYear || null);
      if (![1, 2, 3].includes(updateData.diplomaYear)) {
        return res.status(400).json({ message: 'Selected player has invalid diploma year in master data.' });
      }
    }

    const current = await Result.findById(req.params.id).lean();
    if (!current) {
      return res.status(404).json({ message: 'Result not found' });
    }

    const finalMasterId = Object.prototype.hasOwnProperty.call(updateData, 'playerMasterId')
      ? updateData.playerMasterId
      : current.playerMasterId;
    const finalEvent = Object.prototype.hasOwnProperty.call(updateData, 'event')
      ? String(updateData.event || '').trim()
      : String(current.event || '').trim();
    const finalYear = Object.prototype.hasOwnProperty.call(updateData, 'year')
      ? Number(updateData.year)
      : Number(current.year);
    const finalLevel = Object.prototype.hasOwnProperty.call(updateData, 'level')
      ? normalizeResultLevel(updateData.level)
      : normalizeResultLevel(current.level);

    if (!finalMasterId || !finalEvent || !finalYear) {
      return res.status(400).json({ message: 'playerMasterId, event and year are required.' });
    }

    const duplicate = await Result.findOne({
      _id: { $ne: req.params.id },
      playerMasterId: finalMasterId,
      event: finalEvent,
      year: finalYear,
      level: finalLevel
    }).lean();

    if (duplicate) {
      return res.status(400).json({
        message: 'Result already exists for this player in this event and level.'
      });
    }

    updateData.playerMasterId = finalMasterId;
    updateData.event = finalEvent;
    updateData.year = finalYear;
    updateData.level = finalLevel;
    const previousImagePublicId = String(current.imagePublicId || '').trim();
    let shouldDeletePreviousImage = false;

    if (req.file) {
      const storedImage = await storeUploadedBuffer({
        req,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
        folder: 'results',
        cloudinaryOptions: {
          folder: 'results',
          resource_type: 'image',
          quality: 'auto',
          fetch_format: 'auto',
          transformation: [{ width: 2000, crop: 'limit' }],
        }
      });
      updateData.imageUrl = storedImage.url;
      updateData.imagePublicId = storedImage.publicId;
      shouldDeletePreviousImage = Boolean(previousImagePublicId && previousImagePublicId !== storedImage.publicId);
    } else {
      const hasImageUrl = Object.prototype.hasOwnProperty.call(updateData, 'imageUrl');
      const hasImagePublicId = Object.prototype.hasOwnProperty.call(updateData, 'imagePublicId');

      if (hasImageUrl || hasImagePublicId) {
        const nextImageUrl = hasImageUrl
          ? normalizeImageUrl(updateData.imageUrl)
          : normalizeImageUrl(current.imageUrl);
        let nextImagePublicId = hasImagePublicId
          ? String(updateData.imagePublicId || '').trim()
          : String(current.imagePublicId || '').trim();

        if (hasImageUrl && !nextImageUrl) {
          nextImagePublicId = '';
        }

        if (
          hasImageUrl &&
          nextImageUrl &&
          nextImageUrl !== normalizeImageUrl(current.imageUrl) &&
          !hasImagePublicId
        ) {
          nextImagePublicId = '';
        }

        if (hasImageUrl) {
          updateData.imageUrl = nextImageUrl;
        }
        if (hasImagePublicId || (hasImageUrl && !nextImageUrl) || (hasImageUrl && nextImagePublicId === '')) {
          updateData.imagePublicId = nextImagePublicId;
        }

        shouldDeletePreviousImage = Boolean(previousImagePublicId && previousImagePublicId !== nextImagePublicId);
      }
    }

    const result = await Result.findByIdAndUpdate(
      current._id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!result) {
      return res.status(404).json({ message: 'Result not found' });
    }

    if (shouldDeletePreviousImage) {
      await deleteStoredFile(previousImagePublicId);
    }

    await ensureResultsBoardProjection({ force: true }).catch((projectionError) => {
      console.error('Results board projection sync failed after update:', projectionError);
    });
    res.json(result);
  } catch (error) {
    console.error('Update result error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    if (error?.code === 11000) {
      return res.status(400).json({
        message: 'Result already exists for this player in this event and level.'
      });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteResult = async (req, res) => {
  try {
    const result = await Result.findByIdAndDelete(req.params.id);

    if (!result) {
      return res.status(404).json({ message: 'Result not found' });
    }

    await deleteStoredFile(result.imagePublicId);
    await ensureResultsBoardProjection({ force: true }).catch((projectionError) => {
      console.error('Results board projection sync failed after delete:', projectionError);
    });
    res.json({ message: 'Result deleted' });
  } catch (error) {
    console.error('Delete result error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.reorderResults = async (req, res) => {
  try {
    const { year, order } = req.body;

    const bulk = order.map((id, index) => ({
      updateOne: {
        filter: { _id: id, year },
        update: { order: index }
      }
    }));

    await Result.bulkWrite(bulk);
    await ensureResultsBoardProjection({ force: true }).catch((projectionError) => {
      console.error('Results board projection sync failed after reorder:', projectionError);
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Reorder error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
