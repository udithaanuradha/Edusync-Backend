const TaskModel = require("../models/supervisorTaskModel");

const getTasks = (req, res) => {
  const { supervisorId } = req.params;
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res
      .status(400)
      .json({ error: "startDate and endDate are required" });
  }

  TaskModel.getTasksByDateRange(
    supervisorId,
    startDate,
    endDate,
    (err, tasks) => {
      if (err) {
        console.error("Error fetching tasks:", err);
        return res.status(500).json({ error: "Failed to fetch tasks" });
      }
      res.status(200).json(tasks);
    },
  );
};

const addTask = (req, res) => {
  const taskData = { ...req.body, supervisor_id: req.params.supervisorId };
  TaskModel.createTask(taskData, (err, newTask) => {
    if (err) return res.status(500).json({ error: "Failed to create task" });
    res.status(201).json(newTask);
  });
};

const editTask = (req, res) => {
  const { taskId } = req.params;
  TaskModel.updateTask(taskId, req.body, (err) => {
    if (err) return res.status(500).json({ error: "Failed to update task" });
    res.status(200).json({ success: true });
  });
};

const removeTask = (req, res) => {
  const { taskId } = req.params;
  TaskModel.deleteTask(taskId, (err) => {
    if (err) return res.status(500).json({ error: "Failed to delete task" });
    res.status(200).json({ success: true });
  });
};

module.exports = { getTasks, addTask, editTask, removeTask };
