/**
 * Shared MySQL2-pool mock used by every controller test.
 *
 * The real controllers do:
 *   const db = require('../config/db');
 *   const dbPromise = db.promise();
 *   const [rows] = await dbPromise.query(sql, params);
 *
 * This mock stands in for `db.promise()` (the pool) and for a checked-out
 * transaction `connection` (db.promise().getConnection()). Both `.query`
 * calls default to resolving `[[]]` (an empty result set) so that all the
 * "ensure table/column exists" bootstrap queries every controller runs on
 * first call (SHOW COLUMNS / CREATE TABLE IF NOT EXISTS / ALTER TABLE) just
 * quietly succeed without needing to be stubbed individually.
 *
 * Call `route(pool.query, rules)` to make specific SQL statements return
 * specific rows. Rules are matched by regex against the SQL text, in order,
 * first match wins — so tests stay correct regardless of exactly how many
 * bootstrap queries a given controller happens to run before or after the
 * query under test.
 */

// `jest` is injected as a global by the Jest test runner — no import needed.

function makeDbMock() {
  const connection = {
    query: jest.fn(),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  connection.query.mockResolvedValue([[]]);
  connection.beginTransaction.mockResolvedValue(undefined);
  connection.commit.mockResolvedValue(undefined);
  connection.rollback.mockResolvedValue(undefined);

  const pool = {
    query: jest.fn(),
    getConnection: jest.fn(),
  };
  pool.query.mockResolvedValue([[]]);
  pool.getConnection.mockResolvedValue(connection);

  return { pool, connection };
}

/**
 * @param {jest.Mock} queryMock  either pool.query or connection.query
 * @param {Array<{ when: RegExp, then: any[] | ((sql: string, params: any) => any[]) }>} rules
 */
function route(queryMock, rules) {
  queryMock.mockImplementation((sql, params) => {
    const text = String(sql);
    for (const rule of rules) {
      if (rule.when.test(text)) {
        const rows = typeof rule.then === 'function' ? rule.then(text, params) : rule.then;
        return Promise.resolve([rows]);
      }
    }
    return Promise.resolve([[]]);
  });
}

module.exports = { makeDbMock, route };
