const express = require('express');
const router = express.Router();
const { createSubmission, getStudentSubmissions, deleteSubmission } = require('../controllers/submissionController');
const { upload } = require('../config/cloudinaryConfig');

router.post(
  '/',
  (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
      }
      next();
    });
  },
  createSubmission,
);
router.get('/student/:studentId', getStudentSubmissions);
router.delete('/:submissionId', deleteSubmission);

module.exports = router;
