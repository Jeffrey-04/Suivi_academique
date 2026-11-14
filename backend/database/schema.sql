-- Schéma de base de données : Suivi Académique
-- Compatible MySQL 8+ / MariaDB 10.3+ (InfinityFree & Laragon)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Filières
CREATE TABLE IF NOT EXISTS `filieres` (
  `id` VARCHAR(20) NOT NULL,
  `code` VARCHAR(10) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_filieres_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Niveaux (classes)
CREATE TABLE IF NOT EXISTS `levels` (
  `id` VARCHAR(20) NOT NULL,
  `name` VARCHAR(10) NOT NULL,
  `label` VARCHAR(60) NOT NULL,
  `filiere_id` VARCHAR(20) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_levels_filiere` (`filiere_id`),
  CONSTRAINT `fk_levels_filiere` FOREIGN KEY (`filiere_id`) REFERENCES `filieres` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Unités d'enseignement (UE)
CREATE TABLE IF NOT EXISTS `units` (
  `id` VARCHAR(20) NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `type` ENUM('UEF','UEC') NOT NULL,
  `level_id` VARCHAR(20) NOT NULL,
  `semester` ENUM('S1','S2') NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_units_level` (`level_id`),
  CONSTRAINT `fk_units_level` FOREIGN KEY (`level_id`) REFERENCES `levels` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Enseignants
CREATE TABLE IF NOT EXISTS `teachers` (
  `id` VARCHAR(20) NOT NULL,
  `first_name` VARCHAR(80) NOT NULL,
  `last_name` VARCHAR(80) NOT NULL,
  `grade` VARCHAR(60) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `contract_hours` SMALLINT NOT NULL DEFAULT 0,
  `photo` MEDIUMTEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_teachers_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Étudiants
CREATE TABLE IF NOT EXISTS `students` (
  `id` VARCHAR(20) NOT NULL,
  `matricule` VARCHAR(30) NOT NULL,
  `first_name` VARCHAR(80) NOT NULL,
  `last_name` VARCHAR(80) NOT NULL,
  `birth_date` DATE NOT NULL,
  `birth_place` VARCHAR(80) DEFAULT NULL,
  `email` VARCHAR(190) NOT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `filiere_id` VARCHAR(20) NOT NULL,
  `level_id` VARCHAR(20) NOT NULL,
  `photo` MEDIUMTEXT DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_students_matricule` (`matricule`),
  UNIQUE KEY `uq_students_email` (`email`),
  KEY `fk_students_filiere` (`filiere_id`),
  KEY `fk_students_level` (`level_id`),
  CONSTRAINT `fk_students_filiere` FOREIGN KEY (`filiere_id`) REFERENCES `filieres` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_students_level` FOREIGN KEY (`level_id`) REFERENCES `levels` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Utilisateurs (Comptes de connexion)
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(30) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('chef','enseignant','etudiant') NOT NULL,
  `profile_id` VARCHAR(20) DEFAULT NULL,
  `first_name` VARCHAR(80) DEFAULT NULL,
  `last_name` VARCHAR(80) DEFAULT NULL,
  `photo` MEDIUMTEXT DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
  `settings` JSON DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_profile` (`profile_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Matières
CREATE TABLE IF NOT EXISTS `subjects` (
  `id` VARCHAR(20) NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `coefficient` DECIMAL(3,1) NOT NULL,
  `planned_hours` SMALLINT NOT NULL,
  `level_id` VARCHAR(20) NOT NULL,
  `semester` ENUM('S1','S2') NOT NULL,
  `teacher_id` VARCHAR(20) DEFAULT NULL,
  `unit_id` VARCHAR(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subjects_code` (`code`),
  KEY `fk_subjects_level` (`level_id`),
  KEY `fk_subjects_teacher` (`teacher_id`),
  KEY `fk_subjects_unit` (`unit_id`),
  CONSTRAINT `fk_subjects_level` FOREIGN KEY (`level_id`) REFERENCES `levels` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_subjects_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_subjects_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Notes
CREATE TABLE IF NOT EXISTS `grades` (
  `id` VARCHAR(20) NOT NULL,
  `student_id` VARCHAR(20) NOT NULL,
  `subject_id` VARCHAR(20) NOT NULL,
  `type` ENUM('CC','EXAMEN','RATTRAPAGE') NOT NULL,
  `value` DECIMAL(4,2) NOT NULL,
  `status` ENUM('brouillon','validee') NOT NULL DEFAULT 'brouillon',
  `entered_by` VARCHAR(30) NOT NULL,
  `entered_at` DATE NOT NULL,
  `validated_by` VARCHAR(30) DEFAULT NULL,
  `validated_at` DATE DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grades_entry` (`student_id`, `subject_id`, `type`),
  KEY `fk_grades_subject` (`subject_id`),
  KEY `idx_grades_student` (`student_id`),
  CONSTRAINT `fk_grades_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_grades_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Bulletins (Instantanés figés)
CREATE TABLE IF NOT EXISTS `bulletins` (
  `id` VARCHAR(20) NOT NULL,
  `student_id` VARCHAR(20) NOT NULL,
  `semester` ENUM('S1','S2') NOT NULL,
  `academic_year` VARCHAR(12) NOT NULL,
  `average` DECIMAL(4,2) DEFAULT NULL,
  `mention` VARCHAR(30) DEFAULT NULL,
  `result` ENUM('Admis','Rattrapage','Ajourné') NOT NULL,
  `rank` SMALLINT DEFAULT NULL,
  `class_ranked` SMALLINT DEFAULT NULL,
  `class_size` SMALLINT DEFAULT NULL,
  `class_average` DECIMAL(4,2) DEFAULT NULL,
  `total_coefficient` DECIMAL(5,1) DEFAULT NULL,
  `credits` JSON DEFAULT NULL,
  `units` JSON DEFAULT NULL,
  `lines` JSON DEFAULT NULL,
  `retake` JSON DEFAULT NULL,
  `appreciation` TEXT DEFAULT NULL,
  `generated_at` DATE NOT NULL,
  `generated_by` VARCHAR(30) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bulletins_student_semester` (`student_id`, `semester`),
  CONSTRAINT `fk_bulletins_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Séances (Heures & Présences)
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` VARCHAR(20) NOT NULL,
  `teacher_id` VARCHAR(20) NOT NULL,
  `subject_id` VARCHAR(20) NOT NULL,
  `date` DATE NOT NULL,
  `start_time` CHAR(5) NOT NULL,
  `end_time` CHAR(5) NOT NULL,
  `status` ENUM('present','absent') NOT NULL,
  `declared_by` VARCHAR(30) NOT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sessions_teacher_date` (`teacher_id`, `date`),
  KEY `idx_sessions_subject_date` (`subject_id`, `date`),
  CONSTRAINT `fk_sessions_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_sessions_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Pointages géolocalisés (Checkins)
CREATE TABLE IF NOT EXISTS `checkins` (
  `id` VARCHAR(20) NOT NULL,
  `teacher_id` VARCHAR(20) NOT NULL,
  `subject_id` VARCHAR(20) NOT NULL,
  `date` DATE NOT NULL,
  `time` CHAR(5) NOT NULL,
  `distance` INT NOT NULL,
  `accuracy` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_checkins_daily` (`teacher_id`, `subject_id`, `date`),
  KEY `fk_checkins_subject` (`subject_id`),
  CONSTRAINT `fk_checkins_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_checkins_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Événements du calendrier
CREATE TABLE IF NOT EXISTS `events` (
  `id` VARCHAR(20) NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `start` DATE NOT NULL,
  `end` DATE DEFAULT NULL,
  `start_time` CHAR(5) DEFAULT NULL,
  `end_time` CHAR(5) DEFAULT NULL,
  `location` VARCHAR(100) DEFAULT NULL,
  `description` VARCHAR(500) DEFAULT NULL,
  `audience` JSON NOT NULL,
  `created_by` VARCHAR(30) NOT NULL,
  `created_at` DATE NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_events_dates` (`start`, `end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Notifications
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` VARCHAR(20) NOT NULL,
  `user_id` VARCHAR(30) NOT NULL,
  `event_id` VARCHAR(20) NOT NULL,
  `kind` ENUM('created','updated','reminder') DEFAULT NULL,
  `stage` TINYINT DEFAULT NULL,
  `message` VARCHAR(140) NOT NULL,
  `read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user_date` (`user_id`, `created_at`),
  KEY `fk_notifications_event` (`event_id`),
  CONSTRAINT `fk_notifications_event` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Compteurs d'identifiants (stu-001, ses-0871…) : incrément atomique, aucune collision
CREATE TABLE IF NOT EXISTS `id_sequences` (
  `name` VARCHAR(10) NOT NULL,
  `value` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. Échecs de connexion (limitation des tentatives)
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(190) NOT NULL,
  `ip` VARCHAR(45) NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_attempts_email` (`email`, `created_at`),
  KEY `idx_attempts_ip` (`ip`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

