const db = require('../config/db');

// preferred_date/preferred_time were originally NOT NULL — a student is no
// longer required to propose a specific date/time (the supervisor can set
// one when scheduling), so this self-heals the columns to nullable the same
// lazy way groupController.js/ProjectModel.js patch their own columns,
// rather than requiring every environment to run a migration script by hand.
let ensureNullableColumnsPromise = null;
const ensureNullableDateTimeColumns = () => {
  if (!ensureNullableColumnsPromise) {
    ensureNullableColumnsPromise = new Promise((resolve) => {
      db.query(
        `ALTER TABLE supervisor_student_meeting MODIFY COLUMN preferred_date DATE NULL`,
        () => {
          db.query(
            `ALTER TABLE supervisor_student_meeting MODIFY COLUMN preferred_time TIME NULL`,
            () => resolve() // Either column may already be nullable — nothing to react to either way.
          );
        }
      );
    });
  }
  return ensureNullableColumnsPromise;
};

const createMeetingRequest = (requestData, callback) => {
  const { student_id, supervisor_id, group_name, topic, preferred_date, preferred_time, end_time, reason } = requestData;
  const query = `
    INSERT INTO supervisor_student_meeting
    (student_id, supervisor_id, group_name, topic, preferred_date, preferred_time, end_time, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  ensureNullableDateTimeColumns().then(() => {
    db.query(
      query,
      [student_id, supervisor_id, group_name, topic, preferred_date || null, preferred_time || null, end_time || null, reason],
      (err, result) => {
        if (err) return callback(err);
        callback(null, { id: result.insertId, ...requestData, status: 'pending' });
      }
    );
  });
};

const getPendingRequestsForSupervisor = (supervisorId, callback) => {
  const query = `
    SELECT * FROM supervisor_student_meeting 
    WHERE supervisor_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `;
  db.query(query, [supervisorId], (err, results) => {
    if (err) return callback(err);
    callback(null, results);
  });
};

const updateRequestStatus = (requestId, status, message, callback) => {
  const query = `
    UPDATE supervisor_student_meeting 
    SET status = ?, supervisor_message = ? 
    WHERE id = ?
  `;
  db.query(query, [status, message, requestId], (err, result) => {
    if (err) return callback(err);
    callback(null, result);
  });
};

const getRequestsForStudent = (studentId, callback) => {
  const query = `
    SELECT * FROM supervisor_student_meeting 
    WHERE student_id = ?
    ORDER BY created_at DESC
  `;
  db.query(query, [studentId], (err, results) => {
    if (err) return callback(err);
    callback(null, results);
  });
};

module.exports = {
  createMeetingRequest,
  getPendingRequestsForSupervisor,
  updateRequestStatus,
  getRequestsForStudent
};
