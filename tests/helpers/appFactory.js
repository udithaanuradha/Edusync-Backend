/**
 * Mounts a single router (e.g. groupRoutes, milestoneRoutes) on a bare
 * Express app, exactly the way index.js mounts it, so tests exercise real
 * routing + real middleware (express.json()) instead of calling controller
 * functions directly with hand-built req/res objects.
 */
const express = require('express');

function buildApp(router, basePath) {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  return app;
}

module.exports = { buildApp };
