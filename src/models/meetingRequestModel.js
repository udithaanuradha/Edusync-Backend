const db = require('../config/db');

const createMeetingRequest = (requestData, callback) => {
  const { student_id, supervisor_id, group_name, topic, preferred_date, preferred_time, reason } = requestData;
  const query = `
    INSERT INTO supervisor_student_meeting 
    (student_id, supervisor_id, group_name, topic, preferred_date, preferred_time, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  db.query(
    query,
    [student_id, supervisor_id, group_name, topic, preferred_date, preferred_time, reason],
    (err, result) => {
      if (err) return callback(err);
      callback(null, { id: result.insertId, ...requestData, status: 'pending' });
    }
  );
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

const updateRequestStatus = (requestId, status, callback) => {
  const query = `
    UPDATE supervisor_student_meeting 
    SET status = ? 
    WHERE id = ?
  `;
  db.query(query, [status, requestId], (err, result) => {
    if (err) return callback(err);
    callback(null, result);
  });
};

module.exports = {
  createMeetingRequest,
  getPendingRequestsForSupervisor,
  updateRequestStatus
};
