const {
  getWeeklyScheduleBySupervisorId,
  upsertWeeklySchedule,
} = require("../models/supervisorpartincalenderModel");

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const createEmptySchedule = () =>
  DAYS_OF_WEEK.reduce((accumulator, day) => {
    accumulator[day] = [];
    return accumulator;
  }, {});

const normalizeWeeklySchedule = (value) => {
  if (!value || typeof value !== "object") return createEmptySchedule();

  return DAYS_OF_WEEK.reduce((accumulator, day) => {
    const slots = Array.isArray(value[day]) ? value[day] : [];

    accumulator[day] = slots
      .filter((slot) => slot && typeof slot === "object")
      .map((slot) => ({
        start: typeof slot.start === "string" ? slot.start : "08:00",
        end: typeof slot.end === "string" ? slot.end : "10:00",
      }));

    return accumulator;
  }, createEmptySchedule());
};

const getWeeklySchedule = (req, res) => {
  const supervisorId = req.params.supervisorId || req.query.supervisorId;

  if (!supervisorId) {
    return res.status(400).json({ error: "supervisorId is required" });
  }

  getWeeklyScheduleBySupervisorId(supervisorId, (error, schedule) => {
    if (error) {
      console.error("Failed to fetch weekly schedule:", error);
      return res.status(500).json({ error: "Database error" });
    }
    return res.status(200).json({ success: true, data: schedule });
  });
};

const saveWeeklySchedule = (req, res) => {
  const rawId = req.params.supervisorId || req.body.supervisorId;
  const supervisorId = Number(rawId); // Force number to prevent strict mode DB failures

  if (!supervisorId || isNaN(supervisorId)) {
    return res.status(400).json({ error: "Valid supervisorId is required" });
  }

  // Safely extract the schedule payload
  const weeklySchedule = req.body.weeklySchedule || req.body;
  const normalizedSchedule = normalizeWeeklySchedule(weeklySchedule);

  upsertWeeklySchedule(supervisorId, normalizedSchedule, (error) => {
    if (error) {
      console.error("Failed to save schedule:", error);
      return res.status(500).json({ error: "Failed to save weekly schedule" });
    }

    return res.status(200).json({
      success: true,
      message: "Weekly schedule saved successfully",
      supervisorId,
      weeklySchedule: normalizedSchedule,
    });
  });
};

module.exports = {
  getWeeklySchedule,
  saveWeeklySchedule,
};
