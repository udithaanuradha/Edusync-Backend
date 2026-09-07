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

// A student may only request a meeting with a supervisor actually assigned
// to their group — checks both supervisor_id and supervisor_id_2 (a group
// can have a second supervisor), same scoping used elsewhere for that
// feature. Used by the controller before creating a request.
const isSupervisorAssignedToStudent = (studentId, supervisorId, callback) => {
  const query = `
    SELECT 1 FROM project_groups pg
    JOIN project_group_members gm ON gm.group_id = pg.id
    WHERE gm.student_id = ? AND (pg.supervisor_id = ? OR pg.supervisor_id_2 = ?)
    LIMIT 1
  `;
  db.query(query, [studentId, supervisorId, supervisorId], (err, results) => {
    if (err) return callback(err);
    callback(null, results.length > 0);
  });
};

// The student's actual assigned supervisor(s) — id + name, deduped, across
// every group they're in (no level filter, so it can't miss one because a
// caller's level state doesn't match the student's real level). Used to
// restrict the "Supervisor" dropdown on the meeting request form to only
// people the student can actually pick.
const getAssignedSupervisorsForStudent = (studentId, callback) => {
  const query = `
    SELECT DISTINCT pg.supervisor_id AS id1, u1.name AS name1,
                     pg.supervisor_id_2 AS id2, u2.name AS name2
    FROM project_groups pg
    JOIN project_group_members gm ON gm.group_id = pg.id
    LEFT JOIN users u1 ON u1.id = pg.supervisor_id
    LEFT JOIN users u2 ON u2.id = pg.supervisor_id_2
    WHERE gm.student_id = ?
  `;
  db.query(query, [studentId], (err, rows) => {
    if (err) return callback(err);

    const byId = new Map();
    rows.forEach((row) => {
      if (row.id1 != null) byId.set(row.id1, row.name1 || `Supervisor ${row.id1}`);
      if (row.id2 != null) byId.set(row.id2, row.name2 || `Supervisor ${row.id2}`);
    });
    callback(null, [...byId.entries()].map(([id, name]) => ({ id, name })));
  });
};

// A student can only have one *pending* request open with a given
// supervisor at a time — once it's approved or rejected, they're free to
// send another. Used by the controller before creating a request.
const hasPendingRequestForSupervisor = (studentId, supervisorId, callback) => {
  const query = `
    SELECT 1 FROM supervisor_student_meeting
    WHERE student_id = ? AND supervisor_id = ? AND status = 'pending'
    LIMIT 1
  `;
  db.query(query, [studentId, supervisorId], (err, results) => {
    if (err) return callback(err);
    callback(null, results.length > 0);
  });
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

// A student can only delete their OWN request, and only while it's still
// pending (once a supervisor has responded, the record stays as history).
// callback(err, deleted: boolean).
const deletePendingRequest = (requestId, studentId, callback) => {
  const query = `
    DELETE FROM supervisor_student_meeting
    WHERE id = ? AND student_id = ? AND status = 'pending'
  `;
  db.query(query, [requestId, studentId], (err, result) => {
    if (err) return callback(err);
    callback(null, result.affectedRows > 0);
  });
};

module.exports = {
  isSupervisorAssignedToStudent,
  hasPendingRequestForSupervisor,
  getAssignedSupervisorsForStudent,
  createMeetingRequest,
  getPendingRequestsForSupervisor,
  updateRequestStatus,
  getRequestsForStudent,
  deletePendingRequest
};
