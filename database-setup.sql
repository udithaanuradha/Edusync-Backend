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
    university_id VARCHAR(50) DEFAULT NULL,
    phone VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
-- 4. Create the Messages Table (For Communication Feature)
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
