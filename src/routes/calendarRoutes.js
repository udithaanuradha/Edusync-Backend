const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ---------------------------------------------------------
// 1. SCHEDULE EVALUATION PANEL (From your slide-out drawer)
// ---------------------------------------------------------
router.post('/panels', async (req, res) => {
    const { evaluationType, academicLevel, targetGroup, evaluators, panelDate, startTime, duration, location } = req.body;
    
    try {
        const evaluatorsString = JSON.stringify(evaluators); // Convert array to string
        const query = `
            INSERT INTO evaluation_panels 
            (evaluation_type, academic_level, target_group, evaluators, panel_date, start_time, duration, location) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        // Notice the .promise() added here!
        await db.promise().query(query, [evaluationType, academicLevel, targetGroup, evaluatorsString, panelDate, startTime, duration, location]);
        
        res.status(201).json({ message: "Evaluation panel scheduled successfully!" });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: "Failed to schedule panel" });
    }
});

// ---------------------------------------------------------
// 2. FETCH UPCOMING PANELS (For the right sidebar)
// ---------------------------------------------------------
router.get('/panels', async (req, res) => {
    try {
        const query = "SELECT * FROM evaluation_panels WHERE panel_date >= CURRENT_DATE ORDER BY panel_date ASC, start_time ASC LIMIT 5";
        
        // Notice the .promise() added here!
        const [results] = await db.promise().query(query);
        
        res.status(200).json(results);
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: "Failed to fetch upcoming panels" });
    }
});

// ---------------------------------------------------------
// 3. FREEZE A DATE (From the top right button)
// ---------------------------------------------------------
router.post('/freeze', async (req, res) => {
    const { frozen_date, reason, type, created_by } = req.body;
    
    try {
        const query = "INSERT INTO frozen_dates (frozen_date, reason, type, created_by) VALUES (?, ?, ?, ?)";
        
        // Notice the .promise() added here!
        await db.promise().query(query, [frozen_date, reason, type, created_by]);
        
        res.status(201).json({ message: "Date successfully frozen!" });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: "Failed to freeze date" });
    }
});

// ---------------------------------------------------------
// 4. FETCH FROZEN DATES (To put colored dots on the calendar)
// ---------------------------------------------------------
router.get('/frozen-dates', async (req, res) => {
    try {
        const query = "SELECT * FROM frozen_dates ORDER BY frozen_date ASC";
        
        // Notice the .promise() added here!
        const [results] = await db.promise().query(query);
        
        res.status(200).json(results);
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ error: "Failed to fetch frozen dates" });
    }
});

module.exports = router;