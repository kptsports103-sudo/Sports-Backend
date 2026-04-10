const AdminActivityLog = require('../models/adminActivityLog.model');
const Attendance = require('../models/attendance.model');
const Certificate = require('../models/certificate.model');
const Event = require('../models/event.model');
const Gallery = require('../models/gallery.model');
const GroupResult = require('../models/groupResult.model');
const Home = require('../models/home.model');
const KpmPool = require('../models/kpmPool.model');
const MediaActivity = require('../models/mediaActivity.model');
const OTP = require('../models/otp.model');
const Player = require('../models/player.model');
const Registration = require('../models/registration.model');
const Result = require('../models/result.model');
const StudentParticipation = require('../models/studentParticipation.model');
const User = require('../models/user.model');
const WebVital = require('../models/webVital.model');
const Winner = require('../models/winner.model');
const WinnerCaptureSession = require('../models/winnerCaptureSession.model');
const Visitor = require('../../models/visitor.model');

const runtimeModels = [
  AdminActivityLog,
  Attendance,
  Certificate,
  Event,
  Gallery,
  GroupResult,
  Home,
  KpmPool,
  MediaActivity,
  OTP,
  Player,
  Registration,
  Result,
  StudentParticipation,
  User,
  WebVital,
  Winner,
  WinnerCaptureSession,
  Visitor,
];

let schemaInitPromise = null;

const initializeMySQLSchema = async () => {
  if (!schemaInitPromise) {
    schemaInitPromise = Promise.all(runtimeModels.map((model) => model.ensureTable()))
      .then(() => runtimeModels.map((model) => model.tableName))
      .catch((error) => {
        schemaInitPromise = null;
        throw error;
      });
  }

  return schemaInitPromise;
};

module.exports = {
  runtimeModels,
  initializeMySQLSchema,
};
