const db = require('../config/db');

let ensureAnnouncementsTablePromise = null;

const normalizeAudience = (value) => String(value || '').trim().toLowerCase();

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

/**
 * CREATE: Post a new announcement
 */
const createAnnouncement = (req, res) => {
  const title = firstNonEmptyString(req.body.title, req.body.subject);
  const message = firstNonEmptyString(req.body.message, req.body.content, req.body.description);
  const targetAudience = firstNonEmptyString(
    req.body.target_audience,
    req.body.targetAudience,
    req.body.audience,
    req.body.target
  ) || 'All';
  const authorName = firstNonEmptyString(
    req.body.author_name,
    req.body.authorName,
    req.body.author,
    req.body.posted_by,
    req.body.postedBy
  ) || 'System';
  
  const authorId = req.body.author_id || req.user?.id || null;

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      target_audience VARCHAR(64) NOT NULL DEFAULT 'All',
      author_name VARCHAR(255) NOT NULL,
      author_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.query(createTableQuery, (err) => {
    if (err && err.code !== 'ER_TABLE_EXISTS_ERROR') {
      console.error('Table creation error:', err);
      return res.status(500).json({ error: 'Database setup failed' });
    }

    const normalizedAudience = String(targetAudience).trim();
    const normalizedAuthor = String(authorName).trim();

    const insertQuery = `
      INSERT INTO announcements (title, message, target_audience, author_name, author_id)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(insertQuery, [title, message, normalizedAudience, normalizedAuthor, authorId], (err, result) => {
      if (err) {
        console.error('Insert error:', err);
        return res.status(500).json({ error: 'Database failure' });
      }

      return res.status(201).json({
        success: true,
        message: 'Announcement posted successfully!',
        announcement: {
          id: result.insertId,
          title,
          message,
          target_audience: normalizedAudience,
          author_name: normalizedAuthor,
          author_id: authorId
        }
      });
    });
  });
};

/**
 * READ: Fetch with enhanced Role-Based Filtering
 */
const getAnnouncements = (req, res) => {
  const userRole = firstNonEmptyString(req.query.role, req.query.userRole, req.query.audience);
  const userLevel = firstNonEmptyString(req.query.level, req.query.userLevel);
  const authorName = firstNonEmptyString(req.query.author, req.query.author_name, req.query.authorName);
  const allAudienceOnly = req.query.all_audience === 'true';
  const currentUserId = req.query.exclude_author_id ? parseInt(req.query.exclude_author_id, 10) : null;

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      target_audience VARCHAR(64) NOT NULL DEFAULT 'All',
      author_name VARCHAR(255) NOT NULL,
      author_id INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.query(createTableQuery, (tableErr) => {
    if (tableErr && tableErr.code !== 'ER_TABLE_EXISTS_ERROR') {
      console.error('[getAnnouncements] Table creation error:', tableErr);
      return res.status(500).json({ error: 'Database setup failed' });
    }

    let query = `SELECT * FROM announcements`;
    let params = [];

    // 1. Fetch all announcements for management page (all_audience=true)
    if (allAudienceOnly) {
      query = `SELECT * FROM announcements ORDER BY created_at DESC`;
    }
    // 2. Fetch announcements by author name
    else if (authorName) {
      query = `SELECT * FROM announcements WHERE author_name = ? ORDER BY created_at DESC`;
      params.push(authorName);
    }
    // 3. SUPER ADMIN: Sees absolutely every announcement
    else if (userRole && userRole.toLowerCase() === 'admin') {
      query = `SELECT * FROM announcements ORDER BY created_at DESC`;
    }
    // 4. COORDINATOR: Uses "Rule of Relevance"
    else if (userRole && userRole.toLowerCase() === 'coordinator') {
      query = `SELECT * FROM announcements WHERE (LOWER(target_audience) IN ('all', 'all system users') OR LOWER(target_audience) LIKE ?) ORDER BY created_at DESC`;
      params.push('%coordinator%');
    }
    // 5. EVERYONE ELSE (Students, Supervisors, Mentors, etc.)
    else if (userRole) {
      const normalizedRole = normalizeAudience(userRole);
      query = `SELECT * FROM announcements WHERE (LOWER(target_audience) IN ('all', 'all system users') OR LOWER(target_audience) LIKE ?`;
      params.push(`%${normalizedRole}%`);

      if (userLevel) {
        query += ` OR LOWER(target_audience) LIKE ?`;
        params.push(`%level${userLevel}%`);
      }
      
      query += `) ORDER BY created_at DESC`;
    }
    // 6. Fallback: No valid parameters provided
    else {
      query = `SELECT * FROM announcements WHERE LOWER(target_audience) IN ('all', 'all system users') ORDER BY created_at DESC`;
    }

    // Exclude current user's own posts from dashboard view
    if (currentUserId && currentUserId > 0 && !allAudienceOnly && !authorName) {
      query = query.replace(' ORDER BY created_at DESC', ` AND (author_id IS NULL OR author_id != ?) ORDER BY created_at DESC`);
      params.push(currentUserId);
    }

    console.log('[getAnnouncements] Query:', query, 'Params:', params);

    db.query(query, params, (err, results) => {
      if (err) {
        console.error('[getAnnouncements] Query error:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve announcements', details: err.message });
      }

      console.log('[getAnnouncements] Success, found', results.length, 'announcements');
      return res.status(200).json({ success: true, announcements: results || [] });
    });
  });
};

/**
 * UPDATE: Secure update
 */
const updateAnnouncement = (req, res) => {
  const { id } = req.params;
  const { title, message } = req.body;

  const query = `UPDATE announcements SET title = ?, message = ? WHERE id = ?`;
  
  db.query(query, [title, message, id], (err, result) => {
    if (err) {
      console.error('Update error:', err);
      return res.status(500).json({ error: 'Update failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({ success: true, message: 'Updated' });
  });
};

/**
 * DELETE: Secure delete
 */
const deleteAnnouncement = (req, res) => {
  const { id } = req.params;

  db.query(`DELETE FROM announcements WHERE id = ?`, [id], (err, result) => {
    if (err) {
      console.error('Delete error:', err);
      return res.status(500).json({ error: 'Delete failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({ success: true, message: 'Deleted' });
  });
};

module.exports = { createAnnouncement, getAnnouncements, updateAnnouncement, deleteAnnouncement };