const express = require('express');
const router = express.Router();
const {
    scheduleEvaluationPanel,
    getUpcomingPanels,
    completePanelsForGroups,
    deleteEvaluationPanel,
    freezeDate,
    getFrozenDates,
} = require('../controllers/calendarController');

// ---------------------------------------------------------
// 1. SCHEDULE EVALUATION PANEL (From your slide-out drawer)
// ---------------------------------------------------------
router.post('/panels', scheduleEvaluationPanel);

// ---------------------------------------------------------
// 2. FETCH UPCOMING PANELS (For the right sidebar)
// ---------------------------------------------------------
router.get('/panels', getUpcomingPanels);

// ---------------------------------------------------------
// 2.1 DELETE A PANEL
// ---------------------------------------------------------
router.delete('/panels/:id', deleteEvaluationPanel);

// ---------------------------------------------------------
// 2.2 COORDINATOR MARKS A GROUP'S EVALUATION CYCLE COMPLETE, TRIGGERED FROM
//     THE FINAL STAGE COLUMN (Reports/Gradebook) — clears ALL of that
//     group's panels, not just the Final one.
// ---------------------------------------------------------
router.put('/panels/complete-for-groups', completePanelsForGroups);

// ---------------------------------------------------------
// 3. FREEZE A DATE (From the top right button)
// ---------------------------------------------------------
router.post('/freeze', freezeDate);

// ---------------------------------------------------------
// 4. FETCH FROZEN DATES (To put colored dots on the calendar)
// ---------------------------------------------------------
router.get('/frozen-dates', getFrozenDates);

module.exports = router;