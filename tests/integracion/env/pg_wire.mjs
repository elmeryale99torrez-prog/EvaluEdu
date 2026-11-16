import net from 'node:net';

// Driver minimalista y determinista sobre el protocolo wire v3 de PostgreSQL (PostgreSQL 15).
// Soporta Simple Query y Extended Query (Parse/Bind/Execute/Sync) con parámetros UTF-8 seguros
// y parseo tipado por OID para aislar sesiones SQL reales sin dependencias externas no instaladas.

export class PgQueryError extends Error {
  constructor(fields) {
    super(fields.message || 'Error de PostgreSQL');
    this.name = 'PgQueryError';
    this.sqlstate = fields.code || '';
    this.severity = fields.severity || '';
    this.detail = fields.detail || '';
    this.hint = fields.hint || '';
    this.where = fields.where || '';
  }
}

const PG_OID_PARSERS = {
  16: (val) => val === 't' || val === 'true', // bool
  20: (val) => {
    const n = Number(val);
    return Number.isSafeInteger(n) ? n : val;
  }, // int8
  21: (val) => Number(val), // int2
  23: (val) => Number(val), // int4
  26: (val) => Number(val), // oid
  700: (val) => Number(val), // float4
  701: (val) => Number(val), // float8
  1700: (val) => Number(val), // numeric
  114: (val) => JSON.parse(val), // json
  3802: (val) => JSON.parse(val), // jsonb
  1009: parsePgTextArray, // _text
  1015: parsePgTextArray, // _varchar
  2951: parsePgTextArray, // _uuid
};

function parsePgTextArray(raw) {
  if (!raw || raw === '{}') return [];
  if (!raw.startsWith('{') || !raw.endsWith('}')) return [raw];
  const inner = raw.slice(1, -1);
  if (!inner) return [];
  const items = [];
  let cur = '';
  let inQuotes = false;
  let escaped = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      items.push(cur === 'NULL' ? null : cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  items.push(cur === 'NULL' ? null : cur);
  return items;
}

function encodeStartupMessage(user, database) {
  const parts = [
    Buffer.from('user\0', 'utf8'),
    Buffer.from(`${user}\0`, 'utf8'),
    Buffer.from('database\0', 'utf8'),
    Buffer.from(`${database}\0`, 'utf8'),
    Buffer.from('client_encoding\0', 'utf8'),
    Buffer.from('UTF8\0', 'utf8'),
    Buffer.from('\0', 'utf8'),
  ];
  const body = Buffer.concat(parts);
  const len = 4 + 4 + body.length;
  const buf = Buffer.alloc(len);
  buf.writeInt32BE(len, 0);
  buf.writeInt32BE(196608, 4); // protocol 3.0
  body.copy(buf, 8);
  return buf;
}

function frameMessage(typeChar, payload) {
  const len = 4 + payload.length;
  const buf = Buffer.alloc(1 + len);
  buf.writeUInt8(typeChar.charCodeAt(0), 0);
  buf.writeInt32BE(len, 1);
  payload.copy(buf, 5);
  return buf;
}

function encodeParamValue(val) {
  if (val === undefined || val === null) return null;
  if (val instanceof Date) return val.toISOString();
  if (Array.isArray(val) && val.every((x) => typeof x === 'string')) {
    return val;
  }
  if (typeof val === 'object') return JSON.stringify(val);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

function encodeParse(sql) {
  const sqlBuf = Buffer.from(`${sql}\0`, 'utf8');
  const payload = Buffer.alloc(1 + sqlBuf.length + 2);
  payload.writeUInt8(0, 0); // unnamed prepared statement
  sqlBuf.copy(payload, 1);
  payload.writeInt16BE(0, 1 + sqlBuf.length); // 0 param OID hints -> infer from SQL
  return frameMessage('P', payload);
}

function encodeBind(params) {
  const encodedParams = params.map((p) => {
    if (p === undefined || p === null) return null;
    if (Array.isArray(p) && p.every((x) => typeof x === 'string')) {
      const escaped = p.map((s) => `"${String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',');
      return Buffer.from(`{${escaped}}`, 'utf8');
    }
    return Buffer.from(encodeParamValue(p), 'utf8');
  });

  const chunks = [];
  // portal "" (1 byte) + statement "" (1 byte)
  const head = Buffer.alloc(4);
  head.writeUInt8(0, 0);
  head.writeUInt8(0, 1);
  head.writeInt16BE(0, 2); // 0 parameter format codes -> all text
  chunks.push(head);

  const countBuf = Buffer.alloc(2);
  countBuf.writeInt16BE(encodedParams.length, 0);
  chunks.push(countBuf);

  for (const buf of encodedParams) {
    if (buf === null) {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(-1, 0);
      chunks.push(lenBuf);
    } else {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(buf.length, 0);
      chunks.push(lenBuf, buf);
    }
  }

  const tail = Buffer.alloc(2);
  tail.writeInt16BE(0, 0); // 0 result format codes -> all text
  chunks.push(tail);
  return frameMessage('B', Buffer.concat(chunks));
}

function encodeDescribePortal() {
  return frameMessage('D', Buffer.from([0x50, 0x00])); // 'P', ""
}

function encodeExecute() {
  const payload = Buffer.alloc(5);
  payload.writeUInt8(0, 0); // ""
  payload.writeInt32BE(0, 1); // no max rows limit
  return frameMessage('E', payload);
}

function encodeSync() {
  return frameMessage('S', Buffer.alloc(0));
}

function parseErrorFields(payload) {
  const fields = {};
  let idx = 0;
  while (idx < payload.length) {
    const code = payload.readUInt8(idx);
    idx += 1;
    if (code === 0) break;
    const end = payload.indexOf(0, idx);
    const val = payload.toString('utf8', idx, end === -1 ? payload.length : end);
    idx = (end === -1 ? payload.length : end) + 1;
    const key = String.fromCharCode(code);
    if (key === 'M') fields.message = val;
    else if (key === 'C') fields.code = val;
    else if (key === 'S') fields.severity = val;
    else if (key === 'D') fields.detail = val;
    else if (key === 'H') fields.hint = val;
    else if (key === 'W') fields.where = val;
  }
  return fields;
}

function parseRowDescription(payload) {
  const colCount = payload.readInt16BE(0);
  const cols = [];
  let offset = 2;
  for (let i = 0; i < colCount; i += 1) {
    const end = payload.indexOf(0, offset);
    const name = payload.toString('utf8', offset, end);
    offset = end + 1;
    // tableOid(4) + attrNum(2) + typeOid(4) + typeSize(2) + typeMod(4) + formatCode(2)
    const typeOid = payload.readUInt32BE(offset + 6);
    offset += 18;
    cols.push({ name, typeOid });
  }
  return cols;
}

function parseDataRow(payload, cols) {
  const colCount = payload.readInt16BE(0);
  const row = {};
  let offset = 2;
  for (let i = 0; i < colCount; i += 1) {
    const len = payload.readInt32BE(offset);
    offset += 4;
    const col = cols[i] ?? { name: `col_${i}`, typeOid: 25 };
    if (len === -1) {
      row[col.name] = null;
    } else {
      const raw = payload.toString('utf8', offset, offset + len);
      offset += len;
      const parser = PG_OID_PARSERS[col.typeOid];
      row[col.name] = parser ? parser(raw) : raw;
    }
  }
  return row;
}

export class PgClient {
  constructor(options) {
    this.options = options;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  async connect() {
    const { socketPath, host, port, user, database } = this.options;
    await new Promise((resolve, reject) => {
      const sock = socketPath
        ? net.createConnection({ path: socketPath })
        : net.createConnection({ host: host || '127.0.0.1', port });
      this.socket = sock;
      this.pending = {
        mode: 'startup',
        resolve,
        reject,
      };
      sock.once('connect', () => {
        sock.write(encodeStartupMessage(user, database));
      });
      sock.on('data', (chunk) => this.#onData(chunk));
      sock.on('error', (err) => {
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          p.reject(err);
        }
      });
      sock.on('close', () => {
        this.closed = true;
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          p.reject(new Error('Conexión PostgreSQL cerrada inesperadamente.'));
        }
      });
    });
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 5) {
      const type = String.fromCharCode(this.buffer.readUInt8(0));
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < 1 + length) break;
      const payload = this.buffer.subarray(5, 1 + length);
      this.buffer = this.buffer.subarray(1 + length);
      this.#handleMessage(type, payload);
    }
  }

  #handleMessage(type, payload) {
    const p = this.pending;
    if (!p) return;

    if (p.mode === 'startup') {
      if (type === 'R') {
        const authType = payload.readInt32BE(0);
        if (authType !== 0) {
          this.pending = null;
          p.reject(new Error(`Método de autenticación PostgreSQL no soportado: ${authType}`));
        }
      } else if (type === 'E') {
        this.pending = null;
        p.reject(new PgQueryError(parseErrorFields(payload)));
      } else if (type === 'Z') {
        this.pending = null;
        p.resolve();
      }
      return;
    }

    if (type === 'T') {
      p.cols = parseRowDescription(payload);
    } else if (type === 'D') {
      p.rows.push(parseDataRow(payload, p.cols));
    } else if (type === 'C') {
      const tag = payload.toString('utf8').replace(/\0$/, '');
      p.commandTags.push(tag);
    } else if (type === 'N') {
      p.notices.push(parseErrorFields(payload));
    } else if (type === 'E') {
      p.error = new PgQueryError(parseErrorFields(payload));
    } else if (type === 'Z') {
      this.pending = null;
      if (p.error) p.reject(p.error);
      else p.resolve({ rows: p.rows, commandTags: p.commandTags, notices: p.notices });
    }
  }

  query(sql, params = []) {
    const run = async () => {
      if (this.closed || !this.socket) throw new Error('Conexión PostgreSQL cerrada.');
      return await new Promise((resolve, reject) => {
        this.pending = {
          mode: 'query',
          cols: [],
          rows: [],
          commandTags: [],
          notices: [],
          error: null,
          resolve,
          reject,
        };
        if (params.length === 0) {
          const buf = Buffer.from(`${sql}\0`, 'utf8');
          this.socket.write(frameMessage('Q', buf));
        } else {
          this.socket.write(
            Buffer.concat([
              encodeParse(sql),
              encodeBind(params),
              encodeDescribePortal(),
              encodeExecute(),
              encodeSync(),
            ]),
          );
        }
      });
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async close() {
    if (this.closed || !this.socket) return;
    this.closed = true;
    try {
      this.socket.write(frameMessage('X', Buffer.alloc(0)));
    } catch {
      // ignorar si ya cerró
    }
    this.socket.end();
  }
}

export class PgPool {
  constructor(options, maxConnections = 16) {
    this.options = options;
    this.maxConnections = maxConnections;
    this.idle = [];
    this.activeCount = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.idle.length > 0) {
      const client = this.idle.pop();
      if (!client.closed) return client;
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    if (this.activeCount < this.maxConnections) {
      this.activeCount += 1;
      const client = new PgClient(this.options);
      try {
        await client.connect();
        return client;
      } catch (err) {
        this.activeCount = Math.max(0, this.activeCount - 1);
        throw err;
      }
    }
    return await new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(client) {
    if (client.closed) {
      this.activeCount = Math.max(0, this.activeCount - 1);
      if (this.waiters.length > 0) {
        const nextWaiter = this.waiters.shift();
        void this.acquire().then(nextWaiter);
      }
      return;
    }
    if (this.waiters.length > 0) {
      const nextWaiter = this.waiters.shift();
      nextWaiter(client);
      return;
    }
    this.idle.push(client);
  }

  async withClient(fn) {
    const client = await this.acquire();
    try {
      return await fn(client);
    } finally {
      this.release(client);
    }
  }

  async query(sql, params = []) {
    return await this.withClient((client) => client.query(sql, params));
  }

  async withRole(pgRole, claims, fn) {
    return await this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL ROLE ${pgRole}`);
        const claimsJson = JSON.stringify(claims ?? {});
        const sub = claims?.sub ? String(claims.sub) : '';
        const roleClaim = claims?.role ? String(claims.role) : pgRole;
        await client.query(
          "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)",
          [claimsJson, sub, roleClaim],
        );
        const res = await fn(client);
        await client.query('COMMIT');
        return res;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    });
  }

  async close() {
    while (this.idle.length > 0) {
      const client = this.idle.pop();
      await client.close();
    }
  }
}
