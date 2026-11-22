<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/Router.php';
require_once __DIR__ . '/../src/Controllers/ConfigController.php';
require_once __DIR__ . '/../src/Controllers/AuthController.php';
require_once __DIR__ . '/../src/Controllers/ReferenceController.php';
require_once __DIR__ . '/../src/Controllers/PeopleController.php';
require_once __DIR__ . '/../src/Controllers/SubjectController.php';
require_once __DIR__ . '/../src/Controllers/GradeController.php';
require_once __DIR__ . '/../src/Controllers/BulletinController.php';
require_once __DIR__ . '/../src/Controllers/SessionController.php';
require_once __DIR__ . '/../src/Controllers/TimetableController.php';
require_once __DIR__ . '/../src/Controllers/CalendarController.php';
require_once __DIR__ . '/../src/Controllers/AccountController.php';
require_once __DIR__ . '/../src/Controllers/StatsController.php';

$router = new Router();

// ---- 0. Configuration publique (aucune connexion requise) ------------------
$router->get('/config', [ConfigController::class, 'show']);

// ---- 1. Authentification ---------------------------------------------------
$router->post('/auth/login', [AuthController::class, 'login']);
$router->post('/auth/logout', [AuthController::class, 'logout']);
$router->get('/auth/me', [AuthController::class, 'me']);

// ---- 2. Référentiels -------------------------------------------------------
$router->get('/filieres', [ReferenceController::class, 'filieres']);
$router->get('/levels', [ReferenceController::class, 'levels']);
$router->get('/classes', [ReferenceController::class, 'classes']);
$router->get('/units', [ReferenceController::class, 'units']);

// ---- 3. Étudiants & Enseignants --------------------------------------------
$router->get('/students/count', [PeopleController::class, 'countStudents']);
$router->get('/students', [PeopleController::class, 'listStudents']);
$router->get('/students/{id}/removal-impact', [PeopleController::class, 'studentRemovalImpact']);
$router->get('/students/{id}', [PeopleController::class, 'getStudent']);
$router->post('/students', [PeopleController::class, 'createStudent']);
$router->put('/students/{id}', [PeopleController::class, 'updateStudent']);
$router->delete('/students/{id}', [PeopleController::class, 'deleteStudent']);

$router->get('/teachers', [PeopleController::class, 'listTeachers']);
$router->get('/teachers/{id}/usage', [PeopleController::class, 'teacherUsage']);
$router->get('/teachers/{id}', [PeopleController::class, 'getTeacher']);
$router->post('/teachers', [PeopleController::class, 'createTeacher']);
$router->put('/teachers/{id}', [PeopleController::class, 'updateTeacher']);
$router->delete('/teachers/{id}', [PeopleController::class, 'deleteTeacher']);

// ---- 4. Matières & Notes ---------------------------------------------------
$router->get('/subjects/{id}/usage', [SubjectController::class, 'subjectUsage']);
$router->get('/subjects/{id}/grade-sheet', [GradeController::class, 'gradeSheet']);
$router->put('/subjects/{id}/grades/{type}', [GradeController::class, 'saveDrafts']);
$router->post('/subjects/{id}/grades/{type}/validate', [GradeController::class, 'validateGrades']);
$router->get('/subjects/{id}', [SubjectController::class, 'getSubject']);
$router->get('/subjects', [SubjectController::class, 'listSubjects']);
$router->post('/subjects', [SubjectController::class, 'createSubject']);
$router->put('/subjects/{id}', [SubjectController::class, 'updateSubject']);
$router->delete('/subjects/{id}', [SubjectController::class, 'deleteSubject']);

$router->get('/grades/counts', [GradeController::class, 'countByStatus']);
$router->get('/grades', [GradeController::class, 'listGrades']);
$router->get('/students/{id}/grades/history', [GradeController::class, 'studentHistory']);

// ---- 5. Bulletins ----------------------------------------------------------
$router->get('/bulletins/count', [BulletinController::class, 'countBulletins']);
$router->get('/bulletins/overview', [BulletinController::class, 'overview']);
$router->get('/bulletins', [BulletinController::class, 'listBulletins']);
$router->post('/bulletins/generate', [BulletinController::class, 'generate']);
$router->get('/students/{id}/report', [BulletinController::class, 'studentReport']);
$router->get('/students/{id}/bulletin/document', [BulletinController::class, 'studentDocument']);
$router->get('/students/{id}/bulletin', [BulletinController::class, 'studentBulletin']);

// ---- 6. Séances, heures & présences ----------------------------------------
$router->get('/sessions/detailed', [SessionController::class, 'detailed']);
$router->get('/sessions/stats', [SessionController::class, 'stats']);
$router->post('/sessions/absences', [SessionController::class, 'recordAbsence']);
$router->get('/sessions/{id}', [SessionController::class, 'getSession']);
$router->get('/sessions', [SessionController::class, 'listSessions']);
$router->post('/sessions', [SessionController::class, 'declareSession']);
$router->put('/sessions/{id}', [SessionController::class, 'updateSession']);
$router->delete('/sessions/{id}', [SessionController::class, 'deleteSession']);

$router->get('/teachers/{id}/hours', [SessionController::class, 'teacherHours']);
$router->get('/hours', [SessionController::class, 'allHours']);

// ---- 6bis. Emploi du temps (créneaux hebdomadaires, occurrences, confirmation des séances) --------------
$router->get('/timetable/occurrences', [TimetableController::class, 'listOccurrences']);
$router->post('/timetable/occurrences/confirm', [TimetableController::class, 'confirm']);
$router->post('/timetable/occurrences/absence', [TimetableController::class, 'absence']);
$router->post('/timetable/occurrences/cancel', [TimetableController::class, 'cancel']);
$router->post('/timetable/occurrences/restore', [TimetableController::class, 'restore']);
$router->get('/timetable/slots', [TimetableController::class, 'listSlots']);
$router->get('/timetable/slots/{id}', [TimetableController::class, 'getSlot']);
$router->post('/timetable/slots', [TimetableController::class, 'createSlot']);
$router->put('/timetable/slots/{id}', [TimetableController::class, 'updateSlot']);
$router->delete('/timetable/slots/{id}', [TimetableController::class, 'deleteSlot']);

// ---- 7. Calendrier & Notifications -----------------------------------------
$router->get('/events/rattrapage-open', [CalendarController::class, 'rattrapageOpen']);
$router->get('/events/{id}/notification-count', [CalendarController::class, 'notificationCount']);
$router->get('/events/{id}', [CalendarController::class, 'getEvent']);
$router->get('/events', [CalendarController::class, 'listEvents']);
$router->post('/events', [CalendarController::class, 'createEvent']);
$router->put('/events/{id}', [CalendarController::class, 'updateEvent']);
$router->delete('/events/{id}', [CalendarController::class, 'deleteEvent']);

$router->get('/notifications/unread-count', [CalendarController::class, 'unreadCount']);
$router->post('/notifications/read-all', [CalendarController::class, 'markAllRead']);
$router->post('/notifications/{id}/read', [CalendarController::class, 'markRead']);
$router->get('/notifications', [CalendarController::class, 'listNotifications']);

// ---- 8. Compte du chef : profil et réglages ------------------------------------------
$router->get('/me/profile', [AccountController::class, 'profile']);
$router->patch('/me/contact', [AccountController::class, 'updateContact']);
$router->put('/me/photo', [AccountController::class, 'updatePhoto']);
$router->put('/me/password', [AccountController::class, 'changePassword']);
$router->put('/me/settings', [AccountController::class, 'updateSettings']);


// ---- 9. Statistiques (Tableaux de bord) -----------------------------------
$router->get('/stats/teaching-weekly', [StatsController::class, 'teachingWeekly']);
$router->get('/stats/class-averages', [StatsController::class, 'classAverages']);
$router->get('/stats/grade-progress', [StatsController::class, 'gradeProgress']);
$router->get('/stats/department-results', [StatsController::class, 'departmentResults']);
$router->get('/stats/recent-absences', [StatsController::class, 'recentAbsences']);
$router->get('/stats/hours-progress', [StatsController::class, 'hoursProgress']);
$router->get('/stats/subject-rows', [StatsController::class, 'subjectRows']);
$router->get('/stats/teacher-rows', [StatsController::class, 'teacherRows']);
$router->get('/stats/hours-overview', [StatsController::class, 'hoursOverview']);
$router->get('/stats/teachers/{id}/recent-sessions', [StatsController::class, 'teacherRecentSessions']);
$router->get('/stats/teachers/{id}/overview', [StatsController::class, 'teacherOverview']);
$router->get('/stats/students/{id}/overview', [StatsController::class, 'studentOverview']);

// Dispatcher la requête HTTP
$router->dispatch();

