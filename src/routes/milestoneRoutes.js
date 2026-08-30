const express = require('express');
const router = express.Router();
const {
  createMilestone,
  getMilestonesByGroup,
  updateMilestoneStatus,
  updateMilestoneDetails,
  getUnseenFeedbackCount,
  markGroupFeedbackSeen,
  deleteMilestone,
  createStudentTask,
  getTasksByMilestone,
  getTasksByStudent,
  getTasksByStudentAndGroup,
  getTasksByGroup,
  updateTaskStatus,
  deleteTask,
  upsertOverview,
  getOverviewByGroup,
  getScopeSectionsByMilestone,
  createScopeSection,
  claimScopeSection,
  updateScopeSection,
  deleteScopeSection
} = require('../controllers/milestoneController');

 
// PROJECT OVERVIEW ROUTES
 
router.post('/overview', upsertOverview);
router.get('/overview/group/:groupId', getOverviewByGroup);

 
// MILESTONE ROUTES
 

// Create a new milestone
router.post('/', createMilestone);

// Get all milestones for a specific group
router.get('/group/:groupId', getMilestonesByGroup);

// Update milestone status (PENDING, REJECTED, APPROVED) and feedback
router.put('/:id/status', updateMilestoneStatus);

// Edit an existing milestone's own details (title/description/dates) — leader-only
router.put('/:id', updateMilestoneDetails);

// Count of unseen supervisor feedback items across all of a student's groups
// (backs the red notification badge in Header.tsx)
router.get('/feedback/unseen-count/:studentId', getUnseenFeedbackCount);

// Mark all of one group's currently-unseen feedback as seen
router.put('/feedback/mark-seen/:groupId', markGroupFeedbackSeen);

// Delete a milestone
router.delete('/:id', deleteMilestone);



// SCOPE DIVISION ROUTES

// List a milestone's scope sections (with claimant name resolved)
router.get('/:milestoneId/scope', getScopeSectionsByMilestone);

// Define a new scope section under a milestone (leader-only)
router.post('/:milestoneId/scope', createScopeSection);

// Claim a still-open scope section — atomic, any group member
router.put('/scope/:id/claim', claimScopeSection);

// Edit a scope section's title/description (leader-only)
router.put('/scope/:id', updateScopeSection);

// Delete a scope section entirely (leader-only)
router.delete('/scope/:id', deleteScopeSection);



// TASK ROUTES
 

// Create a new task within a milestone
router.post('/tasks', createStudentTask);

// Get all tasks for a specific milestone
router.get('/tasks/milestone/:milestoneId', getTasksByMilestone);

// Get all tasks assigned to a specific student (optional ?groupId= query param scopes to one group)
router.get('/tasks/student/:studentId', getTasksByStudent);

// Get tasks for a specific student scoped strictly to one group's project
// Usage: GET /api/milestones/tasks/student/:studentId/group/:groupId
router.get('/tasks/student/:studentId/group/:groupId', getTasksByStudentAndGroup);

// Get all tasks for a specific group
router.get('/tasks/group/:groupId', getTasksByGroup);

// Update task status (TODO, IN_PROGRESS, COMPLETED)
router.put('/tasks/:id/status', updateTaskStatus);

// Delete a task
router.delete('/tasks/:id', deleteTask);

module.exports = router;
