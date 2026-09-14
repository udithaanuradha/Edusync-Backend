const db = require('../config/db');

// Lazy table creation, same self-healing pattern used elsewhere in this
// codebase (e.g. GroupConversationV2Model.js) — no manual migration step
// needed on any environment.
let ensureTablePromise = null;
const ensureMeetingReportsTable = () => {
  if (!ensureTablePromise) {
    ensureTablePromise = new Promise((resolve, reject) => {
      db.query(
        `CREATE TABLE IF NOT EXISTS meeting_reports (
          id INT AUTO_INCREMENT PRIMARY KEY,
          meeting_request_id INT NOT NULL,
          student_id INT NOT NULL,
          supervisor_id INT NOT NULL,
          group_name VARCHAR(255) NOT NULL,
          summary TEXT NOT NULL,
          status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
          supervisor_message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT fk_meeting_report_request FOREIGN KEY (meeting_request_id)
            REFERENCES supervisor_student_meeting(id) ON DELETE CASCADE
        )`,
        (err) => (err ? reject(err) : resolve())
      );
    });
  }
  return ensureTablePromise;
};

// A report can only be written for a request that's actually approved, and
// only by the student who made it. Used by the controller before creating
// a report. callback(err, request row | null).
const getApprovedRequestForStudent = (meetingRequestId, studentId, callback) => {
  const query = `
    SELECT * FROM supervisor_student_meeting
    WHERE id = ? AND student_id = ? AND status = 'approved'
    LIMIT 1
  `;
  db.query(query, [meetingRequestId, studentId], (err, results) => {
    if (err) return callback(err);
    callback(null, results[0] || null);
  });
};

const createMeetingReport = (reportData, callback) => {
  const { meeting_request_id, student_id, supervisor_id, group_name, summary } = reportData;
  const query = `
    INSERT INTO meeting_reports
    (meeting_request_id, student_id, supervisor_id, group_name, summary)
    VALUES (?, ?, ?, ?, ?)
  `;
  ensureMeetingReportsTable()
    .then(() => {
      db.query(query, [meeting_request_id, student_id, supervisor_id, group_name, summary], (err, result) => {
        if (err) return callback(err);
        callback(null, { id: result.insertId, ...reportData, status: 'pending' });
      });
    })
    .catch(callback);
};

const getPendingReportsForSupervisor = (supervisorId, callback) => {
  ensureMeetingReportsTable()
    .then(() => {
      db.query(
        `SELECT * FROM meeting_reports WHERE supervisor_id = ? AND status = 'pending' ORDER BY created_at ASC`,
        [supervisorId],
        (err, results) => {
          if (err) return callback(err);
          callback(null, results);
        }
      );
    })
    .catch(callback);
};

const updateReportStatus = (reportId, status, message, callback) => {
  ensureMeetingReportsTable()
    .then(() => {
      db.query(
        `UPDATE meeting_reports SET status = ?, supervisor_message = ? WHERE id = ?`,
        [status, message, reportId],
        (err, result) => {
          if (err) return callback(err);
          callback(null, result);
        }
      );
    })
    .catch(callback);
};

const getReportsForStudent = (studentId, callback) => {
  ensureMeetingReportsTable()
    .then(() => {
      db.query(
        `SELECT * FROM meeting_reports WHERE student_id = ? ORDER BY created_at DESC`,
        [studentId],
        (err, results) => {
          if (err) return callback(err);
          callback(null, results);
        }
      );
    })
    .catch(callback);
};

// Every meeting request + every meeting report tied to a given group name,
// across all its members — powers the supervisor's "View History" panel.
// callback(err, { meetings, reports }).
const getGroupHistory = (groupName, callback) => {
  ensureMeetingReportsTable()
    .then(() => {
      db.query(
        `SELECT m.*, u.name AS student_name, su.name AS supervisor_name
         FROM supervisor_student_meeting m
         LEFT JOIN users u ON u.id = m.student_id
         LEFT JOIN users su ON su.id = m.supervisor_id
         WHERE m.group_name = ? ORDER BY m.created_at DESC`,
        [groupName],
        (meetingsErr, meetings) => {
          if (meetingsErr) return callback(meetingsErr);
          db.query(
            `SELECT r.*, u.name AS student_name, su.name AS supervisor_name
             FROM meeting_reports r
             LEFT JOIN users u ON u.id = r.student_id
             LEFT JOIN users su ON su.id = r.supervisor_id
             WHERE r.group_name = ? ORDER BY r.created_at DESC`,
            [groupName],
            (reportsErr, reports) => {
              if (reportsErr) return callback(reportsErr);
              callback(null, { meetings, reports });
            }
          );
        }
      );
    })
    .catch(callback);
};

module.exports = {
  getApprovedRequestForStudent,
  createMeetingReport,
  getPendingReportsForSupervisor,
  updateReportStatus,
  getReportsForStudent,
  getGroupHistory
};
