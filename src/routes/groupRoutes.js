const express = require('express');
const router = express.Router();
 
 const {
  getGroupsByLevel,
  getStudentGroup,
  createGroup,
  getCoordinatorApprovedRequests,
  updateGroup,
  deleteGroup,
  getCoordinatorGroups,
} = require('../controllers/groupController');

// Routes for project groups. Base path: /api/groups
// These endpoints are used by the coordinator UI and student dashboards.

// Display groups (friendly listing)
router.get('/display/:level', getGroupsByLevel);

// Get a student's current group status
router.get('/my-status/:studentId', getStudentGroup);

// Get group details for a specific student at a specific level
router.get('/student-group/:studentId/:level', getStudentGroup);

// Admin/management: list groups by level
router.get('/level/:level', getGroupsByLevel);

// Get all coordinator-approved requests
router.get('/coordinator/approved', getCoordinatorApprovedRequests);

// Get groups created by a specific coordinator
router.get('/coordinator/:coordinatorId/:level', getCoordinatorGroups);

// Create a new project group
router.post('/create', createGroup);

// Update group details (PUT is idempotent)
router.put('/:id', updateGroup);
router.put('/update/:id', updateGroup);

// Delete a group
router.delete('/:id', deleteGroup);
router.delete('/delete/:id', deleteGroup);

module.exports = router;
