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
  getSupervisors,
  createGroupRequest,
  finalSubmitRequest,
  getStudentRequestStatus,
} = require('../controllers/groupController');

// If you have authentication middleware, it is highly recommended to include it here
// const authMiddleware = require('../middleware/authMiddleware');

router.get('/supervisors', getSupervisors);
router.post('/request', createGroupRequest);
router.put('/final-submit', finalSubmitRequest);
router.get('/my-requests/:studentId', getStudentRequestStatus);

router.get('/display/:level', getGroupsByLevel);
router.get('/my-status/:studentId', getStudentGroup);

 
router.get('/student-group/:studentId/:level', getStudentGroup);

 
router.get('/:groupId/members', getGroupMembers);

 
router.get('/level/:level', getGroupsByLevel);

 
router.get('/coordinator/approved', getCoordinatorApprovedRequests);

 
router.get('/coordinator/:coordinatorId/:level', getCoordinatorGroups);


router.post('/create', createGroup);

 
router.put('/:id', updateGroup);
router.put('/update/:id', updateGroup);

 
router.delete('/:id', deleteGroup);
router.delete('/delete/:id', deleteGroup);

module.exports = router;
