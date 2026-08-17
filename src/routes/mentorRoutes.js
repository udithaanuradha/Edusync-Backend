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

// ── Assigned Groups ──────────────────────────────────────────────────────────
// GET /api/mentor/groups/:mentorId or GET /api/mentor/groups?mentorId=...
router.get('/groups/:mentorId', mentorController.getMentorGroups);
router.get('/groups', mentorController.getMentorGroups);
router.get('/group/:groupId', mentorController.getMentorGroupDetails);

// ── Stage Guidelines ──────────────────────────────────────────────────────────
// GET /api/mentor/stages/:level?user_role=mentor
// Blocks Level 1 for mentors (returns 403).
router.get('/stages/:level', mentorController.getMentorStages);

// ── Announcements ─────────────────────────────────────────────────────────────
// GET /api/mentor/announcements
// Returns all announcements EXCEPT Level 1 targeted ones.
router.get('/announcements', mentorController.getMentorAnnouncements);

// GET /api/mentor/announcements/:id
// Returns a single announcement — blocks if it is Level 1 targeted.
router.get('/announcements/:id', mentorController.getMentorAnnouncementById);

module.exports = router;