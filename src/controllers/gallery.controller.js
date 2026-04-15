const Gallery = require('../models/gallery.model');
const {
  DEFAULT_GALLERY_CATEGORY,
  compareGalleryCategory,
  normalizeGalleryCategory,
} = require('../utils/galleryCategories');

const normalizeGalleryMedia = (media = []) => {
  if (!Array.isArray(media)) return [];

  return media.map((item) => {
    if (typeof item === 'string') {
      return { url: item, overview: '' };
    }

    if (!item || typeof item !== 'object') {
      return { url: '', overview: '' };
    }

    return {
      ...item,
      url: String(item?.url || ''),
      overview: String(item?.overview || ''),
    };
  });
};

const normalizeGalleryDocument = (gallery) => {
  const galleryObject = typeof gallery.toObject === 'function' ? gallery.toObject() : gallery;

  return {
    ...galleryObject,
    category: normalizeGalleryCategory(galleryObject?.category),
    media: normalizeGalleryMedia(galleryObject?.media),
  };
};

const toSortTime = (value) => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
};

exports.getGalleries = async (req, res) => {
  try {
    const galleries = await Gallery.find();
    const processedGalleries = galleries
      .map(normalizeGalleryDocument)
      .sort((left, right) => {
        const categorySort = compareGalleryCategory(left.category, right.category);
        if (categorySort !== 0) return categorySort;
        return toSortTime(right.createdAt) - toSortTime(left.createdAt);
      });
    res.json(processedGalleries);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.createGallery = async (req, res) => {
  const { title, media = [], visibility = true, category = DEFAULT_GALLERY_CATEGORY } = req.body;
  console.log('Creating gallery:', { title, category, media, visibility });

  if (!title || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }

  const processedMedia = normalizeGalleryMedia(media);
  const processedCategory = normalizeGalleryCategory(category);

  try {
    const gallery = new Gallery({
      title: title.trim(),
      category: processedCategory,
      media: processedMedia,
      visibility,
    });
    await gallery.save();
    res.status(201).json(normalizeGalleryDocument(gallery));
  } catch (error) {
    console.error('Error creating gallery:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateGallery = async (req, res) => {
  const { id } = req.params;
  const { title, media = [], visibility = true, category = DEFAULT_GALLERY_CATEGORY } = req.body;
  console.log('Updating gallery:', id, req.body);

  if (!title || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }

  const processedMedia = normalizeGalleryMedia(media);
  const processedCategory = normalizeGalleryCategory(category);

  try {
    const gallery = await Gallery.findByIdAndUpdate(
      id,
      {
        title: title.trim(),
        category: processedCategory,
        media: processedMedia,
        visibility,
      },
      { new: true }
    );
    if (!gallery) {
      return res.status(404).json({ message: 'Gallery not found' });
    }
    res.json(normalizeGalleryDocument(gallery));
  } catch (error) {
    console.error('Error updating gallery:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteGallery = async (req, res) => {
  const { id } = req.params;
  try {
    const gallery = await Gallery.findByIdAndDelete(id);
    if (!gallery) {
      return res.status(404).json({ message: 'Gallery not found' });
    }
    res.json({ message: 'Gallery deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};
