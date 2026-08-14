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
  approveGroupRequest,
  rejectGroupRequest,
  finalSubmitRequest,
  getStudentRequestStatus,
  getPendingRequestsForSupervisor,
  approveRequestBySupervisor,
  rejectRequestBySupervisor,
} = require('../controllers/groupController');

// Routes for project groups. Base path: /api/groups
// These endpoints are used by the coordinator UI and student dashboards.

// Display groups (friendly listing)
router.get('/display/:level', getGroupsByLevel);

// Get a student's current group status
router.get('/my-status/:studentId', getStudentGroup);

// Get group details for a specific student at a specific level
router.get('/student-group/:studentId/:level', getStudentGroup);

// List every user who can act as a supervisor for a group request
// (was imported into this file but never actually mounted — GroupRequest.tsx
// has been calling this exact path all along, so it 404'd and the
// "Loading supervisors..." UI never resolved)
router.get('/supervisors', getSupervisors);

// Get members for a specific group (used by Project Management page)
router.get('/:groupId/members', getGroupMembers);

// Admin/management: list groups by level
router.get('/level/:level', getGroupsByLevel);

// Get all coordinator-approved requests
router.get('/coordinator/approved', getCoordinatorApprovedRequests);

// Get groups created by a specific coordinator
router.get('/coordinator/:coordinatorId/:level', getCoordinatorGroups);

// Create a new group request (student submits to supervisor)
router.post('/request', createGroupRequest);

// Supervisor actions: approve or reject a request (legacy, param-based,
// single-supervisor — kept for backward compatibility, not called by the
// current frontend, which uses the body-based routes below instead)
router.put('/request/:requestId/approve', approveGroupRequest);
router.put('/request/:requestId/reject', rejectGroupRequest);

// Supervisor actions on a multi-supervisor request: body = { request_id, supervisor_id/approved_by|rejected_by, rejection_reason/reason/reject_reason }
router.put('/approve', approveRequestBySupervisor);
router.put('/reject', rejectRequestBySupervisor);

// Pending requests targeted at a specific supervisor
router.get('/pending/:supervisorId', getPendingRequestsForSupervisor);

// Finalize request and submit to coordinator (student action after supervisor approval)
router.put('/final-submit', finalSubmitRequest);

// Get requests where the student is leader or member
router.get('/my-requests/:studentId', getStudentRequestStatus);

// Create a new project group
router.post('/create', createGroup);

// Update group details (PUT is idempotent)
router.put('/:id', updateGroup);
router.put('/update/:id', updateGroup);

// Delete a group
router.delete('/:id', deleteGroup);
router.delete('/delete/:id', deleteGroup);

module.exports = router;
