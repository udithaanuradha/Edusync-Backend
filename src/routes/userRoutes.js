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
  updateUserProfile,
  changeUserPassword,
  verifyUser,
  verifyAllUsers,
} = require("../controllers/userController");

router.get("/", getUsersByRole);
router.get("/search", searchStudentForGroup);
router.get("/supervisors", searchSupervisors);
router.get("/level/:level", getStudentsByLevel);
router.get("/lecturers", getLecturersForAssignment);

// Verification routes
router.put("/verify-all", verifyAllUsers);
router.put("/:id/verify", verifyUser);

// Any authenticated group member can view another member's profile
router.get("/:id/profile", getUserProfile);

router.post("/assign-coordinator", assignCoordinator);
router.post("/remove-coordinator", removeCoordinator);

router.put("/profile/update", updateUserProfile);
router.put("/change-password", changeUserPassword);

module.exports = router;
