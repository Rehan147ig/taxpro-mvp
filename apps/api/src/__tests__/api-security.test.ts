import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { provisionRoutes } from '../modules/provision/provision.routes.js';
import { importRoutes } from '../modules/import/import.routes.js';
import { mappingRoutes } from '../modules/mapping/mapping.routes.js';
import { errorHandler } from '../lib/middleware/error-handler.js';
import { env } from '../config/env.js';

const app = new Hono();
app.onError(errorHandler);
app.route('/api/auth', authRoutes);
app.route('/api/provision', provisionRoutes);
app.route('/api/import', importRoutes);
app.route('/api/mapping', mappingRoutes);

let authToken = '';

describe('Phase 4.1 — Authentication', () => {

  it('login with valid credentials returns 200 + JWT', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@taxpro.ai', password: 'TaxProDemo123!' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe('string');
    expect(data.tenant).toBeDefined();
    authToken = data.token;
  });

  it('login with wrong password returns 401', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@taxpro.ai', password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
  });

  it('login with missing body returns 400', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('login with SQL injection in email returns 400 (not 500)', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: "' OR '1'='1", password: 'test' }),
    });
    expect(res.status).toBe(400);
  });

});

describe('Phase 4.2 — Protected endpoint access', () => {

  it('returns 401 when no auth header', async () => {
    const res = await app.request('/api/provision/runs');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await app.request('/api/provision/runs', {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed auth header', async () => {
    const res = await app.request('/api/provision/runs', {
      headers: { Authorization: 'Basic not-bearer' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 with an expired token', async () => {
    const expiredToken = jwt.sign(
      { userId: 'expired-user', tenantId: '00000000-0000-0000-0000-000000000000', email: 'expired@test.local', role: 'admin' },
      env.JWT_SECRET,
      { expiresIn: '1s' }
    );
    await new Promise((r) => setTimeout(r, 1100));
    const res = await app.request('/api/provision/runs', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Invalid or expired token');
  });

});

describe('Phase 4.3 — Provision flow with auth', () => {

  it('creates provision run with valid token', async () => {
    const run = await app.request('/api/provision/run?direct=true', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ period: '2026-01-01' }),
    });
    expect(run.status).toBe(200);
    const runData = await run.json() as any;
    expect(runData.provisionRunId).toBeDefined();
  });

});

describe('Phase 4.4 — Import routes security', () => {

  it('import route returns 401 without auth', async () => {
    const res = await app.request('/api/import/companies-house', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyNumber: '' }),
    });
    expect(res.status).toBe(401);
  });

  it('import route returns 400 for empty company number when authenticated', async () => {
    const res = await app.request('/api/import/companies-house', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ companyNumber: '' }),
    });
    expect(res.status).toBe(400);
  });

});

describe('Phase 4.5 — Rate Limiter (must be last — depletes quota)', () => {

  it('6th login attempt within window returns 429', async () => {
    const body = JSON.stringify({ email: 'demo@taxpro.ai', password: 'wrong' });
    const headers = { 'Content-Type': 'application/json' };
    let got429 = false;
    for (let i = 0; i < 10; i++) {
      const r = await app.request('/api/auth/login', { method: 'POST', headers, body });
      if (r.status === 429) {
        got429 = true;
        const text = await r.json() as any;
        expect(text.error).toContain('Too many requests');
        break;
      }
      expect([400, 401]).toContain(r.status);
    }
    expect(got429).toBe(true);
  });

});
