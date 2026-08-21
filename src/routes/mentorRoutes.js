const express = require('express');
const router = express.Router();
const mentorController = require('../controllers/mentorController');

// ── Mentor Dashboard Components (Used by React Mentor Dashboard) ─────────────
// GET /api/mentor/stats (StatCards.tsx)
router.get('/stats/:mentorId', mentorController.getMentorStats);
router.get('/stats', mentorController.getMentorStats);

// GET /api/mentor/projects (RecentProjects.tsx)
router.get('/projects/:mentorId', mentorController.getMentorProjects);
router.get('/projects', mentorController.getMentorProjects);

// GET /api/mentor/students-attention (StudentAttention.tsx)
router.get('/students-attention/:mentorId', mentorController.getMentorStudentsAttention);
router.get('/students-attention', mentorController.getMentorStudentsAttention);

// GET /api/mentor/notifications (RecentNotification.tsx)
router.get('/notifications/:mentorId', mentorController.getMentorNotifications);
router.get('/notifications', mentorController.getMentorNotifications);

// ── Dashboard & Summary ───────────────────────────────────────────────────────
// GET /api/mentor/dashboard/:mentorId or GET /api/mentor/dashboard?mentorId=...
router.get('/dashboard/:mentorId', mentorController.getMentorDashboard);
router.get('/dashboard', mentorController.getMentorDashboard);
router.get('/summary/:mentorId', mentorController.getMentorDashboard);
router.get('/summary', mentorController.getMentorDashboard);

// ── Specific Nested Routes (Placed BEFORE generic :mentorId routes) ───────────
router.get('/groups/:groupId/tasks', mentorController.getMentorGroupTasks);
router.get('/group/:groupId', mentorController.getMentorGroupDetails);
router.get('/assigned-group/:mentorId/:level', mentorController.getMentorGroups);
router.get('/assigned-group/:mentorId', mentorController.getMentorGroups);
router.get('/assigned/:mentorId', mentorController.getMentorGroups);

// ── Generic Groups Routes ─────────────────────────────────────────────────────
router.get('/groups', mentorController.getMentorGroups);
router.get('/groups/:mentorId', mentorController.getMentorGroups);

// ── Stage Guidelines ──────────────────────────────────────────────────────────
// GET /api/mentor/stages/:level?user_role=mentor
// Blocks Level 1 for mentors (returns 403).
router.get('/stages/:level', mentorController.getMentorStages);

// -- Student Submissions for Mentor Level Pages --
router.get('/submissions/:level', mentorController.getMentorSubmissions);

// -- Calendar Events (Student Tasks, Milestones, Stage Deadlines) --
router.get('/calendar-events', mentorController.getMentorCalendarEvents);

// -- Project Delays (Delayed student tasks past their due date) --
router.get('/project-delays/:mentorId', mentorController.getMentorProjectDelays);
router.get('/project-delays', mentorController.getMentorProjectDelays);

// ── Announcements ─────────────────────────────────────────────────────────────
// GET /api/mentor/announcements
// Returns all announcements scoped to mentor's assigned level and mentor-targeted announcements
router.get('/announcements', mentorController.getMentorAnnouncements);

// POST /api/mentor/announcements
// Post an announcement targeted to mentor's assigned project group students
router.post('/announcements', mentorController.createMentorAnnouncement);

// PUT /api/mentor/announcements/:id
// Edit an announcement authored by this mentor
router.put('/announcements/:id', mentorController.updateMentorAnnouncement);

// DELETE /api/mentor/announcements/:id
// Delete an announcement authored by this mentor
router.delete('/announcements/:id', mentorController.deleteMentorAnnouncement);

// GET /api/mentor/announcements/:id
// Returns a single announcement — blocks if it is Level 1 targeted.
router.get('/announcements/:id', mentorController.getMentorAnnouncementById);

// -- Mentor Task Feedback (Database-backed feedback for student tasks) --
router.put('/tasks/:taskId/feedback', mentorController.saveMentorTaskFeedback);
router.post('/tasks/:taskId/feedback', mentorController.saveMentorTaskFeedback);
router.delete('/tasks/:taskId/feedback', mentorController.clearMentorTaskFeedback);

module.exports = router;
