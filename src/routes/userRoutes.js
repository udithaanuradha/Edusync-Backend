const express = require('express');
const router = express.Router();
const {
  getUsersByRole,
  searchStudentForGroup,
  searchSupervisors,
  getStudentsByLevel,
} = require("../controllers/userController");

// This creates the URL: /api/users/
router.get("/", getUsersByRole);

// This creates the URL: /api/users/search
router.get("/search", searchStudentForGroup);
router.get("/supervisors", searchSupervisors);

// This creates the URL: /api/users/level/:level
router.get("/level/:level", getStudentsByLevel);

module.exports = router;
