const crypto = require('crypto');
const cloudinary = require('../config/cloudinary');
const Result = require('../models/result.model');
const GroupResult = require('../models/groupResult.model');
const Player = require('../models/player.model');
const Winner = require('../models/winner.model');
const WinnerCaptureSession = require('../models/winnerCaptureSession.model');

const ALLOWED_MEDALS = ['Gold', 'Silver', 'Bronze'];
const ALLOWED_LINK_TYPES = ['manual', 'individual', 'team'];
const CAPTURE_SESSION_TTL_MS = 15 * 60 * 1000;

const createValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const normalizeWinnerYear = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeWinnerPayload = (payload = {}) => ({
  eventName: String(payload.eventName || '').trim(),
  playerName: String(payload.playerName || '').trim(),
  teamName: String(payload.teamName || '').trim(),
  branch: String(payload.branch || '').trim(),
  year: normalizeWinnerYear(payload.year),
  medal: String(payload.medal || '').trim(),
  linkedResultType: String(payload.linkedResultType || 'manual').trim().toLowerCase() || 'manual',
  linkedResultId: String(payload.linkedResultId || '').trim(),
  imageUrl: String(payload.imageUrl || '').trim(),
  imagePublicId: String(payload.imagePublicId || '').trim(),
});

const validateWinnerPayload = (payload) => {
  const errors = [];

  if (!payload.playerName) errors.push('playerName is required.');
  if (!payload.imageUrl) errors.push('imageUrl is required.');
  if (!ALLOWED_LINK_TYPES.includes(payload.linkedResultType)) {
    errors.push(`linkedResultType must be one of: ${ALLOWED_LINK_TYPES.join(', ')}.`);
  }
  if (payload.linkedResultType === 'manual' && !payload.eventName) {
    errors.push('eventName is required.');
  }
  if (payload.linkedResultType !== 'manual' && !payload.linkedResultId) {
    errors.push('linkedResultId is required for linked winners.');
  }
  if (!ALLOWED_MEDALS.includes(payload.medal)) {
    errors.push(`medal must be one of: ${ALLOWED_MEDALS.join(', ')}.`);
  }

  return errors;
};

const getGroupLeadName = (groupResult) => {
  const firstNamedMember = (Array.isArray(groupResult?.members) ? groupResult.members : []).find(
    (member) => String(member?.name || '').trim()
  );
  return String(firstNamedMember?.name || groupResult?.teamName || '').trim();
};

const buildPlayerBranchLookup = async (groupResults) => {
  const masterIds = new Set();
  const playerIds = new Set();

  (groupResults || []).forEach((groupResult) => {
    (Array.isArray(groupResult?.members) ? groupResult.members : []).forEach((member) => {
      const masterId = String(member?.playerMasterId || '').trim();
      const playerId = String(member?.playerId || '').trim();
      if (masterId) masterIds.add(masterId);
      if (playerId) playerIds.add(playerId);
    });
  });

  if (masterIds.size === 0 && playerIds.size === 0) {
    return new Map();
  }

  const players = await Player.find({
    $or: [
      { masterId: { $in: Array.from(masterIds) } },
      { playerId: { $in: Array.from(playerIds) } },
    ],
  })
    .sort({ year: -1, updatedAt: -1, createdAt: -1 })
    .lean();

  const lookup = new Map();
  players.forEach((player) => {
    const branch = String(player?.branch || '').trim();
    if (!branch) return;

    const masterId = String(player?.masterId || '').trim();
    const playerId = String(player?.playerId || '').trim();

    if (masterId && !lookup.has(`master:${masterId}`)) {
      lookup.set(`master:${masterId}`, branch);
    }
    if (playerId && !lookup.has(`player:${playerId}`)) {
      lookup.set(`player:${playerId}`, branch);
    }
  });

  return lookup;
};

const resolveGroupBranch = (groupResult, playerLookup) => {
  const branches = Array.from(
    new Set(
      (Array.isArray(groupResult?.members) ? groupResult.members : [])
        .map((member) => {
          const directBranch = String(member?.branch || '').trim();
          if (directBranch) return directBranch;

          const masterId = String(member?.playerMasterId || '').trim();
          const playerId = String(member?.playerId || '').trim();

          return (
            playerLookup.get(`master:${masterId}`) ||
            playerLookup.get(`player:${playerId}`) ||
            ''
          );
        })
        .filter(Boolean)
    )
  );

  if (branches.length === 1) return branches[0];
  if (branches.length > 1) return String(groupResult?.teamName || 'Mixed Team').trim();
  return String(groupResult?.teamName || '').trim();
};

const buildWinnerFromLinkedResult = async (payload) => {
  if (payload.linkedResultType === 'manual' || !payload.linkedResultId) {
    return payload;
  }

  if (payload.linkedResultType === 'individual') {
    const linkedResult = await Result.findById(payload.linkedResultId).lean();
    if (!linkedResult) {
      throw createValidationError('Linked individual result not found.');
    }
    if (!ALLOWED_MEDALS.includes(linkedResult.medal)) {
      throw createValidationError('Only Gold, Silver, or Bronze results can be linked to winners.');
    }

    return {
      ...payload,
      eventName: String(linkedResult.event || '').trim(),
      playerName: payload.playerName || String(linkedResult.name || '').trim(),
      teamName: '',
      branch: String(linkedResult.branch || '').trim(),
      year: Number(linkedResult.year) || null,
      medal: String(linkedResult.medal || '').trim(),
    };
  }

  const linkedGroupResult = await GroupResult.findById(payload.linkedResultId).lean();
  if (!linkedGroupResult) {
    throw createValidationError('Linked team result not found.');
  }
  if (!ALLOWED_MEDALS.includes(linkedGroupResult.medal)) {
    throw createValidationError('Only Gold, Silver, or Bronze team results can be linked to winners.');
  }

  const playerLookup = await buildPlayerBranchLookup([linkedGroupResult]);

  return {
    ...payload,
    eventName: String(linkedGroupResult.event || '').trim(),
    playerName: payload.playerName || getGroupLeadName(linkedGroupResult),
    teamName: String(linkedGroupResult.teamName || '').trim(),
    branch: resolveGroupBranch(linkedGroupResult, playerLookup) || payload.branch,
    year: Number(linkedGroupResult.year) || null,
    medal: String(linkedGroupResult.medal || '').trim(),
  };
};

const hydrateLinkedWinners = async (winners) => {
  const safeWinners = Array.isArray(winners) ? winners : [];
  const individualIds = safeWinners
    .filter((winner) => winner?.linkedResultType === 'individual' && winner?.linkedResultId)
    .map((winner) => winner.linkedResultId);
  const teamIds = safeWinners
    .filter((winner) => winner?.linkedResultType === 'team' && winner?.linkedResultId)
    .map((winner) => winner.linkedResultId);

  const [individualResults, teamResults] = await Promise.all([
    individualIds.length ? Result.find({ _id: { $in: individualIds } }).lean() : [],
    teamIds.length ? GroupResult.find({ _id: { $in: teamIds } }).lean() : [],
  ]);

  const teamPlayerLookup = await buildPlayerBranchLookup(teamResults);
  const individualMap = new Map(individualResults.map((result) => [String(result._id), result]));
  const teamMap = new Map(teamResults.map((result) => [String(result._id), result]));

  return safeWinners.map((winner) => {
    const linkedType = String(winner?.linkedResultType || 'manual').trim().toLowerCase();
    const linkedId = String(winner?.linkedResultId || '').trim();

    if (linkedType === 'individual' && linkedId && individualMap.has(linkedId)) {
      const linkedResult = individualMap.get(linkedId);
      if (ALLOWED_MEDALS.includes(linkedResult?.medal)) {
        return {
          ...winner,
          eventName: String(linkedResult.event || winner.eventName || '').trim(),
          playerName: String(winner.playerName || linkedResult.name || '').trim(),
          teamName: '',
          branch: String(linkedResult.branch || winner.branch || '').trim(),
          year: Number(linkedResult.year) || winner.year || null,
          medal: String(linkedResult.medal || winner.medal || '').trim(),
        };
      }
    }

    if (linkedType === 'team' && linkedId && teamMap.has(linkedId)) {
      const linkedResult = teamMap.get(linkedId);
      if (ALLOWED_MEDALS.includes(linkedResult?.medal)) {
        return {
          ...winner,
          eventName: String(linkedResult.event || winner.eventName || '').trim(),
          playerName: String(winner.playerName || getGroupLeadName(linkedResult) || '').trim(),
          teamName: String(linkedResult.teamName || winner.teamName || '').trim(),
          branch: resolveGroupBranch(linkedResult, teamPlayerLookup) || String(winner.branch || '').trim(),
          year: Number(linkedResult.year) || winner.year || null,
          medal: String(linkedResult.medal || winner.medal || '').trim(),
        };
      }
    }

    return winner;
  });
};

const destroyWinnerImage = async (publicId) => {
  const safePublicId = String(publicId || '').trim();
  if (!safePublicId) return;

  try {
    await cloudinary.uploader.destroy(safePublicId);
  } catch (error) {
    console.error('Failed to delete winner image from Cloudinary:', error?.message || error);
  }
};

const hashCaptureToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex');

const getRequesterId = (req) =>
  String(req.user?.id || req.user?._id || req.user?.userId || '').trim();

const isCaptureSessionExpired = (session) =>
  !session?.expiresAt || new Date(session.expiresAt).getTime() <= Date.now();

const serializeCaptureSession = (session) => ({
  sessionId: session.sessionId,
  status: session.status,
  imageUrl: session.imageUrl || '',
  imagePublicId: session.imagePublicId || '',
  uploadedAt: session.uploadedAt || null,
  expiresAt: session.expiresAt,
});

const findOwnedCaptureSession = async (req, sessionId) => {
  const createdBy = getRequesterId(req);
  if (!createdBy) return null;

  return WinnerCaptureSession.findOne({
    sessionId: String(sessionId || '').trim(),
    createdBy,
  });
};

exports.createWinnerCaptureSession = async (req, res) => {
  try {
    const createdBy = getRequesterId(req);
    if (!createdBy) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const sessionId = crypto.randomBytes(12).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + CAPTURE_SESSION_TTL_MS);

    const session = await WinnerCaptureSession.create({
      sessionId,
      tokenHash: hashCaptureToken(token),
      createdBy,
      expiresAt,
    });

    res.status(201).json({
      sessionId: session.sessionId,
      token,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error('Error creating winner capture session:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getWinnerCaptureSession = async (req, res) => {
  try {
    const session = await findOwnedCaptureSession(req, req.params.sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Capture session not found' });
    }

    if (isCaptureSessionExpired(session)) {
      return res.status(410).json({ message: 'Capture session expired' });
    }

    res.json(serializeCaptureSession(session));
  } catch (error) {
    console.error('Error loading winner capture session:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.uploadWinnerCapturePhoto = async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    const token = String(req.body?.token || req.query?.token || req.headers['x-capture-token'] || '').trim();

    if (!sessionId || !token) {
      return res.status(400).json({ message: 'Session and token are required' });
    }

    const session = await WinnerCaptureSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: 'Capture session not found' });
    }

    if (isCaptureSessionExpired(session)) {
      return res.status(410).json({ message: 'Capture session expired' });
    }

    if (session.status === 'claimed') {
      return res.status(409).json({ message: 'Capture session already used' });
    }

    if (session.tokenHash !== hashCaptureToken(token)) {
      return res.status(403).json({ message: 'Invalid capture token' });
    }

    const file = req.file;
    if (!file || !String(file.mimetype || '').startsWith('image/')) {
      return res.status(400).json({ message: 'Please upload an image file' });
    }

    const previousPublicId = String(session.imagePublicId || '').trim();
    const base64 = file.buffer.toString('base64');

    const uploadResult = await cloudinary.uploader.upload(
      `data:${file.mimetype};base64,${base64}`,
      {
        folder: 'winner-captures',
        resource_type: 'image',
        quality: 'auto',
        fetch_format: 'auto',
        transformation: [{ width: 2000, crop: 'limit' }],
      }
    );

    session.status = 'uploaded';
    session.imageUrl = uploadResult.secure_url || '';
    session.imagePublicId = uploadResult.public_id || '';
    session.uploadedAt = new Date();
    await session.save();

    if (previousPublicId && previousPublicId !== session.imagePublicId) {
      await destroyWinnerImage(previousPublicId);
    }

    res.json({
      message: 'Photo uploaded successfully',
      ...serializeCaptureSession(session),
    });
  } catch (error) {
    console.error('Error uploading winner capture photo:', error);
    res.status(500).json({ message: 'Upload failed' });
  }
};

exports.claimWinnerCaptureSession = async (req, res) => {
  try {
    const session = await findOwnedCaptureSession(req, req.params.sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Capture session not found' });
    }

    if (isCaptureSessionExpired(session)) {
      return res.status(410).json({ message: 'Capture session expired' });
    }

    if (!session.imageUrl) {
      return res.status(409).json({ message: 'No uploaded photo to claim' });
    }

    session.status = 'claimed';
    await session.save();

    res.json(serializeCaptureSession(session));
  } catch (error) {
    console.error('Error claiming winner capture session:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteWinnerCaptureSession = async (req, res) => {
  try {
    const session = await findOwnedCaptureSession(req, req.params.sessionId);
    if (!session) {
      return res.status(204).end();
    }

    const shouldDeleteImage = session.status !== 'claimed' && session.imagePublicId;
    const publicId = session.imagePublicId;

    await session.deleteOne();

    if (shouldDeleteImage) {
      await destroyWinnerImage(publicId);
    }

    res.status(204).end();
  } catch (error) {
    console.error('Error deleting winner capture session:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getWinners = async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 24)
      : null;

    const query = Winner.find({}).sort({ createdAt: -1 });
    if (limit) query.limit(limit);

    const winners = await query.lean();
    const hydratedWinners = await hydrateLinkedWinners(winners);
    res.json(hydratedWinners);
  } catch (error) {
    console.error('Error fetching winners:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.createWinner = async (req, res) => {
  try {
    const normalizedPayload = normalizeWinnerPayload(req.body);
    const payload = await buildWinnerFromLinkedResult(normalizedPayload);
    const errors = validateWinnerPayload(payload);

    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const winner = new Winner(payload);
    await winner.save();

    res.status(201).json(winner);
  } catch (error) {
    console.error('Error creating winner:', error);
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateWinner = async (req, res) => {
  try {
    const winner = await Winner.findById(req.params.id);
    if (!winner) {
      return res.status(404).json({ message: 'Winner not found' });
    }

    const normalizedPayload = normalizeWinnerPayload({
      eventName: req.body.eventName ?? winner.eventName,
      playerName: req.body.playerName ?? winner.playerName,
      teamName: req.body.teamName ?? winner.teamName,
      branch: req.body.branch ?? winner.branch,
      year: req.body.year ?? winner.year,
      medal: req.body.medal ?? winner.medal,
      linkedResultType: req.body.linkedResultType ?? winner.linkedResultType,
      linkedResultId: req.body.linkedResultId ?? winner.linkedResultId,
      imageUrl: req.body.imageUrl ?? winner.imageUrl,
      imagePublicId: req.body.imagePublicId ?? winner.imagePublicId,
    });
    const payload = await buildWinnerFromLinkedResult(normalizedPayload);
    const errors = validateWinnerPayload(payload);

    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const previousImagePublicId = String(winner.imagePublicId || '').trim();
    const nextImagePublicId = String(payload.imagePublicId || '').trim();

    winner.eventName = payload.eventName;
    winner.playerName = payload.playerName;
    winner.teamName = payload.teamName;
    winner.branch = payload.branch;
    winner.year = payload.year;
    winner.medal = payload.medal;
    winner.linkedResultType = payload.linkedResultType;
    winner.linkedResultId = payload.linkedResultId;
    winner.imageUrl = payload.imageUrl;
    winner.imagePublicId = nextImagePublicId;

    await winner.save();

    if (previousImagePublicId && previousImagePublicId !== nextImagePublicId) {
      await destroyWinnerImage(previousImagePublicId);
    }

    res.json(winner);
  } catch (error) {
    console.error('Error updating winner:', error);
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteWinner = async (req, res) => {
  try {
    const winner = await Winner.findByIdAndDelete(req.params.id);
    if (!winner) {
      return res.status(404).json({ message: 'Winner not found' });
    }

    await destroyWinnerImage(winner.imagePublicId);

    res.json({ message: 'Winner deleted' });
  } catch (error) {
    console.error('Error deleting winner:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
