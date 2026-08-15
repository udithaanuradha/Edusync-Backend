const express = require('express');
const router = express.Router();
const {
  getUsersByRole,
  searchStudentForGroup,
  searchSupervisors,
  getStudentsByLevel,
  getLecturersForAssignment,
  assignCoordinator,
  removeCoordinator,
  getUserProfile,
} = require("../controllers/userController");

router.get("/", getUsersByRole);

router.get("/search", searchStudentForGroup);
router.get("/supervisors", searchSupervisors);

router.get("/level/:level", getStudentsByLevel);

// Any authenticated group member can view another member's profile
// (?requesterId= required, checked server-side against shared group membership)
router.get("/:id/profile", getUserProfile);

router.get("/lecturers", getLecturersForAssignment);

router.post("/assign-coordinator", assignCoordinator);

router.post("/remove-coordinator", removeCoordinator);

module.exports = router;
