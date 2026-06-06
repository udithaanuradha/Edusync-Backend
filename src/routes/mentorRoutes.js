const express = require('express');
const router = express.Router();
const mentorController = require('../controllers/mentorController');

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