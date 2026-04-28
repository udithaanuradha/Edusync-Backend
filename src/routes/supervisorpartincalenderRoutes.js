const express = require("express");
const {
  getWeeklySchedule,
  saveWeeklySchedule,
} = require("../controllers/supervisorpartincalenderController");

const router = express.Router();

router.get("/", getWeeklySchedule);
router.get("/:supervisorId", getWeeklySchedule);
router.post("/", saveWeeklySchedule);
router.put("/:supervisorId", saveWeeklySchedule);

module.exports = router;
