const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const {
  deleteStoredFile,
  storeUploadedBuffer,
  streamMySQLAsset,
} = require('../services/hybridStorage.service');

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for videos
    files: 10 // Maximum 10 files
  }
});

router.post('/', authMiddleware, upload.array('files'), async (req, res) => {
  console.log('Upload request received, files:', req.files ? req.files.length : 0);
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const uploadPromises = req.files.map((file) =>
      storeUploadedBuffer({
        req,
        buffer: file.buffer,
        mimetype: file.mimetype,
        originalName: file.originalname,
        folder: 'media',
      })
    );

    const results = await Promise.all(uploadPromises);
    console.log('Upload results:', results.length);

    const files = results.map((result) => ({
      url: result.url,
      public_id: result.publicId,
      storage: result.storage,
      resource_type: result.resourceType,
      mime_type: result.mimeType,
    }));

    res.json({ success: true, files });
  } catch (error) {
    console.error('Upload error:', error);

    // Handle specific error types
    if (error.http_code === 413) {
      return res.status(413).json({
        success: false,
        message: 'File too large. Maximum size allowed is 100MB'
      });
    }

    if (error.name === 'MulterError') {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: 'File too large. Maximum size allowed is 100MB'
        });
      }
      if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          message: 'Too many files. Maximum 10 files allowed'
        });
      }
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Upload failed'
    });
  }
});

router.get('/assets/:assetId', async (req, res) => {
  try {
    const found = await streamMySQLAsset(req, res, req.params.assetId);
    if (!found) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
  } catch (error) {
    console.error('Asset stream error:', error);
    res.status(500).json({ success: false, message: 'Failed to load file' });
  }
});

router.delete('/*', authMiddleware, async (req, res) => {
  try {
    const publicId = String(req.params[0] || '').trim();
    if (!publicId) {
      return res.status(400).json({ success: false, message: 'public_id is required' });
    }

    await deleteStoredFile(publicId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
});

module.exports = router;
