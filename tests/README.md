# Backend tests

Covers three workflows, each in its own folder, mirroring the routes in
`src/routes/groupRoutes.js` and `src/routes/milestoneRoutes.js`:

```
tests/
  helpers/
    dbMock.js        # mocks the MySQL2 pool/connection — no real DB needed
    appFactory.js     # mounts one router on a bare Express app for supertest
  group-formation/
    groupFormation.test.js      # POST /request, POST /create, GET /my-status/:id, DELETE /delete/:id
  milestone-creation/
    milestoneCreation.test.js   # POST /, PUT /:id, DELETE /:id, GET /group/:groupId
  task-creation/
    taskCreation.test.js        # POST /tasks, PUT /tasks/:id/status, DELETE /tasks/:id
```

These are integration-style tests: each one sends a real HTTP request
(via `supertest`) into the actual Express router + controller code, with only
the MySQL layer mocked (`tests/helpers/dbMock.js`). No database connection,
`.env`, or running server is required.

## How to run

From `Edusync-Backend/`:

```bash
npm install      # one-time — installs jest + supertest as devDependencies
npm test         # runs the whole suite once
npm run test:watch   # re-runs on file changes while you work
```

To run just one workflow's tests:

```bash
npx jest tests/group-formation
npx jest tests/milestone-creation
npx jest tests/task-creation
```

To run a single test by name:

```bash
npx jest -t "creates a new pending request"
```

## What "passing" means here

Every test asserts on the actual HTTP response (status code + JSON body) and,
for the write paths, on the exact SQL the controller issued (via the mocked
`db.__pool.query` / `db.__connection.query` call history) — e.g. that a
create-group-request inserts the right supervisor row, or that deleting a
group also deletes its `project_group_members` rows. A red test means either
the route/controller logic changed, or the SQL shape the test expects (see
the `route(...)` calls at the top of each `test(...)`) is now stale and needs
updating to match.
