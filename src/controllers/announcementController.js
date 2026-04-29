const db = require('../config/db');

const dbPromise = db.promise();

const normalizeAudience = (value) => String(value || '').trim().toLowerCase();

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

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
    return res.status(400).json({
      error: 'title and message are required'
    });
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
    console.error('Create Announcement DB Error:', error);
    return res.status(500).json({ error: 'Failed to post announcement' });
  }
};

const getAnnouncements = async (req, res) => {
  const userRole = firstNonEmptyString(req.query.role, req.query.userRole, req.query.audience);
  const userLevel = firstNonEmptyString(req.query.level, req.query.userLevel);
  const userName = firstNonEmptyString(req.query.name, req.query.user_name, req.query.userName);
  const authorName = firstNonEmptyString(req.query.author, req.query.author_name, req.query.authorName);
  const allAudienceOnly = req.query.all_audience === 'true';
  const currentUserId = req.query.exclude_author_id ? parseInt(req.query.exclude_author_id, 10) : null;

  try {
    await ensureAnnouncementsTable();

    let query;
    const params = [];

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

      query = `SELECT * FROM announcements WHERE LOWER(target_audience) IN ('all', 'all system users')`;

      if (normalizedRole) {
        query += ` OR LOWER(target_audience) LIKE ?`;
        params.push(`%${normalizedRole}%`);
      }

      if (normalizedLevelAudience) {
        query += ` OR LOWER(target_audience) LIKE ?`;
        params.push(`%${normalizedLevelAudience}%`);
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

    const [results] = await dbPromise.query(query, params);
    return res.status(200).json({
      success: true,
      announcements: results,
      data: results
    });
  } catch (error) {
    console.error('Fetch Announcements DB Error:', error);
    return res.status(500).json({ error: 'Failed to fetch announcements' });
  }
};

const updateAnnouncement = async (req, res) => {
  const announcementId = req.params.id;
  const title = firstNonEmptyString(req.body.title, req.body.subject);
  const message = firstNonEmptyString(req.body.message, req.body.content, req.body.description);

  if (!title || !message) {
    return res.status(400).json({
      error: 'title and message are required'
    });
  }

  try {
    await ensureAnnouncementsTable();

    const query = `
      UPDATE announcements
      SET title = ?, message = ?
      WHERE id = ?
    `;

    const [result] = await dbPromise.query(query, [title, message, announcementId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Announcement updated successfully!'
    });
  } catch (error) {
    console.error('Update Announcement DB Error:', error);
    return res.status(500).json({ error: 'Failed to update announcement' });
  }
};

const deleteAnnouncement = async (req, res) => {
  const announcementId = req.params.id;

  try {
    await ensureAnnouncementsTable();

    const query = `
      DELETE FROM announcements
      WHERE id = ?
    `;

    const [result] = await dbPromise.query(query, [announcementId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Announcement deleted successfully!'
    });
  } catch (error) {
    console.error('Delete Announcement DB Error:', error);
    return res.status(500).json({ error: 'Failed to delete announcement' });
  }
};

module.exports = {
  createAnnouncement,
  getAnnouncements,
  updateAnnouncement,
  deleteAnnouncement
};
