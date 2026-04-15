const GALLERY_CATEGORIES = [
  { key: 'annual', label: 'Annual' },
  { key: 'state', label: 'State' },
  { key: 'national', label: 'National' },
];

const DEFAULT_GALLERY_CATEGORY = 'state';

const CATEGORY_KEYS = new Set(GALLERY_CATEGORIES.map((category) => category.key));
const CATEGORY_ORDER = GALLERY_CATEGORIES.reduce((order, category, index) => {
  order[category.key] = index;
  return order;
}, {});

const normalizeGalleryCategory = (value) => {
  const key = String(value || '').trim().toLowerCase();
  return CATEGORY_KEYS.has(key) ? key : DEFAULT_GALLERY_CATEGORY;
};

const getGalleryCategoryLabel = (value) => {
  const key = normalizeGalleryCategory(value);
  return GALLERY_CATEGORIES.find((category) => category.key === key)?.label || 'State';
};

const compareGalleryCategory = (left, right) =>
  (CATEGORY_ORDER[normalizeGalleryCategory(left)] ?? CATEGORY_ORDER[DEFAULT_GALLERY_CATEGORY]) -
  (CATEGORY_ORDER[normalizeGalleryCategory(right)] ?? CATEGORY_ORDER[DEFAULT_GALLERY_CATEGORY]);

module.exports = {
  GALLERY_CATEGORIES,
  DEFAULT_GALLERY_CATEGORY,
  normalizeGalleryCategory,
  getGalleryCategoryLabel,
  compareGalleryCategory,
};
