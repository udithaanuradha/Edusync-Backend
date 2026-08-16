const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.error('Connection failed:', err);
    process.exit(1);
  }
  console.log('✅ Connected to database');
  insertTestData();
});

const insertTestData = () => {
  // Insert test students
  const studentsSql = `INSERT INTO users (name, email, password, role, university_id, phone) VALUES 
    ('Kumari Silva', 'kumari@test.com', 'password123', 'student', '2021001', '0771234567'),
    ('Nimal Bandara', 'nimal@test.com', 'password123', 'student', '2021002', '0772345678'),
    ('Asha Perera', 'asha@test.com', 'password123', 'student', '2021003', '0773456789')`;

  db.query(studentsSql, (err) => {
    if (err) {
      console.error('Insert students error:', err.message);
    } else {
      console.log('✅ Students inserted');
    }

    // Insert supervisor
    const supervisorSql = `INSERT INTO users (name, email, password, role, phone) VALUES 
      ('Dr. Jayasena', 'jayasena@test.com', 'password123', 'supervisor', '0714567890')`;

    db.query(supervisorSql, (err) => {
      if (err) {
        console.error('Insert supervisor error:', err.message);
      } else {
        console.log('✅ Supervisor inserted');
      }

      // Insert approved group request
      const requestSql = `INSERT INTO group_requests (group_name, members_list, request_message, student_id, supervisor_id, status, project_level) 
        VALUES ('Team Alpha', 'Leader: Kumari Silva (2021001), Members: Nimal Bandara (2021002)', 'Project: AI Chatbot', 1, 4, 'approved', 2)`;

      db.query(requestSql, (err) => {
        if (err) {
          console.error('Insert request error:', err.message);
        } else {
          console.log('✅ Group request inserted');
        }

        // Insert project group
        const groupSql = `INSERT INTO project_groups (group_name, level, supervisor_id) VALUES 
          ('Team Alpha', 2, 4)`;

        db.query(groupSql, (err) => {
          if (err) {
            console.error('Insert group error:', err.message);
          } else {
            console.log('✅ Project group inserted');
          }

          // Insert group members
          const membersSql = `INSERT INTO project_group_members (group_id, student_id, is_leader) VALUES 
            (1, 1, 1), (1, 2, 0)`;

          db.query(membersSql, (err) => {
            if (err) {
              console.error('Insert members error:', err.message);
            } else {
              console.log('✅ Group members inserted');
            }
            console.log('✨ Test data insertion complete!');
            db.end();
            process.exit(0);
          });
        });
      });
    });
  });
};
