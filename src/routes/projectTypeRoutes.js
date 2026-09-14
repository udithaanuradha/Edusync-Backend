const express = require('express');
const router = express.Router();
const { getProjectType, setProjectType } = require('../controllers/projectTypeController');

// Get a student's chosen project type (Group / Individual) for one level
router.get('/:studentId/:level', getProjectType);

// Set/update a student's chosen project type for one level
router.put('/', setProjectType);

module.exports = router;
