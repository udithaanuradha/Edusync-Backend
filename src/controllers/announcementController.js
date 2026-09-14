const db = require('../config/db');
const dbPromise = db.promise();

let ensureAnnouncementsTablePromise = null;

// Self-healing column: `priority` didn't exist on the original announcements
// table, so CREATE TABLE IF NOT EXISTS (which only applies to a table that
// doesn't exist yet) never retroactively adds it to an already-created one.
// Checked once per process and cached, same pattern as
// calendarController.js's ensureEvaluationPanelSupervisorsColumn.
let ensureAnnouncementPriorityColumnPromise = null;
const ensureAnnouncementPriorityColumn = async () => {
  if (!ensureAnnouncementPriorityColumnPromise) {
    ensureAnnouncementPriorityColumnPromise = (async () => {
      try {
        const [columns] = await dbPromise.query('SHOW COLUMNS FROM announcements');
        const hasColumn = (columns || []).some((column) => column.Field === 'priority');
        if (!hasColumn) {
          await dbPromise.query(
            `ALTER TABLE announcements ADD COLUMN priority VARCHAR(16) NOT NULL DEFAULT 'normal'`
          );
        }
      } catch (error) {
        console.warn('announcements priority column check failed:', error.message);
      }
    })();
  }
  await ensureAnnouncementPriorityColumnPromise;
};

// `target_audience` can now hold several comma-joined values at once (e.g.
// "Supervisor,Student", from Announcements.tsx's multi-select) — the
// original VARCHAR(64) truncates once enough audiences are combined (all
// four role options plus all four levels comes to ~71 characters), silently
// dropping whichever ones didn't fit. Widened once per process, same
// self-healing pattern as the priority column above.
let ensureAnnouncementAudienceWidthPromise = null;
const ensureAnnouncementAudienceWidth = async () => {
  if (!ensureAnnouncementAudienceWidthPromise) {
    ensureAnnouncementAudienceWidthPromise = (async () => {
      try {
        const [columns] = await dbPromise.query('SHOW COLUMNS FROM announcements');
        const column = (columns || []).find((col) => col.Field === 'target_audience');
        const lengthMatch = column ? /varchar\((\d+)\)/i.exec(column.Type || '') : null;
        const currentLength = lengthMatch ? Number(lengthMatch[1]) : 0;
        if (currentLength && currentLength < 255) {
          await dbPromise.query(
            `ALTER TABLE announcements MODIFY COLUMN target_audience VARCHAR(255) NOT NULL DEFAULT 'All'`
          );
        }
      } catch (error) {
        console.warn('announcements target_audience width check failed:', error.message);
      }
    })();
  }
  await ensureAnnouncementAudienceWidthPromise;
};

const normalizeAudience = (value) => String(value || '').trim().toLowerCase();

const normalizePriority = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'urgent' ? 'urgent' : 'normal';
};

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
  const authorId = req.body.author_id
    || req.body.coordinator_id
    || req.body.supervisor_id
    || req.user?.id
    || null;
  const priority = normalizePriority(
    req.body.priority ?? req.body.priority_level ?? req.body.urgency
  );

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      target_audience VARCHAR(255) NOT NULL DEFAULT 'All',
      author_name VARCHAR(255) NOT NULL,
      author_id INT,
      priority VARCHAR(16) NOT NULL DEFAULT 'normal',
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
      INSERT INTO announcements (title, message, target_audience, author_name, author_id, priority)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(insertQuery, [title, message, normalizedAudience, normalizedAuthor, authorId, priority], (insertErr, result) => {
      if (insertErr) {
        console.error('Insert error:', insertErr);
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
          author_id: authorId,
          priority
        }
      });
    });
  });
};

/**
 * READ: Fetch with enhanced Role-Based and Department-Based Filtering
 */
const getAnnouncements = (req, res) => {
  let userRole = firstNonEmptyString(req.query.role, req.query.userRole, req.query.audience);
  let userDesignation = firstNonEmptyString(req.query.designation, req.query.userDesignation);
  let userLevel = firstNonEmptyString(req.query.level, req.query.userLevel);
  let userDepartment = firstNonEmptyString(req.query.department, req.query.academic_unit, req.query.academicUnit);
  const authorName = firstNonEmptyString(req.query.author, req.query.author_name, req.query.authorName);
  const allAudienceOnly = req.query.all_audience === 'true';
  const currentUserId = req.query.exclude_author_id ? parseInt(req.query.exclude_author_id, 10) : null;
  const targetUserId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      target_audience VARCHAR(255) NOT NULL DEFAULT 'All',
      author_name VARCHAR(255) NOT NULL,
      author_id INT,
      priority VARCHAR(16) NOT NULL DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  db.query(createTableQuery, async (tableErr) => {
    if (tableErr && tableErr.code !== 'ER_TABLE_EXISTS_ERROR') {
      console.error('[getAnnouncements] Table creation error:', tableErr);
      return res.status(500).json({ error: 'Database setup failed' });
    }

    await ensureAnnouncementPriorityColumn();
    await ensureAnnouncementAudienceWidth();

    const executeQuery = (resolvedRole, resolvedDesignation, resolvedLevel, resolvedDept) => {
      const roleNorm = normalizeAudience(resolvedRole);
      const designationNorm = normalizeAudience(resolvedDesignation);

      // A user is a Coordinator if role or designation is 'coordinator'
      const isCoordinator = roleNorm === 'coordinator' || designationNorm === 'coordinator';

      // A user is a Supervisor if they are not a coordinator and are a lecturer/supervisor
      // (in the users table, lecturers who aren't assigned as coordinator are supervisors)
      const isSupervisor = !isCoordinator && (
        roleNorm === 'supervisor' ||
        designationNorm === 'supervisor' ||
        roleNorm === 'lecturer'
      );

      const isAdmin = roleNorm === 'admin';

      let whereConditions = [];
      let params = [];

      // 1. Fetch all announcements for management page (all_audience=true) only when not admin
      if (allAudienceOnly && !isAdmin) {
        // no filter
      }
      // 2. Fetch announcements by author name (when not admin filtering)
      else if (authorName && !isAdmin) {
        whereConditions.push('author_name = ?');
        params.push(authorName);
      }
      // 3. ADMIN: Sees:
      //    (a) Announcements created by this admin (author_id = targetUserId or author_name = authorName)
      //    (b) Announcements specifically targeted to Admins (contains 'admin')
      //    (c) Announcements targeted to All System Users / All
      else if (isAdmin) {
        let adminClauses = [
          "LOWER(TRIM(target_audience)) IN ('all', 'all system users', 'admin', 'admins', 'administrator', 'administrators')",
          "LOWER(target_audience) LIKE '%admin%'",
          "LOWER(target_audience) LIKE '%all system users%'"
        ];

        if (targetUserId) {
          adminClauses.push("author_id = ?");
          params.push(targetUserId);
        }
        if (authorName) {
          adminClauses.push("LOWER(TRIM(author_name)) = LOWER(TRIM(?))");
          params.push(authorName);
        }

        whereConditions.push(`(${adminClauses.join(' OR ')})`);
      }
      // 4. COORDINATOR: Precise matching by level and department
      else if (isCoordinator) {
        let coordTargeted = ["LOWER(target_audience) LIKE '%coordinator%'"];

        // Level check: if announcement specifies a level, it must match this coordinator's level
        const cleanLevel = resolvedLevel ? String(resolvedLevel).replace(/[^0-9]/g, '') : '';
        if (cleanLevel) {
          coordTargeted.push(`(
            (
              LOWER(target_audience) NOT LIKE '%level 1%' AND LOWER(target_audience) NOT LIKE '%level 2%' AND
              LOWER(target_audience) NOT LIKE '%level 3%' AND LOWER(target_audience) NOT LIKE '%level 4%' AND
              LOWER(target_audience) NOT LIKE '%level1%' AND LOWER(target_audience) NOT LIKE '%level2%' AND
              LOWER(target_audience) NOT LIKE '%level3%' AND LOWER(target_audience) NOT LIKE '%level4%'
            )
            OR LOWER(target_audience) LIKE ?
            OR LOWER(target_audience) LIKE ?
          )`);
          params.push(`%level ${cleanLevel}%`, `%level${cleanLevel}%`);
        }

        // Department check: if announcement specifies a department, it must match this coordinator's department
        const deptUpper = resolvedDept ? String(resolvedDept).trim().toUpperCase() : '';
        let matchDeptClause = '';
        if (deptUpper === 'IT') {
          matchDeptClause = "(LOWER(target_audience) LIKE '%- it%' AND LOWER(target_audience) NOT LIKE '%- itm%')";
        } else if (deptUpper === 'IDS' || deptUpper === 'ITM') {
          matchDeptClause = "(LOWER(target_audience) LIKE '%- ids%' OR LOWER(target_audience) LIKE '%- itm%')";
        } else if (deptUpper === 'CM' || deptUpper === 'AI') {
          matchDeptClause = "(LOWER(target_audience) LIKE '%- cm%' OR LOWER(target_audience) LIKE '%- ai%')";
        }

        if (matchDeptClause) {
          coordTargeted.push(`(
            (
              LOWER(target_audience) NOT LIKE '%- it%'
              AND LOWER(target_audience) NOT LIKE '%- ids%'
              AND LOWER(target_audience) NOT LIKE '%- cm%'
              AND LOWER(target_audience) NOT LIKE '%- itm%'
              AND LOWER(target_audience) NOT LIKE '%- ai%'
            )
            OR ${matchDeptClause}
          )`);
        }

        whereConditions.push(`(
          LOWER(TRIM(target_audience)) IN ('all', 'all system users')
          OR (${coordTargeted.join(' AND ')})
        )`);
      }
      // 5. SUPERVISOR: Department matching (Rule: Lecturers who aren't coordinators are supervisors)
      else if (isSupervisor) {
        let supTargeted = ["LOWER(target_audience) LIKE '%supervisor%'"];

        // Department check: if announcement specifies a department, it must match this supervisor's department
        const deptUpper = resolvedDept ? String(resolvedDept).trim().toUpperCase() : '';
        let matchDeptClause = '';
        if (deptUpper === 'IT') {
          matchDeptClause = "(LOWER(target_audience) LIKE '%- it%' AND LOWER(target_audience) NOT LIKE '%- itm%')";
        } else if (deptUpper === 'IDS' || deptUpper === 'ITM') {
          matchDeptClause = "(LOWER(target_audience) LIKE '%- ids%' OR LOWER(target_audience) LIKE '%- itm%')";
        } else if (deptUpper === 'CM' || deptUpper === 'AI') {
          matchDeptClause = "(LOWER(target_audience) LIKE '%- cm%' OR LOWER(target_audience) LIKE '%- ai%')";
        }

        if (matchDeptClause) {
          supTargeted.push(`(
            (
              LOWER(target_audience) NOT LIKE '%- it%'
              AND LOWER(target_audience) NOT LIKE '%- ids%'
              AND LOWER(target_audience) NOT LIKE '%- cm%'
              AND LOWER(target_audience) NOT LIKE '%- itm%'
              AND LOWER(target_audience) NOT LIKE '%- ai%'
            )
            OR ${matchDeptClause}
          )`);
        } else if (deptUpper) {
          supTargeted.push(`(
            (
              LOWER(target_audience) NOT LIKE '%- it%'
              AND LOWER(target_audience) NOT LIKE '%- ids%'
              AND LOWER(target_audience) NOT LIKE '%- cm%'
              AND LOWER(target_audience) NOT LIKE '%- itm%'
              AND LOWER(target_audience) NOT LIKE '%- ai%'
            )
            OR LOWER(target_audience) LIKE ?
          )`);
          params.push(`%- ${deptUpper.toLowerCase()}%`);
        }

        whereConditions.push(`(
          LOWER(TRIM(target_audience)) IN ('all', 'all system users')
          OR (${supTargeted.join(' AND ')})
        )`);
      }
      // 6. EVERYONE ELSE (Students, Mentors, etc.)
      else if (resolvedRole) {
        let roleCondition = `(LOWER(target_audience) IN ('all', 'all system users') OR LOWER(target_audience) LIKE ?`;
        params.push(`%${roleNorm}%`);

        if (resolvedLevel) {
          const cleanLevel = String(resolvedLevel).replace(/[^0-9]/g, '');
          if (cleanLevel) {
            roleCondition += ` OR LOWER(target_audience) LIKE ? OR LOWER(target_audience) LIKE ?`;
            params.push(`%level ${cleanLevel}%`, `%level${cleanLevel}%`);
          }
        }

        roleCondition += `)`;
        whereConditions.push(roleCondition);
      }
      // 7. Fallback
      else {
        whereConditions.push(`LOWER(target_audience) IN ('all', 'all system users')`);
      }

      // Exclude current user's own posts from dashboard view
      if (currentUserId && currentUserId > 0 && !allAudienceOnly && !authorName) {
        whereConditions.push(`(author_id IS NULL OR author_id != ?)`);
        params.push(currentUserId);
      }

      let query = `
        SELECT announcements.*, author_u.role AS author_role, author_u.designation AS author_designation
        FROM announcements
        LEFT JOIN users author_u ON author_u.id = announcements.author_id
      `;
      if (whereConditions.length > 0) {
        query += ` WHERE ` + whereConditions.join(' AND ');
      }
      query += ` ORDER BY announcements.created_at DESC`;

      console.log('[getAnnouncements] Query:', query, 'Params:', params);

      db.query(query, params, (err, results) => {
        if (err) {
          console.error('[getAnnouncements] Query error:', err.message);
          return res.status(500).json({ error: 'Failed to retrieve announcements', details: err.message });
        }

        console.log('[getAnnouncements] Success, found', results.length, 'announcements');
        return res.status(200).json({ success: true, announcements: results || [] });
      });
    };

    // If user_id is provided, look up authoritative user info from users table
    if (targetUserId) {
      db.query('SELECT role, designation, level, academic_unit FROM users WHERE id = ?', [targetUserId], (err, uRows) => {
        if (!err && uRows && uRows[0]) {
          const u = uRows[0];
          const rawRole = String(u.role || '').toLowerCase().trim();
          const rawDesignation = String(u.designation || '').toLowerCase().trim();

          let resRole = u.role || userRole;
          let resDesignation = u.designation || userDesignation;

          if (rawRole === 'admin') {
            resRole = 'admin';
          } else {
            const isCoord = rawDesignation === 'coordinator' || rawRole === 'coordinator';
            const isSup = !isCoord && (
              rawRole === 'supervisor' ||
              rawDesignation === 'supervisor' ||
              (rawRole === 'lecturer' && rawDesignation !== 'coordinator')
            );

            if (isCoord) {
              resRole = 'coordinator';
              resDesignation = 'coordinator';
            } else if (isSup) {
              resRole = 'supervisor';
              resDesignation = 'supervisor';
            }
          }

          const resLevel = (u.level !== null && u.level !== undefined) ? String(u.level) : userLevel;
          const resDept = u.academic_unit || userDepartment;
          return executeQuery(resRole, resDesignation, resLevel, resDept);
        }
        return executeQuery(userRole, userDesignation, userLevel, userDepartment);
      });
    } else {
      executeQuery(userRole, userDesignation, userLevel, userDepartment);
    }
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
