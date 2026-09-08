const db = require('../config/db');

let ensureTablePromise = null;

const formatTime12h = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const trimmed = timeStr.trim();
  if (!trimmed) return '';
  if (/am|pm/i.test(trimmed)) return trimmed;

  const parts = trimmed.split(':');
  if (parts.length >= 2) {
    let hours = parseInt(parts[0], 10);
    const minutes = parts[1].slice(0, 2).padStart(2, '0');
    if (!isNaN(hours)) {
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // 0 becomes 12
      const formattedHour = String(hours).padStart(2, '0');
      return `${formattedHour}:${minutes} ${ampm}`;
    }
  }
  return trimmed;
};

const convertMsgTimesTo12h = (msg) => {
  if (!msg || typeof msg !== 'string') return msg;
  return msg.replace(/\b(\d{1,2}:\d{2})\b(?!\s*(?:AM|PM|am|pm))/g, (match, timeStr) => {
    return formatTime12h(timeStr);
  });
};

const ensureAwarenessTable = () => {
  if (!ensureTablePromise) {
    ensureTablePromise = new Promise((resolve) => {
      const sql = `
        CREATE TABLE IF NOT EXISTS awareness_sessions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT NOT NULL,
          target_levels VARCHAR(100) NOT NULL,
          degree_program VARCHAR(50) DEFAULT 'All',
          session_date DATE NOT NULL,
          start_time VARCHAR(20) NOT NULL,
          end_time VARCHAR(20) DEFAULT NULL,
          session_type VARCHAR(20) DEFAULT 'online',
          venue VARCHAR(255) DEFAULT NULL,
          meeting_link TEXT DEFAULT NULL,
          resource_person_name VARCHAR(255) NOT NULL,
          resource_person_title VARCHAR(255) DEFAULT NULL,
          created_by INT DEFAULT NULL,
          author_name VARCHAR(255) DEFAULT 'System Admin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      db.query(sql, (err) => {
        if (err && err.code !== 'ER_TABLE_EXISTS_ERROR') {
          console.error('❌ Error creating awareness_sessions table:', err.message);
        } else {
          console.log('✅ awareness_sessions table verified / created');

          // Normalize any existing companion announcement text to ensure 12h AM/PM format
          db.query(
            `SELECT id, message FROM announcements WHERE title LIKE '%[Awareness Session]%' AND message LIKE '%Time:%'`,
            (annErr, annRows) => {
              if (!annErr && Array.isArray(annRows)) {
                annRows.forEach((row) => {
                  const updatedMsg = convertMsgTimesTo12h(row.message);
                  if (updatedMsg !== row.message) {
                    db.query(`UPDATE announcements SET message = ? WHERE id = ?`, [updatedMsg, row.id]);
                  }
                });
              }
            }
          );
        }
        resolve();
      });
    });
  }
  return ensureTablePromise;
};

/**
 * 1. CREATE AWARENESS SESSION (Admin Only)
 */
const createSession = async (req, res) => {
  await ensureAwarenessTable();

  const {
    title,
    description,
    target_levels,
    degree_program,
    session_date,
    start_time,
    end_time,
    session_type = 'online',
    venue,
    meeting_link,
    resource_person_name,
    resource_person_title,
    author_name = 'System Admin',
    created_by = null
  } = req.body;

  if (!title || !description || !session_date || !start_time || !resource_person_name) {
    return res.status(400).json({ 
      error: 'Title, description, date, start time, and resource person name are required.' 
    });
  }

  // Validate Resource Person Name (Only letters, spaces, dots, hyphens, apostrophes)
  const nameRegex = /^[a-zA-Z\s.'-]+$/;
  if (!nameRegex.test(String(resource_person_name).trim()) || String(resource_person_name).trim().length < 2) {
    return res.status(400).json({ 
      error: 'Resource Person name must contain only letters (no numbers or special symbols).' 
    });
  }

  // Validate Resource Person Designation / Organization (if provided)
  if (resource_person_title && String(resource_person_title).trim()) {
    const orgRegex = /^[a-zA-Z0-9\s.,'&/()@_-]+$/;
    if (!orgRegex.test(String(resource_person_title).trim())) {
      return res.status(400).json({ 
        error: 'Designation / Organization contains invalid special characters.' 
      });
    }
  }

  // Validate Online Meeting Link URL
  let sanitizedMeetingLink = null;
  if (session_type === 'online') {
    if (!meeting_link || !String(meeting_link).trim()) {
      return res.status(400).json({ error: 'Meeting link is required for online sessions.' });
    }
    const cleanLink = String(meeting_link).trim();
    const urlPattern = /^https?:\/\/([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/[^\s]*)?$/i;
    if (!urlPattern.test(cleanLink)) {
      return res.status(400).json({ 
        error: 'Invalid meeting URL. Please provide a valid meeting web link starting with https:// or http://' 
      });
    }
    sanitizedMeetingLink = cleanLink;
  }

  // Normalize target levels as comma-separated string (e.g. "1,2" or "All")
  let normalizedLevels = 'All';
  if (Array.isArray(target_levels) && target_levels.length > 0) {
    normalizedLevels = target_levels.map(String).join(',');
  } else if (typeof target_levels === 'string' && target_levels.trim()) {
    normalizedLevels = target_levels.trim();
  }

  // Normalize target degree programs as comma-separated string (e.g. "IT,AI" or "All")
  let normalizedDegrees = 'All';
  if (Array.isArray(degree_program) && degree_program.length > 0) {
    normalizedDegrees = degree_program.map(String).join(',');
  } else if (typeof degree_program === 'string' && degree_program.trim()) {
    normalizedDegrees = degree_program.trim();
  }

  const insertSql = `
    INSERT INTO awareness_sessions 
    (title, description, target_levels, degree_program, session_date, start_time, end_time, session_type, venue, meeting_link, resource_person_name, resource_person_title, created_by, author_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    title.trim(),
    description.trim(),
    normalizedLevels,
    normalizedDegrees,
    session_date,
    start_time.trim(),
    end_time ? end_time.trim() : null,
    session_type,
    venue ? venue.trim() : null,
    sanitizedMeetingLink,
    resource_person_name.trim(),
    resource_person_title ? resource_person_title.trim() : null,
    created_by || req.user?.id || null,
    author_name || 'System Admin'
  ];

  db.query(insertSql, values, (err, result) => {
    if (err) {
      console.error('Error inserting awareness session:', err);
      return res.status(500).json({ error: 'Failed to create awareness session in database.' });
    }

    const sessionId = result.insertId;

    // Also auto-post a companion record into announcements table so it appears in standard notification streams
    const targetDegreesText = normalizedDegrees === 'All' ? '' : ` (${normalizedDegrees.split(',').join(', ')})`;
    const targetAudienceLabel = normalizedLevels === 'All' 
      ? `Student${targetDegreesText}` 
      : `Student - Level ${normalizedLevels.split(',').join(', Level ')}${targetDegreesText}`;

    const startTime12h = formatTime12h(start_time);
    const endTime12h = end_time ? formatTime12h(end_time) : '';
    const timeDisplay = endTime12h ? `${startTime12h} - ${endTime12h}` : startTime12h;

    const announcementMsg = `Date: ${session_date} | Time: ${timeDisplay}\nResource Person: ${resource_person_name}${resource_person_title ? ` (${resource_person_title})` : ''}\n${session_type === 'online' && sanitizedMeetingLink ? `Meeting Link: ${sanitizedMeetingLink}` : `Venue: ${venue || 'Campus Hall'}`}\n\n${description.trim()}`;

    const insertAnnounceSql = `
      INSERT INTO announcements (title, message, target_audience, author_name, author_id)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(insertAnnounceSql, [`[Awareness Session] ${title.trim()}`, announcementMsg, targetAudienceLabel, author_name || 'System Admin', created_by || null], () => {});

    return res.status(201).json({
      success: true,
      message: 'Awareness session published successfully!',
      sessionId
    });
  });
};

/**
 * 2. GET SESSIONS (Filtered for Student level/degree or all for Admin)
 */
const getSessions = async (req, res) => {
  await ensureAwarenessTable();

  const { role, level, degree, upcomingOnly } = req.query;
  const userLevel = level ? Number(level) : null;
  const userDegree = degree ? String(degree).trim() : null;

  let query = `
    SELECT 
      id,
      title,
      description,
      target_levels,
      degree_program,
      DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date,
      start_time,
      end_time,
      session_type,
      venue,
      meeting_link,
      resource_person_name,
      resource_person_title,
      author_name,
      created_at,
      DATEDIFF(session_date, CURDATE()) AS days_remaining
    FROM awareness_sessions
  `;

  const whereConditions = [];
  const params = [];

  if (upcomingOnly === 'true') {
    whereConditions.push(`session_date >= CURDATE()`);
  }

  // Student level filtering: matches if target_levels is 'All' or contains user's level
  if (role === 'student' && userLevel) {
    whereConditions.push(`(target_levels = 'All' OR FIND_IN_SET(?, target_levels) > 0)`);
    params.push(userLevel);
  }

  // Student degree program filtering: matches if degree_program is 'All' or contains user's degree
  if (role === 'student' && userDegree && userDegree.toLowerCase() !== 'all') {
    whereConditions.push(`(degree_program = 'All' OR degree_program IS NULL OR FIND_IN_SET(?, degree_program) > 0 OR degree_program LIKE ?)`);
    params.push(userDegree, `%${userDegree}%`);
  }

  if (whereConditions.length > 0) {
    query += ` WHERE ` + whereConditions.join(' AND ');
  }

  query += ` ORDER BY session_date ASC, start_time ASC`;

  db.query(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching awareness sessions:', err);
      return res.status(500).json({ error: 'Failed to fetch awareness sessions.' });
    }

    // Enhance each session with dynamic in-app reminder status flags
    const sessions = (rows || []).map(s => {
      const days = Number(s.days_remaining);
      let reminderBadge = null;
      let reminderType = 'normal';

      if (days === 0) {
        reminderBadge = "🔴 Today's Live Session";
        reminderType = 'today';
      } else if (days === 1) {
        reminderBadge = "⏰ Tomorrow";
        reminderType = 'tomorrow';
      } else if (days === 2) {
        reminderBadge = "⏳ In 2 Days (Reminder)";
        reminderType = '2days';
      } else if (days > 2) {
        reminderBadge = `📅 In ${days} Days`;
        reminderType = 'upcoming';
      } else {
        reminderBadge = "Completed";
        reminderType = 'past';
      }

      return {
        ...s,
        start_time: formatTime12h(s.start_time),
        end_time: s.end_time ? formatTime12h(s.end_time) : null,
        reminderBadge,
        reminderType,
        isToday: days === 0,
        is2DaysAlert: days === 2 || days === 1
      };
    });

    return res.status(200).json({
      success: true,
      sessions
    });
  });
};

/**
 * 3. GET CALENDAR EVENTS FORMATTED (For Student / System Calendar)
 */
const getCalendarEvents = async (req, res) => {
  await ensureAwarenessTable();

  const { level } = req.query;
  const userLevel = level ? Number(level) : null;

  let query = `
    SELECT 
      id,
      title,
      description,
      target_levels,
      DATE_FORMAT(session_date, '%Y-%m-%d') AS date,
      start_time AS time,
      end_time,
      session_type,
      venue,
      meeting_link AS meetingLink,
      resource_person_name AS resourcePerson,
      resource_person_title AS resourceTitle,
      author_name
    FROM awareness_sessions
  `;

  const params = [];
  if (userLevel) {
    query += ` WHERE (target_levels = 'All' OR FIND_IN_SET(?, target_levels) > 0)`;
    params.push(userLevel);
  }

  query += ` ORDER BY session_date ASC`;

  db.query(query, params, (err, rows) => {
    if (err) {
      console.error('Error fetching session calendar events:', err);
      return res.status(500).json({ error: 'Failed to fetch session calendar events.' });
    }

    const events = (rows || []).map(r => ({
      id: `awareness-${r.id}`,
      title: r.title,
      evaluation_type: 'Awareness Session',
      kind: 'Awareness Session',
      date: r.date,
      time: formatTime12h(r.time),
      endTime: r.end_time ? formatTime12h(r.end_time) : null,
      duration: '60 min',
      location: r.session_type === 'online' ? 'Online (Zoom/Teams)' : (r.venue || 'Campus'),
      venue: r.venue,
      meeting_link: r.meetingLink,
      meetingLink: r.meetingLink,
      resourcePerson: r.resourcePerson,
      resourceTitle: r.resourceTitle,
      speaker: r.resourcePerson + (r.resourceTitle ? ` (${r.resourceTitle})` : ''),
      evaluators: [],
      supervisors: [],
      target_group: `Level ${r.target_levels} Students`,
      group_name: `Level ${r.target_levels} Students`,
      notes: r.description,
      targetLevels: r.target_levels,
      isAwarenessSession: true
    }));

    return res.status(200).json({
      success: true,
      events
    });
  });
};

/**
 * 4. DELETE AWARENESS SESSION (Admin Only)
 */
const deleteSession = async (req, res) => {
  await ensureAwarenessTable();
  const sessionId = req.params.id;

  // First fetch the session title so we can delete the companion record from announcements table
  db.query(`SELECT title FROM awareness_sessions WHERE id = ?`, [sessionId], (selectErr, rows) => {
    const sessionTitle = rows && rows.length > 0 ? rows[0].title : null;

    db.query(`DELETE FROM awareness_sessions WHERE id = ?`, [sessionId], (err, result) => {
      if (err) {
        console.error('Error deleting awareness session:', err);
        return res.status(500).json({ error: 'Failed to delete awareness session.' });
      }

      // Automatically remove companion announcement record from announcements table
      if (sessionTitle) {
        db.query(
          `DELETE FROM announcements WHERE title LIKE ? OR title LIKE ?`,
          [`%[Awareness Session]%${sessionTitle}%`, `%${sessionTitle}%`],
          (annErr) => {
            if (annErr) console.error('Error removing companion announcement:', annErr);
          }
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Awareness session deleted successfully.'
      });
    });
  });
};

module.exports = {
  createSession,
  getSessions,
  getCalendarEvents,
  deleteSession
};
