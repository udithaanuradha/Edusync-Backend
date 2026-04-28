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

// ==========================================
// MILESTONE CONTROLLERS
// ==========================================

const createMilestone = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { group_id, title, description, start_date, due_date } = req.body;

    if (!group_id || !title) {
      return res.status(400).json({ success: false, error: 'group_id and title are required.' });
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

const getMilestonesByGroup = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { groupId } = req.params;

    const [milestones] = await dbPromise.query(
      `SELECT * FROM milestones WHERE group_id = ? ORDER BY created_at ASC`,
      [groupId]
    );

    res.status(200).json({ success: true, data: milestones });
  } catch (error) {
    console.error('❌ Error fetching milestones:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch milestones.' });
  }
};

const updateMilestoneStatus = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { id } = req.params;
    const { status, feedback_reason } = req.body;

    if (!['PENDING', 'REJECTED', 'APPROVED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status.' });
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

const deleteMilestone = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { id } = req.params;

    await dbPromise.query(`DELETE FROM milestones WHERE id = ?`, [id]);
    res.status(200).json({ success: true, message: 'Milestone deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting milestone:', error);
    res.status(500).json({ success: false, error: 'Failed to delete milestone.' });
  }
};


// ==========================================
// STUDENT TASKS CONTROLLERS
// ==========================================

const createStudentTask = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { milestone_id, assigned_to, task_name, description, due_date } = req.body;

    if (!milestone_id || !assigned_to || !task_name) {
      return res.status(400).json({ success: false, error: 'milestone_id, assigned_to, and task_name are required.' });
    }

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

const getTasksByMilestone = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { milestoneId } = req.params;

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
    const { studentId } = req.params;

    const [tasks] = await dbPromise.query(
      `SELECT t.*, m.title AS milestone_title 
       FROM student_tasks t
       JOIN milestones m ON t.milestone_id = m.id
       WHERE t.assigned_to = ? ORDER BY t.due_date ASC`,
      [studentId]
    );

    res.status(200).json({ success: true, data: tasks });
  } catch (error) {
    console.error('❌ Error fetching student tasks:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tasks.' });
  }
};

const updateTaskStatus = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { id } = req.params;
    const { status } = req.body;

    if (!['TODO', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status.' });
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

// ==========================================
// PROJECT OVERVIEW CONTROLLERS
// ==========================================

const upsertOverview = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { group_id, start_date, end_date, workflow_name } = req.body;

    if (!group_id) {
      return res.status(400).json({ success: false, error: 'group_id is required.' });
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

const getOverviewByGroup = async (req, res) => {
  try {
    await ensureMilestoneTables();
    const { groupId } = req.params;

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
  updateTaskStatus,
  deleteTask,
  upsertOverview,
  getOverviewByGroup
};
