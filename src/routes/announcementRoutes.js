const express = require('express');
const router = express.Router();
const { createAnnouncement, getAnnouncements, updateAnnouncement, deleteAnnouncement } = require('../controllers/announcementController');

// POST /api/announcements
router.post('/', createAnnouncement);

// GET /api/announcements?role=Student
router.get('/', getAnnouncements);

// PUT /api/announcements/:id
router.put('/:id', updateAnnouncement);

// DELETE /api/announcements/:id
router.delete('/:id', deleteAnnouncement);

module.exports = router;
