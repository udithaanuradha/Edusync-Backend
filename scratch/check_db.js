const db = require('../src/config/db');

db.query('SELECT * FROM project_groups WHERE level = 1', (err, results) => {
  if (err) {
    console.error(err);
  } else {
    console.log('Level 1 Groups:', results);
  }
  process.exit();
});
