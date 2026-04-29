const express = require('express');
const router = express.Router();

const { getCoordinatorSummary } = require('../controllers/dashboardController');

router.get('/coordinator/summary', getCoordinatorSummary);

module.exports = router;