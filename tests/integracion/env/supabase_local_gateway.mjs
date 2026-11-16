import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RC_CONFIG } from '../config/rc.config.mjs';
import { PgPool } from './pg_wire.mjs';

// Pasarela HTTP local aislada para LAB-RC-001:
// - /rest/v1/*      -> PostgREST oficial v12.2.3 en 127.0.0.1:54342
// - /functions/v1/* -> Workers Deno 2.x reales en 127.0.0.1:(54350 + idx)
// - /auth/v1/*      -> Emulador GoTrue respaldado por esquema auth.* en PostgreSQL 15
// - /__rc_control/* -> Ganchos de control para inyección determinista de fallos HTTP en pruebas

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function signJwtHs256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

export function verifyJwtHs256(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest());
  if (s !== expected) return null;
  try {
    const payload = JSON.parse(b64urlDecode(p));
    if (payload.exp && Math.floor(Date.now() / 1000) >= Number(payload.exp)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function formatAuthUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    aud: row.aud || 'authenticated',
    role: row.role || 'authenticated',
    email: row.email,
    email_confirmed_at: row.email_confirmed_at || null,
    invited_at: row.invited_at || null,
    banned_until: row.banned_until || null,
    last_sign_in_at: row.last_sign_in_at || null,
    app_metadata: row.raw_app_meta_data || { provider: 'email', providers: ['email'] },
    user_metadata: row.raw_user_meta_data || {},
    identities: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_anonymous: Boolean(row.is_anonymous),
  };
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, x-forwarded-for, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
    'Access-Control-Expose-Headers': 'Content-Range, X-Total-Count, Retry-After',
    ...extraHeaders,
  });
  res.end(body);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function startServers() {
  const runtimeStatePath = path.join(RC_CONFIG.workDir, 'runtime_state.json');
  const runtimeState = JSON.parse(fs.readFileSync(runtimeStatePath, 'utf8'));
  const jwtSecret = runtimeState.jwtSecret;
  const postgrestPort = runtimeState.postgrestPort || 54342;

  const pool = new PgPool({
    socketPath: path.join(RC_CONFIG.postgres.socketDir, `.s.PGSQL.${RC_CONFIG.postgres.port}`),
    user: RC_CONFIG.postgres.superuser,
    database: RC_CONFIG.postgres.dbName,
  }, 20);

  // Reglas de inyección de fallos activas:
  // [{ method, pathIncludes, action, bodyIncludes, delayMs, status, body, headers, afterUpstreamStatus, afterUpstreamBody, remaining }]
  let faultRules = [];

  function matchFaultRule(method, urlPath, rawBody) {
    const bodyText = Buffer.isBuffer(rawBody)
      ? rawBody.toString('utf8')
      : typeof rawBody === 'string'
        ? rawBody
        : '';
    let parsedBody;
    let parsedAttempted = false;
    const getParsedBody = () => {
      if (!parsedAttempted) {
        parsedAttempted = true;
        if (bodyText) {
          try {
            parsedBody = JSON.parse(bodyText);
          } catch {
            parsedBody = null;
          }
        } else {
          parsedBody = null;
        }
      }
      return parsedBody;
    };

    for (let i = 0; i < faultRules.length; i += 1) {
      const rule = faultRules[i];
      if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) continue;
      if (rule.pathIncludes && !urlPath.includes(rule.pathIncludes)) continue;
      if (rule.action !== undefined) {
        const json = getParsedBody();
        if (!json || typeof json !== 'object' || json.action !== rule.action) continue;
      }
      if (rule.bodyIncludes !== undefined && !bodyText.includes(String(rule.bodyIncludes))) continue;
      if (typeof rule.remaining === 'number') {
        if (rule.remaining <= 0) continue;
        rule.remaining -= 1;
      }
      return rule;
    }
    return null;
  }

  function extractBearerToken(req) {
    const auth = req.headers.authorization || '';
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    return req.headers.apikey ? String(req.headers.apikey).trim() : '';
  }

  function issueSession(userRow) {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + 3600;
    const accessToken = signJwtHs256(
      {
        aud: 'authenticated',
        role: 'authenticated',
        sub: userRow.id,
        email: userRow.email,
        is_anonymous: Boolean(userRow.is_anonymous),
        app_metadata: userRow.raw_app_meta_data || { provider: 'email', providers: ['email'] },
        user_metadata: userRow.raw_user_meta_data || {},
        iat: nowSec,
        exp: expSec,
      },
      jwtSecret,
    );
    const refreshToken = crypto.randomBytes(24).toString('hex');
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expSec,
      refresh_token: refreshToken,
      user: formatAuthUser(userRow),
    };
  }

  async function handleAuth(req, res, parsedUrl, rawBody) {
    const pathname = parsedUrl.pathname.replace(/^\/auth\/v1/, '') || '/';
    const method = req.method || 'GET';
    let body = {};
    if (rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        body = {};
      }
    }

    if (method === 'POST' && pathname === '/token') {
      const grantType = parsedUrl.searchParams.get('grant_type') || 'password';
      if (grantType === 'password') {
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const { rows } = await pool.query(
          `SELECT *, (encrypted_password = crypt($2, encrypted_password)) AS pass_ok
           FROM auth.users WHERE lower(email) = $1 LIMIT 1`,
          [email, password],
        );
        const userRow = rows[0];
        if (!userRow || !userRow.pass_ok) {
          return sendJson(res, 400, {
            error: 'invalid_grant',
            error_description: 'Invalid login credentials',
            msg: 'Invalid login credentials',
          });
        }
        if (userRow.banned_until && new Date(userRow.banned_until).getTime() > Date.now()) {
          return sendJson(res, 400, {
            error: 'user_banned',
            error_description: 'User is banned',
            msg: 'User is banned',
          });
        }
        await pool.query('UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1', [userRow.id]);
        const session = issueSession(userRow);
        await pool.query('INSERT INTO auth.refresh_tokens(token, user_id) VALUES ($1, $2)', [session.refresh_token, userRow.id]);
        return sendJson(res, 200, session);
      }

      if (grantType === 'refresh_token') {
        const rt = String(body.refresh_token || '');
        const { rows } = await pool.query(
          `SELECT u.* FROM auth.refresh_tokens r
           JOIN auth.users u ON u.id = r.user_id
           WHERE r.token = $1 AND r.revoked = false LIMIT 1`,
          [rt],
        );
        const userRow = rows[0];
        if (!userRow) {
          return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', msg: 'Invalid Refresh Token' });
        }
        if (userRow.banned_until && new Date(userRow.banned_until).getTime() > Date.now()) {
          return sendJson(res, 400, { error: 'user_banned', error_description: 'User is banned', msg: 'User is banned' });
        }
        const session = issueSession(userRow);
        await pool.query('INSERT INTO auth.refresh_tokens(token, user_id) VALUES ($1, $2)', [session.refresh_token, userRow.id]);
        return sendJson(res, 200, session);
      }

      return sendJson(res, 400, { error: 'unsupported_grant_type', msg: 'Unsupported grant_type' });
    }

    if (method === 'GET' && pathname === '/user') {
      const token = extractBearerToken(req);
      const claims = verifyJwtHs256(token, jwtSecret);
      if (!claims || !claims.sub) {
        return sendJson(res, 401, { msg: 'Invalid JWT', message: 'Invalid JWT' });
      }
      const { rows } = await pool.query('SELECT * FROM auth.users WHERE id = $1 LIMIT 1', [claims.sub]);
      const userRow = rows[0];
      if (!userRow) {
        return sendJson(res, 401, { msg: 'User from sub claim in JWT does not exist', message: 'User not found' });
      }
      if (userRow.banned_until && new Date(userRow.banned_until).getTime() > Date.now()) {
        return sendJson(res, 403, { msg: 'User is banned', message: 'User is banned' });
      }
      return sendJson(res, 200, formatAuthUser(userRow));
    }

    if (method === 'PUT' && pathname === '/user') {
      const token = extractBearerToken(req);
      const claims = verifyJwtHs256(token, jwtSecret);
      if (!claims || !claims.sub) {
        return sendJson(res, 401, { msg: 'Invalid JWT', message: 'Invalid JWT' });
      }
      const metaPatch = body.data || body.user_metadata || null;
      if (body.password) {
        await pool.query(
          `UPDATE auth.users
           SET encrypted_password = crypt($2, gen_salt('bf')),
               updated_at = now()
           WHERE id = $1`,
          [claims.sub, String(body.password)],
        );
      }
      if (metaPatch && typeof metaPatch === 'object') {
        await pool.query(
          `UPDATE auth.users
           SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || $2::jsonb,
               updated_at = now()
           WHERE id = $1`,
          [claims.sub, JSON.stringify(metaPatch)],
        );
      }
      const { rows } = await pool.query('SELECT * FROM auth.users WHERE id = $1 LIMIT 1', [claims.sub]);
      const formatted = formatAuthUser(rows[0]);
      return sendJson(res, 200, { user: formatted, ...formatted });
    }

    if (method === 'POST' && pathname === '/logout') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      });
      return res.end();
    }

    if (method === 'POST' && pathname === '/recover') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return sendJson(res, 400, { msg: 'Email required', message: 'Email required' });
      const redirectTo = parsedUrl.searchParams.get('redirect_to') || null;
      await pool.query('INSERT INTO auth.mail_outbox(kind, email, redirect_to) VALUES ($1, $2, $3)', ['recover', email, redirectTo]);
      return sendJson(res, 200, {});
    }

    // Rutas administrativas (/invite y /admin/users*)
    const token = extractBearerToken(req);
    const claims = verifyJwtHs256(token, jwtSecret);
    if (!claims || claims.role !== 'service_role') {
      return sendJson(res, 403, { msg: 'User not allowed', message: 'User not allowed' });
    }

    if (method === 'POST' && pathname === '/invite') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return sendJson(res, 400, { msg: 'Email required', message: 'Email required' });
      const dup = await pool.query('SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1', [email]);
      if (dup.rows.length > 0) {
        return sendJson(res, 422, {
          msg: 'A user with this email address has already been registered',
          message: 'A user with this email address has already been registered',
        });
      }
      const userMeta = body.data && typeof body.data === 'object' ? body.data : {};
      const { rows } = await pool.query(
        `INSERT INTO auth.users(email, invited_at, raw_user_meta_data)
         VALUES ($1, now(), $2::jsonb)
         RETURNING *`,
        [email, JSON.stringify(userMeta)],
      );
      const redirectTo = parsedUrl.searchParams.get('redirect_to') || null;
      await pool.query('INSERT INTO auth.mail_outbox(kind, email, redirect_to) VALUES ($1, $2, $3)', ['invite', email, redirectTo]);
      const formatted = formatAuthUser(rows[0]);
      return sendJson(res, 200, { user: formatted, ...formatted });
    }

    if (method === 'GET' && pathname === '/admin/users') {
      const { rows } = await pool.query('SELECT * FROM auth.users ORDER BY created_at ASC');
      return sendJson(
        res,
        200,
        { users: rows.map(formatAuthUser), aud: 'authenticated' },
        { 'x-total-count': String(rows.length) },
      );
    }

    if (method === 'POST' && pathname === '/admin/users') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const dup = await pool.query('SELECT id FROM auth.users WHERE lower(email) = $1 LIMIT 1', [email]);
      if (dup.rows.length > 0) {
        return sendJson(res, 422, {
          msg: 'A user with this email address has already been registered',
          message: 'A user with this email address has already been registered',
        });
      }
      const userMeta = body.user_metadata && typeof body.user_metadata === 'object' ? body.user_metadata : {};
      const appMeta = body.app_metadata && typeof body.app_metadata === 'object'
        ? body.app_metadata
        : { provider: 'email', providers: ['email'] };
      const emailConfirmedAt = body.email_confirm ? new Date().toISOString() : null;
      const { rows } = await pool.query(
        `INSERT INTO auth.users(email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
         VALUES ($1, crypt($2, gen_salt('bf')), $3, $4::jsonb, $5::jsonb)
         RETURNING *`,
        [email, password, emailConfirmedAt, JSON.stringify(userMeta), JSON.stringify(appMeta)],
      );
      const formatted = formatAuthUser(rows[0]);
      return sendJson(res, 200, { user: formatted, ...formatted });
    }

    const adminUserMatch = pathname.match(/^\/admin\/users\/([0-9a-fA-F-]{36})$/);
    if (adminUserMatch) {
      const targetId = adminUserMatch[1];
      if (method === 'PUT') {
        const existing = await pool.query('SELECT * FROM auth.users WHERE id = $1 LIMIT 1', [targetId]);
        if (existing.rows.length === 0) {
          return sendJson(res, 404, { msg: 'User not found', message: 'User not found' });
        }
        if (body.ban_duration !== undefined) {
          const bd = String(body.ban_duration);
          if (bd === 'none' || bd === '0' || bd === '0s' || bd === '0h') {
            await pool.query('UPDATE auth.users SET banned_until = NULL, updated_at = now() WHERE id = $1', [targetId]);
          } else {
            const hoursMatch = bd.match(/^(\d+)h$/);
            const hours = hoursMatch ? Number(hoursMatch[1]) : 876000;
            const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
            await pool.query('UPDATE auth.users SET banned_until = $2, updated_at = now() WHERE id = $1', [targetId, until]);
          }
        }
        if (body.user_metadata && typeof body.user_metadata === 'object') {
          await pool.query(
            `UPDATE auth.users
             SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || $2::jsonb,
                 updated_at = now()
             WHERE id = $1`,
            [targetId, JSON.stringify(body.user_metadata)],
          );
        }
        if (body.password) {
          await pool.query(
            `UPDATE auth.users SET encrypted_password = crypt($2, gen_salt('bf')), updated_at = now() WHERE id = $1`,
            [targetId, String(body.password)],
          );
        }
        const { rows } = await pool.query('SELECT * FROM auth.users WHERE id = $1 LIMIT 1', [targetId]);
        const formatted = formatAuthUser(rows[0]);
        return sendJson(res, 200, { user: formatted, ...formatted });
      }
      if (method === 'DELETE') {
        const { rows } = await pool.query('DELETE FROM auth.users WHERE id = $1 RETURNING *', [targetId]);
        if (rows.length === 0) return sendJson(res, 404, { msg: 'User not found', message: 'User not found' });
        const formatted = formatAuthUser(rows[0]);
        return sendJson(res, 200, { user: formatted, ...formatted });
      }
    }

    return sendJson(res, 404, { msg: `Auth endpoint not found: ${method} ${pathname}`, message: 'Not found' });
  }

  function proxyRequest(req, res, targetPort, targetPath, rawBody) {
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders.connection;
    forwardHeaders['content-length'] = String(rawBody.length);
    if (!forwardHeaders['x-forwarded-for']) {
      forwardHeaders['x-forwarded-for'] = req.socket?.remoteAddress || '127.0.0.1';
    }

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: targetPath,
        headers: forwardHeaders,
      },
      (proxyRes) => {
        const resHeaders = {
          ...proxyRes.headers,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, x-forwarded-for, x-supabase-api-version',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
          'Access-Control-Expose-Headers': 'Content-Range, X-Total-Count, Retry-After, Preference-Applied, Location',
        };
        res.writeHead(proxyRes.statusCode || 502, resHeaders);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', (err) => {
      sendJson(res, 502, { message: `Gateway proxy error: ${err.message}` });
    });

    if (rawBody.length > 0) proxyReq.write(rawBody);
    proxyReq.end();
  }

  function forwardToUpstreamAndWait(req, targetPort, targetPath, rawBody) {
    return new Promise((resolve, reject) => {
      const forwardHeaders = { ...req.headers };
      delete forwardHeaders.host;
      delete forwardHeaders.connection;
      forwardHeaders['content-length'] = String(rawBody.length);
      if (!forwardHeaders['x-forwarded-for']) {
        forwardHeaders['x-forwarded-for'] = req.socket?.remoteAddress || '127.0.0.1';
      }

      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: targetPort,
          method: req.method,
          path: targetPath,
          headers: forwardHeaders,
        },
        (proxyRes) => {
          const chunks = [];
          proxyRes.on('data', (chunk) => chunks.push(chunk));
          proxyRes.on('end', () => {
            resolve({
              statusCode: proxyRes.statusCode || 502,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          proxyRes.on('error', reject);
        },
      );

      proxyReq.on('error', reject);
      if (rawBody.length > 0) proxyReq.write(rawBody);
      proxyReq.end();
    });
  }

  function sendFaultPayload(res, status, payload, extraHeaders = {}) {
    if (typeof payload === 'string') {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, x-forwarded-for, x-supabase-api-version',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
        'Access-Control-Expose-Headers': 'Content-Range, X-Total-Count, Retry-After',
        ...extraHeaders,
      });
      res.end(payload);
      return;
    }
    sendJson(res, status, payload, extraHeaders);
  }

  function serveStaticApp(req, res, parsedUrl) {
    const distDir = path.join(RC_CONFIG.workDir, 'dist');
    let relPath = decodeURIComponent(parsedUrl.pathname);
    if (relPath === '/') relPath = '/index.html';
    let filePath = path.join(distDir, relPath);
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('Build not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  }

  const gatewayServer = http.createServer(async (req, res) => {
    try {
      const reqAllowedHeaders = req.headers['access-control-request-headers']
        || 'authorization, x-client-info, apikey, content-type, prefer, accept-profile, content-profile, x-forwarded-for, x-supabase-api-version';
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': req.headers.origin || '*',
          'Access-Control-Allow-Headers': reqAllowedHeaders,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
          'Access-Control-Allow-Private-Network': 'true',
        });
        return res.end();
      }

      const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${RC_CONFIG.ports.gateway}`);
      const rawBody = await readRawBody(req);

      if (parsedUrl.pathname === '/__rc_control/health') {
        return sendJson(res, 200, { ok: true, rcId: RC_CONFIG.rcId });
      }

      if (parsedUrl.pathname === '/__rc_control/faults') {
        if (req.method === 'POST') {
          const payload = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
          if (payload.clear) faultRules = [];
          if (Array.isArray(payload.rules)) faultRules = payload.rules;
          return sendJson(res, 200, { ok: true, faultRules });
        }
        if (req.method === 'DELETE') {
          faultRules = [];
          return sendJson(res, 200, { ok: true, faultRules: [] });
        }
        return sendJson(res, 200, { faultRules });
      }

      const matchedFault = matchFaultRule(req.method || 'GET', parsedUrl.pathname + parsedUrl.search, rawBody);
      if (matchedFault) {
        if (typeof matchedFault.delayMs === 'number' && matchedFault.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, matchedFault.delayMs));
        }
        if (typeof matchedFault.afterUpstreamStatus === 'number') {
          let targetPort = null;
          let targetPath = null;
          if (parsedUrl.pathname.startsWith('/rest/v1')) {
            targetPort = postgrestPort;
            targetPath = (parsedUrl.pathname.slice('/rest/v1'.length) || '/') + parsedUrl.search;
          } else if (parsedUrl.pathname.startsWith('/functions/v1/')) {
            const fnName = parsedUrl.pathname.slice('/functions/v1/'.length).split('/')[0];
            const fnIdx = RC_CONFIG.edgeFunctions.indexOf(fnName);
            if (fnIdx === -1) {
              return sendJson(res, 404, { error: `Edge Function no registrada: ${fnName}` });
            }
            targetPort = RC_CONFIG.ports.denoBase + fnIdx;
            targetPath = parsedUrl.pathname + parsedUrl.search;
          }
          if (targetPort !== null && targetPath !== null) {
            await forwardToUpstreamAndWait(req, targetPort, targetPath, rawBody);
          }
          const postCommitBody = matchedFault.afterUpstreamBody !== undefined
            ? matchedFault.afterUpstreamBody
            : (matchedFault.body || { message: 'Injected post-commit upstream ack loss', error: 'Bad Gateway' });
          return sendFaultPayload(
            res,
            matchedFault.afterUpstreamStatus,
            postCommitBody,
            matchedFault.headers || {},
          );
        }
        return sendFaultPayload(
          res,
          matchedFault.status || 500,
          matchedFault.body || { message: 'Injected RC fault', error: 'Injected RC fault' },
          matchedFault.headers || {},
        );
      }

      if (parsedUrl.pathname.startsWith('/auth/v1')) {
        return await handleAuth(req, res, parsedUrl, rawBody);
      }

      if (parsedUrl.pathname.startsWith('/rest/v1')) {
        const subPath = (parsedUrl.pathname.slice('/rest/v1'.length) || '/') + parsedUrl.search;
        return proxyRequest(req, res, postgrestPort, subPath, rawBody);
      }

      if (parsedUrl.pathname.startsWith('/functions/v1/')) {
        const fnName = parsedUrl.pathname.slice('/functions/v1/'.length).split('/')[0];
        const fnIdx = RC_CONFIG.edgeFunctions.indexOf(fnName);
        if (fnIdx === -1) {
          return sendJson(res, 404, { error: `Edge Function no registrada: ${fnName}` });
        }
        const fnPort = RC_CONFIG.ports.denoBase + fnIdx;
        return proxyRequest(req, res, fnPort, parsedUrl.pathname + parsedUrl.search, rawBody);
      }

      if (parsedUrl.pathname.startsWith('/realtime/v1')) {
        return sendJson(res, 404, { message: 'Realtime WebSocket no habilitado en entorno aislado RC' });
      }

      return serveStaticApp(req, res, parsedUrl);
    } catch (err) {
      return sendJson(res, 500, { message: err instanceof Error ? err.message : 'Internal Gateway Error' });
    }
  });

  // Servidor estático para la compilación de Vite en /tmp/evaluedu_rc_runtime/dist
  const distDir = path.join(RC_CONFIG.workDir, 'dist');
  const appServer = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${RC_CONFIG.ports.appServer}`);
    let relPath = decodeURIComponent(parsedUrl.pathname);
    if (relPath === '/') relPath = '/index.html';
    let filePath = path.join(distDir, relPath);
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('Build not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => gatewayServer.listen(RC_CONFIG.ports.gateway, '127.0.0.1', resolve));
  await new Promise((resolve) => appServer.listen(RC_CONFIG.ports.appServer, '127.0.0.1', resolve));
  console.log(`GATEWAY_READY gateway=127.0.0.1:${RC_CONFIG.ports.gateway} app=127.0.0.1:${RC_CONFIG.ports.appServer}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServers().catch((err) => {
    console.error('Error fatal en supabase_local_gateway:', err);
    process.exit(1);
  });
}
