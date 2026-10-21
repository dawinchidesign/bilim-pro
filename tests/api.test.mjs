// API логикасының тесттері: node tests/api.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const core = createRequire(import.meta.url)('../bilim-core.js');

const db = {};
const store = {
  get: async k => (k in db ? structuredClone(db[k]) : null),
  set: async (k, v) => { db[k] = structuredClone(v); },
  del: async k => { delete db[k]; },
  list: async p => Object.keys(db).filter(k => k.startsWith(p))
};
const call = (method, path, body, token, ip = '1.1.1.1') => core.handle({ method, path, body, token, ip }, store, {});
let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; };

const lessonBody = {
  subject: 'math', grade: 7, title: 'Бөлшектерді қосу', tag: 'Бөлшектер', minutes: 10,
  paras: ['Бөлшектерді қосу үшін ортақ бөлім керек.'], points: ['Ортақ бөлім'], code: '1/2 + 1/3 = 5/6',
  questions: [1, 2, 3].map(i => ({ q: `Сұрақ ${i}?`, answer: 'Иә', wrong: ['Жоқ', 'Мүмкін', 'Білмеймін'], explain: 'Себебі' })),
  visibility: 'public'
};

ok((await call('GET', '/health')).body.ok, 'health');
let r = await call('POST', '/auth/register', { name: 'Ай', email: 'a@b.kz', password: '12345678', school: 'Мектеп', subjects: ['math'] });
ok(r.status === 400, 'short name rejected');
r = await call('POST', '/auth/register', { name: 'Айгүл Серікова', email: 'bad', password: '12345678', school: 'Мектеп', subjects: ['math'] });
ok(r.status === 400, 'bad email rejected');
r = await call('POST', '/auth/register', { name: 'Айгүл Серікова', email: 'Aigul@School.kz', password: '1234', school: 'Мектеп', subjects: ['math'] });
ok(r.status === 400, 'short password rejected');
r = await call('POST', '/auth/register', { name: 'Айгүл Серікова', email: 'Aigul@School.kz', password: 'qwerty123', school: '№6 мектеп', subjects: ['math', 'nope'] });
ok(r.status === 200 && r.body.token && r.body.teacher.subjects.join() === 'math', 'register');
ok(!('hash' in r.body.teacher) && !('salt' in r.body.teacher), 'no secrets leaked');
const tok = r.body.token;
r = await call('POST', '/auth/register', { name: 'Басқа адам', email: 'aigul@school.kz', password: 'qwerty123', school: 'Мектеп', subjects: ['math'] });
ok(r.status === 409, 'duplicate email');
r = await call('POST', '/auth/login', { email: 'aigul@school.kz', password: 'wrong-pass' });
ok(r.status === 401, 'wrong password');
r = await call('POST', '/auth/login', { email: 'AIGUL@school.kz', password: 'qwerty123' });
ok(r.status === 200 && r.body.teacher.name === 'Айгүл Серікова', 'login case-insensitive');
ok((await call('GET', '/me', null, tok)).body.teacher.email === 'aigul@school.kz', 'me');
ok((await call('GET', '/me', null, tok.slice(0, -2) + 'xx')).status === 401, 'tampered token');
ok((await call('GET', '/me')).status === 401, 'no token');

r = await call('POST', '/classes', { name: '7 «А»', grade: 7, subject: 'math' }, tok);
ok(r.status === 200 && /^[A-Z2-9]{6}$/.test(r.body.class.code), 'create class');
const cls = r.body.class;
r = await call('POST', '/join', { code: cls.code.toLowerCase(), name: 'Іңкәр', pin: '1234' });
ok(r.status === 200 && r.body.class.teacher === 'Айгүл Серікова', 'student join');
const stok = r.body.token;
ok((await call('POST', '/join', { code: cls.code, name: 'іңкәр', pin: '9999' })).status === 403, 'same name wrong pin');
ok((await call('POST', '/join', { code: cls.code, name: 'Іңкәр', pin: '1234' })).body.student.id === r.body.student.id, 'rejoin same pin');
ok((await call('POST', '/join', { code: 'ZZZZZZ', name: 'Нұрай', pin: '1234' })).status === 404, 'bad code');
ok((await call('POST', '/progress', { progress: { xp: 120, completed: ['python', '<x>'], quiz: { python: 3, bad: 99 }, history: [{ score: 20, total: 30, date: 1, subject: 'informatics' }] } }, stok)).status === 200, 'progress');
r = await call('GET', `/classes/${cls.id}`, null, tok);
ok(r.body.students.length === 1 && r.body.students[0].progress.xp === 120 && r.body.students[0].progress.completed.join() === 'python' && !('bad' in r.body.students[0].progress.quiz), 'class view sanitized');
ok(!('pin' in r.body.students[0]) && !('salt' in r.body.students[0]), 'pin not leaked');
ok((await call('POST', '/progress', { progress: {} }, tok)).status === 401, 'teacher cannot post progress');

r = await call('POST', '/auth/register', { name: 'Ерлан Қасымов', email: 'erlan@school.kz', password: 'qwerty123', school: 'Мектеп', subjects: ['physics'] });
const tok2 = r.body.token;
ok((await call('GET', `/classes/${cls.id}`, null, tok2)).status === 404, 'other teacher cannot see class');

r = await call('POST', '/lessons', { ...lessonBody, questions: lessonBody.questions.slice(0, 2) }, tok);
ok(r.status === 400, 'needs 3 questions');
r = await call('POST', '/lessons', { ...lessonBody, questions: [{ ...lessonBody.questions[0], wrong: ['Иә', 'a', 'b'] }, ...lessonBody.questions.slice(1)] }, tok);
ok(r.status === 400, 'duplicate options rejected');
r = await call('POST', '/lessons', lessonBody, tok);
ok(r.status === 200 && r.body.lesson.id.startsWith('t-'), 'create lesson');
const lid = r.body.lesson.id;
await call('POST', '/lessons', { ...lessonBody, title: 'Тек сыныпқа', visibility: 'classes' }, tok);
ok((await call('GET', '/lessons')).body.lessons.length === 1, 'public sees only public');
ok((await call('GET', '/lessons', null, stok)).body.lessons.length === 2, 'student sees class lessons');
ok((await call('GET', '/lessons', null, tok2)).body.lessons.length === 1, 'other teacher sees public only');
ok((await call('PUT', `/lessons/${lid}`, { ...lessonBody, title: 'Жаңа атау' }, tok2)).status === 404, 'cannot edit others');
ok((await call('PUT', `/lessons/${lid}`, { ...lessonBody, title: 'Жаңа атау' }, tok)).body.lesson.title === 'Жаңа атау', 'edit lesson');
r = await call('GET', '/teachers');
ok(r.body.teachers.length === 2 && r.body.teachers[0].lessons === 1 && !('email' in r.body.teachers[0]), 'teachers list');
ok((await call('PUT', '/me', { name: 'Айгүл Серікова', school: 'Жаңа мектеп', subjects: ['math', 'physics'], public: false }, tok)).body.teacher.school === 'Жаңа мектеп', 'update profile');
ok((await call('GET', '/teachers')).body.teachers.length === 1, 'private profile hidden');
ok((await call('POST', '/me/password', { current: 'bad', next: 'newpass123' }, tok)).status === 403, 'password change needs current');
ok((await call('POST', '/me/password', { current: 'qwerty123', next: 'newpass123' }, tok)).status === 200, 'password changed');
ok((await call('POST', '/auth/login', { email: 'aigul@school.kz', password: 'newpass123' })).status === 200, 'login new password');

for (let i = 0; i < 6; i++) await call('POST', '/auth/login', { email: 'erlan@school.kz', password: 'nope-nope' });
ok((await call('POST', '/auth/login', { email: 'erlan@school.kz', password: 'qwerty123' })).status === 429, 'lockout after failures');

ok((await call('DELETE', `/classes/${cls.id}/students/${r.body?.student?.id || 'xxxxxxxx'}`, null, tok)).status === 404, 'delete unknown student');
ok((await call('DELETE', `/classes/${cls.id}`, null, tok)).status === 200, 'delete class');
ok(!Object.keys(db).some(k => k.startsWith(`student/${cls.id}`) || k === 'code/' + cls.code), 'class data removed');
ok((await call('GET', '/student', null, stok)).status === 401, 'student token invalid after class deletion');
ok((await call('DELETE', '/me', { password: 'wrong' }, tok)).status === 403, 'delete needs password');
ok((await call('DELETE', '/me', { password: 'newpass123' }, tok)).status === 200, 'delete account');
ok(!Object.keys(db).some(k => k.startsWith('lesson/') && db[k].title === 'Жаңа атау'), 'teacher lessons removed');
ok((await call('GET', '/nope')).status === 404, 'unknown route');
console.log(`✓ ${passed} API тесті өтті`);
