/**
 * Backend tests — Milestone Creation workflow
 * Covers: POST   /api/milestones          (createMilestone)
 *         PUT    /api/milestones/:id      (updateMilestoneDetails)
 *         DELETE /api/milestones/:id      (deleteMilestone)
 *         GET    /api/milestones/group/:groupId (getMilestonesByGroup)
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

// --- date helpers, always relative to "now" so the suite never rots ---
const toDateStr = (d) => d.toISOString().slice(0, 10);
const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateStr(d);
};
const today = () => addDays(0);

beforeEach(() => {
  db.__pool.query.mockReset().mockResolvedValue([[]]);
  db.__connection.query.mockReset().mockResolvedValue([[]]);
});

describe('POST /api/milestones (createMilestone)', () => {
  const baseBody = { group_id: 5, title: 'Requirements Gathering' };

  test('rejects when group_id or title is missing', async () => {
    const res = await request(app).post('/api/milestones').send({ group_id: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/group_id and title are required/i);
  });

  test('rejects a start date before today', async () => {
    const res = await request(app)
      .post('/api/milestones')
      .send({ ...baseBody, start_date: addDays(-5), due_date: addDays(10) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start date cannot be before today/i);
  });

  test('rejects a due date earlier than the start date', async () => {
    const res = await request(app)
      .post('/api/milestones')
      .send({ ...baseBody, start_date: addDays(10), due_date: addDays(5) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start date cannot be later than end date/i);
  });

  test('rejects a milestone spanning more than one year', async () => {
    const res = await request(app)
      .post('/api/milestones')
      .send({ ...baseBody, start_date: addDays(1), due_date: addDays(400) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/can't run for more than one year/i);
  });

  test("rejects dates outside the group's own project window", async () => {
    route(db.__pool.query, [
      {
        when: /SELECT start_date, end_date FROM project_overviews WHERE group_id = \?/,
        then: [{ start_date: addDays(30), end_date: addDays(60) }],
      },
    ]);
    const res = await request(app)
      .post('/api/milestones')
      .send({ ...baseBody, start_date: addDays(1), due_date: addDays(10) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must fall within the project's/i);
  });

  test('rejects a student who is not a member of the group', async () => {
    const res = await request(app)
      .post('/api/milestones')
      .set('x-user-id', '99')
      .set('x-user-role', 'student')
      .send({ ...baseBody, start_date: addDays(1), due_date: addDays(10) });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member of this group/i);
  });

  test('creates the milestone on the happy path', async () => {
    route(db.__pool.query, [
      { when: /SELECT 1 FROM project_group_members WHERE student_id = \? AND group_id = \?/, then: [{ 1: 1 }] },
      { when: /INSERT INTO milestones \(group_id, title/, then: { insertId: 77 } },
    ]);
    const res = await request(app)
      .post('/api/milestones')
      .set('x-user-id', '1')
      .set('x-user-role', 'student')
      .send({ ...baseBody, start_date: addDays(1), due_date: addDays(10) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { id: 77 } });
  });
});

describe('PUT /api/milestones/:id (updateMilestoneDetails)', () => {
  test('rejects when title is missing', async () => {
    const res = await request(app).put('/api/milestones/1').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title is required/i);
  });

  test('returns 404 when the milestone does not exist', async () => {
    const res = await request(app).put('/api/milestones/999').send({ title: 'New title' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/milestone not found/i);
  });

  test('rejects a non-leader student', async () => {
    route(db.__pool.query, [
      { when: /SELECT group_id, start_date FROM milestones WHERE id = \?/, then: [{ group_id: 5, start_date: addDays(1) }] },
      { when: /AND is_leader = 1/, then: [] },
    ]);
    const res = await request(app)
      .put('/api/milestones/1')
      .set('x-user-id', '2')
      .set('x-user-role', 'student')
      .send({ title: 'Renamed', start_date: addDays(1), due_date: addDays(10) });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only the group leader can edit/i);
  });

  test('updates the milestone on the happy path', async () => {
    route(db.__pool.query, [
      { when: /SELECT group_id, start_date FROM milestones WHERE id = \?/, then: [{ group_id: 5, start_date: addDays(1) }] },
      { when: /AND is_leader = 1/, then: [{ 1: 1 }] },
    ]);
    const res = await request(app)
      .put('/api/milestones/1')
      .set('x-user-id', '2')
      .set('x-user-role', 'student')
      .send({ title: 'Renamed', start_date: addDays(1), due_date: addDays(10) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'Milestone updated successfully.' });
  });
});

describe('DELETE /api/milestones/:id (deleteMilestone)', () => {
  test('rejects a student who is not a group member', async () => {
    route(db.__pool.query, [
      { when: /SELECT group_id FROM milestones WHERE id = \?/, then: [{ group_id: 5 }] },
    ]);
    const res = await request(app)
      .delete('/api/milestones/1')
      .set('x-user-id', '99')
      .set('x-user-role', 'student');
    expect(res.status).toBe(403);
  });

  test('deletes the milestone on the happy path', async () => {
    route(db.__pool.query, [
      { when: /SELECT group_id FROM milestones WHERE id = \?/, then: [{ group_id: 5 }] },
      { when: /SELECT 1 FROM project_group_members WHERE student_id = \? AND group_id = \?/, then: [{ 1: 1 }] },
    ]);
    const res = await request(app)
      .delete('/api/milestones/1')
      .set('x-user-id', '1')
      .set('x-user-role', 'student');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'Milestone deleted successfully' });
  });
});

describe('GET /api/milestones/group/:groupId (getMilestonesByGroup)', () => {
  test('rejects a student who is not a group member', async () => {
    const res = await request(app)
      .get('/api/milestones/group/5')
      .set('x-user-id', '99')
      .set('x-user-role', 'student');
    expect(res.status).toBe(403);
  });

  test('returns the milestone list for a member', async () => {
    route(db.__pool.query, [
      { when: /SELECT 1 FROM project_group_members WHERE student_id = \? AND group_id = \?/, then: [{ 1: 1 }] },
      {
        when: /FROM milestones WHERE group_id = \? ORDER BY created_at ASC/,
        then: [{ id: 1, group_id: 5, title: 'Requirements', status: 'PENDING' }],
      },
    ]);
    const res = await request(app)
      .get('/api/milestones/group/5')
      .set('x-user-id', '1')
      .set('x-user-role', 'student');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Requirements');
  });
});
