CREATE TABLE IF NOT EXISTS supervisor_student_meeting (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    supervisor_id INT NOT NULL,
    group_name VARCHAR(255) NOT NULL,
    topic VARCHAR(255) NOT NULL,
    preferred_date DATE NOT NULL,
    preferred_time TIME NOT NULL,
    reason TEXT,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_smr_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_smr_supervisor FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE
);
