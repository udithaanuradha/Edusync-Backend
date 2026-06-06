const db = require('../config/db');

// GET all backups
exports.getAllBackups = (req, res) => {
    db.query(
        'SELECT * FROM backup_schedules ORDER BY scheduled_date ASC',
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error fetching backups", error: err.message });
            res.status(200).json(results);
        }
    );
};

// POST create a new backup schedule
exports.createBackup = (req, res) => {
    const { type, date, time } = req.body;
    if (!type || !date || !time)
        return res.status(400).json({ message: "Missing required fields" });

    db.query(
        'INSERT INTO backup_schedules (backup_type, scheduled_date, scheduled_time) VALUES (?, ?, ?)',
        [type, date, time],
        (err, result) => {
            if (err) return res.status(500).json({ message: "Error saving backup", error: err.message });
            res.status(201).json({ id: result.insertId, backup_type: type, scheduled_date: date, scheduled_time: time, status: 'Scheduled' });
        }
    );
};

// PUT update a backup
exports.updateBackup = (req, res) => {
    const { id } = req.params;
    const { type, date, time } = req.body;
    if (!type || !date || !time)
        return res.status(400).json({ message: "Missing required fields" });

    db.query(
        'UPDATE backup_schedules SET backup_type = ?, scheduled_date = ?, scheduled_time = ? WHERE id = ?',
        [type, date, time, id],
        (err, result) => {
            if (err) return res.status(500).json({ message: "Error updating backup", error: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ message: "Backup not found" });
            res.status(200).json({ message: "Backup updated successfully" });
        }
    );
};

// DELETE a backup
exports.deleteBackup = (req, res) => {
    const { id } = req.params;
    db.query(
        'DELETE FROM backup_schedules WHERE id = ?',
        [id],
        (err, result) => {
            if (err) return res.status(500).json({ message: "Error deleting backup", error: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ message: "Backup not found" });
            res.status(200).json({ message: "Backup deleted successfully" });
        }
    );
};