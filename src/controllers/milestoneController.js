const db = require('../config/db');
const dbPromise = db.promise();
const { cloudinary, uploadBufferToCloudinary } = require('../config/cloudinaryConfig');

let ensureTablesPromise = null;
let ensureFeedbackSeenColumnPromise = null;

// Adds milestones.feedback_seen_at (nullable timestamp) if it isn't there yet.
// NULL means "not yet seen by the student"; set to NOW() once the student
// views it. updateMilestoneStatus resets it to NULL whenever a
// supervisor/coordinator/admin sets or changes feedback, so it counts as
// unseen again.
const ensureFeedbackSeenColumn = async () => {
  if (!ensureFeedbackSeenColumnPromise) {
    ensureFeedbackSeenColumnPromise = dbPromise.query(
      `ALTER TABLE milestones ADD COLUMN IF NOT EXISTS feedback_seen_at TIMESTAMP NULL DEFAULT NULL`
    );
  }
  await ensureFeedbackSeenColumnPromise;
};

// Adds student_tasks.completed_at (nullable timestamp) if it isn't there
// yet. Set to NOW() by updateTaskStatus whenever a task's status becomes
// COMPLETED, and cleared back to NULL if it's ever moved off COMPLETED —
// backs the "My Progress" tab's completed-tasks timeline with a real
// completion date instead of just a creation-order list.
let ensureCompletedAtColumnPromise = null;
const ensureCompletedAtColumn = async () => {
  if (!ensureCompletedAtColumnPromise) {
    ensureCompletedAtColumnPromise = dbPromise.query(
      `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP NULL DEFAULT NULL`
    );
  }
  await ensureCompletedAtColumnPromise;
};

// Adds student_tasks.start_date (nullable date) if it isn't there yet —
// needed so createStudentTask can validate (and remember) the date a task
// is meant to start on, not just its due_date. Display elsewhere (e.g. the
// task list's own "startDate") is intentionally left reading from
// created_at as it always has; this column only backs the new date-range
// validation against the task's parent milestone.
let ensureTaskStartDateColumnPromise = null;
const ensureTaskStartDateColumn = async () => {
  if (!ensureTaskStartDateColumnPromise) {
    ensureTaskStartDateColumnPromise = dbPromise.query(
      `ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS start_date DATE NULL DEFAULT NULL`
    );
  }
  await ensureTaskStartDateColumnPromise;
};

// Adds student_tasks.file_name/file_url (nullable) if they aren't there
// yet — backs the one optional file a student can attach when creating a
// task (see uploadTaskFile below), uploaded to Cloudinary the same way
// Project Stage files and group Submissions already are, just into their
// own dedicated folder so they never mix with those.
let ensureTaskFileColumnsPromise = null;
const ensureTaskFileColumns = async () => {
  if (!ensureTaskFileColumnsPromise) {
    ensureTaskFileColumnsPromise = dbPromise.query(
      `ALTER TABLE student_tasks
       ADD COLUMN IF NOT EXISTS file_name VARCHAR(500) NULL DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS file_url VARCHAR(1000) NULL DEFAULT NULL`
    );
  }
  await ensureTaskFileColumnsPromise;
};

const ensureMilestoneTables = async () => {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      // Create milestones table
      await dbPromise.query(`
        CREATE TABLE IF NOT EXISTS milestones (
            id INT PRIMARY KEY AUTO_INCREMENT,
            group_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            start_date DATE,
            due_date DATE,
            status ENUM('PENDING', 'REJECTED', 'APPROVED') DEFAULT 'PENDING',
            feedback_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_milestone_group FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE CASCADE
        )
      `);

      // Create student_tasks table
      await dbPromise.query(`
        CREATE TABLE IF NOT EXISTS student_tasks (
            id INT PRIMARY KEY AUTO_INCREMENT,
            milestone_id INT NOT NULL,
            assigned_to INT NOT NULL,
            task_name VARCHAR(255) NOT NULL,
            description TEXT,
            status ENUM('TODO', 'IN_PROGRESS', 'COMPLETED') DEFAULT 'TODO',
            due_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_milestone FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE CASCADE,
            CONSTRAINT fk_student FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Create project_overviews table
      await dbPromise.query(`
        CREATE TABLE IF NOT EXISTS project_overviews (
            group_id INT PRIMARY KEY,
            start_date DATE,
            end_date DATE,
            workflow_name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_po_group FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE CASCADE
        )
      `);
    })();
  }
  await ensureTablesPromise;
};

// Scope Division: the WHOLE PROJECT (group) can be broken into sections —
// any group member creates their own section directly (title +
// description), capped at one per student, and that act of creating it is
// what makes it theirs. There's no separate leader-curates/member-claims
// step any more (that older two-step "leader defines sections, members
// tick to claim one" model — and its claimScopeSection endpoint — has been
// removed entirely). `claimed_by` is still the column name, now meaning
// "who created and owns this section" rather than "who claimed it" — set
// directly in the same INSERT that creates the row. Every section is
// visible to the whole group regardless of who created it, unchanged.
// Editing/deleting is owner-only (the creator), with no leader override.
//
// One-time migration on first boot after the project-wide move: since
// sections used to be milestone-scoped (milestone_scope_sections, keyed by
// milestone_id) in a way that doesn't map cleanly onto "the group's one
// set of sections," that migration wiped any existing milestone-scoped
// sections rather than guess which milestone's set should carry over.
// Safe to run on every boot: once project_scope_sections exists, the old
// table is already gone and this becomes a no-op.
let ensureScopeTablePromise = null;
const ensureScopeSectionsTable = async () => {
  if (!ensureScopeTablePromise) {
    ensureScopeTablePromise = (async () => {
      const [existingTables] = await dbPromise.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('project_scope_sections', 'milestone_scope_sections')`
      );
      const tableNames = new Set(existingTables.map((row) => row.TABLE_NAME));

      if (!tableNames.has('project_scope_sections') && tableNames.has('milestone_scope_sections')) {
        await dbPromise.query(`DROP TABLE milestone_scope_sections`);
      }

      await dbPromise.query(`
        CREATE TABLE IF NOT EXISTS project_scope_sections (
            id INT PRIMARY KEY AUTO_INCREMENT,
            group_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            claimed_by INT NULL,
            claimed_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_scope_group FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE CASCADE,
            CONSTRAINT fk_scope_claimed_by FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
    })();
  }
  await ensureScopeTablePromise;
};
 


//   ACCESS CONTROL HELPER ---
/**
 * Checks if a specific user has permission to view/edit group data.
 * Coordinators/Supervisors pass automatically; Students must be in the group.
 */
const verifyMembership = async (userId, userRole, groupId) => {
  // If not a student, we allow access for now (Coordinator, Supervisor, Admin)
  if (userRole !== 'student') return true;

  const [rows] = await dbPromise.query(
    'SELECT 1 FROM project_group_members WHERE student_id = ? AND group_id = ?',
    [userId, groupId]
  );
  return rows.length > 0;
};

//   DATE VALIDATION HELPERS (milestone create/edit, task create) ---
// All comparisons are calendar-date-only (time-of-day zeroed out), so a
// start_date of "today" compares equal to today, never off by a few hours.
const parseDateOnly = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};

const todayDateOnly = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// YYYY-MM-DD, built from LOCAL year/month/day — NOT toISOString(), which
// converts to UTC first and silently shifts the date back by one day
// whenever the server runs in a positive UTC-offset timezone (local
// midnight on the 8th becomes "the 7th" once re-expressed in UTC). Only
// this string form was ever at risk — the Date-object comparisons
// elsewhere in this file (e.g. `start < todayDateOnly()`) never round-trip
// through UTC, so they were never affected.
const todayDateOnlyString = () => {
  const d = todayDateOnly();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateForMessage = (value) => {
  const d = parseDateOnly(value);
  if (!d) return String(value || '');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const addOneYear = (date) => {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d;
};

/**
 * Shared by createMilestone (always passes `enforceNotBeforeToday: true`)
 * and updateMilestoneDetails (passes `true` only when the start date is
 * actually being changed from what's already stored) — an edit that
 * leaves an already-past start date untouched (e.g. fixing just the
 * title) isn't blocked just because time has passed since it was first
 * set, but no save can ever newly set a start date in the past.
 */
const validateMilestoneDates = (startDateInput, dueDateInput, { enforceNotBeforeToday }) => {
  const start = parseDateOnly(startDateInput);
  const due = parseDateOnly(dueDateInput);

  if (enforceNotBeforeToday && start && start < todayDateOnly()) {
    return 'Start date cannot be before today.';
  }

  // Applies on both create and edit — unlike enforceNotBeforeToday, there's
  // no case where an end date before the milestone's own start date should
  // ever be allowed to save.
  if (start && due && due < start) {
    return 'Start date cannot be later than end date.';
  }

  // One year, anchored to the milestone's own start date (not to today) —
  // a milestone allowed to start in the future still gets a full year from
  // wherever it actually starts.
  if (start && due && due > addOneYear(start)) {
    return "A milestone can't run for more than one year.";
  }

  return null;
};

/**
 * Shared by createStudentTask — a task's own start/due dates must fall
 * within its parent milestone's start_date/due_date range. Skips
 * whichever side the milestone doesn't have a date for, rather than
 * treating a missing milestone date as an impossible range to satisfy.
 */
const validateTaskDatesWithinMilestone = (taskStartInput, taskDueInput, milestoneStartInput, milestoneDueInput) => {
  const taskStart = parseDateOnly(taskStartInput);
  const taskDue = parseDateOnly(taskDueInput);
  const milestoneStart = parseDateOnly(milestoneStartInput);
  const milestoneDue = parseDateOnly(milestoneDueInput);

  const outOfRange =
    (milestoneStart && taskStart && taskStart < milestoneStart) ||
    (milestoneDue && taskDue && taskDue > milestoneDue) ||
    (milestoneDue && taskStart && taskStart > milestoneDue) ||
    (milestoneStart && taskDue && taskDue < milestoneStart);

  if (!outOfRange) return null;

  if (milestoneStart && milestoneDue) {
    return `Task dates must fall within this milestone's ${formatDateForMessage(milestoneStartInput)} – ${formatDateForMessage(milestoneDueInput)} range.`;
  }
  return 'Task dates must fall within its milestone\'s own date range.';
};

/**
 * Shared by createMilestone and updateMilestoneDetails — a milestone's own
 * start_date/due_date must fall within its project's overall window
 * (project_overviews.start_date/end_date), once the group has set one.
 * Mirrors validateTaskDatesWithinMilestone's same "skip whichever side
 * isn't set" approach one level up (milestone-within-project rather than
 * task-within-milestone) — kept as its own separate function rather than
 * reusing that one, since task validation itself is untouched by this.
 */
const validateMilestoneWithinProjectWindow = (milestoneStartInput, milestoneDueInput, projectStartInput, projectEndInput) => {
  const milestoneStart = parseDateOnly(milestoneStartInput);
  const milestoneDue = parseDateOnly(milestoneDueInput);
  const projectStart = parseDateOnly(projectStartInput);
  const projectEnd = parseDateOnly(projectEndInput);

  const outOfRange =
    (projectStart && milestoneStart && milestoneStart < projectStart) ||
    (projectEnd && milestoneDue && milestoneDue > projectEnd) ||
    (projectEnd && milestoneStart && milestoneStart > projectEnd) ||
    (projectStart && milestoneDue && milestoneDue < projectStart);

  if (!outOfRange) return null;

  if (projectStart && projectEnd) {
    return `Milestone dates must fall within the project's ${formatDateForMessage(projectStartInput)} – ${formatDateForMessage(projectEndInput)} window.`;
  }
  return "Milestone dates must fall within the project's own window.";
};

/**
 * Validates the project's own overall window (project_overviews) on every
 * save via upsertOverview. Mirrors validateMilestoneDates' same shape
 * (not-before-today, start<=end, a span cap) one level up — kept as its
 * own separate function since it has a different cap (two years, not
 * one) and `enforceNotBeforeToday` means something slightly different
 * here: "the start date is actually changing from what's already
 * stored," not "creation only" — upsertOverview always does both create
 * and edit through the same call, there's no separate action to split on.
 */
const validateProjectOverviewDates = (startDateInput, endDateInput, { enforceNotBeforeToday }) => {
  const start = parseDateOnly(startDateInput);
  const end = parseDateOnly(endDateInput);

  if (enforceNotBeforeToday && start && start < todayDateOnly()) {
    return 'Project start date cannot be before today.';
  }

  if (start && end && end < start) {
    return 'Project start date cannot be later than end date.';
  }

  // Two years, anchored to the project's own start date — same pattern as
  // addOneYear for milestones, just a longer cap for the project as a
  // whole.
  if (start && end) {
    const twoYearsAfterStart = new Date(start);
    twoYearsAfterStart.setFullYear(twoYearsAfterStart.getFullYear() + 2);
    if (end > twoYearsAfterStart) {
      return "A project's end date can't be more than two years after its start date.";
    }
  }

  return null;
};








 
// MILESTONE CONTROLLERS
 /**
 * POST: Create a new project phase (Milestone)
 * Restricted to group members only.
 */

const createMilestone = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { group_id, title, description, start_date, due_date } = req.body;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!group_id || !title) {
      return res.status(400).json({ success: false, error: 'group_id and title are required.' });
    }

    const dateError = validateMilestoneDates(start_date, due_date, { enforceNotBeforeToday: true });
    if (dateError) {
      return res.status(400).json({ success: false, error: dateError });
    }

    // Only enforced once the group has actually set a project-level
    // window (see upsertOverview/getOverviewByGroup) — a group that
    // hasn't isn't blocked from creating milestones at all.
    const [overviewRows] = await dbPromise.query(
      'SELECT start_date, end_date FROM project_overviews WHERE group_id = ?',
      [group_id]
    );
    if (overviewRows.length > 0) {
      const windowError = validateMilestoneWithinProjectWindow(
        start_date, due_date, overviewRows[0].start_date, overviewRows[0].end_date
      );
      if (windowError) {
        return res.status(400).json({ success: false, error: windowError });
      }
    }

    // Access Control — any group member may create a milestone (only
    // *editing* an existing one, via updateMilestoneDetails, is leader-only;
    // creating one is intentionally open to the whole group).
    if (userId && userRole) {
      const isMember = await verifyMembership(userId, userRole, group_id);
      if (!isMember) {
        return res.status(403).json({ success: false, error: 'Access denied. You are not a member of this group.' });
      }
    }

    const [result] = await dbPromise.query(
      `INSERT INTO milestones (group_id, title, description, start_date, due_date) VALUES (?, ?, ?, ?, ?)`,
      [group_id, title, description || null, start_date || null, due_date || null]
    );

    res.status(201).json({ success: true, message: 'Milestone created successfully', data: { id: result.insertId } });
  } catch (error) {
    console.error('❌ Error creating milestone:', error);
    res.status(500).json({ success: false, error: 'Failed to create milestone.' });
  }
};





//Fetch all phases for a specific project group.

const getMilestonesByGroup = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureFeedbackSeenColumn();
    const { groupId } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    // Access Control
    if (userId && userRole) {
      const isMember = await verifyMembership(userId, userRole, groupId);
      if (!isMember) {
        return res.status(403).json({ success: false, error: 'Access denied. You are not a member of this group.' });
      }
    }

    console.log(`📡 [Backend] Fetching Milestones for Group ID: ${groupId}`);

    const [milestones] = await dbPromise.query(
      `SELECT id AS id, group_id AS group_id, title AS title, description AS description,
              start_date AS start_date, due_date AS due_date, status AS status,
              feedback_reason AS feedback_reason, feedback_seen_at AS feedback_seen_at, created_at AS created_at
       FROM milestones WHERE group_id = ? ORDER BY created_at ASC`,
      [groupId]
    );

    console.log(`✅ [Backend] Found ${milestones.length} milestones for Group ID: ${groupId}`);
    res.status(200).json({ success: true, data: milestones });
  } catch (error) {
    console.error('❌ Error fetching milestones:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch milestones.' });
  }
};



/**
 * GET: Count of "unseen" supervisor feedback items across every group the
 * student belongs to. Backs the red notification badge in Header.tsx.
 * A milestone counts as unseen feedback when it has a non-empty
 * feedback_reason and feedback_seen_at is still NULL.
 */
const getUnseenFeedbackCount = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureFeedbackSeenColumn();
    const { studentId } = req.params;
    const authUserId = req.headers['x-user-id'];

    // A student may only ever check their own unseen-feedback count.
    if (authUserId && String(authUserId) !== String(studentId)) {
      return res.status(403).json({ success: false, error: 'Access denied. You can only check your own notifications.' });
    }

    const [rows] = await dbPromise.query(
      `SELECT COUNT(*) AS cnt
       FROM milestones m
       JOIN project_group_members gm ON gm.group_id = m.group_id
       WHERE gm.student_id = ?
         AND m.feedback_reason IS NOT NULL
         AND m.feedback_reason <> ''
         AND m.feedback_seen_at IS NULL`,
      [studentId]
    );

    res.status(200).json({ success: true, count: Number(rows[0]?.cnt || 0) });
  } catch (error) {
    console.error('❌ Error fetching unseen feedback count:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch unseen feedback count.' });
  }
};

/**
 * PUT: Marks every currently-unseen feedback item for one group as seen.
 * Called once the student has actually viewed the feedback section on
 * ProjectManagementPage so the red badge in the header clears.
 */
const markGroupFeedbackSeen = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureFeedbackSeenColumn();
    const { groupId } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (userId && userRole) {
      const isMember = await verifyMembership(userId, userRole, groupId);
      if (!isMember) {
        return res.status(403).json({ success: false, error: 'Access denied. You are not a member of this group.' });
      }
    }

    await dbPromise.query(
      `UPDATE milestones
       SET feedback_seen_at = NOW()
       WHERE group_id = ? AND feedback_reason IS NOT NULL AND feedback_reason <> '' AND feedback_seen_at IS NULL`,
      [groupId]
    );

    res.status(200).json({ success: true, message: 'Feedback marked as seen.' });
  } catch (error) {
    console.error('❌ Error marking feedback as seen:', error);
    res.status(500).json({ success: false, error: 'Failed to mark feedback as seen.' });
  }
};

//Supervisor approves or rejects a milestone with feedback reason. Only Supervisors, Coordinators, or Admins can perform this action.
const updateMilestoneStatus = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureFeedbackSeenColumn();
    const { id } = req.params;
    const { status, feedback_reason } = req.body;
    const userRole = req.headers['x-user-role'];

    // Security: Only Supervisors, Coordinators, or Admins can update status
    if (userRole === 'student') {
      return res.status(403).json({ success: false, error: 'Access denied. Students cannot approve/reject milestones.' });
    }

    // feedback_seen_at resets to NULL so a new/changed feedback reason shows
    // up again as "unseen" for the student, even if they'd already seen a
    // previous round of feedback on this same milestone.
    await dbPromise.query(
      `UPDATE milestones SET status = ?, feedback_reason = ?, feedback_seen_at = NULL WHERE id = ?`,
      [status, feedback_reason || null, id]
    );

    res.status(200).json({ success: true, message: 'Milestone status updated successfully' });
  } catch (error) {
    console.error('❌ Error updating milestone status:', error);
    res.status(500).json({ success: false, error: 'Failed to update milestone status.' });
  }
};

/**
 * PUT: Edit an existing milestone's own details (title/description/dates) —
 * distinct from updateMilestoneStatus, which only ever touches
 * status/feedback. Leader-only, same access pattern as createMilestone.
 */
const updateMilestoneDetails = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { id } = req.params;
    const { title, description, start_date, due_date } = req.body;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!title) {
      return res.status(400).json({ success: false, error: 'title is required.' });
    }

    const [mRows] = await dbPromise.query('SELECT group_id, start_date FROM milestones WHERE id = ?', [id]);
    if (mRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Milestone not found.' });
    }

    // Not-before-today only applies when the start date is actually being
    // changed — an edit that leaves an already-past start date untouched
    // (e.g. fixing just the title) isn't blocked just because time has
    // passed since it was first set, but an edit can no longer be used to
    // move the start date backward into the past. The one-year span cap
    // still always applies, on both create and edit.
    const startDateUnchanged =
      parseDateOnly(start_date) && parseDateOnly(mRows[0].start_date) &&
      parseDateOnly(start_date).getTime() === parseDateOnly(mRows[0].start_date).getTime();
    const dateError = validateMilestoneDates(start_date, due_date, { enforceNotBeforeToday: !startDateUnchanged });
    if (dateError) {
      return res.status(400).json({ success: false, error: dateError });
    }

    // Only enforced once the group has actually set a project-level
    // window — same as createMilestone's equivalent check.
    const [overviewRows] = await dbPromise.query(
      'SELECT start_date, end_date FROM project_overviews WHERE group_id = ?',
      [mRows[0].group_id]
    );
    if (overviewRows.length > 0) {
      const windowError = validateMilestoneWithinProjectWindow(
        start_date, due_date, overviewRows[0].start_date, overviewRows[0].end_date
      );
      if (windowError) {
        return res.status(400).json({ success: false, error: windowError });
      }
    }

    if (userRole === 'student') {
      const [leaderRows] = await dbPromise.query(
        'SELECT 1 FROM project_group_members WHERE student_id = ? AND group_id = ? AND is_leader = 1',
        [userId, mRows[0].group_id]
      );
      if (leaderRows.length === 0) {
        return res.status(403).json({ success: false, error: 'Only the group leader can edit milestone details.' });
      }
    }

    await dbPromise.query(
      `UPDATE milestones SET title = ?, description = ?, start_date = ?, due_date = ? WHERE id = ?`,
      [title, description || null, start_date || null, due_date || null, id]
    );

    res.status(200).json({ success: true, message: 'Milestone updated successfully.' });
  } catch (error) {
    console.error('❌ Error updating milestone details:', error);
    res.status(500).json({ success: false, error: 'Failed to update milestone.' });
  }
};



/**
 * DELETE: Remove a milestone (and all its tasks via Cascade).
 */

const deleteMilestone = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    // Access Control: Must belong to the group that owns the milestone
    const [mRows] = await dbPromise.query('SELECT group_id FROM milestones WHERE id = ?', [id]);
    if (mRows.length > 0 && userId && userRole === 'student') {
      const isMember = await verifyMembership(userId, userRole, mRows[0].group_id);
      if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    await dbPromise.query(`DELETE FROM milestones WHERE id = ?`, [id]);
    res.status(200).json({ success: true, message: 'Milestone deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting milestone:', error);
    res.status(500).json({ success: false, error: 'Failed to delete milestone.' });
  }
};





// SCOPE DIVISION CONTROLLERS

/**
 * GET: List a group's (project-wide) scope sections, with the creator's
 * name resolved (`claimed_by` — every section has an owner from the moment
 * it's created, there's no separate claim step any more). Visible to every
 * group member, unchanged.
 */
const getScopeSectionsByGroup = async (req, res) => {
  try {
    await ensureScopeSectionsTable();
    const { groupId } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (userId && userRole === 'student') {
      const isMember = await verifyMembership(userId, userRole, groupId);
      if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const [rows] = await dbPromise.query(
      `SELECT s.id, s.group_id, s.title, s.description, s.claimed_by, s.claimed_at,
              u.name AS claimed_by_name
       FROM project_scope_sections s
       LEFT JOIN users u ON u.id = s.claimed_by
       WHERE s.group_id = ?
       ORDER BY s.created_at ASC`,
      [groupId]
    );

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('❌ Error fetching scope sections:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch scope sections.' });
  }
};

/**
 * POST: Create a new scope section for the whole project (group) — open to
 * any group member, not just the leader. Creating a section is the only
 * step: it sets `claimed_by` to the calling student's own verified id
 * immediately, in the same insert. There is no separate "claim" action any
 * more (see Supersedes note in the prompt this replaced — claimScopeSection
 * has been removed entirely, not just hidden).
 *
 * Capped at one section per student per project — a student who already
 * owns a section here must edit or delete that one rather than create a
 * second.
 */
const createScopeSection = async (req, res) => {
  try {
    await ensureScopeSectionsTable();
    const { groupId } = req.params;
    const { title, description } = req.body;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!groupId || !title) {
      return res.status(400).json({ success: false, error: 'groupId and title are required.' });
    }
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User not identified.' });
    }

    if (userRole === 'student') {
      const isMember = await verifyMembership(userId, userRole, groupId);
      if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });

      const [existingOwn] = await dbPromise.query(
        `SELECT id, title FROM project_scope_sections WHERE group_id = ? AND claimed_by = ?`,
        [groupId, userId]
      );
      if (existingOwn.length > 0) {
        return res.status(409).json({
          success: false,
          error: `You've already created "${existingOwn[0].title}" for this project — you can only own one section per project. Edit that one instead.`,
        });
      }
    }

    const [result] = await dbPromise.query(
      `INSERT INTO project_scope_sections (group_id, title, description, claimed_by) VALUES (?, ?, ?, ?)`,
      [groupId, title, description || null, userId]
    );

    res.status(201).json({ success: true, message: 'Scope section created.', data: { id: result.insertId } });
  } catch (error) {
    console.error('❌ Error creating scope section:', error);
    res.status(500).json({ success: false, error: 'Failed to create scope section.' });
  }
};

/**
 * PUT: Edit a scope section's title/description. Owner-only — only the
 * student who created this specific section may edit it (no leader
 * override; creating a section makes it exclusively the creator's). Looked
 * up fresh at request time, never trusted from the client.
 */
const updateScopeSection = async (req, res) => {
  try {
    await ensureScopeSectionsTable();
    const { id } = req.params;
    const { title, description } = req.body;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Title is required.' });
    }

    const [sRows] = await dbPromise.query(
      `SELECT id, group_id, claimed_by FROM project_scope_sections WHERE id = ?`,
      [id]
    );
    if (sRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Scope section not found.' });
    }

    if (userRole === 'student' && String(sRows[0].claimed_by) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'You can only edit a scope section you created yourself.' });
    }

    await dbPromise.query(
      `UPDATE project_scope_sections SET title = ?, description = ? WHERE id = ?`,
      [title.trim(), description || null, id]
    );

    res.status(200).json({ success: true, message: 'Scope section updated.' });
  } catch (error) {
    console.error('❌ Error updating scope section:', error);
    res.status(500).json({ success: false, error: 'Failed to update scope section.' });
  }
};

/**
 * DELETE: Remove a scope section entirely. Same owner-only rule as editing
 * — no leader override.
 */
const deleteScopeSection = async (req, res) => {
  try {
    await ensureScopeSectionsTable();
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    const [sRows] = await dbPromise.query(
      `SELECT id, group_id, claimed_by FROM project_scope_sections WHERE id = ?`,
      [id]
    );
    if (sRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Scope section not found.' });
    }

    if (userRole === 'student') {
      const isOwner = String(sRows[0].claimed_by) === String(userId);
      // An orphaned section (claimed_by NULL, or referencing an account
      // that no longer exists) has no owner to ever delete it under the
      // owner-only rule above — left over from before every section
      // always got an owner at creation. Any group member may clear one
      // of these out, rather than leaving it permanently stuck.
      const isOrphaned = sRows[0].claimed_by == null;
      if (!isOwner && !isOrphaned) {
        return res.status(403).json({ success: false, error: 'You can only delete a scope section you created yourself.' });
      }
      if (!isOwner) {
        const isMember = await verifyMembership(userId, userRole, sRows[0].group_id);
        if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });
      }
    }

    await dbPromise.query(`DELETE FROM project_scope_sections WHERE id = ?`, [id]);

    res.status(200).json({ success: true, message: 'Scope section deleted.' });
  } catch (error) {
    console.error('❌ Error deleting scope section:', error);
    res.status(500).json({ success: false, error: 'Failed to delete scope section.' });
  }
};








 
// STUDENT TASKS CONTROLLERS



 
/**
 * POST: Create a specific work item within a Milestone.
 */
const createStudentTask = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureTaskStartDateColumn();
    const { milestone_id, assigned_to, task_name, description, due_date, start_date } = req.body;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!milestone_id || !assigned_to || !task_name) {
      return res.status(400).json({ success: false, error: 'milestone_id, assigned_to, and task_name are required.' });
    }

    // Access Control: Must belong to the group that owns the milestone.
    // Also pulls the milestone's own start_date/due_date in the same
    // query — needed right below to check this task's dates fall within
    // its milestone's range.
    const [mRows] = await dbPromise.query(
      'SELECT group_id, start_date, due_date FROM milestones WHERE id = ?',
      [milestone_id]
    );
    if (mRows.length > 0 && userId && userRole === 'student') {
      const isMember = await verifyMembership(userId, userRole, mRows[0].group_id);
      if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    // A student may only ever create a task assigned to themselves — leader
    // assigning work to a teammate has been retired in favor of "every
    // student adds their own tasks". Non-student callers (coordinator/
    // supervisor/admin tooling, if any) are left unrestricted here.
    if (userRole === 'student' && String(assigned_to) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'Students can only create tasks for themselves.' });
    }

    // Defaults to today when omitted, matching the quick-add form's own
    // default (MilestoneProgressBoard.tsx's emptyQuickAddForm) — a task
    // otherwise has no start_date to validate or store at all.
    const effectiveStartDate = start_date || todayDateOnlyString();

    // A brand-new task can't be backdated into the past — same rule
    // milestone creation already enforces (validateMilestoneDates).
    const startDateOnly = parseDateOnly(effectiveStartDate);
    if (startDateOnly && startDateOnly < todayDateOnly()) {
      return res.status(400).json({ success: false, error: 'Start date cannot be before today.' });
    }

    const dueDateOnly = parseDateOnly(due_date);
    if (startDateOnly && dueDateOnly && startDateOnly > dueDateOnly) {
      return res.status(400).json({ success: false, error: 'Start date cannot be later than the due date.' });
    }

    if (mRows.length > 0) {
      const rangeError = validateTaskDatesWithinMilestone(
        effectiveStartDate,
        due_date,
        mRows[0].start_date,
        mRows[0].due_date
      );
      if (rangeError) {
        return res.status(400).json({ success: false, error: rangeError });
      }
    }

    // Insert task assigned to a specific user ID
    const [result] = await dbPromise.query(
      `INSERT INTO student_tasks (milestone_id, assigned_to, task_name, description, due_date, start_date) VALUES (?, ?, ?, ?, ?, ?)`,
      [milestone_id, assigned_to, task_name, description || null, due_date || null, effectiveStartDate]
    );

    res.status(201).json({ success: true, message: 'Task created successfully', data: { id: result.insertId } });
  } catch (error) {
    console.error('❌ Error creating student task:', error);
    res.status(500).json({ success: false, error: 'Failed to create task.' });
  }
};





/**
 * GET: Fetch tasks assigned to a specific student.
 */

const getTasksByMilestone = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { milestoneId } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
 
// Security: You can't spy on other students' tasks
    const [mRows] = await dbPromise.query('SELECT group_id FROM milestones WHERE id = ?', [milestoneId]);
    if (mRows.length > 0 && userId && userRole === 'student') {
      const isMember = await verifyMembership(userId, userRole, mRows[0].group_id);
      if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });
    }
 // Join with milestones and tasks to show which phase the task belongs to
    const [tasks] = await dbPromise.query(
      `SELECT t.*, u.name AS assigned_to_name
       FROM student_tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.milestone_id = ? ORDER BY t.created_at ASC`,
      [milestoneId]
    );

    res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks.' });
  }
};





const getTasksByStudent = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureTaskFileColumns();
    const { studentId } = req.params;
    const authUserId = req.headers['x-user-id'];

    // Access Control: Student can only fetch their own tasks
    if (authUserId && String(authUserId) !== String(studentId)) {
      return res.status(403).json({ success: false, error: 'Access denied. You can only view your own tasks.' });
    }
    // Optional group_id query param — if provided, scope tasks to that group's project only
    const groupId = req.query.groupId ? Number(req.query.groupId) : null;

    let query, params;
    if (groupId) {
      // Return only tasks that belong to milestones of this specific group
      query = `SELECT t.*, m.title AS milestone_title, m.group_id AS group_id
               FROM student_tasks t
               JOIN milestones m ON t.milestone_id = m.id
               WHERE t.assigned_to = ? AND m.group_id = ?
               ORDER BY t.due_date ASC`;
      params = [studentId, groupId];
    } else {
      // Fallback: return all tasks for the student (kept for backward compatibility)
      query = `SELECT t.*, m.title AS milestone_title, m.group_id AS group_id
               FROM student_tasks t
               JOIN milestones m ON t.milestone_id = m.id
               WHERE t.assigned_to = ?
               ORDER BY t.due_date ASC`;
      params = [studentId];
    }

    const [tasks] = await dbPromise.query(query, params);
    res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    console.error('❌ Error fetching student tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks.' });
  }
};






// Strict group-scoped "My Tasks" — only tasks from the student's specific group project


const getTasksByStudentAndGroup = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureTaskFileColumns();
    const { studentId, groupId } = req.params;

    console.log(`📡 [Backend] Fetching tasks for Student: ${studentId}, Group: ${groupId}`);

    const [tasks] = await dbPromise.query(
      `SELECT t.id, t.milestone_id, t.assigned_to, t.task_name, t.description,
              t.status, t.due_date, t.created_at, t.file_name, t.file_url,
              m.title AS milestone_title, m.group_id AS group_id,
              u.name AS assigned_to_name
       FROM student_tasks t
       JOIN milestones m ON t.milestone_id = m.id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.assigned_to = ? AND m.group_id = ?
       ORDER BY t.due_date ASC`,
      [studentId, groupId]
    );

    console.log(`✅ [Backend] Found ${tasks.length} tasks for Student ${studentId} in Group ${groupId}`);
    res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    console.error('❌ Error fetching tasks by student and group:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks.' });
  }
};






const getTasksByGroup = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureCompletedAtColumn();
    await ensureTaskFileColumns();
    const { groupId } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    // Access Control
    if (userId && userRole) {
      const isMember = await verifyMembership(userId, userRole, groupId);
      if (!isMember) {
        return res.status(403).json({ success: false, error: 'Access denied. You are not a member of this group.' });
      }
    }

    const [tasks] = await dbPromise.query(
      `SELECT t.id AS id, t.milestone_id AS milestone_id, t.assigned_to AS assigned_to,
              t.task_name AS task_name, t.description AS description, t.status AS status,
              t.due_date AS due_date, t.created_at AS created_at, t.completed_at AS completed_at,
              t.file_name AS file_name, t.file_url AS file_url,
              u.name AS assigned_to_name, m.title AS milestone_title
       FROM student_tasks t
       JOIN milestones m ON t.milestone_id = m.id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE m.group_id = ? ORDER BY t.created_at ASC`,
      [groupId]
    );

    res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    console.error('❌ Error fetching tasks by group:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks.' });
  }
};








/**
 * PATCH: Update the progress status (TODO, IN_PROGRESS, COMPLETED).
 * Security: Students can ONLY update tasks assigned to themselves.
  */

const updateTaskStatus = async (req, res) => {
  try {
    await ensureMilestoneTables();
    await ensureCompletedAtColumn();
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.headers['x-user-id'];

    if (!['TODO', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status.' });
    }

    // Access Control: Student can only update status of tasks assigned to THEM
    const [tRows] = await dbPromise.query('SELECT assigned_to FROM student_tasks WHERE id = ?', [id]);
    if (tRows.length > 0 && userId && String(tRows[0].assigned_to) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'Access denied. You can only update your own tasks.' });
    }

    // completed_at tracks when a task actually became COMPLETED (for the "My
    // Progress" tab's timeline); cleared if a task is ever moved back off
    // COMPLETED, since it isn't "done" anymore.
    await dbPromise.query(
      `UPDATE student_tasks SET status = ?, completed_at = ? WHERE id = ?`,
      [status, status === 'COMPLETED' ? new Date() : null, id]
    );

    res.status(200).json({ success: true, message: 'Task status updated successfully' });
  } catch (error) {
    console.error('❌ Error updating task status:', error);
    res.status(500).json({ success: false, error: 'Failed to update task status.' });
  }
};








// DELETE: permanently remove a task — a real hard delete, no undo. A
// student may only ever delete their own task, matching createStudentTask's
// "self-assign only" restriction (there's no leader-manages-others'-tasks
// model to defer to here).
const deleteTask = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { id } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (userRole === 'student') {
      const [taskRows] = await dbPromise.query('SELECT assigned_to FROM student_tasks WHERE id = ?', [id]);
      if (taskRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found.' });
      }
      if (String(taskRows[0].assigned_to) !== String(userId)) {
        return res.status(403).json({ success: false, error: 'You can only delete your own tasks.' });
      }
    }

    await dbPromise.query(`DELETE FROM student_tasks WHERE id = ?`, [id]);
    res.status(200).json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting task:', error);
    res.status(500).json({ success: false, error: 'Failed to delete task.' });
  }
};

/**
 * POST: Attach one file to an already-created task — uploaded to
 * Cloudinary the exact same way Project Stage files (uploadStageFile,
 * projectController.js) and group Submissions (submissionController.js)
 * already are, via the shared upload.single('file') middleware and
 * uploadBufferToCloudinary helper. Its own dedicated Cloudinary folder
 * (CLOUDINARY_TASK_FOLDER, default 'task-attachments') keeps these from
 * ever mixing in with Stage files or Submissions. Optional and
 * creation-time-only for now — called right after a successful task
 * create (see MilestoneProgressBoard.tsx's quick-add form); there's no
 * "edit a task" endpoint yet to attach one later.
 */
const uploadTaskFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }

    const { task_id } = req.body;
    if (!task_id) {
      return res.status(400).json({ success: false, error: 'task_id is required' });
    }

    await ensureMilestoneTables();
    await ensureTaskFileColumns();

    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    // Access Control: a student may only attach a file to their own
    // task — same self-only rule updateTaskStatus/deleteTask enforce.
    const [taskRows] = await dbPromise.query('SELECT assigned_to FROM student_tasks WHERE id = ?', [task_id]);
    if (taskRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }
    if (userRole === 'student' && String(taskRows[0].assigned_to) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'You can only attach a file to your own task.' });
    }

    const cloudFolder = process.env.CLOUDINARY_TASK_FOLDER || 'task-attachments';
    const cloudResult = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, cloudFolder);
    const fileUrl = cloudResult.secure_url || cloudResult.url
      || (cloudResult.public_id ? cloudinary.url(cloudResult.public_id, { resource_type: 'auto' }) : null);

    if (!fileUrl) {
      throw new Error('Cloudinary upload succeeded but no URL was returned');
    }

    await dbPromise.query(
      `UPDATE student_tasks SET file_name = ?, file_url = ? WHERE id = ?`,
      [req.file.originalname, fileUrl, task_id]
    );

    res.status(200).json({ success: true, file_name: req.file.originalname, file_url: fileUrl });
  } catch (error) {
    console.error('❌ Error uploading task file:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to upload task file.' });
  }
};

  





// PROJECT OVERVIEW CONTROLLERS
 /**
 * POST: Save or Update the project duration and workflow type.
 * Uses "ON DUPLICATE KEY UPDATE" to handle both create and update in one query.
 */

const upsertOverview = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { group_id, start_date, end_date, workflow_name } = req.body;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!group_id) {
      return res.status(400).json({ success: false, error: 'group_id is required.' });
    }

    // Not-before-today only applies when the start date is actually being
    // changed from what's already stored — same "changed value" exemption
    // milestones use, adapted for the fact this is always a single upsert
    // (no separate create/edit action to distinguish here).
    const [existingRows] = await dbPromise.query(
      'SELECT start_date FROM project_overviews WHERE group_id = ?',
      [group_id]
    );
    const startDateUnchanged =
      existingRows.length > 0 &&
      parseDateOnly(start_date) && parseDateOnly(existingRows[0].start_date) &&
      parseDateOnly(start_date).getTime() === parseDateOnly(existingRows[0].start_date).getTime();

    const dateError = validateProjectOverviewDates(start_date, end_date, { enforceNotBeforeToday: !startDateUnchanged });
    if (dateError) {
      return res.status(400).json({ success: false, error: dateError });
    }

    // Access Control
    if (userId && userRole === 'student') {
      const isMember = await verifyMembership(userId, userRole, group_id);
      if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    await dbPromise.query(
      `INSERT INTO project_overviews (group_id, start_date, end_date, workflow_name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_date = ?, end_date = ?, workflow_name = ?`,
      [group_id, start_date || null, end_date || null, workflow_name || null, start_date || null, end_date || null, workflow_name || null]
    );

    res.status(200).json({ success: true, message: 'Overview saved successfully' });
  } catch (error) {
    console.error('❌ Error saving overview:', error);
    res.status(500).json({ success: false, error: 'Failed to save overview.' });
  }
};





/**
 * GET: Retrieve the high-level project timeline for a group.
 */

const getOverviewByGroup = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { groupId } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    // Access Control
    if (userId && userRole === 'student') {
      const isMember = await verifyMembership(userId, userRole, groupId);
      if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const [overviews] = await dbPromise.query(
      `SELECT * FROM project_overviews WHERE group_id = ?`,
      [groupId]
    );

    if (overviews.length > 0) {
      res.status(200).json({ success: true, data: overviews[0] });
    } else {
      res.status(200).json({ success: true, data: null });
    }
  } catch (error) {
    console.error('❌ Error fetching overview:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch overview.' });
  }
};

module.exports = {
  createMilestone,
  getMilestonesByGroup,
  updateMilestoneStatus,
  updateMilestoneDetails,
  getUnseenFeedbackCount,
  markGroupFeedbackSeen,
  deleteMilestone,
  createStudentTask,
  getTasksByMilestone,
  getTasksByStudent,
  getTasksByStudentAndGroup,
  getTasksByGroup,
  updateTaskStatus,
  deleteTask,
  uploadTaskFile,
  upsertOverview,
  getOverviewByGroup,
  getScopeSectionsByGroup,
  createScopeSection,
  updateScopeSection,
  deleteScopeSection
};
