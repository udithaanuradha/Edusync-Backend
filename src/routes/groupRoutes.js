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
  getGroupMembers,
} = require('../controllers/groupController');

// If you have authentication middleware, it is highly recommended to include it here
// const authMiddleware = require('../middleware/authMiddleware');

router.get('/display/:level', getGroupsByLevel);
router.get('/my-status/:studentId', getStudentGroup);

/**
 * @route   GET /api/groups/student-group/:studentId/:level
 * @desc    Get group details for a specific student at a specific level
 */
router.get('/student-group/:studentId/:level', getStudentGroup);

/**
 * @route   GET /api/groups/:groupId/members
 * @desc    Get members of a group
 */
router.get('/:groupId/members', getGroupMembers);

/**
 * @route   GET /api/groups/level/:level
 * @desc    Get groups by level (General Management)
 */
router.get('/level/:level', getGroupsByLevel);

/**
 * @route   GET /api/groups/coordinator/approved
 * @desc    Get all requests approved by the coordinator
 */
router.get('/coordinator/approved', getCoordinatorApprovedRequests);

/**
 * @route   GET /api/groups/coordinator/:coordinatorId/:level
 * @desc    Get groups created by a specific coordinator at a specific level
 */
router.get('/coordinator/:coordinatorId/:level', getCoordinatorGroups);

/**
 * @route   POST /api/groups/create
 * @desc    Create a new project group
 */
router.post('/create', createGroup);

/**
 * @route   PUT /api/groups/:id OR /api/groups/update/:id
 * @desc    Update group details
 */
router.put('/:id', updateGroup);
router.put('/update/:id', updateGroup);

/**
 * @route   DELETE /api/groups/:id OR /api/groups/delete/:id
 * @desc    Remove a group and its members
 */
router.delete('/:id', deleteGroup);
router.delete('/delete/:id', deleteGroup);

module.exports = router;
