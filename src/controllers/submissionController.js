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

const updateSubmission = async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  const studentId = Number(req.body?.student_id ?? req.body?.studentId);

  if (!submissionId || !studentId) {
    return res.status(400).json({ success: false, message: 'submissionId and student_id are required' });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) {
    return res.status(400).json({ success: false, message: 'At least one file is required' });
  }

  try {
    // Ownership check — only the original uploader may update their own submission
    const [existingRows] = await db.promise().query(
      'SELECT student_id FROM student_submissions WHERE submission_id = ?',
      [submissionId],
    );

    if (!existingRows.length) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    if (Number(existingRows[0].student_id) !== studentId) {
      return res.status(403).json({ success: false, message: 'You can only update your own submission' });
    }

    const uploadFolder = process.env.CLOUDINARY_STUDENT_SUBMISSION_FOLDER || process.env.CLOUDINARY_SUBMISSION_FOLDER || 'student-submissions';
    const fileUrls = [];

    for (const file of files) {
      if (!file?.buffer) {
        return res.status(400).json({ success: false, message: 'Each uploaded file must include file data' });
      }
      const result = await uploadBufferToCloudinary(file.buffer, file.originalname, uploadFolder);
      const fileUrl = result.secure_url || result.url || (result.public_id ? cloudinary.url(result.public_id, { resource_type: 'auto' }) : null);
      if (!fileUrl) {
        throw new Error('Cloudinary upload succeeded but no URL was returned');
      }
      fileUrls.push(fileUrl);
    }

    const submittedAt = new Date().toISOString();
    const status = calculateSubmissionStatus(submittedAt, req.body.deadline || null);
    const filePathsValue = JSON.stringify(fileUrls);

    db.query(
      'UPDATE student_submissions SET file_paths = ?, submitted_at = ?, status = ? WHERE submission_id = ? AND student_id = ?',
      [filePathsValue, submittedAt, status, submissionId, studentId],
      (err, result) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Submission could not be updated', error: err.message });
        }
        if (result.affectedRows === 0) {
          return res.status(404).json({ success: false, message: 'Submission not found' });
        }
        res.json({ success: true, message: 'Submission updated successfully', file_paths: fileUrls });
      },
    );
  } catch (uploadErr) {
    return res.status(500).json({ success: false, message: 'Submission update failed', error: uploadErr?.message || 'Unknown error' });
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

const getGroupSubmissionsForStudent = (req, res) => {
  const studentId = Number(req.params.studentId);
  const level = Number(req.params.level);

  if (!studentId || !level) {
    return res.status(400).json({ success: false, message: 'studentId and level are required' });
  }

  // 1. Resolve the student's group at this level
  const groupSql = `
    SELECT pg.id AS group_id
    FROM project_group_members pgm
    JOIN project_groups pg ON pg.id = pgm.group_id
    WHERE pgm.student_id = ? AND pg.level = ?
    LIMIT 1
  `;

  db.query(groupSql, [studentId, level], (groupErr, groupRows) => {
    if (groupErr) {
      return res.status(500).json({ success: false, message: 'Unable to resolve group', error: groupErr.message });
    }

    if (!groupRows.length) {
      // Not in a group yet at this level — nothing to show
      return res.json({ success: true, data: [], group_id: null });
    }

    const groupId = groupRows[0].group_id;

    // 2. Fetch every submission from every member of that group
    const sql = `
      SELECT ss.submission_id, ss.stage_id, ss.student_id, ss.file_paths, ss.submitted_at, ss.status,
             ps.stage_name, ps.deadline,
             u.name AS student_name
      FROM student_submissions ss
      JOIN project_stages ps ON ps.stage_id = ss.stage_id
      JOIN project_group_members pgm ON pgm.student_id = ss.student_id
      LEFT JOIN users u ON u.id = ss.student_id
      WHERE pgm.group_id = ? AND ps.level = ?
      ORDER BY ss.submitted_at DESC
    `;

    db.query(sql, [groupId, level], (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Unable to fetch group submissions', error: err.message });
      }

      const normalized = (results || []).map((row) => ({
        ...row,
        file_paths: typeof row.file_paths === 'string' ? JSON.parse(row.file_paths) : row.file_paths || [],
      }));

      res.json({ success: true, data: normalized, group_id: groupId });
    });
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

const getCoordinatorSubmissionsByLevel = async (req, res) => {
  const level = Number(req.params.level ?? req.query.level ?? 0);

  if (!level) {
    return res.status(400).json({ success: false, message: 'A valid level is required.' });
  }

  const sql = `
    SELECT
      ss.submission_id,
      ss.stage_id,
      ss.student_id,
      ss.file_paths,
      ss.submitted_at,
      ss.status,
      ps.stage_name,
      ps.deadline,
      ps.level,
      u.name AS student_name,
      u.email AS student_email,
      pg.group_name,
      CASE
        WHEN ss.submitted_at IS NULL THEN 'Pending'
        WHEN ps.deadline IS NULL THEN 'On Time'
        WHEN ss.submitted_at > ps.deadline THEN 'Late'
        ELSE 'On Time'
      END AS computed_status
    FROM student_submissions ss
    LEFT JOIN project_stages ps ON ps.stage_id = ss.stage_id
    LEFT JOIN users u ON u.id = ss.student_id
    LEFT JOIN project_group_members pgm ON pgm.student_id = ss.student_id
    LEFT JOIN project_groups pg ON pg.id = pgm.group_id AND pg.level = ps.level
    WHERE ps.level = ?
    ORDER BY ss.submitted_at DESC
  `;

  db.query(sql, [level], (err, results) => {
    if (err) {
      console.error('Coordinator submissions fetch failed:', err.message);
      return res.status(500).json({ success: false, message: 'Unable to fetch submissions for this level.', error: err.message });
    }

    const seen = new Set();
    const normalized = (results || [])
      .map((row) => {
        let parsedFilePaths = [];

        try {
          parsedFilePaths = Array.isArray(row.file_paths)
            ? row.file_paths
            : typeof row.file_paths === 'string'
              ? JSON.parse(row.file_paths)
              : [];
        } catch {
          parsedFilePaths = [];
        }

        const computedStatus = row.computed_status || row.status || 'On Time';
        const dedupeKey = row.submission_id || `${row.student_id ?? 'student'}-${row.stage_id ?? 'stage'}-${row.submitted_at ?? Date.now()}`;

        if (seen.has(dedupeKey)) {
          return null;
        }

        seen.add(dedupeKey);

        return {
          ...row,
          file_paths: Array.isArray(parsedFilePaths) ? parsedFilePaths : [],
          group_name: row.group_name || `${row.student_name || 'Student'} Submission`,
          evaluator_name: 'Not assigned',
          submitted_at: row.submitted_at,
          status: computedStatus,
          current_status: computedStatus,
        };
      })
      .filter(Boolean);

    return res.json({ success: true, data: normalized });
  });
};

module.exports = {
  createSubmission,
  updateSubmission,
  getStudentSubmissions,
  getGroupSubmissionsForStudent,
  deleteSubmission,
  getCoordinatorSubmissionsByLevel,
};
