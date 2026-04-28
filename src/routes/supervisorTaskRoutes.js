const express = require("express");
const {
  getTasks,
  addTask,
  editTask,
  removeTask,
} = require("../controllers/supervisorTaskController");
const router = express.Router();

router.get("/:supervisorId", getTasks);
router.post("/:supervisorId", addTask);
router.put("/:supervisorId/:taskId", editTask);
router.delete("/:supervisorId/:taskId", removeTask);

module.exports = router;
