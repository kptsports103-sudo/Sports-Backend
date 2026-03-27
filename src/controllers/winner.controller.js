const crypto = require('crypto');
const cloudinary = require('../config/cloudinary');
const Winner = require('../models/winner.model');
const WinnerCaptureSession = require('../models/winnerCaptureSession.model');

const ALLOWED_MEDALS = ['Gold', 'Silver', 'Bronze'];
const CAPTURE_SESSION_TTL_MS = 15 * 60 * 1000;

const normalizeWinnerPayload = (payload = {}) => ({
  eventName: String(payload.eventName || '').trim(),
  playerName: String(payload.playerName || '').trim(),
  medal: String(payload.medal || '').trim(),
  imageUrl: String(payload.imageUrl || '').trim(),
  imagePublicId: String(payload.imagePublicId || '').trim(),
});

const validateWinnerPayload = (payload) => {
  const errors = [];

  if (!payload.eventName) errors.push('eventName is required.');
  if (!payload.playerName) errors.push('playerName is required.');
  if (!payload.imageUrl) errors.push('imageUrl is required.');
  if (!ALLOWED_MEDALS.includes(payload.medal)) {
    errors.push(`medal must be one of: ${ALLOWED_MEDALS.join(', ')}.`);
  }

  return errors;
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
    res.json(winners);
  } catch (error) {
    console.error('Error fetching winners:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.createWinner = async (req, res) => {
  try {
    const payload = normalizeWinnerPayload(req.body);
    const errors = validateWinnerPayload(payload);

    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const winner = new Winner(payload);
    await winner.save();

    res.status(201).json(winner);
  } catch (error) {
    console.error('Error creating winner:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateWinner = async (req, res) => {
  try {
    const winner = await Winner.findById(req.params.id);
    if (!winner) {
      return res.status(404).json({ message: 'Winner not found' });
    }

    const payload = normalizeWinnerPayload({
      eventName: req.body.eventName ?? winner.eventName,
      playerName: req.body.playerName ?? winner.playerName,
      medal: req.body.medal ?? winner.medal,
      imageUrl: req.body.imageUrl ?? winner.imageUrl,
      imagePublicId: req.body.imagePublicId ?? winner.imagePublicId,
    });
    const errors = validateWinnerPayload(payload);

    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const previousImagePublicId = String(winner.imagePublicId || '').trim();
    const nextImagePublicId = String(payload.imagePublicId || '').trim();

    winner.eventName = payload.eventName;
    winner.playerName = payload.playerName;
    winner.medal = payload.medal;
    winner.imageUrl = payload.imageUrl;
    winner.imagePublicId = nextImagePublicId;

    await winner.save();

    if (previousImagePublicId && previousImagePublicId !== nextImagePublicId) {
      await destroyWinnerImage(previousImagePublicId);
    }

    res.json(winner);
  } catch (error) {
    console.error('Error updating winner:', error);
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
