const GroupResult = require('../models/groupResult.model');
const { deleteStoredFile, storeUploadedBuffer } = require('../services/hybridStorage.service');
const { ensureResultsBoardProjection } = require('../services/resultsBoard.service');
const { normalizeResultLevel } = require('../utils/resultLevels');
const { ensureResultLevelStorage } = require('../utils/resultStorageMigration');

const normalizeGroupPayload = (raw = {}) => {
  const data = { ...raw };
  data.level = normalizeResultLevel(data.level);
  const members = Array.isArray(data.members) ? data.members : [];

  const normalizedMembers = members
    .map((member) => {
      if (!member || typeof member !== 'object') return null;
      const legacyId = String(member.playerId || '').trim();
      const masterId = String(member.playerMasterId || legacyId || '').trim();

      return {
        ...member,
        playerMasterId: masterId || undefined,
        playerId: legacyId || undefined,
        branch: String(member.branch || '').trim()
      };
    })
    .filter(Boolean);

  if (normalizedMembers.length) {
    data.members = normalizedMembers;
  }

  const incomingMasterIds = Array.isArray(data.memberMasterIds) ? data.memberMasterIds : [];
  const derivedMasterIds = normalizedMembers
    .map((m) => String(m.playerMasterId || '').trim())
    .filter(Boolean);
  data.memberMasterIds = Array.from(new Set([...incomingMasterIds, ...derivedMasterIds]));

  return data;
};

const getGroupResults = async (req, res) => {
  try {
    await ensureResultLevelStorage({ GroupResult });
    const query = {};
    if (req.query.year && req.query.year !== 'all') query.year = Number(req.query.year);
    if (req.query.level && req.query.level !== 'all') query.level = normalizeResultLevel(req.query.level);
    if (req.query.medal && req.query.medal !== 'all') query.medal = req.query.medal;

    const groupResults = await GroupResult.find(query).sort({ year: -1 });
    res.json(groupResults);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const createGroupResult = async (req, res) => {
  try {
    await ensureResultLevelStorage({ GroupResult });
    const data = normalizeGroupPayload(req.body);

    if (req.file) {
      const storedImage = await storeUploadedBuffer({
        req,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
        folder: 'group-results',
        cloudinaryOptions: {
          folder: 'group-results',
          resource_type: 'image',
          quality: 'auto',
          fetch_format: 'auto',
          transformation: [{ width: 2000, crop: 'limit' }],
        },
      });
      data.imageUrl = storedImage.url;
      data.imagePublicId = storedImage.publicId;
    } else if (data.imageUrl === '' || !data.imageUrl?.trim()) {
      data.imageUrl = '';
      data.imagePublicId = '';
    }
    const groupResult = new GroupResult(data);
    await groupResult.save();
    await ensureResultsBoardProjection({ force: true }).catch((projectionError) => {
      console.error('Results board projection sync failed after group create:', projectionError);
    });
    res.status(201).json(groupResult);
  } catch (error) {
    console.error('Create group result error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const updateGroupResult = async (req, res) => {
  try {
    await ensureResultLevelStorage({ GroupResult });
    const updateData = normalizeGroupPayload(req.body);
    const current = await GroupResult.findById(req.params.id).lean();

    if (!current) {
      return res.status(404).json({ message: 'Group result not found' });
    }

    const previousImagePublicId = String(current.imagePublicId || '').trim();
    let shouldDeletePreviousImage = false;

    if (req.file) {
      const storedImage = await storeUploadedBuffer({
        req,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname,
        folder: 'group-results',
        cloudinaryOptions: {
          folder: 'group-results',
          resource_type: 'image',
          quality: 'auto',
          fetch_format: 'auto',
          transformation: [{ width: 2000, crop: 'limit' }],
        },
      });
      updateData.imageUrl = storedImage.url;
      updateData.imagePublicId = storedImage.publicId;
      shouldDeletePreviousImage = Boolean(previousImagePublicId && previousImagePublicId !== storedImage.publicId);
    } else {
      const hasImageUrl = Object.prototype.hasOwnProperty.call(updateData, 'imageUrl');
      const hasImagePublicId = Object.prototype.hasOwnProperty.call(updateData, 'imagePublicId');

      if (hasImageUrl || hasImagePublicId) {
        const nextImageUrl = hasImageUrl
          ? String(updateData.imageUrl || '').trim()
          : String(current.imageUrl || '').trim();
        let nextImagePublicId = hasImagePublicId
          ? String(updateData.imagePublicId || '').trim()
          : previousImagePublicId;

        if (hasImageUrl && !nextImageUrl) {
          nextImagePublicId = '';
        }

        if (
          hasImageUrl &&
          nextImageUrl &&
          nextImageUrl !== String(current.imageUrl || '').trim() &&
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

    const groupResult = await GroupResult.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!groupResult) {
      return res.status(404).json({ message: 'Group result not found' });
    }

    if (shouldDeletePreviousImage) {
      await deleteStoredFile(previousImagePublicId);
    }

    await ensureResultsBoardProjection({ force: true }).catch((projectionError) => {
      console.error('Results board projection sync failed after group update:', projectionError);
    });
    res.json(groupResult);
  } catch (error) {
    console.error('Update group result error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const deleteGroupResult = async (req, res) => {
  try {
    const groupResult = await GroupResult.findByIdAndDelete(req.params.id);

    if (!groupResult) {
      return res.status(404).json({ message: 'Group result not found' });
    }

    await deleteStoredFile(groupResult.imagePublicId);
    await ensureResultsBoardProjection({ force: true }).catch((projectionError) => {
      console.error('Results board projection sync failed after group delete:', projectionError);
    });
    res.json({ message: 'Group result deleted' });
  } catch (error) {
    console.error('Delete group result error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getGroupResults,
  createGroupResult,
  updateGroupResult,
  deleteGroupResult,
};
