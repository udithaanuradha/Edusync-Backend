const express = require('express');
const router = express.Router();
const {
  createMilestone,
  getMilestonesByGroup,
  updateMilestoneStatus,
  deleteMilestone,
  createStudentTask,
  getTasksByMilestone,
  getTasksByStudent,
  updateTaskStatus,
  deleteTask,
  upsertOverview,
  getOverviewByGroup
} = require('../controllers/milestoneController');

// =======================
// PROJECT OVERVIEW ROUTES
// =======================
router.post('/overview', upsertOverview);
router.get('/overview/group/:groupId', getOverviewByGroup);

// =======================
// MILESTONE ROUTES
// =======================

// Create a new milestone
router.post('/', createMilestone);

// Get all milestones for a specific group
router.get('/group/:groupId', getMilestonesByGroup);

// Update milestone status (PENDING, REJECTED, APPROVED) and feedback
router.put('/:id/status', updateMilestoneStatus);

// Delete a milestone
router.delete('/:id', deleteMilestone);

// =======================
// TASK ROUTES
// =======================

// Create a new task within a milestone
router.post('/tasks', createStudentTask);

// Get all tasks for a specific milestone
router.get('/tasks/milestone/:milestoneId', getTasksByMilestone);

// Get all tasks assigned to a specific student
router.get('/tasks/student/:studentId', getTasksByStudent);

// Update task status (TODO, IN_PROGRESS, COMPLETED)
router.put('/tasks/:id/status', updateTaskStatus);

// Delete a task
router.delete('/tasks/:id', deleteTask);

module.exports = router;
