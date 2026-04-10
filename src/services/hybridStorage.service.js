const crypto = require('crypto');

const cloudinary = require('../config/cloudinary');
const { pool } = require('../config/mysql');
const { createObjectId } = require('../../lib/objectId');

const TABLE_PREFIX = process.env.MYSQL_TABLE_PREFIX || 'kpt_';
const MYSQL_ASSET_TABLE = `${TABLE_PREFIX}media_assets`;
const MYSQL_MAX_FILE_BYTES = 4294967295;

const SMALL_IMAGE_MAX_BYTES = Number(process.env.CLOUDINARY_SMALL_IMAGE_MAX_BYTES || 512 * 1024);
const CLOUDINARY_STORAGE_LIMIT_BYTES = Number(process.env.CLOUDINARY_STORAGE_LIMIT_BYTES || 1024 * 1024 * 1024);
const CLOUDINARY_USAGE_CACHE_TTL_MS = Number(process.env.CLOUDINARY_USAGE_CACHE_TTL_MS || 5 * 60 * 1000);
const CLOUDINARY_FORCE_MYSQL_TTL_MS = Number(process.env.CLOUDINARY_FORCE_MYSQL_TTL_MS || 15 * 60 * 1000);

let ensureAssetTablePromise = null;
const cloudinaryStatus = {
  checkedAt: 0,
  isStorageFull: false,
  forceMySQLUntil: 0,
};

const hasCloudinaryCredentials = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const detectResourceType = (mimetype = '') => {
  const safeMimeType = String(mimetype || '').trim().toLowerCase();

  if (safeMimeType.startsWith('image/')) return 'image';
  if (safeMimeType.startsWith('video/')) return 'video';
  if (safeMimeType.startsWith('audio/')) return 'audio';
  if (safeMimeType === 'application/pdf') return 'pdf';
  return 'document';
};

const sanitizeFilename = (value = '') =>
  String(value || 'file')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'file';

const getRequestOrigin = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || '';

  return host ? `${protocol}://${host}` : '';
};

const buildStoredAssetUrl = (req, assetId) => `${getRequestOrigin(req)}/api/v1/upload/assets/${assetId}`;

const encodeMySQLPublicId = (assetId) => `mysql:${String(assetId || '').trim()}`;

const encodeCloudinaryPublicId = (publicId, resourceType = 'image') =>
  `cloudinary:${String(resourceType || 'image').trim()}:${String(publicId || '').trim()}`;

const parsePublicId = (publicId) => {
  const safePublicId = String(publicId || '').trim();

  if (!safePublicId) {
    return { provider: null, assetId: '', publicId: '', resourceType: 'image' };
  }

  if (safePublicId.startsWith('mysql:')) {
    return {
      provider: 'mysql',
      assetId: safePublicId.slice('mysql:'.length),
      publicId: '',
      resourceType: 'raw',
    };
  }

  const cloudinaryMatch = safePublicId.match(/^cloudinary:([^:]+):(.+)$/);
  if (cloudinaryMatch) {
    return {
      provider: 'cloudinary',
      resourceType: cloudinaryMatch[1] || 'image',
      publicId: cloudinaryMatch[2] || '',
      assetId: '',
    };
  }

  return {
    provider: 'cloudinary',
    resourceType: 'image',
    publicId: safePublicId,
    assetId: '',
  };
};

const parseDataUri = (dataUri = '') => {
  const match = String(dataUri || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Unsupported file payload. Expected a base64 data URI.');
  }

  return {
    mimetype: String(match[1] || 'application/octet-stream').trim().toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  };
};

const ensureAssetTable = async () => {
  if (!ensureAssetTablePromise) {
    ensureAssetTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS \`${MYSQL_ASSET_TABLE}\` (
        id VARCHAR(64) NOT NULL,
        folder VARCHAR(255) NULL,
        original_name VARCHAR(255) NULL,
        mime_type VARCHAR(255) NULL,
        resource_type VARCHAR(32) NULL,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        checksum VARCHAR(64) NULL,
        binary_data LONGBLOB NOT NULL,
        metadata JSON NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_media_assets_created_at (created_at)
      )
    `).catch((error) => {
      ensureAssetTablePromise = null;
      throw error;
    });
  }

  await ensureAssetTablePromise;
};

const mysqlAssetTableExists = async () => {
  const [rows] = await pool.query('SHOW TABLES LIKE ?', [MYSQL_ASSET_TABLE]);
  return rows.length > 0;
};

const getMySQLAssetStats = async () => {
  const exists = await mysqlAssetTableExists();
  if (!exists) {
    return {
      tableName: MYSQL_ASSET_TABLE,
      exists: false,
      totalAssets: 0,
      totalSizeBytes: 0,
      averageSizeBytes: 0,
      largestFileBytes: 0,
      imageCount: 0,
      videoCount: 0,
      audioCount: 0,
      pdfCount: 0,
      documentCount: 0,
      perFileLimitBytes: MYSQL_MAX_FILE_BYTES,
      capacityNote: 'No fixed asset count limit. Capacity depends on MySQL disk or hosting quota.',
    };
  }

  const [rows] = await pool.query(
    `
      SELECT
        COUNT(*) AS totalAssets,
        COALESCE(SUM(size_bytes), 0) AS totalSizeBytes,
        COALESCE(AVG(size_bytes), 0) AS averageSizeBytes,
        COALESCE(MAX(size_bytes), 0) AS largestFileBytes,
        SUM(CASE WHEN resource_type = 'image' THEN 1 ELSE 0 END) AS imageCount,
        SUM(CASE WHEN resource_type = 'video' THEN 1 ELSE 0 END) AS videoCount,
        SUM(CASE WHEN resource_type = 'audio' THEN 1 ELSE 0 END) AS audioCount,
        SUM(CASE WHEN resource_type = 'pdf' THEN 1 ELSE 0 END) AS pdfCount,
        SUM(CASE WHEN resource_type = 'document' THEN 1 ELSE 0 END) AS documentCount
      FROM \`${MYSQL_ASSET_TABLE}\`
    `
  );

  const stats = rows[0] || {};
  return {
    tableName: MYSQL_ASSET_TABLE,
    exists: true,
    totalAssets: normalizeNumber(stats.totalAssets, 0),
    totalSizeBytes: normalizeNumber(stats.totalSizeBytes, 0),
    averageSizeBytes: normalizeNumber(stats.averageSizeBytes, 0),
    largestFileBytes: normalizeNumber(stats.largestFileBytes, 0),
    imageCount: normalizeNumber(stats.imageCount, 0),
    videoCount: normalizeNumber(stats.videoCount, 0),
    audioCount: normalizeNumber(stats.audioCount, 0),
    pdfCount: normalizeNumber(stats.pdfCount, 0),
    documentCount: normalizeNumber(stats.documentCount, 0),
    perFileLimitBytes: MYSQL_MAX_FILE_BYTES,
    capacityNote: 'No fixed asset count limit. Capacity depends on MySQL disk or hosting quota.',
  };
};

const getStoragePolicySnapshot = () => ({
  smallImageMaxBytes: SMALL_IMAGE_MAX_BYTES,
  cloudinaryStorageLimitBytes: CLOUDINARY_STORAGE_LIMIT_BYTES,
  cloudinaryPreferredFor: 'Small images only',
  mysqlPreferredFor: 'Large images, videos, audio, PDFs, and other documents',
  fallbackToMySQLWhenCloudinaryFull: true,
  cloudinaryTemporaryFallbackActive:
    Boolean(cloudinaryStatus.forceMySQLUntil && cloudinaryStatus.forceMySQLUntil > Date.now()),
  cloudinaryFallbackUntil: cloudinaryStatus.forceMySQLUntil
    ? new Date(cloudinaryStatus.forceMySQLUntil).toISOString()
    : null,
});

const getCloudinaryUsageBytes = async () => {
  const usage = await cloudinary.api.usage();
  const storageUsage = usage?.storage;
  if (typeof storageUsage === 'number') return storageUsage;
  if (storageUsage && typeof storageUsage === 'object') {
    return normalizeNumber(storageUsage.usage, 0);
  }
  return 0;
};

const markCloudinaryAsFull = () => {
  const now = Date.now();
  cloudinaryStatus.checkedAt = now;
  cloudinaryStatus.isStorageFull = true;
  cloudinaryStatus.forceMySQLUntil = now + CLOUDINARY_FORCE_MYSQL_TTL_MS;
};

const canUseCloudinary = async () => {
  if (!hasCloudinaryCredentials()) {
    return false;
  }

  const now = Date.now();
  if (cloudinaryStatus.forceMySQLUntil > now) {
    return false;
  }

  if (cloudinaryStatus.checkedAt && now - cloudinaryStatus.checkedAt < CLOUDINARY_USAGE_CACHE_TTL_MS) {
    return !cloudinaryStatus.isStorageFull;
  }

  try {
    const usedStorage = await getCloudinaryUsageBytes();
    cloudinaryStatus.checkedAt = now;
    cloudinaryStatus.isStorageFull =
      CLOUDINARY_STORAGE_LIMIT_BYTES > 0 && usedStorage >= CLOUDINARY_STORAGE_LIMIT_BYTES;
    if (cloudinaryStatus.isStorageFull) {
      cloudinaryStatus.forceMySQLUntil = now + CLOUDINARY_FORCE_MYSQL_TTL_MS;
    }
    return !cloudinaryStatus.isStorageFull;
  } catch (error) {
    cloudinaryStatus.checkedAt = now;
    return true;
  }
};

const shouldUseCloudinary = async ({ mimetype, sizeBytes, allowCloudinary = true }) => {
  if (!allowCloudinary) return false;
  if (!String(mimetype || '').toLowerCase().startsWith('image/')) return false;
  if (normalizeNumber(sizeBytes, 0) > SMALL_IMAGE_MAX_BYTES) return false;
  return canUseCloudinary();
};

const createMySQLAsset = async ({ req, buffer, mimetype, originalName, folder = 'media', metadata = null }) => {
  await ensureAssetTable();

  const assetId = createObjectId();
  const now = new Date();
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const safeMimeType = String(mimetype || 'application/octet-stream').trim().toLowerCase();
  const safeOriginalName = sanitizeFilename(originalName || assetId);
  const safeFolder = String(folder || 'media').trim() || 'media';
  const checksum = crypto.createHash('sha1').update(safeBuffer).digest('hex');
  const resourceType = detectResourceType(safeMimeType);
  const serializedMetadata = metadata == null ? null : JSON.stringify(metadata);

  await pool.query(
    `
      INSERT INTO \`${MYSQL_ASSET_TABLE}\`
        (id, folder, original_name, mime_type, resource_type, size_bytes, checksum, binary_data, metadata, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      assetId,
      safeFolder,
      safeOriginalName,
      safeMimeType,
      resourceType,
      safeBuffer.length,
      checksum,
      safeBuffer,
      serializedMetadata,
      now,
      now,
    ]
  );

  return {
    url: buildStoredAssetUrl(req, assetId),
    publicId: encodeMySQLPublicId(assetId),
    storage: 'mysql',
    resourceType,
    sizeBytes: safeBuffer.length,
    mimeType: safeMimeType,
    originalName: safeOriginalName,
  };
};

const uploadToCloudinary = async ({ buffer, mimetype, folder = 'media', cloudinaryOptions = {} }) => {
  const safeMimeType = String(mimetype || 'application/octet-stream').trim().toLowerCase();
  const uploadOptions = {
    folder: String(folder || 'media').trim() || 'media',
    resource_type: 'image',
    quality: 'auto',
    fetch_format: 'auto',
    transformation: [{ width: 2000, crop: 'limit' }],
    ...cloudinaryOptions,
  };
  const dataUri = `data:${safeMimeType};base64,${Buffer.from(buffer).toString('base64')}`;

  const result = await cloudinary.uploader.upload(dataUri, uploadOptions);
  return {
    url: result.secure_url || result.url || '',
    publicId: encodeCloudinaryPublicId(result.public_id, result.resource_type || uploadOptions.resource_type),
    storage: 'cloudinary',
    resourceType: result.resource_type || uploadOptions.resource_type || 'image',
    providerPublicId: result.public_id || '',
  };
};

const storeUploadedBuffer = async ({
  req,
  buffer,
  mimetype,
  originalName,
  folder = 'media',
  allowCloudinary = true,
  metadata = null,
  cloudinaryOptions = {},
}) => {
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const safeMimeType = String(mimetype || 'application/octet-stream').trim().toLowerCase();

  if (!safeBuffer.length) {
    throw new Error('Cannot store an empty file');
  }

  if (await shouldUseCloudinary({ mimetype: safeMimeType, sizeBytes: safeBuffer.length, allowCloudinary })) {
    try {
      return await uploadToCloudinary({
        buffer: safeBuffer,
        mimetype: safeMimeType,
        folder,
        cloudinaryOptions,
      });
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (
        message.includes('quota') ||
        message.includes('storage') ||
        message.includes('limit') ||
        message.includes('credits')
      ) {
        markCloudinaryAsFull();
      }

      console.warn('Cloudinary upload failed, falling back to MySQL storage:', error?.message || error);
    }
  }

  return createMySQLAsset({
    req,
    buffer: safeBuffer,
    mimetype: safeMimeType,
    originalName,
    folder,
    metadata,
  });
};

const storeDataUri = async ({
  req,
  dataUri,
  originalName,
  folder = 'media',
  allowCloudinary = true,
  metadata = null,
  cloudinaryOptions = {},
}) => {
  const { buffer, mimetype } = parseDataUri(dataUri);
  return storeUploadedBuffer({
    req,
    buffer,
    mimetype,
    originalName,
    folder,
    allowCloudinary,
    metadata,
    cloudinaryOptions,
  });
};

const getMySQLAssetById = async (assetId) => {
  await ensureAssetTable();
  const [rows] = await pool.query(
    `
      SELECT id, original_name, mime_type, resource_type, size_bytes, binary_data
      FROM \`${MYSQL_ASSET_TABLE}\`
      WHERE id = ?
      LIMIT 1
    `,
    [String(assetId || '').trim()]
  );

  return rows[0] || null;
};

const streamMySQLAsset = async (req, res, assetId) => {
  const asset = await getMySQLAssetById(assetId);
  if (!asset) {
    return false;
  }

  const buffer = Buffer.isBuffer(asset.binary_data)
    ? asset.binary_data
    : Buffer.from(asset.binary_data || []);
  const totalBytes = buffer.length;
  const mimeType = String(asset.mime_type || 'application/octet-stream').trim().toLowerCase();
  const fileName = sanitizeFilename(asset.original_name || asset.id);
  const rangeHeader = String(req.headers.range || '').trim();
  const isInlineType =
    mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    mimeType === 'application/pdf';

  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('Content-Type', mimeType || 'application/octet-stream');
  res.set('Content-Disposition', `${isInlineType ? 'inline' : 'attachment'}; filename="${fileName}"`);
  res.set('ETag', `"${asset.id}-${totalBytes}"`);

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      res.set('Content-Range', `bytes */${totalBytes}`);
      res.status(416).end();
      return true;
    }

    const start = match[1] === '' ? 0 : normalizeNumber(match[1], 0);
    const end = match[2] === '' ? totalBytes - 1 : normalizeNumber(match[2], totalBytes - 1);

    if (start < 0 || end < start || start >= totalBytes) {
      res.set('Content-Range', `bytes */${totalBytes}`);
      res.status(416).end();
      return true;
    }

    const safeEnd = Math.min(end, totalBytes - 1);
    const chunk = buffer.subarray(start, safeEnd + 1);

    res.status(206);
    res.set('Content-Range', `bytes ${start}-${safeEnd}/${totalBytes}`);
    res.set('Content-Length', String(chunk.length));
    res.end(chunk);
    return true;
  }

  res.set('Content-Length', String(totalBytes));
  res.status(200).end(buffer);
  return true;
};

const deleteMySQLAssetById = async (assetId) => {
  await ensureAssetTable();
  const [result] = await pool.query(`DELETE FROM \`${MYSQL_ASSET_TABLE}\` WHERE id = ?`, [
    String(assetId || '').trim(),
  ]);
  return result?.affectedRows || 0;
};

const deleteCloudinaryAsset = async ({ publicId, resourceType = 'image' }) => {
  const candidates = Array.from(
    new Set(
      [resourceType, 'image', 'video', 'raw']
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: candidate });
      if (result?.result === 'ok' || result?.result === 'not found') {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { result: 'not found' };
};

const deleteStoredFile = async (publicId) => {
  const parsed = parsePublicId(publicId);

  if (parsed.provider === 'mysql') {
    return deleteMySQLAssetById(parsed.assetId);
  }

  if (parsed.provider === 'cloudinary' && parsed.publicId) {
    return deleteCloudinaryAsset(parsed);
  }

  return null;
};

module.exports = {
  SMALL_IMAGE_MAX_BYTES,
  CLOUDINARY_STORAGE_LIMIT_BYTES,
  MYSQL_ASSET_TABLE,
  MYSQL_MAX_FILE_BYTES,
  deleteStoredFile,
  encodeCloudinaryPublicId,
  encodeMySQLPublicId,
  getMySQLAssetStats,
  getStoragePolicySnapshot,
  hasCloudinaryCredentials,
  parsePublicId,
  storeDataUri,
  storeUploadedBuffer,
  streamMySQLAsset,
};
