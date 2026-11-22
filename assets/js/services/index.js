/* Point d'entrée unique des services : les pages importent depuis ce fichier. */

export { AuthService } from './auth.js';
export { ReferenceService, StudentService, TeacherService, TEACHER_GRADES } from './people.js';
export { ValidationError } from './errors.js';
export { SubjectService, GradeService, BulletinService, BULLETIN_STATUS, GRADE_TYPES, SEMESTERS } from './academics.js';
export { SessionService, HoursService, SESSION_STATUS } from './teaching.js';
export { TimetableService, WEEKDAYS, OCCURRENCE_STATUS, weekdayOf } from './timetable.js';
export { AccountService, CALENDAR_VIEWS, DEFAULT_PHOTO, PASSWORD_MIN, resolveSettings } from './accounts.js';
export { EventService, NotificationService, academicYearBounds } from './calendar.js';
export { StatsService } from './stats.js';
export { resetDemoData } from './data.js';
