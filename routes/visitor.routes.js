const express = require("express");
const Visitor = require("../models/visitor.model.js");

const router = express.Router();

const summarizeDbError = (error) => ({
  code: error?.code || null,
  errno: error?.errno || null,
  sqlState: error?.sqlState || null,
  message: error?.message || 'Unknown database error',
});

// Basic visit cache to prevent rapid refresh abuse
const visitCache = new Set();

// Safety middleware
const safetyMiddleware = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (visitCache.has(ip)) {
    return next(); // Skip counting but still return data
  }
  visitCache.add(ip);
  setTimeout(() => visitCache.delete(ip), 60000); // 1 minute cooldown
  req.shouldCount = true;
  next();
};

router.get("/count", safetyMiddleware, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    let todayVisitor;
    
    // Only increment if not blocked by safety middleware
    if (req.shouldCount) {
      todayVisitor = await Visitor.findOneAndUpdate(
        { date: today },
        { $inc: { count: 1 } },
        { new: true, upsert: true }
      );
    } else {
      todayVisitor = await Visitor.findOne({ date: today }) || 
                     { count: 0 };
    }

    // Calculate total visitors
    const totalVisitors = await Visitor.aggregate([
      { $group: { _id: null, total: { $sum: "$count" } } }
    ]);

    res.json({
      today: todayVisitor.count,
      total: totalVisitors[0]?.total || 0,
      date: today
    });
  } catch (err) {
    console.error("Visitor count error:", summarizeDbError(err));
    res.status(503).json({
      message: "Visitor count error",
      code: err?.code || null,
    });
  }
});

// Get current count without incrementing
router.get("/current", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    
    const todayVisitor = await Visitor.findOne({ date: today }) || { count: 0 };
    
    const totalVisitors = await Visitor.aggregate([
      { $group: { _id: null, total: { $sum: "$count" } } }
    ]);

    res.json({
      today: todayVisitor.count,
      total: totalVisitors[0]?.total || 0,
      date: today
    });
  } catch (err) {
    console.error("Get current count error:", summarizeDbError(err));
    res.status(503).json({
      message: "Error getting visitor count",
      code: err?.code || null,
    });
  }
});

// Get daily visitors data for chart
router.get("/daily", async (req, res) => {
  try {
    const data = await Visitor.find()
      .sort({ date: 1 })
      .select("date count -_id");

    res.json(data);
  } catch (err) {
    console.error("Failed to fetch visitor stats:", summarizeDbError(err));
    res.status(503).json({
      message: "Failed to fetch visitor stats",
      code: err?.code || null,
    });
  }
});

// Get daily + total visitors comparison data
router.get("/daily-total", async (req, res) => {
  try {
    const visitors = await Visitor.find()
      .sort({ date: 1 })
      .select("date count -_id");

    let total = 0;
    const result = visitors.map(v => {
      total += v.count;
      return {
        date: v.date,
        daily: v.count,
        total
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Visitor stats error:", summarizeDbError(err));
    res.status(503).json({
      message: "Visitor stats error",
      code: err?.code || null,
    });
  }
});

module.exports = router;
