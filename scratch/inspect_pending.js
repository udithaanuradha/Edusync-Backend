const dbPromise = require('../src/config/db').promise();

(async () => {
  try {
    const [reqs] = await dbPromise.query(
      `SELECT request_id, student_id, group_name, project_level, status, supervisor_id, is_group_created, created_group_id, created_at
       FROM group_requests ORDER BY created_at DESC LIMIT 15`
    );
    console.log('=== recent group_requests ===');
    console.table(reqs);

    const [gs] = await dbPromise.query(
      `SELECT * FROM group_request_supervisors ORDER BY id DESC LIMIT 20`
    );
    console.log('=== recent group_request_supervisors ===');
    console.table(gs);

    const [t1] = await dbPromise.query(`SHOW TABLES LIKE 'group_request_supervisors'`);
    console.log('group_request_supervisors table exists:', t1.length > 0);

    const [t2] = await dbPromise.query(`SHOW TABLES LIKE 'group_request_members'`);
    console.log('group_request_members table exists:', t2.length > 0);
  } catch (e) {
    console.error('ERROR', e);
  } finally {
    process.exit(0);
  }
})();
