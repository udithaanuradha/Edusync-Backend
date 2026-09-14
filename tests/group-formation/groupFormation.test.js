/**
 * Backend tests — Group Formation workflow
 * Covers: POST /api/groups/request (createGroupRequest)
 *         POST /api/groups/create  (createGroup)
 *         GET  /api/groups/my-status/:studentId (getStudentGroup)
 *         DELETE /api/groups/delete/:id (deleteGroup)
 *
 * The MySQL pool/connection is fully mocked (see tests/helpers/dbMock.js) —
 * no real database is touched. Each test routes only the SQL statements it
 * actually needs; every other query (schema bootstrap checks, etc.) falls
 * through to a harmless empty-result default.
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
const groupRoutes = require('../../src/routes/groupRoutes');

const app = buildApp(groupRoutes, '/api/groups');

beforeEach(() => {
  // Reset to the harmless "everything empty" baseline before every test.
  db.__pool.query.mockReset().mockResolvedValue([[]]);
  db.__connection.query.mockReset().mockResolvedValue([[]]);
  db.__connection.beginTransaction.mockReset().mockResolvedValue(undefined);
  db.__connection.commit.mockReset().mockResolvedValue(undefined);
  db.__connection.rollback.mockReset().mockResolvedValue(undefined);
  db.__pool.getConnection.mockReset().mockResolvedValue(db.__connection);
});

describe('POST /api/groups/request (createGroupRequest)', () => {
  const validBody = {
    group_name: 'CYGEN',
    members_list: 'Leader: Alice, Members: Bob (2020123)',
    request_message: 'Project: EduSync. Please supervise us.',
    supervisor_ids: [7],
    member_ids: [],
    student_id: 1,
    project_level: 3,
  };

  test('rejects when no supervisor is selected', async () => {
    const { supervisor_ids, ...rest } = validBody;
    const res = await request(app).post('/api/groups/request').send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one supervisor/i);
  });

  test('rejects when the student does not exist', async () => {
    // default mock already returns an empty user lookup
    const res = await request(app).post('/api/groups/request').send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/student not found/i);
  });

  test("rejects when project_level doesn't match the student's own level", async () => {
    route(db.__pool.query, [
      { when: /SELECT id, level, academic_unit FROM users WHERE id = \?/, then: [{ id: 1, level: 2, academic_unit: 'IT' }] },
    ]);
    const res = await request(app).post('/api/groups/request').send(validBody); // level 3 requested, student is level 2
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/only create group requests for your own level/i);
  });

  test('rejects when the student has no department set', async () => {
    route(db.__pool.query, [
      { when: /SELECT id, level, academic_unit FROM users WHERE id = \?/, then: [{ id: 1, level: 3, academic_unit: null }] },
    ]);
    const res = await request(app).post('/api/groups/request').send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/set your department/i);
  });

  test('rejects when a selected member is in a different level/department', async () => {
    route(db.__pool.query, [
      { when: /SELECT id, level, academic_unit FROM users WHERE id = \?/, then: [{ id: 1, level: 3, academic_unit: 'IT' }] },
      { when: /SELECT id, level, academic_unit FROM users WHERE id IN \(\?\)/, then: [{ id: 55, level: 2, academic_unit: 'IT' }] },
    ]);
    const res = await request(app)
      .post('/api/groups/request')
      .send({ ...validBody, member_ids: [55] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same department/i);
    expect(res.body.invalid_member_ids).toEqual([55]);
  });

  test('rejects when a selected member already belongs to a live group', async () => {
    route(db.__pool.query, [
      { when: /SELECT id, level, academic_unit FROM users WHERE id = \?/, then: [{ id: 1, level: 3, academic_unit: 'IT' }] },
      { when: /SELECT id, level, academic_unit FROM users WHERE id IN \(\?\)/, then: [{ id: 55, level: 3, academic_unit: 'IT' }] },
      { when: /pm\.student_id IN \(\?\)[\s\S]*AND pg\.id IS NOT NULL/, then: [{ student_id: 55 }] },
    ]);
    const res = await request(app)
      .post('/api/groups/request')
      .send({ ...validBody, member_ids: [55] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already belong to a group/i);
    expect(res.body.already_grouped_member_ids).toEqual([55]);
  });

  test('rejects when the requester is already an active member of a group', async () => {
    route(db.__pool.query, [
      { when: /SELECT id, level, academic_unit FROM users WHERE id = \?/, then: [{ id: 1, level: 3, academic_unit: 'IT' }] },
      { when: /pm\.student_id = \?[\s\S]*AND pg\.id IS NOT NULL[\s\S]*LIMIT 1/, then: [{ dummy: 1 }] },
    ]);
    const res = await request(app).post('/api/groups/request').send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already a member of a group/i);
  });

  test('creates a new pending request and returns 201 on the happy path', async () => {
    route(db.__pool.query, [
      { when: /SELECT id, level, academic_unit FROM users WHERE id = \?/, then: [{ id: 1, level: 3, academic_unit: 'IT' }] },
    ]);
    route(db.__connection.query, [
      { when: /INSERT INTO group_requests \(group_name/, then: { insertId: 501 } },
    ]);

    const res = await request(app).post('/api/groups/request').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ message: 'Request Sent', groupId: 501, request_id: 501 });
    expect(db.__connection.commit).toHaveBeenCalled();
    expect(db.__connection.rollback).not.toHaveBeenCalled();

    // The supervisor row is inserted against the newly created request id.
    const supervisorInsertCall = db.__connection.query.mock.calls.find(([sql]) =>
      /INSERT INTO group_request_supervisors/.test(sql)
    );
    expect(supervisorInsertCall).toBeTruthy();
    expect(supervisorInsertCall[1][0]).toEqual([[501, 7, 'pending']]);
  });

  test('rejects a request naming more than 2 supervisors', async () => {
    route(db.__pool.query, [
      { when: /SELECT id, level, academic_unit FROM users WHERE id = \?/, then: [{ id: 1, level: 3, academic_unit: 'IT' }] },
    ]);
    route(db.__connection.query, [
      { when: /INSERT INTO group_requests \(group_name/, then: { insertId: 999 } },
    ]);

    const res = await request(app)
      .post('/api/groups/request')
      .send({ ...validBody, supervisor_ids: [1, 2, 3] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum of 2 supervisors/i);
    expect(db.__connection.rollback).toHaveBeenCalled();
  });
});

describe('POST /api/groups/create (createGroup)', () => {
  const validBody = {
    groupName: 'CYGEN',
    level: 3,
    supervisorId: 7,
    leaderId: 1,
    memberIds: [1, 2],
    department: 'IT',
    createdBy: 99,
  };

  test('rejects when a member no longer matches the group level', async () => {
    route(db.__connection.query, [
      {
        when: /SELECT id, name, level FROM users WHERE id IN \(\?\)/,
        then: [
          { id: 1, name: 'Alice', level: 3 },
          { id: 2, name: 'Bob', level: 2 }, // mismatched
        ],
      },
    ]);

    const res = await request(app).post('/api/groups/create').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no longer matches this group.?s level/i);
    expect(res.body.level_mismatched_member_ids).toEqual([2]);
    expect(db.__connection.rollback).toHaveBeenCalled();
  });

  test('rejects when a member already belongs to a different group', async () => {
    route(db.__connection.query, [
      {
        when: /SELECT id, name, level FROM users WHERE id IN \(\?\)/,
        then: [
          { id: 1, name: 'Alice', level: 3 },
          { id: 2, name: 'Bob', level: 3 },
        ],
      },
      { when: /INSERT INTO project_groups \(group_name/, then: { insertId: 42 } },
      {
        when: /pm\.student_id IN \(\?\)[\s\S]*AND pg\.id != \?/,
        then: [{ student_id: 2 }],
      },
    ]);

    const res = await request(app).post('/api/groups/create').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already belong to another group/i);
    expect(res.body.already_grouped_member_ids).toEqual([2]);
    expect(db.__connection.rollback).toHaveBeenCalled();
  });

  test('creates the group and its members on the happy path', async () => {
    route(db.__connection.query, [
      {
        when: /SELECT id, name, level FROM users WHERE id IN \(\?\)/,
        then: [
          { id: 1, name: 'Alice', level: 3 },
          { id: 2, name: 'Bob', level: 3 },
        ],
      },
      { when: /INSERT INTO project_groups \(group_name/, then: { insertId: 42 } },
    ]);

    const res = await request(app).post('/api/groups/create').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: { groupId: 42 } });
    expect(db.__connection.commit).toHaveBeenCalled();

    const memberInsertCall = db.__connection.query.mock.calls.find(([sql]) =>
      /INSERT INTO project_group_members \(group_id, student_id, is_leader\) VALUES \?/.test(sql)
    );
    expect(memberInsertCall).toBeTruthy();
    // leaderId (1) must be flagged is_leader = 1, the other member 0.
    expect(memberInsertCall[1][0]).toEqual(
      expect.arrayContaining([[42, 1, 1], [42, 2, 0]])
    );
  });
});

describe('GET /api/groups/my-status/:studentId (getStudentGroup)', () => {
  test('returns an empty array when the student has no group', async () => {
    const res = await request(app).get('/api/groups/my-status/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns the formatted group with its resolved leader', async () => {
    route(db.__pool.query, [
      {
        when: /FROM project_groups pg\s+JOIN project_group_members gm ON pg\.id = gm\.group_id/,
        then: [{ groupId: 1, groupName: 'CYGEN', supervisor: 'Dr. Perera', level: 3, supervisorId: 7, supervisor2: null, supervisorId2: null }],
      },
      {
        when: /SELECT gm\.group_id, u\.id, u\.name, u\.university_id, gm\.is_leader/,
        then: [{ group_id: 1, id: 11, name: 'Alice', university_id: '2020001', is_leader: 1 }],
      },
    ]);

    const res = await request(app).get('/api/groups/my-status/11');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ groupId: 1, groupName: 'CYGEN', leader: 'Alice', status: 'Active' });
    expect(res.body[0].members).toHaveLength(1);
  });
});

describe('DELETE /api/groups/delete/:id (deleteGroup)', () => {
  test('rejects a non-numeric group id', async () => {
    const res = await request(app).delete('/api/groups/delete/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/group id is required/i);
  });

  test('returns 404 when the group does not exist', async () => {
    const res = await request(app).delete('/api/groups/delete/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/group not found/i);
  });

  test('deletes the group and its members on the happy path', async () => {
    route(db.__connection.query, [
      { when: /SELECT group_name, level FROM project_groups WHERE id = \? LIMIT 1/, then: [{ group_name: 'CYGEN', level: 3 }] },
    ]);

    const res = await request(app).delete('/api/groups/delete/42');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Deleted.' });
    expect(db.__connection.commit).toHaveBeenCalled();
    expect(
      db.__connection.query.mock.calls.some(([sql]) => /DELETE FROM project_groups WHERE id = \?/.test(sql))
    ).toBe(true);
  });
});
