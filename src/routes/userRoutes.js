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
} = require("../controllers/userController");

router.get("/", getUsersByRole);

router.get("/search", searchStudentForGroup);
router.get("/supervisors", searchSupervisors);

router.get("/level/:level", getStudentsByLevel);

router.get("/lecturers", getLecturersForAssignment);

router.post("/assign-coordinator", assignCoordinator);

router.post("/remove-coordinator", removeCoordinator);

module.exports = router;
