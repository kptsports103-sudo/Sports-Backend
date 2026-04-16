const Certificate = require('../models/certificate.model');
const Event = require('../models/event.model');
const Gallery = require('../models/gallery.model');
const GroupResult = require('../models/groupResult.model');
const MediaItem = require('../models/mediaItem.model');
const Player = require('../models/player.model');
const Result = require('../models/result.model');
const StudentParticipation = require('../models/studentParticipation.model');
const Winner = require('../models/winner.model');

const MIN_ARCHIVE_YEAR = 1900;
const MAX_ARCHIVE_YEAR = 2100;
const MEDAL_ORDER = {
  Gold: 1,
  Silver: 2,
  Bronze: 3,
  Participation: 4,
};

const toNumberYear = (value) => {
  const year = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isInteger(year) || year < MIN_ARCHIVE_YEAR || year > MAX_ARCHIVE_YEAR) {
    return null;
  }
  return year;
};

const extractYear = (...values) => {
  for (const value of values) {
    const directYear = toNumberYear(value);
    if (directYear) {
      return directYear;
    }

    const text = String(value || '').trim();
    if (!text) {
      continue;
    }

    const matchedYear = text.match(/(?:19|20)\d{2}/);
    if (matchedYear) {
      const parsedYear = toNumberYear(matchedYear[0]);
      if (parsedYear) {
        return parsedYear;
      }
    }

    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      const dateYear = date.getFullYear();
      if (dateYear >= MIN_ARCHIVE_YEAR && dateYear <= MAX_ARCHIVE_YEAR) {
        return dateYear;
      }
    }
  }

  return null;
};

const toSortTime = (value) => {
  const time = Date.parse(String(value || '').trim());
  return Number.isFinite(time) ? time : 0;
};

const compareByMedalThenName = (left, right, leftName = '', rightName = '') => {
  const medalDiff = (MEDAL_ORDER[left] || 99) - (MEDAL_ORDER[right] || 99);
  if (medalDiff !== 0) {
    return medalDiff;
  }

  return String(leftName || '').localeCompare(String(rightName || ''), 'en', { sensitivity: 'base' });
};

const safeText = (value, fallback = '') => String(value || fallback).trim();

const normalizeMemberNames = (members = []) =>
  (Array.isArray(members) ? members : [])
    .map((member) => {
      if (typeof member === 'string') {
        return safeText(member);
      }

      return safeText(member?.name);
    })
    .filter(Boolean);

const countGalleryAssets = (gallery) =>
  (Array.isArray(gallery?.media) ? gallery.media : []).filter((item) => {
    if (typeof item === 'string') {
      return safeText(item);
    }

    return safeText(item?.url);
  }).length;

const countMediaAssets = (mediaItem) => {
  const files = Array.isArray(mediaItem?.files) ? mediaItem.files : [];
  if (files.length > 0) {
    return files.filter((file) => safeText(file?.url || file)).length;
  }

  return safeText(mediaItem?.link) ? 1 : 0;
};

const buildGalleryEntries = (galleries = []) =>
  galleries.flatMap((gallery) => {
    const media = Array.isArray(gallery?.media) ? gallery.media : [];
    return media
      .map((item, index) => {
        const url = typeof item === 'string' ? safeText(item) : safeText(item?.url);
        if (!url) {
          return null;
        }

        return {
          id: `${safeText(gallery?._id || gallery?.id || 'gallery')}-${index}`,
          source: 'gallery',
          title: safeText(gallery?.title, 'Gallery'),
          category: safeText(gallery?.category, 'general'),
          overview: typeof item === 'string' ? '' : safeText(item?.overview),
          url,
          createdAt: gallery?.createdAt || null,
          year: extractYear(gallery?.createdAt),
        };
      })
      .filter(Boolean);
  });

const buildMediaEntries = (mediaItems = []) =>
  mediaItems.flatMap((item) => {
    const files = Array.isArray(item?.files) ? item.files : [];

    if (files.length > 0) {
      return files
        .map((file, index) => {
          const url = safeText(file?.url || file);
          if (!url) {
            return null;
          }

          return {
            id: `${safeText(item?._id || item?.id || 'media')}-${index}`,
            source: 'media',
            title: safeText(item?.title, 'Media'),
            category: safeText(item?.category, 'general'),
            overview: safeText(item?.description),
            url,
            createdAt: item?.createdAt || null,
            year: extractYear(item?.createdAt),
          };
        })
        .filter(Boolean);
    }

    const link = safeText(item?.link);
    if (!link) {
      return [];
    }

    return [{
      id: safeText(item?._id || item?.id || 'media-link'),
      source: 'media',
      title: safeText(item?.title, 'Media'),
      category: safeText(item?.category, 'general'),
      overview: safeText(item?.description),
      url: link,
      createdAt: item?.createdAt || null,
      year: extractYear(item?.createdAt),
    }];
  });

const uniqueYears = (...collections) =>
  Array.from(
    new Set(
      collections.flatMap((collection) => collection || []).map((year) => toNumberYear(year)).filter(Boolean)
    )
  ).sort((left, right) => right - left);

const buildSectionPayload = ({
  selectedYear,
  results,
  groupResults,
  winners,
  certificates,
  players,
  participations,
  events,
  mediaEntries,
}) => ({
  results: results
    .sort((left, right) => compareByMedalThenName(left.medal, right.medal, left.name, right.name))
    .map((result) => ({
      id: result._id,
      name: safeText(result.name, 'Unknown Player'),
      branch: safeText(result.branch),
      event: safeText(result.event, 'Event'),
      year: selectedYear,
      medal: safeText(result.medal, 'Participation'),
      level: safeText(result.level, 'state'),
      imageUrl: safeText(result.imageUrl),
    })),
  groupResults: groupResults
    .sort((left, right) => compareByMedalThenName(left.medal, right.medal, left.teamName, right.teamName))
    .map((groupResult) => ({
      id: groupResult._id,
      teamName: safeText(groupResult.teamName, 'Team'),
      event: safeText(groupResult.event, 'Event'),
      year: selectedYear,
      medal: safeText(groupResult.medal, 'Participation'),
      level: safeText(groupResult.level, 'state'),
      members: normalizeMemberNames(groupResult.members),
      imageUrl: safeText(groupResult.imageUrl),
    })),
  winners: winners
    .sort((left, right) => compareByMedalThenName(left.medal, right.medal, left.playerName, right.playerName))
    .map((winner) => ({
      id: winner._id,
      playerName: safeText(winner.playerName, 'Winner'),
      teamName: safeText(winner.teamName),
      branch: safeText(winner.branch),
      eventName: safeText(winner.eventName, 'Event'),
      year: selectedYear,
      medal: safeText(winner.medal, 'Gold'),
      imageUrl: safeText(winner.imageUrl),
    })),
  certificates: certificates
    .sort((left, right) => safeText(left.name).localeCompare(safeText(right.name), 'en', { sensitivity: 'base' }))
    .map((certificate) => ({
      id: certificate._id,
      certificateId: safeText(certificate.certificateId),
      name: safeText(certificate.name, 'Student'),
      department: safeText(certificate.department),
      competition: safeText(certificate.competition, 'Competition'),
      position: safeText(certificate.position),
      achievement: safeText(certificate.achievement),
      year: selectedYear,
    })),
  players: players
    .sort((left, right) => safeText(left.name).localeCompare(safeText(right.name), 'en', { sensitivity: 'base' }))
    .map((player) => ({
      id: player._id,
      name: safeText(player.name, 'Player'),
      branch: safeText(player.branch),
      kpmNo: safeText(player.kpmNo),
      semester: safeText(player.semester),
      currentDiplomaYear: player.currentDiplomaYear || null,
      status: safeText(player.status, 'ACTIVE'),
      year: selectedYear,
    })),
  participations: participations
    .sort((left, right) => safeText(left.studentName).localeCompare(safeText(right.studentName), 'en', { sensitivity: 'base' }))
    .map((entry) => ({
      id: entry._id,
      studentName: safeText(entry.studentName, 'Student'),
      sport: safeText(entry.sport),
      event: safeText(entry.event),
      year: selectedYear,
    })),
  events: events
    .sort((left, right) => toSortTime(right.eventDate || right.date) - toSortTime(left.eventDate || left.date))
    .map((event) => ({
      id: event._id,
      title: safeText(event.event_title || event.eventName, 'Sports Event'),
      category: safeText(event.category),
      sportType: safeText(event.sportType),
      eventType: safeText(event.eventType),
      level: safeText(event.level || event.event_level),
      venue: safeText(event.venue),
      city: safeText(event.city),
      eventDate: safeText(event.eventDate || event.event_date || event.date),
      eventTime: safeText(event.eventTime),
      registrationStatus: safeText(event.registrationStatus),
      year: selectedYear,
    })),
  media: mediaEntries
    .sort((left, right) => toSortTime(right.createdAt) - toSortTime(left.createdAt))
    .map((entry) => ({
      id: entry.id,
      source: entry.source,
      title: safeText(entry.title, 'Media'),
      category: safeText(entry.category),
      overview: safeText(entry.overview),
      url: safeText(entry.url),
      createdAt: entry.createdAt || null,
      year: selectedYear,
    })),
});

const buildMedalBreakdown = (results = [], groupResults = [], winners = []) => {
  const breakdown = {
    Gold: 0,
    Silver: 0,
    Bronze: 0,
    Participation: 0,
  };

  [...results, ...groupResults, ...winners].forEach((entry) => {
    const medal = safeText(entry?.medal, 'Participation');
    if (Object.prototype.hasOwnProperty.call(breakdown, medal)) {
      breakdown[medal] += 1;
    }
  });

  return breakdown;
};

const resolveSelectedYear = (requestedYear, availableYears) => {
  const normalizedRequestedYear = toNumberYear(requestedYear);
  if (normalizedRequestedYear) {
    return normalizedRequestedYear;
  }

  if (availableYears.length > 0) {
    return availableYears[0];
  }

  return new Date().getFullYear();
};

const getArchivePayload = async (requestedYear) => {
  const [
    results,
    groupResults,
    winners,
    certificates,
    players,
    events,
    galleries,
    mediaItems,
    participations,
  ] = await Promise.all([
    Result.find().lean(),
    GroupResult.find().lean(),
    Winner.find().lean(),
    Certificate.find().lean(),
    Player.find().lean(),
    Event.find().lean(),
    Gallery.find().lean(),
    MediaItem.find().lean(),
    StudentParticipation.find().lean(),
  ]);

  const galleryEntries = buildGalleryEntries(galleries.filter((gallery) => gallery?.visibility !== false));
  const mediaEntries = buildMediaEntries(mediaItems);

  const eventYears = events.map((event) =>
    extractYear(
      event?.event_date,
      event?.eventDate,
      event?.date,
      event?.registrationStartDate,
      event?.registrationEndDate
    )
  );
  const galleryYears = galleryEntries.map((entry) => entry.year);
  const mediaYears = mediaEntries.map((entry) => entry.year);

  const availableYears = uniqueYears(
    results.map((entry) => entry?.year),
    groupResults.map((entry) => entry?.year),
    winners.map((entry) => entry?.year),
    certificates.map((entry) => entry?.year),
    players.map((entry) => entry?.year),
    participations.map((entry) => entry?.year),
    eventYears,
    galleryYears,
    mediaYears
  );

  const selectedYear = resolveSelectedYear(requestedYear, availableYears);
  const resultsForYear = results.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const groupResultsForYear = groupResults.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const winnersForYear = winners.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const certificatesForYear = certificates.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const playersForYear = players.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const participationsForYear = participations.filter((entry) => toNumberYear(entry?.year) === selectedYear);
  const eventsForYear = events.filter((entry) =>
    extractYear(
      entry?.event_date,
      entry?.eventDate,
      entry?.date,
      entry?.registrationStartDate,
      entry?.registrationEndDate
    ) === selectedYear
  );
  const galleryEntriesForYear = galleryEntries.filter((entry) => entry.year === selectedYear);
  const mediaEntriesForYear = mediaEntries.filter((entry) => entry.year === selectedYear);
  const combinedMediaForYear = [...galleryEntriesForYear, ...mediaEntriesForYear];
  const visibleGalleriesForYear = galleries.filter(
    (gallery) => gallery?.visibility !== false && extractYear(gallery?.createdAt) === selectedYear
  );

  const sections = buildSectionPayload({
    selectedYear,
    results: resultsForYear,
    groupResults: groupResultsForYear,
    winners: winnersForYear,
    certificates: certificatesForYear,
    players: playersForYear,
    participations: participationsForYear,
    events: eventsForYear,
    mediaEntries: combinedMediaForYear,
  });

  return {
    year: selectedYear,
    requestedYear: toNumberYear(requestedYear),
    availableYears,
    hasAnyData: availableYears.length > 0,
    summary: {
      eventCount: eventsForYear.length,
      playerCount: playersForYear.length,
      participationCount: participationsForYear.length,
      resultCount: resultsForYear.length,
      groupResultCount: groupResultsForYear.length,
      winnerCount: winnersForYear.length,
      certificateCount: certificatesForYear.length,
      galleryCount: visibleGalleriesForYear.length,
      galleryAssetCount: galleryEntriesForYear.length,
      mediaCount: mediaEntriesForYear.length,
    },
    medalBreakdown: buildMedalBreakdown(resultsForYear, groupResultsForYear, winnersForYear),
    highlights: {
      topWinners: sections.winners.slice(0, 6),
      featuredEvents: sections.events.slice(0, 6),
      latestMedia: sections.media.slice(0, 8),
    },
    sections,
    links: {
      results: `/results?year=${selectedYear}`,
      winners: '/winners',
      pointsTable: '/points-table',
      gallery: '/gallery',
      events: '/events',
    },
  };
};

module.exports = {
  getArchivePayload,
};
