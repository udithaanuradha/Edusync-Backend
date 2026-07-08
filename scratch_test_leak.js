const db = require('./src/config/db');
const dbPromise = db.promise();

async function testNullLeak() {
  try {
    // 1. Create a user with NULL university_id
    const leakyUserId = 88801;
    await dbPromise.query(
      'INSERT IGNORE INTO users (id, name, university_id, role, level, email, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [leakyUserId, 'Leaky User', null, 'student', 1, 'leaky@test.com', 'pass']
    );

    // 2. Create a group request for a DIFFERENT student
    const groupName = 'Secret Group';
    const leaderId = 99901;
    await dbPromise.query(
      'INSERT INTO group_requests (group_name, members_list, student_id, project_level, status, supervisor_id) VALUES (?, ?, ?, ?, ?, ?)',
      [groupName, 'Leader: Leader, Members: ID_SECRET', leaderId, 1, 'pending', 150001]
    );

    const checkStatus = async (studentId) => {
      const [userRows] = await dbPromise.query('SELECT university_id FROM users WHERE id = ?', [studentId]);
      const universityId = userRows[0].university_id;
      
      const [results] = await dbPromise.query(
        `SELECT * FROM group_requests 
         WHERE student_id = ? 
            OR (? != '' AND ? IS NOT NULL AND members_list LIKE ?) 
         ORDER BY created_at DESC`,
        [studentId, universityId || '', universityId, `%${universityId}%`]
      );
      return results;
    };

    console.log('--- Leak Test Results ---');
    
    const leakResults = await checkStatus(leakyUserId);
    console.log(`Leaky User (88801, NULL university_id) sees ${leakResults.length} requests. (Expected: 0)`);

    const leaderResults = await checkStatus(leaderId);
    console.log(`Leader (99901) sees ${leaderResults.length} requests. (Expected: 1)`);

    // Clean up
    await dbPromise.query('DELETE FROM group_requests WHERE group_name = ?', [groupName]);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

testNullLeak();
