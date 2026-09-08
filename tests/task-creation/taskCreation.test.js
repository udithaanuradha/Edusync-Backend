/**
 * Backend tests — Task Creation workflow (student_tasks, inside a milestone)
 * Covers: POST   /api/milestones/tasks              (createStudentTask)
 *         PUT    /api/milestones/tasks/:id/status   (updateTaskStatus)
 *         DELETE /api/milestones/tasks/:id           (deleteTask)
 *
 * The MySQL pool is fully mocked — see tests/helpers/dbMock.js.
 */
const request = require('supertest');
const { buildApp } = require('../helpers/appFactory');
const { route } = require('../helpers/dbMock');

jest.mock('../../src/config/db', () => {
  // eslint-disable-next-line global-require
  const { makeDbMock: factory } = require('../helpers/dbMock');
  const instance = factory();
  return {
    promise: () => instance.pool,
    __pool: instance.pool,
    __connection: instance.connection,
  };
});

const db = require('../../src/config/db');
const milestoneRoutes = require('../../src/routes/milestoneRoutes');

const app = buildApp(milestoneRoutes, '/api/milestones');

const toDateStr = (d) => d.toISOString().slice(0, 10);
const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateStr(d);
};

beforeEach(() => {
  db.__pool.query.mockReset().mockResolvedValue([[]]);
  db.__connection.query.mockReset().mockResolvedValue([[]]);
});

describe('POST /api/milestones/tasks (createStudentTask)', () => {
  const baseBody = { milestone_id: 10, assigned_to: 1, task_name: 'Write proposal' };

  test('rejects when a required field is missing', async () => {
    const res = await request(app).post('/api/milestones/tasks').send({ milestone_id: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/milestone_id, assigned_to, and task_name are required/i);
  });

  test('rejects a student who is not a member of the milestone\'s group', async () => {
    route(db.__pool.query, [
      { when: /SELECT group_id, start_date, due_date FROM milestones WHERE id = \?/, then: [{ group_id: 5, start_date: null, due_date: null }] },
    ]);
    const res = await request(app)
      .post('/api/milestones/tasks')
      .set('x-user-id', '1')
      .set('x-user-role', 'student')
      .send(baseBody);
    expect(res.status).toBe(403);
  });

  test('rejects a student trying to assign the task to someone else', async () => {
    const res = await request(app)
      .post('/api/milestones/tasks')
      .set('x-user-id', '1')
      .set('x-user-role', 'student')
      .send({ ...baseBody, assigned_to: 2 }); // header user is 1, assigning to 2
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/students can only create tasks for themselves/i);
  });

  test('rejects a start date before today', async () => {
    const res = await request(app)
      .post('/api/milestones/tasks')
      .set('x-user-id', '1')
      .set('x-user-role', 'student')
      .send({ ...baseBody, start_date: addDays(-3) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start date cannot be before today/i);
  });

  test('rejects a start date later than the due date', async () => {
    const res = await request(app)
      .post('/api/milestones/tasks')
      .set('x-user-id', '1')
      .set('x-user-role', 'student')
      .send({ ...baseBody, start_date: addDays(5), due_date: addDays(1) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start date cannot be later than the due date/i);
  });

  test("rejects task dates that fall outside the parent milestone's range", async () => {
    route(db.__pool.query, [
      {
        when: /SELECT group_id, start_date, due_date FROM milestones WHERE id = \?/,
        then: [{ group_id: 5, start_date: addDays(10), due_date: addDays(20) }],
      },
      { when: /SELECT 1 FROM project_group_members WHERE student_id = \? AND group_id = \?/, then: [{ 1: 1 }] },
    ]);
    const res = await request(app)
      .post('/api/milestones/tasks')
      .set('x-user-id', '1')
      .set('x-user-role', 'student')
      .send({ ...baseBody, start_date: addDays(11), due_date: addDays(25) }); // due_date past the milestone's own due_date
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must fall within this milestone's/i);
  });

  test('creates a self-assigned task on the happy path (defaults start date to today)', async () => {
    route(db.__pool.query, [
      { when: /INSERT INTO student_tasks \(milestone_id/, then: { insertId: 900 } },
    ]);
    const res = await request(app)
      .post('/api/milestones/tasks')
      .set('x-user-id', '1')
      .set('x-user-role', 'student')
      .send({ ...baseBody, due_date: addDays(7) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { id: 900 } });
  });
});

describe('PUT /api/milestones/tasks/:id/status (updateTaskStatus)', () => {
  test('rejects an invalid status value', async () => {
    const res = await request(app).put('/api/milestones/tasks/1/status').send({ status: 'DONE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid status/i);
  });

  test("rejects a student updating someone else's task", async () => {
    route(db.__pool.query, [
      { when: /SELECT assigned_to FROM student_tasks WHERE id = \?/, then: [{ assigned_to: 5 }] },
    ]);
    const res = await request(app)
      .put('/api/milestones/tasks/1/status')
      .set('x-user-id', '9')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/you can only update your own tasks/i);
  });

  test('marks a task COMPLETED and stamps completed_at', async () => {
    route(db.__pool.query, [
      { when: /SELECT assigned_to FROM student_tasks WHERE id = \?/, then: [{ assigned_to: 5 }] },
    ]);
    const res = await request(app)
      .put('/api/milestones/tasks/1/status')
      .set('x-user-id', '5')
      .send({ status: 'COMPLETED' });
    expect(res.status).toBe(200);
    const updateCall = db.__pool.query.mock.calls.find(([sql]) => /UPDATE student_tasks SET status = \?, completed_at = \?/.test(sql));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1][0]).toBe('COMPLETED');
    expect(updateCall[1][1]).toBeInstanceOf(Date);
  });

  test('clears completed_at when a task is moved off COMPLETED', async () => {
    route(db.__pool.query, [
      { when: /SELECT assigned_to FROM student_tasks WHERE id = \?/, then: [{ assigned_to: 5 }] },
    ]);
    const res = await request(app)
      .put('/api/milestones/tasks/1/status')
      .set('x-user-id', '5')
      .send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    const updateCall = db.__pool.query.mock.calls.find(([sql]) => /UPDATE student_tasks SET status = \?, completed_at = \?/.test(sql));
    expect(updateCall[1][1]).toBeNull();
  });
});

describe('DELETE /api/milestones/tasks/:id (deleteTask)', () => {
  test('returns 404 when the task does not exist', async () => {
    const res = await request(app)
      .delete('/api/milestones/tasks/999')
      .set('x-user-role', 'student');
    expect(res.status).toBe(404);
  });

  test("rejects a student deleting someone else's task", async () => {
    route(db.__pool.query, [
      { when: /SELECT assigned_to FROM student_tasks WHERE id = \?/, then: [{ assigned_to: 5 }] },
    ]);
    const res = await request(app)
      .delete('/api/milestones/tasks/1')
      .set('x-user-id', '9')
      .set('x-user-role', 'student');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/you can only delete your own tasks/i);
  });

  test('deletes the task on the happy path', async () => {
    route(db.__pool.query, [
      { when: /SELECT assigned_to FROM student_tasks WHERE id = \?/, then: [{ assigned_to: 5 }] },
    ]);
    const res = await request(app)
      .delete('/api/milestones/tasks/1')
      .set('x-user-id', '5')
      .set('x-user-role', 'student');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'Task deleted successfully' });
  });
});
