const express = require('express');
const router = express.Router();
const { createAnnouncement, getAnnouncements, updateAnnouncement, deleteAnnouncement } = require('../controllers/announcementController');

// Announcement endpoints used by the frontend dashboard and admin tools.
// Base path: /api/announcements

// Create a new announcement
// POST /api/announcements
router.post('/', createAnnouncement);

// Fetch announcements with optional filters (role, level, author, etc.)
// GET /api/announcements?role=Student
router.get('/', getAnnouncements);

// Update an announcement by id
// PUT /api/announcements/:id
router.put('/:id', updateAnnouncement);

// Delete an announcement by id
// DELETE /api/announcements/:id
router.delete('/:id', deleteAnnouncement);

module.exports = router;
