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

-- 2. Create the Project Stages Table
CREATE TABLE project_stages (
    stage_id INT AUTO_INCREMENT PRIMARY KEY,
    level INT NOT NULL,
    stage_name VARCHAR(255) NOT NULL,
    description TEXT,
    deadline DATE,
    created_by INT DEFAULT NULL,
    resource_link TEXT DEFAULT NULL,
    resource_links TEXT DEFAULT NULL,
    mentor_details_url TEXT DEFAULT NULL
);

-- 3. Create the Group Requests Table
CREATE TABLE group_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    group_name VARCHAR(255) NOT NULL,
    members_list TEXT NOT NULL,
    request_message TEXT,
    student_id INT NOT NULL, 
    supervisor_id INT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    rejection_reason TEXT NULL,
    is_final_submitted BOOLEAN DEFAULT FALSE,
    project_level INT NOT NULL,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_gr_student FOREIGN KEY (student_id) REFERENCES users(id),
    CONSTRAINT fk_gr_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id),
    CONSTRAINT fk_gr_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 4. Create the Project Groups Table (UPDATED & MERGED)
CREATE TABLE project_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_name VARCHAR(255) NOT NULL,
    level INT NOT NULL,
    supervisor_id INT,
    created_by INT,  -- Kept this so you can track which Coordinator made it!
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pg_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_pg_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 5. Create the Group Members Table (NEW)
CREATE TABLE project_group_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    student_id INT NOT NULL,
    is_leader BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pgm_group FOREIGN KEY (group_id) REFERENCES project_groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_pgm_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_group_student (group_id, student_id)
);

-- 6. Create the Messages Table (For Communication Feature)
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

-- 7. Create the Supervisor Weekly Schedule Table
CREATE TABLE IF NOT EXISTS supervisorpartincalender (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supervisor_id INT NOT NULL UNIQUE,
    weekly_schedule JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_supervisorpartincalender_supervisor
        FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 8. Create the Evaluation Panels Table (NEW - For Calendar Integration)
CREATE TABLE evaluation_panels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    evaluation_type VARCHAR(100) NOT NULL, 
    academic_level VARCHAR(50) NOT NULL,   
    target_group VARCHAR(100) NOT NULL,    
    evaluators TEXT NOT NULL,              
    panel_date DATE NOT NULL,              
    start_time TIME NOT NULL,              
    duration VARCHAR(50) NOT NULL,         
    location VARCHAR(255),                 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);