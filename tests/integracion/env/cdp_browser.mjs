import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RC_CONFIG } from '../config/rc.config.mjs';

// Cliente Chrome DevTools Protocol (CDP) sin dependencias externas (usa WebSocket nativo de Node 24).
// Permite automatizar Chromium 156 headless, interceptar respuestas completas de red (/functions/v1/*),
// controlar diálogos window.confirm, emular modo sin conexión y cambiar viewport (390x844).

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.networkRecords = [];
    this.pendingResponses = new Map();
    this.dialogPolicy = 'accept';
    this.lastDialogs = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e) => reject(new Error(`CDP WebSocket error: ${e.message || 'unknown'}`)));
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id) {
          const entry = this.pending.get(msg.id);
          if (entry) {
            this.pending.delete(msg.id);
            if (msg.error) entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message}`));
            else entry.resolve(msg.result);
          }
          return;
        }
        if (msg.method) {
          const list = this.listeners.get(msg.method) || [];
          for (const fn of list) {
            try {
              fn(msg.params);
            } catch {
              // ignorar error en listener
            }
          }
        }
      });
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');

    this.on('Page.javascriptDialogOpening', (params) => {
      this.lastDialogs.push({ type: params.type, message: params.message });
      void this.send('Page.handleJavaScriptDialog', {
        accept: this.dialogPolicy !== 'dismiss',
      }).catch(() => {});
    });

    this.on('Network.requestWillBeSent', (params) => {
      this.pendingResponses.set(params.requestId, {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        postData: params.request.postData || null,
        status: null,
        responseHeaders: {},
        responseBody: null,
      });
    });

    this.on('Network.responseReceived', (params) => {
      const rec = this.pendingResponses.get(params.requestId) || {
        requestId: params.requestId,
        url: params.response.url,
        method: 'GET',
        postData: null,
      };
      rec.status = params.response.status;
      rec.responseHeaders = params.response.headers || {};
      this.pendingResponses.set(params.requestId, rec);
    });

    this.on('Network.loadingFinished', async (params) => {
      const rec = this.pendingResponses.get(params.requestId);
      if (!rec) return;
      this.pendingResponses.delete(params.requestId);
      if (rec.url.includes('/functions/v1/') || rec.url.includes('/rest/v1/') || rec.url.includes('/auth/v1/')) {
        try {
          const bodyRes = await this.send('Network.getResponseBody', { requestId: params.requestId });
          rec.responseBody = bodyRes.base64Encoded
            ? Buffer.from(bodyRes.body, 'base64').toString('utf8')
            : bodyRes.body;
        } catch {
          // cuerpo vacío o ya liberado
        }
      }
      this.networkRecords.push(rec);
    });

    this.on('Network.loadingFailed', (params) => {
      const rec = this.pendingResponses.get(params.requestId);
      if (!rec) return;
      this.pendingResponses.delete(params.requestId);
      rec.failed = true;
      rec.canceled = Boolean(params.canceled);
      rec.errorText = params.errorText || 'failed';
      this.networkRecords.push(rec);
    });
  }

  on(event, fn) {
    const list = this.listeners.get(event) || [];
    list.push(fn);
    this.listeners.set(event, list);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url, waitMs = 600) {
    await this.send('Page.navigate', { url });
    await this.waitForSelector('body', 10000);
    if (waitMs > 0) await sleep(waitMs);
  }

  async reload(waitMs = 600) {
    await this.send('Page.reload', { ignoreCache: false });
    await this.waitForSelector('body', 10000);
    if (waitMs > 0) await sleep(waitMs);
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`JS Eval Error: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async waitFor(predicateExpr, timeoutMs = 10000, pollMs = 120) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const val = await this.eval(predicateExpr);
        if (val) return val;
      } catch {
        // continuar esperando durante navegación
      }
      await sleep(pollMs);
    }
    throw new Error(`Timeout (${timeoutMs}ms) esperando condición: ${predicateExpr}`);
  }

  async waitForSelector(selector, timeoutMs = 10000) {
    const selJson = JSON.stringify(selector);
    return await this.waitFor(`Boolean(document.querySelector(${selJson}))`, timeoutMs);
  }

  async waitForText(textSubstring, timeoutMs = 10000) {
    const txtJson = JSON.stringify(textSubstring);
    return await this.waitFor(`Boolean(document.body && document.body.innerText.includes(${txtJson}))`, timeoutMs);
  }

  async clickButtonByText(textSubstring, exact = false) {
    const txtJson = JSON.stringify(textSubstring);
    const clicked = await this.eval(`(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const target = buttons.find((b) => {
        if (b.disabled) return false;
        const t = (b.innerText || b.textContent || '').trim();
        return ${exact ? `t === ${txtJson}` : `t.includes(${txtJson})`};
      });
      if (!target) return false;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return true;
    })()`);
    if (!clicked) {
      throw new Error(`No se encontró botón habilitado con texto: ${textSubstring}`);
    }
    await sleep(150);
  }

  async setInputValue(selector, value) {
    const selJson = JSON.stringify(selector);
    const valJson = JSON.stringify(String(value));
    const ok = await this.eval(`(() => {
      const el = document.querySelector(${selJson});
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${valJson});
      else el.value = ${valJson};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new Error(`No se encontró input/textarea para selector: ${selector}`);
    await sleep(80);
  }

  async setViewport(width, height, mobile = false) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await sleep(150);
  }

  async setOffline(offline) {
    await this.send('Network.emulateNetworkConditions', {
      offline: Boolean(offline),
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }

  async close() {
    try {
      this.ws?.close();
    } catch {
      // ignorar
    }
  }
}

export class CdpBrowser {
  constructor(debugPort = RC_CONFIG.ports.chromiumDebug, profileSuffix = 'default') {
    this.debugPort = debugPort;
    this.userDataDir = path.join(RC_CONFIG.workDir, `chrome_profile_${profileSuffix}_${debugPort}`);
    this.downloadDir = path.join(RC_CONFIG.workDir, `downloads_${profileSuffix}_${debugPort}`);
    this.proc = null;
  }

  async launch() {
    fs.rmSync(this.userDataDir, { recursive: true, force: true });
    fs.rmSync(this.downloadDir, { recursive: true, force: true });
    fs.mkdirSync(this.userDataDir, { recursive: true });
    fs.mkdirSync(this.downloadDir, { recursive: true });

    this.proc = spawn(
      RC_CONFIG.chromiumBin,
      [
        '--headless',
        '--no-sandbox',
        '--no-proxy-server',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-first-run-ui',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${this.userDataDir}`,
        `--remote-debugging-port=${this.debugPort}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.debugPort}/json/version`);
        if (res.ok) break;
      } catch {
        // esperando arranque
      }
      await sleep(150);
    }
  }

  async newPage() {
    const res = await fetch(`http://127.0.0.1:${this.debugPort}/json/new?about:blank`, { method: 'PUT' });
    const target = await res.json();
    const session = new CdpSession(target.webSocketDebuggerUrl);
    await session.connect();
    await session.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: this.downloadDir,
    }).catch(() => {});
    return session;
  }

  async close() {
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        // ignorar
      }
      this.proc = null;
    }
    await sleep(200);
    fs.rmSync(this.userDataDir, { recursive: true, force: true });
  }
}
