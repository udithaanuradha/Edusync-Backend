const db = require('./src/config/db');

db.query('SHOW CREATE TABLE users', (err, rows) => {
  if (err) {
    console.error('SHOW_CREATE_ERR', err);
    process.exit(1);
  }
  console.log(JSON.stringify(rows, null, 2));
  db.end(() => process.exit(0));
});
