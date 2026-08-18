const express = require('express');
const router = express.Router();
const { getMentorAssignedGroup, getMentorGroupsByLevel } = require('../controllers/mentorGroupController');

// 1. Group listings by level (Enriched with mentor & full member details)
router.get('/display/:level', getMentorGroupsByLevel);
router.get('/level/:level', getMentorGroupsByLevel);

// 2. Student & Mentor assigned group lookups
router.get('/student-group/:studentId/:level', getMentorAssignedGroup);
router.get('/student-group/:studentId', getMentorAssignedGroup);
router.get('/my-status/:studentId', getMentorAssignedGroup);
router.get('/mentor/:mentorId', getMentorAssignedGroup);
router.get('/mentor/:mentorId/:level', getMentorAssignedGroup);
router.get('/assigned/:mentorId', getMentorAssignedGroup);
router.get('/assigned/:mentorId/:level', getMentorAssignedGroup);

module.exports = router;
