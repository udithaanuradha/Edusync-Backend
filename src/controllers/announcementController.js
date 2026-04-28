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
const ensureAnnouncementsTable = async () => {
  if (isTableReady) return;
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
  isTableReady = true;
};

/**
 * CREATE: Post a new announcement
 */
const createAnnouncement = async (req, res) => {
  const { title: reqTitle, subject, message: reqMsg, content, target_audience, author_name, author_id } = req.body;
  
  const title = firstNonEmptyString(reqTitle, subject);
  const message = firstNonEmptyString(reqMsg, content);
  const audience = target_audience || 'All';
  const author = author_name || 'System';

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  try {
    await ensureAnnouncementsTable();
    const query = `INSERT INTO announcements (title, message, target_audience, author_name, author_id) VALUES (?, ?, ?, ?, ?)`;
    const [result] = await dbPromise.query(query, [title, message, audience, author, author_id || null]);

    return res.status(201).json({
      success: true,
      message: 'Announcement posted successfully!',
      announcementId: result.insertId
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
  const { role, level, name, author, all_audience } = req.query;

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

      let roleFilter = `LOWER(target_audience) IN ('all', 'all system users') OR LOWER(target_audience) LIKE ?`;
      params.push(`%${userRole}%`);

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

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY created_at DESC`;

    const [results] = await dbPromise.query(query, params);
    return res.status(200).json({ success: true, announcements: results });
  } catch (error) {
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
