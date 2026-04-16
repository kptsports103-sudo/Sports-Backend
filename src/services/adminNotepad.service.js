const AdminNotepadPage = require('../models/adminNotepadPage.model');
const User = require('../models/user.model');
const { createSecurityError } = require('./accountSecurity.service');

const NOTEPAD_HEADING = 'Darya Admin Notepad';
const NOTEPAD_TOTAL_PAGES = 20;
const NOTEPAD_MIN_LINES = 10;
const NOTEPAD_MAX_LINES = 20;
const NOTEPAD_TITLE_MAX_LENGTH = 120;
const NOTEPAD_CONTENT_MAX_LENGTH = 12000;

const normalizePageNumber = (value) => {
  const pageNumber = Number.parseInt(String(value || '').trim(), 10);

  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > NOTEPAD_TOTAL_PAGES) {
    throw createSecurityError(
      `Page number must be between 1 and ${NOTEPAD_TOTAL_PAGES}.`,
      400,
      'INVALID_NOTEPAD_PAGE'
    );
  }

  return pageNumber;
};

const normalizeLineCount = (value) => {
  const lineCount = Number.parseInt(String(value || NOTEPAD_MIN_LINES).trim(), 10);

  if (!Number.isInteger(lineCount) || lineCount < NOTEPAD_MIN_LINES || lineCount > NOTEPAD_MAX_LINES) {
    throw createSecurityError(
      `Line count must be between ${NOTEPAD_MIN_LINES} and ${NOTEPAD_MAX_LINES}.`,
      400,
      'INVALID_NOTEPAD_LINE_COUNT'
    );
  }

  return lineCount;
};

const normalizeTitle = (value) => {
  const title = String(value || '').trim();

  if (title.length > NOTEPAD_TITLE_MAX_LENGTH) {
    throw createSecurityError(
      `Title must be ${NOTEPAD_TITLE_MAX_LENGTH} characters or less.`,
      400,
      'INVALID_NOTEPAD_TITLE'
    );
  }

  return title;
};

const normalizeContent = (value) => {
  const content = String(value || '').replace(/\r\n/g, '\n');

  if (content.length > NOTEPAD_CONTENT_MAX_LENGTH) {
    throw createSecurityError(
      `Text must be ${NOTEPAD_CONTENT_MAX_LENGTH} characters or less.`,
      400,
      'INVALID_NOTEPAD_CONTENT'
    );
  }

  return content;
};

const buildPreview = (content) =>
  String(content || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

const buildDefaultPage = (user, pageNumber) => ({
  adminId: String(user?._id || ''),
  adminEmail: String(user?.email || ''),
  heading: NOTEPAD_HEADING,
  pageNumber,
  title: '',
  content: '',
  lineCount: NOTEPAD_MIN_LINES,
  createdAt: null,
  updatedAt: null,
});

const serializePage = (page) => ({
  pageNumber: Number(page?.pageNumber || 1),
  heading: String(page?.heading || NOTEPAD_HEADING),
  title: String(page?.title || ''),
  content: String(page?.content || ''),
  lineCount: Number(page?.lineCount || NOTEPAD_MIN_LINES),
  createdAt: page?.createdAt || null,
  updatedAt: page?.updatedAt || null,
  preview: buildPreview(page?.content),
  hasContent: Boolean(String(page?.title || '').trim() || String(page?.content || '').trim()),
});

const buildOverviewPage = (page) => {
  const serialized = serializePage(page);

  return {
    pageNumber: serialized.pageNumber,
    title: serialized.title,
    lineCount: serialized.lineCount,
    updatedAt: serialized.updatedAt,
    preview: serialized.preview,
    hasContent: serialized.hasContent,
  };
};

const getUserOrThrow = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw createSecurityError('User not found', 404, 'USER_NOT_FOUND');
  }

  return user;
};

const listAdminNotepadPages = async (userId) => {
  const user = await getUserOrThrow(userId);
  const pages = await AdminNotepadPage.find({ adminId: String(user._id) }).sort({ pageNumber: 1 }).lean();
  const pageMap = new Map(pages.map((page) => [Number(page.pageNumber), page]));

  const overviewPages = Array.from({ length: NOTEPAD_TOTAL_PAGES }, (_, index) => {
    const pageNumber = index + 1;
    return buildOverviewPage(pageMap.get(pageNumber) || buildDefaultPage(user, pageNumber));
  });

  return {
    heading: NOTEPAD_HEADING,
    totalPages: NOTEPAD_TOTAL_PAGES,
    minLines: NOTEPAD_MIN_LINES,
    maxLines: NOTEPAD_MAX_LINES,
    pages: overviewPages,
  };
};

const getAdminNotepadPage = async (userId, requestedPageNumber) => {
  const user = await getUserOrThrow(userId);
  const pageNumber = normalizePageNumber(requestedPageNumber);
  const storedPage = await AdminNotepadPage.findOne({
    adminId: String(user._id),
    pageNumber,
  }).lean();

  return {
    heading: NOTEPAD_HEADING,
    totalPages: NOTEPAD_TOTAL_PAGES,
    minLines: NOTEPAD_MIN_LINES,
    maxLines: NOTEPAD_MAX_LINES,
    page: serializePage(storedPage || buildDefaultPage(user, pageNumber)),
  };
};

const saveAdminNotepadPage = async (userId, requestedPageNumber, payload = {}) => {
  const user = await getUserOrThrow(userId);
  const pageNumber = normalizePageNumber(requestedPageNumber);
  const title = normalizeTitle(payload.title);
  const content = normalizeContent(payload.content);
  const lineCount = normalizeLineCount(payload.lineCount);

  const existingPage = await AdminNotepadPage.findOne({
    adminId: String(user._id),
    pageNumber,
  });

  if (existingPage) {
    existingPage.adminEmail = String(user.email || '');
    existingPage.heading = NOTEPAD_HEADING;
    existingPage.title = title;
    existingPage.content = content;
    existingPage.lineCount = lineCount;
    await existingPage.save();

    return {
      message: `Page ${pageNumber} saved successfully.`,
      page: serializePage(existingPage),
    };
  }

  const createdPage = await AdminNotepadPage.create({
    adminId: String(user._id),
    adminEmail: String(user.email || ''),
    heading: NOTEPAD_HEADING,
    pageNumber,
    title,
    content,
    lineCount,
  });

  return {
    message: `Page ${pageNumber} saved successfully.`,
    page: serializePage(createdPage),
  };
};

module.exports = {
  NOTEPAD_HEADING,
  NOTEPAD_MAX_LINES,
  NOTEPAD_MIN_LINES,
  NOTEPAD_TOTAL_PAGES,
  getAdminNotepadPage,
  listAdminNotepadPages,
  saveAdminNotepadPage,
};
