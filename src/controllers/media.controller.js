const cloudinary = require('../config/cloudinary');
const MediaActivity = require('../models/mediaActivity.model');
const MediaItem = require('../models/mediaItem.model');
const {
  CLOUDINARY_STORAGE_LIMIT_BYTES: STORAGE_LIMIT_BYTES,
  deleteStoredFile,
  getMySQLAssetStats,
  getStoragePolicySnapshot,
  hasCloudinaryCredentials,
  SMALL_IMAGE_MAX_BYTES,
} = require('../services/hybridStorage.service');

const CLOUDINARY_RESOURCE_COUNT_CACHE_TTL_MS = Number(
  process.env.CLOUDINARY_RESOURCE_COUNT_CACHE_TTL_MS || 5 * 60 * 1000
);
const CLOUDINARY_RESOURCE_COUNT_MAX_PAGES = Number(
  process.env.CLOUDINARY_RESOURCE_COUNT_MAX_PAGES || 20
);

const cloudinaryResourceCountCache = {
  checkedAt: 0,
  data: null,
};

const normalizeUsageValue = (value) => {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return Number(value.usage || 0);
  return 0;
};

const normalizeMediaFiles = (files = []) => {
  if (!Array.isArray(files)) return [];

  return files
    .map((file) => {
      if (typeof file === 'string') {
        return { url: file, public_id: '', storage: '' };
      }

      if (!file || typeof file !== 'object') {
        return null;
      }

      return {
        url: String(file.url || ''),
        public_id: String(file.public_id || file.publicId || ''),
        storage: String(file.storage || ''),
        resource_type: String(file.resource_type || file.resourceType || ''),
        mime_type: String(file.mime_type || file.mimeType || ''),
      };
    })
    .filter((file) => file && file.url);
};

const normalizeMediaDocument = (media) => {
  const mediaObject = typeof media?.toObject === 'function' ? media.toObject() : media;
  return {
    ...mediaObject,
    id: mediaObject?._id || mediaObject?.id,
    category: String(mediaObject?.category || ''),
    title: String(mediaObject?.title || ''),
    description: String(mediaObject?.description || ''),
    link: String(mediaObject?.link || ''),
    files: normalizeMediaFiles(mediaObject?.files),
  };
};

const buildMediaPayload = (body = {}) => ({
  category: String(body.category || '').trim(),
  title: String(body.title || '').trim(),
  description: String(body.description || '').trim(),
  link: String(body.link || '').trim(),
  files: normalizeMediaFiles(body.files),
});

const getMediaItems = async (req, res) => {
  try {
    const mediaItems = await MediaItem.find().sort({ createdAt: -1 });
    return res.json(mediaItems.map(normalizeMediaDocument));
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load media',
      error: error.message,
    });
  }
};

const createMediaItem = async (req, res) => {
  try {
    const payload = buildMediaPayload(req.body);

    if (!payload.category) {
      return res.status(400).json({ success: false, message: 'Category is required' });
    }

    if (!payload.link && payload.files.length === 0) {
      return res.status(400).json({ success: false, message: 'A link or uploaded file is required' });
    }

    const mediaItem = new MediaItem(payload);
    await mediaItem.save();

    return res.status(201).json(normalizeMediaDocument(mediaItem));
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to save media',
      error: error.message,
    });
  }
};

const updateMediaItem = async (req, res) => {
  try {
    const payload = buildMediaPayload(req.body);
    const mediaItem = await MediaItem.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!mediaItem) {
      return res.status(404).json({ success: false, message: 'Media item not found' });
    }

    return res.json(normalizeMediaDocument(mediaItem));
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update media',
      error: error.message,
    });
  }
};

const deleteMediaItem = async (req, res) => {
  try {
    const mediaItem = await MediaItem.findByIdAndDelete(req.params.id);

    if (!mediaItem) {
      return res.status(404).json({ success: false, message: 'Media item not found' });
    }

    const normalized = normalizeMediaDocument(mediaItem);
    await Promise.all(
      normalized.files
        .map((file) => file.public_id)
        .filter(Boolean)
        .map(async (publicId) => {
          try {
            await deleteStoredFile(publicId);
          } catch (error) {
            console.warn('Failed to delete stored media file:', error?.message || error);
          }
        })
    );

    return res.json({ success: true, message: 'Media item deleted' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to delete media',
      error: error.message,
    });
  }
};

const countCloudinaryResourcesByType = async (resourceType) => {
  let nextCursor = undefined;
  let count = 0;
  let exact = true;

  for (let page = 0; page < CLOUDINARY_RESOURCE_COUNT_MAX_PAGES; page += 1) {
    const response = await cloudinary.api.resources({
      type: 'upload',
      resource_type: resourceType,
      max_results: 500,
      next_cursor: nextCursor,
    });

    count += Array.isArray(response?.resources) ? response.resources.length : 0;
    if (!response?.next_cursor) {
      return { count, exact };
    }

    nextCursor = response.next_cursor;
  }

  exact = false;
  return { count, exact };
};

const getCloudinaryResourceCounts = async () => {
  const now = Date.now();
  if (
    cloudinaryResourceCountCache.data &&
    cloudinaryResourceCountCache.checkedAt &&
    now - cloudinaryResourceCountCache.checkedAt < CLOUDINARY_RESOURCE_COUNT_CACHE_TTL_MS
  ) {
    return cloudinaryResourceCountCache.data;
  }

  const [images, videos, raw] = await Promise.all([
    countCloudinaryResourcesByType('image'),
    countCloudinaryResourcesByType('video'),
    countCloudinaryResourcesByType('raw'),
  ]);

  const exact = images.exact && videos.exact && raw.exact;
  const data = {
    imageCount: images.count,
    videoCount: videos.count,
    rawCount: raw.count,
    totalAssets: images.count + videos.count + raw.count,
    exact,
  };

  cloudinaryResourceCountCache.checkedAt = now;
  cloudinaryResourceCountCache.data = data;
  return data;
};

const getCloudinaryUsage = async (req, res) => {
  try {
    const usage = await cloudinary.api.usage();

    return res.json({
      success: true,
      data: {
        bandwidth: normalizeUsageValue(usage?.bandwidth),
        storage: normalizeUsageValue(usage?.storage),
        transformations: normalizeUsageValue(usage?.transformations),
        requests: normalizeUsageValue(usage?.requests),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Cloudinary usage',
      error: error.message,
    });
  }
};

const getCloudinaryStats = async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    const mysqlStats = await getMySQLAssetStats();
    const policy = getStoragePolicySnapshot();

    if (!hasCloudinaryCredentials()) {
      return res.json({
        success: true,
        data: {
          cloudinary: {
            enabled: false,
            status: 'disabled',
            storageLimit: STORAGE_LIMIT_BYTES,
            storageUsed: 0,
            remainingStorage: STORAGE_LIMIT_BYTES,
            percentUsed: 0,
            bandwidth: 0,
            transformations: 0,
            requests: 0,
            totalAssets: 0,
            imageCount: 0,
            videoCount: 0,
            rawCount: 0,
            countsExact: true,
            estimatedRemainingSmallImages: Math.floor(
              STORAGE_LIMIT_BYTES / Math.max(1, SMALL_IMAGE_MAX_BYTES)
            ),
            timestamp,
          },
          mysql: mysqlStats,
          policy,
          summary: {
            totalAssets: mysqlStats.totalAssets,
            totalStorageBytes: mysqlStats.totalSizeBytes,
            cloudinaryAssets: 0,
            mysqlAssets: mysqlStats.totalAssets,
          },
          storageLimit: STORAGE_LIMIT_BYTES,
          storageUsed: 0,
          remainingStorage: STORAGE_LIMIT_BYTES,
          percentUsed: 0,
          bandwidth: 0,
          transformations: 0,
          requests: 0,
          timestamp,
        },
      });
    }

    let usage = null;
    let counts = {
      imageCount: 0,
      videoCount: 0,
      rawCount: 0,
      totalAssets: 0,
      exact: true,
    };
    let cloudinaryError = '';

    try {
      usage = await cloudinary.api.usage();
    } catch (error) {
      cloudinaryError = error?.message || 'Unable to fetch Cloudinary usage';
    }

    if (!cloudinaryError) {
      try {
        counts = await getCloudinaryResourceCounts();
      } catch (error) {
        cloudinaryError = error?.message || 'Unable to fetch Cloudinary resource counts';
      }
    }

    if (cloudinaryError) {
      return res.json({
        success: true,
        data: {
          cloudinary: {
            enabled: true,
            status: 'error',
            message: cloudinaryError,
            storageLimit: STORAGE_LIMIT_BYTES,
            storageUsed: 0,
            remainingStorage: STORAGE_LIMIT_BYTES,
            percentUsed: 0,
            bandwidth: 0,
            transformations: 0,
            requests: 0,
            totalAssets: 0,
            imageCount: 0,
            videoCount: 0,
            rawCount: 0,
            countsExact: true,
            estimatedRemainingSmallImages: Math.floor(
              STORAGE_LIMIT_BYTES / Math.max(1, SMALL_IMAGE_MAX_BYTES)
            ),
            timestamp,
          },
          mysql: mysqlStats,
          policy,
          summary: {
            totalAssets: mysqlStats.totalAssets,
            totalStorageBytes: mysqlStats.totalSizeBytes,
            cloudinaryAssets: 0,
            mysqlAssets: mysqlStats.totalAssets,
          },
          storageLimit: STORAGE_LIMIT_BYTES,
          storageUsed: 0,
          remainingStorage: STORAGE_LIMIT_BYTES,
          percentUsed: 0,
          bandwidth: 0,
          transformations: 0,
          requests: 0,
          timestamp,
        },
      });
    }

    const usedStorage = normalizeUsageValue(usage?.storage);
    const remainingStorage = Math.max(0, STORAGE_LIMIT_BYTES - usedStorage);
    const rawPercent = STORAGE_LIMIT_BYTES > 0 ? (usedStorage / STORAGE_LIMIT_BYTES) * 100 : 0;
    const percentUsed = Math.max(0, Math.min(100, Number(rawPercent.toFixed(2))));
    const cloudinarySummary = {
      enabled: true,
      status: percentUsed >= 100 ? 'full' : percentUsed >= 80 ? 'warning' : 'healthy',
      storageLimit: STORAGE_LIMIT_BYTES,
      storageUsed: usedStorage,
      remainingStorage,
      percentUsed,
      bandwidth: normalizeUsageValue(usage?.bandwidth),
      transformations: normalizeUsageValue(usage?.transformations),
      requests: normalizeUsageValue(usage?.requests),
      totalAssets: counts.totalAssets,
      imageCount: counts.imageCount,
      videoCount: counts.videoCount,
      rawCount: counts.rawCount,
      countsExact: counts.exact,
      estimatedRemainingSmallImages: Math.floor(
        remainingStorage / Math.max(1, SMALL_IMAGE_MAX_BYTES)
      ),
      timestamp,
    };

    return res.json({
      success: true,
      data: {
        cloudinary: cloudinarySummary,
        mysql: mysqlStats,
        policy,
        summary: {
          totalAssets: counts.totalAssets + mysqlStats.totalAssets,
          totalStorageBytes: usedStorage + mysqlStats.totalSizeBytes,
          cloudinaryAssets: counts.totalAssets,
          mysqlAssets: mysqlStats.totalAssets,
        },
        storageLimit: cloudinarySummary.storageLimit,
        storageUsed: cloudinarySummary.storageUsed,
        remainingStorage: cloudinarySummary.remainingStorage,
        percentUsed: cloudinarySummary.percentUsed,
        bandwidth: cloudinarySummary.bandwidth,
        transformations: cloudinarySummary.transformations,
        requests: cloudinarySummary.requests,
        timestamp,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Cloudinary stats fetch failed',
      error: error.message,
    });
  }
};

const logMediaActivity = async (req, res) => {
  try {
    const { mediaId, mediaType = 'other', action = 'view', mediaUrl = '', userId = '', userRole = '' } = req.body || {};

    if (!mediaId) {
      return res.status(400).json({
        success: false,
        message: 'mediaId is required',
      });
    }

    const normalizedType = String(mediaType).toLowerCase();
    const normalizedAction = String(action).toLowerCase();

    await MediaActivity.create({
      userId: String(userId || '').trim(),
      userRole: String(userRole || '').trim(),
      mediaId: String(mediaId),
      mediaUrl: String(mediaUrl || '').trim(),
      mediaType: ['image', 'video', 'pdf', 'audio', 'other'].includes(normalizedType) ? normalizedType : 'other',
      action: ['view', 'play', 'open', 'download'].includes(normalizedAction) ? normalizedAction : 'view',
      timestamp: new Date(),
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to log media activity',
      error: error.message,
    });
  }
};

const resolveUserId = (req) => {
  const fromToken = req?.user?.userId || req?.user?.id || req?.user?._id || '';
  const fromQuery = req?.query?.userId || '';
  return String(fromToken || fromQuery || '').trim();
};

const predictMediaUsage = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 5));
    const lookback = Math.max(20, Math.min(500, Number(req.query.lookback) || 200));
    const userId = resolveUserId(req);
    const currentHour = new Date().getHours();

    const match = userId ? { userId } : {};
    const logs = await MediaActivity.find(match).sort({ timestamp: -1 }).limit(lookback).lean();

    if (!logs.length) {
      return res.json({ success: true, data: { predictions: [], urls: [] } });
    }

    const total = logs.length;
    const scoreMap = new Map();

    logs.forEach((log, index) => {
      const mediaKey = String(log.mediaId || '').trim();
      if (!mediaKey) return;

      const recencyScore = 1 - index / total;
      const sameHourScore = new Date(log.timestamp).getHours() === currentHour ? 1 : 0;
      const eventScore = 0.5 * 1 + 0.3 * recencyScore + 0.2 * sameHourScore;

      const existing = scoreMap.get(mediaKey) || {
        mediaId: mediaKey,
        mediaUrl: log.mediaUrl || '',
        mediaType: log.mediaType || 'other',
        events: 0,
        score: 0,
      };

      existing.events += 1;
      existing.score += eventScore;
      if (!existing.mediaUrl && log.mediaUrl) {
        existing.mediaUrl = log.mediaUrl;
      }
      scoreMap.set(mediaKey, existing);
    });

    const predictions = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => ({
        ...item,
        score: Number(item.score.toFixed(4)),
      }));

    const urls = predictions.map((item) => item.mediaUrl).filter(Boolean);

    return res.json({
      success: true,
      data: {
        userId: userId || null,
        predictions,
        urls,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to predict media usage',
      error: error.message,
    });
  }
};

const getMediaHeatmap = async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const points = await MediaActivity.aggregate([
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: {
            day: { $subtract: [{ $dayOfWeek: '$timestamp' }, 1] }, // 0-6 (Sun-Sat)
            hour: { $hour: '$timestamp' }, // 0-23
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.day': 1, '_id.hour': 1 } },
    ]);

    const byType = await MediaActivity.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$mediaType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    points.forEach((item) => {
      const day = item?._id?.day;
      const hour = item?._id?.hour;
      if (Number.isInteger(day) && Number.isInteger(hour) && day >= 0 && day < 7 && hour >= 0 && hour < 24) {
        matrix[day][hour] = item.count;
      }
    });

    return res.json({
      success: true,
      data: {
        days,
        matrix,
        points,
        totalsByType: byType,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch media heatmap',
      error: error.message,
    });
  }
};

module.exports = {
  createMediaItem,
  deleteMediaItem,
  getCloudinaryUsage,
  getCloudinaryStats,
  getMediaItems,
  logMediaActivity,
  predictMediaUsage,
  getMediaHeatmap,
  updateMediaItem,
};
