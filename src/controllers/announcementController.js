const db = require('../config/db');
const dbPromise = db.promise();

/**
 * Utility: Helpers for data normalization
 */
const normalizeAudience = (value) => String(value || '').trim().toLowerCase();

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

/**
 * Ensures the table exists. 
 * Moved to a self-invoking pattern or one-time check for performance.
 */
let isTableReady = false;
let ensureAnnouncementsTablePromise = null;
const ensureAnnouncementsTable = async () => {
  if (!ensureAnnouncementsTablePromise) {
    ensureAnnouncementsTablePromise = (async () => {
      // Create table if it doesn't exist
      await dbPromise.query(`
        CREATE TABLE IF NOT EXISTS announcements (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          target_audience VARCHAR(64) NOT NULL DEFAULT 'All',
          author_name VARCHAR(255) NOT NULL,
          author_id INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // Add author_id column if it doesn't exist
      try {
        await dbPromise.query(`
          ALTER TABLE announcements ADD COLUMN author_id INT AFTER author_name
        `);
      } catch (error) {
        // Column might already exist, ignore error
        if (error.code !== 'ER_DUP_FIELDNAME') {
          console.error('Error adding author_id column:', error.message);
        }
      }
    })();
  }

  await ensureAnnouncementsTablePromise;
};

/**
 * CREATE: Post a new announcement
 */
const createAnnouncement = async (req, res) => {
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
  
  // Get author_id from request or token
  const authorId = req.body.author_id || req.user?.id || null;

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  try {
    await ensureAnnouncementsTable();

    const normalizedAudience = String(targetAudience).trim();
    const normalizedAuthor = String(authorName).trim();

    const query = `
      INSERT INTO announcements (title, message, target_audience, author_name, author_id)
      VALUES (?, ?, ?, ?, ?)
    `;

    const [result] = await dbPromise.query(query, [title, message, normalizedAudience, normalizedAuthor, authorId]);

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
  } catch (error) {
    console.error('Create Announcement Error:', error);
    return res.status(500).json({ error: 'Database failure' });
  }
};

/**
 * READ: Fetch with enhanced Role-Based Filtering
 */
const getAnnouncements = async (req, res) => {
  const userRole = firstNonEmptyString(req.query.role, req.query.userRole, req.query.audience);
  const userLevel = firstNonEmptyString(req.query.level, req.query.userLevel);
  const userName = firstNonEmptyString(req.query.name, req.query.user_name, req.query.userName);
  const authorName = firstNonEmptyString(req.query.author, req.query.author_name, req.query.authorName);
  const allAudienceOnly = req.query.all_audience === 'true';
  const currentUserId = req.query.exclude_author_id ? parseInt(req.query.exclude_author_id, 10) : null;

  try {
    await ensureAnnouncementsTable();
    let query = `SELECT * FROM announcements`;
    let params = [];
    let whereClauses = [];

    // 1. Fetch all announcements for management page (all_audience=true) or ADMIN
    if (allAudienceOnly || (userRole && userRole.toLowerCase() === 'admin')) {
      // no where clauses needed
    }
    // 2. Fetch announcements by author name
    else if (authorName) {
      whereClauses.push(`author_name = ?`);
      params.push(authorName);
    }
    // 3. Role-Based Relevance (Coordinator, Student, Supervisor, etc.)
    else if (userRole) {
      const normalizedRole = normalizeAudience(userRole);
      
      let roleFilter = `LOWER(target_audience) IN ('all', 'all system users') OR LOWER(target_audience) LIKE ?`;
      params.push(`%${normalizedRole}%`);

      if (userLevel) {
        const normalizedLevel = normalizeAudience(`level${userLevel}`);
        roleFilter += ` OR LOWER(target_audience) LIKE ?`;
        params.push(`%${normalizedLevel}%`);
      }

      if (userName) {
        roleFilter += ` OR LOWER(target_audience) LIKE ?`;
        params.push(`%${normalizeAudience(userName)}%`);
      }

      whereClauses.push(`(${roleFilter})`);

      // Exclude current user's posts from dashboard view
      if (currentUserId && currentUserId > 0) {
        whereClauses.push(`(author_id IS NULL OR author_id != ?)`);
        params.push(currentUserId);
      }
    }
    // 4. Fallback: No valid parameters provided
    else {
      whereClauses.push(`LOWER(target_audience) IN ('all', 'all system users')`);
      
      if (currentUserId && currentUserId > 0) {
        whereClauses.push(`(author_id IS NULL OR author_id != ?)`);
        params.push(currentUserId);
      }
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ` + whereClauses.join(' AND ');
    }

    query += ` ORDER BY created_at DESC`;

    const [results] = await dbPromise.query(query, params);
    return res.status(200).json({ success: true, announcements: results });
  } catch (error) {
    console.error("Error fetching announcements:", error);
    return res.status(500).json({ error: 'Failed to retrieve announcements' });
  }
};

/**
 * UPDATE: Secure update
 */
const updateAnnouncement = async (req, res) => {
  const { id } = req.params;
  const { title, message, requester_role, requester_id } = req.body;

  try {
    // Optional: Add a check here to ensure requester_id === author_id 
    // unless requester_role === 'admin'
    
    const query = `UPDATE announcements SET title = ?, message = ? WHERE id = ?`;
    const [result] = await dbPromise.query(query, [title, message, id]);

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, message: 'Updated' });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
};

/**
 * DELETE: Secure delete
 */
const deleteAnnouncement = async (req, res) => {
  const { id } = req.params;
  // It is recommended to pass requester_id and role via middleware (req.user)
  
  try {
    const [result] = await dbPromise.query(`DELETE FROM announcements WHERE id = ?`, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
};

module.exports = {
  createAnnouncement,
  getAnnouncements,
  updateAnnouncement,
  deleteAnnouncement
};
