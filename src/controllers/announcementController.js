const db = require('../config/db');
const dbPromise = db.promise();

let ensureAnnouncementsTablePromise = null;

const normalizeAudience = (value) => String(value || '').trim().toLowerCase();

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

/**
 * Ensures the table exists. 
 * Moved to a self-invoking pattern or one-time check for performance.
 */
let isTableReady = false;
const ensureAnnouncementsTable = async () => {
  if (!ensureAnnouncementsTablePromise) {
    ensureAnnouncementsTablePromise = (async () => {
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
      try {
        await dbPromise.query(`ALTER TABLE announcements ADD COLUMN author_id INT AFTER author_name`);
      } catch (error) { /* already exists */ }
    })();
  }
  return ensureAnnouncementsTablePromise;
};

// CREATE
const createAnnouncement = async (req, res) => {
  const title = firstNonEmptyString(req.body.title, req.body.subject);
  const message = firstNonEmptyString(req.body.message, req.body.content);
  const targetAudience = firstNonEmptyString(req.body.target_audience, req.body.targetAudience) || 'All';
  const authorName = firstNonEmptyString(req.body.author_name, req.body.author) || 'System';
  const authorId = req.body.author_id || req.user?.id || null;

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  try {
    await ensureAnnouncementsTable();
    const [result] = await dbPromise.query(
      `INSERT INTO announcements (title, message, target_audience, author_name, author_id) VALUES (?, ?, ?, ?, ?)`,
      [title, message, targetAudience, authorName, authorId]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    console.error('Create Error:', error);
    res.status(500).json({ error: 'Database failure' });
  }
};

// READ
const getAnnouncements = async (req, res) => {
  const userRole = firstNonEmptyString(req.query.role, req.query.userRole);
  const userLevel = firstNonEmptyString(req.query.level, req.query.userLevel);
  const allAudienceOnly = req.query.all_audience === 'true';
  const currentUserId = req.query.exclude_author_id ? parseInt(req.query.exclude_author_id, 10) : null;

  try {
    await ensureAnnouncementsTable();
    let query = `SELECT * FROM announcements`;
    let params = [];
    let conditions = [];

    // 1. Management/Admin View
    if (all_audience === 'true' || (role && role.toLowerCase() === 'admin')) {
      // No extra conditions, fetch all
    } 
    // 2. Author Specific
    else if (author) {
      conditions.push(`author_name = ?`);
      params.push(author);
    }
    // 3. Role-Based Relevance
    else if (role) {
      const userRole = normalizeAudience(role);
      const userLevel = level ? normalizeAudience(`Level${level}`) : null;

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
    // Sees: Global posts + Coordinator-targeted posts (but NOT their own posts on dashboard)
    else if (userRole && userRole.toLowerCase() === 'coordinator') {
      query = `
        SELECT * FROM announcements 
        WHERE (LOWER(target_audience) IN ('all', 'all system users') 
           OR LOWER(target_audience) LIKE ?)
      `;
      params.push('%coordinator%');
      
      // Exclude current user's posts from dashboard view
      if (currentUserId && currentUserId > 0) {
        query += ` AND (author_id IS NULL OR author_id != ?)`;
        params.push(currentUserId);
      }
      
      query += ` ORDER BY created_at DESC`;
    }
    // 5. EVERYONE ELSE (Students, Supervisors, Mentors, etc.)
    // Sees: Global posts + posts targeted to their role/level (but NOT their own posts on dashboard)
    else if (userRole) {
      const normalizedRole = normalizeAudience(userRole);
      const normalizedLevelAudience = userLevel ? normalizeAudience(`Level${userLevel}`) : '';

      if (userLevel) {
        roleFilter += ` OR LOWER(target_audience) LIKE ?`;
        params.push(`%${userLevel}%`);
      }
      
      // Coordinators also see posts they authored even if not targeted to them
      if (userRole === 'coordinator' && name) {
        roleFilter += ` OR author_name = ?`;
        params.push(name);
      }

      conditions.push(`(${roleFilter})`);
    }

      // Exclude current user's posts from dashboard view
      if (currentUserId && currentUserId > 0) {
        query += ` AND (author_id IS NULL OR author_id != ?)`;
        params.push(currentUserId);
      }
      
      query += ' ORDER BY created_at DESC';
    }
    // 6. Fallback: No valid parameters provided
    else {
      query = `SELECT * FROM announcements WHERE LOWER(target_audience) IN ('all', 'all system users')`;
      
      // Exclude current user's posts from dashboard view
      if (currentUserId && currentUserId > 0) {
        query += ` AND (author_id IS NULL OR author_id != ?)`;
        params.push(currentUserId);
      }
      
      query += ` ORDER BY created_at DESC`;
    }

    query += ` ORDER BY created_at DESC`;

    const [results] = await dbPromise.query(query, params);
    res.status(200).json({ success: true, announcements: results });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve announcements' });
  }
};

// UPDATE
const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, message } = req.body;
    await dbPromise.query(`UPDATE announcements SET title = ?, message = ? WHERE id = ?`, [title, message, id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Update failed' }); }
};

// DELETE — only allow if author_id matches
const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const { author_id } = req.body;

    // First check who owns this announcement
    const [rows] = await dbPromise.query(
      `SELECT author_id FROM announcements WHERE id = ?`, [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    // If author_id is provided, verify ownership
    if (author_id && rows[0].author_id !== null && rows[0].author_id !== parseInt(author_id)) {
      return res.status(403).json({ error: 'You can only delete your own announcements' });
    }

    await dbPromise.query(`DELETE FROM announcements WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('Delete Error:', e);
    res.status(500).json({ error: 'Delete failed' });
  }
};

module.exports = { createAnnouncement, getAnnouncements, updateAnnouncement, deleteAnnouncement };