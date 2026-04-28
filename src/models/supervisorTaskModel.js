const db = require("../config/db");

const getTasksByDateRange = (supervisorId, startDate, endDate, callback) => {
  const query = `
    SELECT * FROM supervisor_tasks 
    WHERE supervisor_id = ? AND task_date BETWEEN ? AND ?
    ORDER BY task_date ASC, start_time ASC
  `;
  db.query(query, [supervisorId, startDate, endDate], (err, results) => {
    if (err) return callback(err);
    callback(null, results);
  });
};

const createTask = (taskData, callback) => {
  const {
    supervisor_id,
    task_date,
    start_time,
    end_time,
    category,
    description,
  } = taskData;
  const query = `
    INSERT INTO supervisor_tasks (supervisor_id, task_date, start_time, end_time, category, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  db.query(
    query,
    [supervisor_id, task_date, start_time, end_time, category, description],
    (err, result) => {
      if (err) return callback(err);
      callback(null, { id: result.insertId, ...taskData });
    },
  );
};

const updateTask = (taskId, taskData, callback) => {
  const { task_date, start_time, end_time, category, description } = taskData;
  const query = `
    UPDATE supervisor_tasks 
    SET task_date = ?, start_time = ?, end_time = ?, category = ?, description = ?
    WHERE id = ?
  `;
  db.query(
    query,
    [task_date, start_time, end_time, category, description, taskId],
    (err, result) => {
      if (err) return callback(err);
      callback(null, result);
    },
  );
};

const deleteTask = (taskId, callback) => {
  const query = "DELETE FROM supervisor_tasks WHERE id = ?";
  db.query(query, [taskId], (err, result) => {
    if (err) return callback(err);
    callback(null, result);
  });
};

module.exports = { getTasksByDateRange, createTask, updateTask, deleteTask };
