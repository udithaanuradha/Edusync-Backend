const db = require('../config/db');
const { cloudinary, uploadBufferToCloudinary } = require('../config/cloudinaryConfig');
const { calculateSubmissionStatus } = require('../utils/submissionUtils');

const createSubmission = async (req, res) => {
  console.log('submission body:', req.body);
  console.log('submission headers:', req.headers['content-type']);
  console.log('submission files:', req.files?.length || 0);
  console.log('submission env folder:', process.env.CLOUDINARY_STUDENT_SUBMISSION_FOLDER || process.env.CLOUDINARY_SUBMISSION_FOLDER);

  const stageId = Number(req.body?.stage_id ?? req.body?.stageId);
  const studentId = Number(req.body?.student_id ?? req.body?.studentId);

  if (!stageId || !studentId) {
    return res.status(400).json({ success: false, message: 'stage_id and student_id are required' });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) {
    return res.status(400).json({ success: false, message: 'At least one file is required' });
  }

  try {
    const uploadFolder = process.env.CLOUDINARY_STUDENT_SUBMISSION_FOLDER || process.env.CLOUDINARY_SUBMISSION_FOLDER || 'student-submissions';
    console.log('submission upload folder:', uploadFolder);
    console.log('submission file names:', files.map((file) => file.originalname));
    const fileUrls = [];

    for (const file of files) {
      if (!file?.buffer) {
        return res.status(400).json({ success: false, message: 'Each uploaded file must include file data' });
      }

      const result = await uploadBufferToCloudinary(file.buffer, file.originalname, uploadFolder);
      console.log('Cloudinary file upload result:', result);
      const fileUrl = result.secure_url || result.url || (result.public_id ? cloudinary.url(result.public_id, { resource_type: 'auto' }) : null);
      if (!fileUrl) {
        throw new Error('Cloudinary upload succeeded but no URL was returned');
      }
      fileUrls.push(fileUrl);
    }

    if (fileUrls.length === 0) {
      return res.status(500).json({ success: false, message: 'No valid file URLs were generated from uploads' });
    }

    const submittedAt = new Date().toISOString();
    const status = calculateSubmissionStatus(submittedAt, req.body.deadline || null);
    const filePathsValue = JSON.stringify(fileUrls);

    const sql = `
      INSERT INTO student_submissions (stage_id, student_id, file_paths, submitted_at, status)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sql, [stageId, studentId, filePathsValue, submittedAt, status], (err, result) => {
      if (err) {
        console.error('Submission insert failed:', err.message);
        if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
          return res.status(400).json({ success: false, message: 'The selected stage does not exist yet. Please choose a valid stage created by the coordinator.' });
        }
        return res.status(500).json({ success: false, message: 'Submission could not be saved', error: err.message });
      }

      res.status(201).json({ success: true, message: 'Submission uploaded successfully', submission_id: result.insertId, file_urls: fileUrls, file_paths: fileUrls });
    });
  } catch (uploadErr) {
    console.error('Cloudinary submission upload failed:', uploadErr);
    const normalizedMessage = uploadErr?.message?.includes('Invalid api_key')
      ? 'Cloudinary authentication failed. Check CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in your environment.'
      : uploadErr?.message || 'Submission upload failed';
    return res.status(500).json({ success: false, message: 'Submission upload failed', error: normalizedMessage });
  }
};

const getStudentSubmissions = (req, res) => {
  const { studentId } = req.params;
  const sql = `
    SELECT ss.*, ps.stage_name, ps.deadline
    FROM student_submissions ss
    LEFT JOIN project_stages ps ON ps.stage_id = ss.stage_id
    WHERE ss.student_id = ?
    ORDER BY ss.submitted_at DESC
  `;

  db.query(sql, [studentId], (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Unable to fetch submissions', error: err.message });
    }

    const normalized = (results || []).map((row) => ({
      ...row,
      file_paths: typeof row.file_paths === 'string' ? JSON.parse(row.file_paths) : row.file_paths || [],
    }));

    res.json({ success: true, data: normalized });
  });
};

const deleteSubmission = (req, res) => {
  const { submissionId } = req.params;
  const studentId = Number(req.query.studentId ?? req.body?.student_id ?? req.body?.studentId);

  if (!submissionId) {
    return res.status(400).json({ success: false, message: 'submissionId is required' });
  }

  const sql = studentId
    ? 'DELETE FROM student_submissions WHERE submission_id = ? AND student_id = ?'
    : 'DELETE FROM student_submissions WHERE submission_id = ?';

  const values = studentId ? [submissionId, studentId] : [submissionId];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('Delete submission failed:', err.message);
      return res.status(500).json({ success: false, message: 'Unable to delete submission', error: err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    res.json({ success: true, message: 'Submission deleted successfully' });
  });
};

module.exports = { createSubmission, getStudentSubmissions, deleteSubmission };
