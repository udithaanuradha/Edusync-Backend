-- EduSync Database Setup File
-- Use these commands to recreate the database tables if needed.
USE test;

-- 1. Create the Users Table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    university_id VARCHAR(50) DEFAULT NULL UNIQUE,
    phone VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- For existing databases, run these once if constraints are missing:
-- ALTER TABLE users ADD CONSTRAINT unique_email UNIQUE (email);
-- ALTER TABLE users ADD CONSTRAINT unique_university_id UNIQUE (university_id);

-- 2. Create the Project Stages Table
CREATE TABLE project_stages (
    stage_id INT AUTO_INCREMENT PRIMARY KEY,
    stage_name VARCHAR(255) NOT NULL,
    description TEXT,
    deadline DATE
);

-- 3. Create the Stage Files Table (For Guideline Documents)
CREATE TABLE group_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    group_name VARCHAR(255) NOT NULL,
    members_list TEXT NOT NULL,
    request_message TEXT,
    student_id INT NOT NULL, 
    supervisor_id INT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    rejection_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_gr_student FOREIGN KEY (student_id) REFERENCES users(id),
    CONSTRAINT fk_gr_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id)
);
ALTER TABLE group_requests 
ADD COLUMN is_final_submitted BOOLEAN DEFAULT FALSE;
ALTER TABLE group_requests 
ADD COLUMN project_level INT NOT NULL;

-- 4. Create the Project Groups Table
CREATE TABLE project_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_name VARCHAR(255) NOT NULL,
    level INT NOT NULL,
    supervisor_id INT,
    created_by INT NOT NULL,  -- the coordinator who created the group
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pg_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id),
    CONSTRAINT fk_pg_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 5. Create the Messages Table (For Communication Feature)
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    sender_name VARCHAR(255) NOT NULL,
    sender_role VARCHAR(50) NOT NULL,
    receiver_id INT NOT NULL,
    receiver_name VARCHAR(255) NOT NULL,
    receiver_role VARCHAR(50) NOT NULL,
    message_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_status BOOLEAN DEFAULT false,
    CONSTRAINT fk_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_receiver FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_conversation (sender_id, receiver_id),
    INDEX idx_created (created_at)
);

-- 6. Create the Supervisor Weekly Schedule Table
CREATE TABLE IF NOT EXISTS supervisorpartincalender (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supervisor_id INT NOT NULL UNIQUE,
    weekly_schedule JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_supervisorpartincalender_supervisor
        FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE
);
-- 6. Create the marks Table 
CREATE TABLE IF NOT EXISTS marks (
  mark_id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  stage_id INT COMMENT 'NULL means overall grade',
  marked_by INT NOT NULL COMMENT 'supervisor who gave the mark',
  marks_obtained DECIMAL(5,2) NOT NULL,
  total_marks DECIMAL(5,2) NOT NULL DEFAULT 100,
  feedback TEXT,
  mark_type ENUM('stage', 'overall') DEFAULT 'stage',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mark_group FOREIGN KEY (group_id) REFERENCES project_groups(id),
  CONSTRAINT fk_mark_stage FOREIGN KEY (stage_id) REFERENCES project_stages(stage_id),
  CONSTRAINT fk_mark_supervisor FOREIGN KEY (marked_by) REFERENCES users(id)
);

-- 6. Create the OTP Verification Table
CREATE TABLE IF NOT EXISTS otp_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    otp_code VARCHAR(10) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_otp_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);