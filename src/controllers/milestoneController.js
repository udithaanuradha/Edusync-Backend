const db = require('../config/db');
const dbPromise = db.promise();

let ensureTablesPromise = null;

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

    // Access Control
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
              feedback_reason AS feedback_reason, created_at AS created_at
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



//Supervisor approves or rejects a milestone with feedback reason. Only Supervisors, Coordinators, or Admins can perform this action.
const updateMilestoneStatus = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { id } = req.params;
    const { status, feedback_reason } = req.body;
    const userRole = req.headers['x-user-role'];

    // Security: Only Supervisors, Coordinators, or Admins can update status
    if (userRole === 'student') {
      return res.status(403).json({ success: false, error: 'Access denied. Students cannot approve/reject milestones.' });
    }

    await dbPromise.query(
      `UPDATE milestones SET status = ?, feedback_reason = ? WHERE id = ?`,
      [status, feedback_reason || null, id]
    );

    res.status(200).json({ success: true, message: 'Milestone status updated successfully' });
  } catch (error) {
    console.error('❌ Error updating milestone status:', error);
    res.status(500).json({ success: false, error: 'Failed to update milestone status.' });
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









 
// STUDENT TASKS CONTROLLERS



 
/**
 * POST: Create a specific work item within a Milestone.
 */
const createStudentTask = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { milestone_id, assigned_to, task_name, description, due_date } = req.body;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    if (!milestone_id || !assigned_to || !task_name) {
      return res.status(400).json({ success: false, error: 'milestone_id, assigned_to, and task_name are required.' });
    }

    // Access Control: Must belong to the group that owns the milestone
    const [mRows] = await dbPromise.query('SELECT group_id FROM milestones WHERE id = ?', [milestone_id]);
    if (mRows.length > 0 && userId && userRole === 'student') {
      const isMember = await verifyMembership(userId, userRole, mRows[0].group_id);
      if (!isMember) return res.status(403).json({ success: false, error: 'Access denied.' });
    }
    // Insert task assigned to a specific user ID
    const [result] = await dbPromise.query(
      `INSERT INTO student_tasks (milestone_id, assigned_to, task_name, description, due_date) VALUES (?, ?, ?, ?, ?)`,
      [milestone_id, assigned_to, task_name, description || null, due_date || null]
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
      `SELECT t.*, u.name AS assigned_to_name 
       FROM student_tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.milestone_id = ? ORDER BY t.created_at ASC`,
      [milestoneId]
    ;

    res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks.' });
  }
};





const getTasksByStudent = async (req, res) => {
  try {
    await ensureMilestoneTables();
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
    const { studentId, groupId } = req.params;

    console.log(`📡 [Backend] Fetching tasks for Student: ${studentId}, Group: ${groupId}`);

    const [tasks] = await dbPromise.query(
      `SELECT t.id, t.milestone_id, t.assigned_to, t.task_name, t.description,
              t.status, t.due_date, t.created_at,
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
              t.due_date AS due_date, t.created_at AS created_at,
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

    await dbPromise.query(
      `UPDATE student_tasks SET status = ? WHERE id = ?`,
      [status, id]
    );

    res.status(200).json({ success: true, message: 'Task status updated successfully' });
  } catch (error) {
    console.error('❌ Error updating task status:', error);
    res.status(500).json({ success: false, error: 'Failed to update task status.' });
  }
};








// delete task 
const deleteTask = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { id } = req.params;

    await dbPromise.query(`DELETE FROM student_tasks WHERE id = ?`, [id]);
    res.status(200).json({ success: true, message: 'Task deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting task:', error);
    res.status(500).json({ success: false, error: 'Failed to delete task.' });
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
  deleteMilestone,
  createStudentTask,
  getTasksByMilestone,
  getTasksByStudent,
  getTasksByStudentAndGroup,
  getTasksByGroup,
  updateTaskStatus,
  deleteTask,
  upsertOverview,
  getOverviewByGroup
};
