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
  uploadTaskFile,
  upsertOverview,
  getOverviewByGroup,
  getScopeSectionsByGroup,
  createScopeSection,
  updateScopeSection,
  deleteScopeSection
} = require('../controllers/milestoneController');
const { upload } = require('../config/cloudinaryConfig');

 
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



// SCOPE DIVISION ROUTES — project-wide (per-group), not per-milestone.
// Any group member creates their own section directly (capped at one per
// student); creating it makes them its owner. No separate claim step —
// there is no claim route any more.

// List a group's (whole-project) scope sections (creator name resolved)
router.get('/group/:groupId/scope', getScopeSectionsByGroup);

// Create a new scope section, owned by the calling student immediately
router.post('/group/:groupId/scope', createScopeSection);

// Edit a scope section's title/description (owner-only, no leader override)
router.put('/scope/:id', updateScopeSection);

// Delete a scope section entirely (owner-only, no leader override)
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

// Attach one optional file to an already-created task (task_id + uploaded_by
// in the multipart body) — same upload.single('file') middleware
// submissionRoutes.js already uses, its own Cloudinary folder
// (CLOUDINARY_TASK_FOLDER, default 'task-attachments').
router.post(
  '/tasks/upload-file',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, error: err.message || 'File upload failed' });
      }
      next();
    });
  },
  uploadTaskFile
);

module.exports = router;
