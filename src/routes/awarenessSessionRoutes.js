const express = require('express');
const router = express.Router();
const {
  createSession,
  getSessions,
  getCalendarEvents,
  deleteSession
} = require('../controllers/awarenessSessionController');

// 1. Create a new awareness session
router.post('/', createSession);

// 2. Fetch awareness sessions (filter by level / role)
router.get('/', getSessions);

// 3. Fetch calendar formatted events
router.get('/calendar-events', getCalendarEvents);

// 4. Delete session by ID
router.delete('/:id', deleteSession);

module.exports = router;
