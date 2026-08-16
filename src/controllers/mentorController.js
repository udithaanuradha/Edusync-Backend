const db = require('../config/db');
const Project = require('../models/projectModel');

// ── Constant ─────────────────────────────────────────────────────────────────
// All target_audience values that are Level 1 specific.
// Update this array if your DB uses different strings.
const LEVEL1_AUDIENCES = ['Level1', 'Level 1', 'Level1 Students', 'Level 1 Students'];

// ── 1. Get Stages ─────────────────────────────────────────────────────────────
// Blocks Level 1 stage guidelines for mentors.
exports.getMentorStages = (req, res) => {
  const { level } = req.params;
  const { user_role } = req.query;

  if (Number(level) === 1 && user_role === 'mentor') {
    return res.status(403).json({
      success: false,
      message: 'Industry mentors are not assigned to Level 1 stages.',
    });
  }

  Project.getStagesByLevel(level, (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, data: results });
  });
};

// ── 2. JS helper — filter Level 1 announcements out of a list ────────────────
//
// USE THIS in your existing announcementsController.js in the section that
// handles role === 'Mentor'. Just pipe the fetched list through this function
// before returning to the client.
//

exports.filterLevel1FromMentorAnnouncements = (announcements) => {
  return announcements.filter(
    (a) => !LEVEL1_AUDIENCES.includes((a.target_audience || '').trim())
  );
};

// ── 3. Standalone mentor announcements endpoint ──────────────────────────────
// Fetches all announcements a mentor can see, excluding Level 1 targeted ones.
// Used by GET /api/mentor/announcements (see mentorRoutes.js).
//
// FIX: This is the CORRECT endpoint for MentorAnnouncementsPage.tsx.
// The frontend must call /api/mentor/announcements — NOT /api/announcements?role=Mentor.
// The generic /api/announcements endpoint does NOT apply Level 1 filtering.
exports.getMentorAnnouncements = (req, res) => {
  const placeholders = LEVEL1_AUDIENCES.map(() => '?').join(', ');

  // Fetch all announcements whose target_audience is NOT Level 1 specific.
  // Also includes announcements with NULL target_audience (system-wide ones).
  const query = `
    SELECT *
    FROM announcements
    WHERE (
      target_audience NOT IN (${placeholders})
      OR target_audience IS NULL
    )
    ORDER BY created_at DESC
  `;

  db.query(query, LEVEL1_AUDIENCES, (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, announcements: results });
  });
};

// ── 4. Single announcement — blocks Level 1 targeted ones for mentors ────────
exports.getMentorAnnouncementById = (req, res) => {
  const { id } = req.params;

  db.query('SELECT * FROM announcements WHERE id = ?', [id], (err, results) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!results.length) return res.status(404).json({ success: false, message: 'Not found' });

    const announcement = results[0];

    if (LEVEL1_AUDIENCES.includes((announcement.target_audience || '').trim())) {
      return res.status(403).json({
        success: false,
        message: 'Industry mentors do not have access to Level 1 announcements.',
      });
    }

    res.json({ success: true, data: announcement });
  });
};