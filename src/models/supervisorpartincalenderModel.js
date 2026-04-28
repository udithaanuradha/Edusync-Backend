const db = require("../config/db");

const getWeeklyScheduleBySupervisorId = (supervisorId, callback) => {
  const safeSupId = Number(supervisorId);
  const query =
    "SELECT supervisor_id, weekly_schedule FROM supervisorpartincalender WHERE supervisor_id = ? LIMIT 1";

  db.query(query, [safeSupId], (error, results) => {
    if (error) return callback(error);
    if (!results.length) return callback(null, null);

    const row = results[0];
    let weeklySchedule = row.weekly_schedule;

    // Safely parse JSON if TiDB returns it as a string
    if (typeof weeklySchedule === "string") {
      try {
        weeklySchedule = JSON.parse(weeklySchedule);
      } catch {
        weeklySchedule = null;
      }
    }

    return callback(null, {
      supervisorId: row.supervisor_id,
      weeklySchedule: weeklySchedule,
    });
  });
};

const upsertWeeklySchedule = (supervisorId, weeklySchedule, callback) => {
  const safeSupId = Number(supervisorId);
  const jsonString = JSON.stringify(weeklySchedule);

  // 1. Explicitly check if the user already has a row
  const checkQuery =
    "SELECT id FROM supervisorpartincalender WHERE supervisor_id = ?";

  db.query(checkQuery, [safeSupId], (checkErr, results) => {
    if (checkErr) return callback(checkErr);

    if (results.length > 0) {
      // 2a. Update existing row
      const updateQuery = `
        UPDATE supervisorpartincalender 
        SET weekly_schedule = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE supervisor_id = ?
      `;
      db.query(
        updateQuery,
        [jsonString, safeSupId],
        (updateErr, updateResult) => {
          if (updateErr) return callback(updateErr);
          return callback(null, updateResult);
        },
      );
    } else {
      // 2b. Insert brand new row
      const insertQuery = `
        INSERT INTO supervisorpartincalender (supervisor_id, weekly_schedule, created_at, updated_at) 
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
      db.query(
        insertQuery,
        [safeSupId, jsonString],
        (insertErr, insertResult) => {
          if (insertErr) return callback(insertErr);
          return callback(null, insertResult);
        },
      );
    }
  });
};

module.exports = {
  getWeeklyScheduleBySupervisorId,
  upsertWeeklySchedule,
};
