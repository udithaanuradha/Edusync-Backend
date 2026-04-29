const db = require('../config/db');

// GET all backups
exports.getAllBackups = (req, res) => {
    db.query(
        'SELECT * FROM backup_schedules ORDER BY scheduled_date ASC',
        (err, results) => {
            if (err) {
                console.error("❌ Error fetching backups:", err);
                return res.status(500).json({ message: "Error fetching backups", error: err.message });
            }
            res.status(200).json(results);
        }
    );
};

// POST create a new backup schedule
exports.createBackup = (req, res) => {
    const { type, date, time } = req.body;

    if (!type || !date || !time) {
        return res.status(400).json({ 
            message: "Missing required fields: type, date, and time are required." 
        });
    }

    db.query(
        'INSERT INTO backup_schedules (backup_type, scheduled_date, scheduled_time) VALUES (?, ?, ?)',
        [type, date, time],
        (err, result) => {
            if (err) {
                console.error("❌ Error saving backup:", err);
                return res.status(500).json({ message: "Error saving backup", error: err.message });
            }
            res.status(201).json({ 
                id: result.insertId, 
                backup_type: type, 
                scheduled_date: date, 
                scheduled_time: time,
                status: 'Scheduled'
            });
        }
    );
};