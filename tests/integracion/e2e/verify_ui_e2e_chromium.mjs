import fs from 'node:fs';
import path from 'node:path';
import { RC_CONFIG, REPO_ROOT } from '../config/rc.config.mjs';
import { EDUEVAL_V2_13_FIXTURE } from '../config/fixture_13_actividades.mjs';
import { PgClient } from '../env/pg_wire.mjs';
import { CdpBrowser } from '../env/cdp_browser.mjs';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'answer',
  'correct',
  'acceptedAnswers',
  'hasError',
  'expectedCells',
  'activities_snapshot',
  'guest_token_hash',
  'shuffleSeed',
  'recommended',
]);

function scanForbiddenKeys(obj, currentPath = '$', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => scanForbiddenKeys(item, `${currentPath}[${idx}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const nextPath = `${currentPath}.${k}`;
    if (FORBIDDEN_PUBLIC_KEYS.has(k)) {
      out.push(nextPath);
    }
    scanForbiddenKeys(v, nextPath, out);
  }
  return out;
}

export function redactSensitiveData(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');
  }
  if (Array.isArray(val)) {
    return val.map((item) => redactSensitiveData(item));
  }
  if (typeof val === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      const lower = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        lower.includes('token') ||
        lower.includes('password') ||
        lower.includes('secret') ||
        lower.includes('authorization') ||
        lower.includes('apikey')
      ) {
        res[k] = '[REDACTED]';
      } else {
        res[k] = redactSensitiveData(v);
      }
    }
    return res;
  }
  return val;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(val) {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

async function waitForCondition(fn, { timeoutMs = 12000, pollMs = 150, label = 'condición' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await fn();
      if (lastValue) return lastValue;
      lastError = null;
    } catch (err) {
      lastError = err;
    }
    await sleep(pollMs);
  }
  const extra = lastError
    ? `error=${lastError.message}`
    : `lastValue=${JSON.stringify(redactSensitiveData(lastValue))}`;
  throw new Error(`Timeout (${timeoutMs}ms) esperando ${label} [${extra}]`);
}

async function waitForDb(pg, sql, params, predicate, { timeoutMs = 12000, pollMs = 150, label = 'consulta PostgreSQL' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastRows = [];
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await pg.query(sql, params);
      lastRows = res.rows;
      if (predicate(lastRows)) return lastRows;
      lastError = null;
    } catch (err) {
      lastError = err;
    }
    await sleep(pollMs);
  }
  const extra = lastError
    ? `error=${lastError.message}`
    : `rows=${JSON.stringify(redactSensitiveData(lastRows))}`;
  throw new Error(`Timeout (${timeoutMs}ms) esperando DB (${label}) [${extra}]`);
}

async function setFaultRules(rules) {
  const res = await fetch(`http://127.0.0.1:${RC_CONFIG.ports.gateway}/__rc_control/faults`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true, rules }),
  });
  if (!res.ok) {
    throw new Error(`Error configurando reglas de fallo (${res.status})`);
  }
}

async function clearFaultRules() {
  const res = await fetch(`http://127.0.0.1:${RC_CONFIG.ports.gateway}/__rc_control/faults`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Error limpiando reglas de fallo (${res.status})`);
  }
}

async function openAndSaveFirstVariantTitle(page, newTitle) {
  await page.waitForText('Ver variantes', 8000);
  await page.clickButtonByText('Ver variantes');
  await page.waitForSelector('.variant-drilldown-modal', 8000);
  await page.clickButtonByText('Editar');
  await page.waitForSelector('.activity-editor-modal', 8000);
  const inputVal = await page.eval(`((titleVal) => {
    const modal = document.querySelector('.activity-editor-modal');
    if (!modal) return '';
    const inputs = Array.from(modal.querySelectorAll('input'));
    if (!inputs[0]) return '';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter.call(inputs[0], titleVal);
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    return inputs[0].value;
  })(${JSON.stringify(newTitle)})`);
  await page.clickButtonByText('Guardar cambios y habilitar');
  await page.waitFor(`!document.querySelector('.activity-editor-modal')`, 8000);
  return inputVal;
}

async function waitItemReadyAndDispatchOnline(page, predicateExpr, maxWaitMs = 22000) {
  const nextRetryAt = await page.eval(`(() => {
    const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
    const item = q.find(${predicateExpr});
    return item ? (item.nextRetryAt || null) : null;
  })()`);
  if (nextRetryAt) {
    const waitMs = Math.max(0, Date.parse(nextRetryAt) - Date.now() + 150);
    if (waitMs > 0) {
      await sleep(Math.min(waitMs, maxWaitMs));
    }
  }
  await page.eval(`window.dispatchEvent(new Event('online'))`);
}

async function waitForStudentQuestionNumber(page, expectedQuestionNumber, totalQuestions = 13, timeoutMs = 8000) {
  return await page.waitFor(
    `(() => {
      const topText = (document.querySelector('.play-top')?.innerText || '').trim();
      const match = topText.match(/ACTIVIDAD\\s+(\\d+)\\s+DE\\s+(\\d+)/i);
      if (!match) return null;
      const domNum = Number(match[1]);
      const domTotal = Number(match[2]);
      const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
      const playIdx = typeof sess.playIndex === 'number' ? sess.playIndex : -1;
      if (domNum === ${expectedQuestionNumber} && domTotal === ${totalQuestions} && playIdx === ${expectedQuestionNumber - 1}) {
        return { domNum, domTotal, playIndex: playIdx };
      }
      return null;
    })()`,
    timeoutMs,
  );
}

async function advanceAfterAnswer(page, nextQuestionNumber, totalQuestions = 13) {
  await page.clickButtonByText('Siguiente actividad');
  return await waitForStudentQuestionNumber(page, nextQuestionNumber, totalQuestions, 8000);
}

async function skipStudentQuestionsToLast(page, totalQuestions = 13) {
  const startState = await page.waitFor(
    `(() => {
      const topText = (document.querySelector('.play-top')?.innerText || '').trim();
      const match = topText.match(/ACTIVIDAD\\s+(\\d+)\\s+DE\\s+(\\d+)/i);
      if (!match) return null;
      const domNum = Number(match[1]);
      const domTotal = Number(match[2]);
      const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
      const playIdx = typeof sess.playIndex === 'number' ? sess.playIndex : -1;
      if (domTotal === ${totalQuestions} && playIdx === domNum - 1) {
        return { domNum, domTotal, playIndex: playIdx };
      }
      return null;
    })()`,
    8000,
  );

  let currentNumber = startState.domNum;
  while (currentNumber < totalQuestions) {
    await page.clickButtonByText('Omitir por ahora');
    const nextNum = currentNumber + 1;
    await waitForStudentQuestionNumber(page, nextNum, totalQuestions, 8000);
    currentNumber = nextNum;
  }

  const finalCheck = await page.waitFor(
    `(() => {
      const topText = (document.querySelector('.play-top')?.innerText || '').trim();
      const match = topText.match(/ACTIVIDAD\\s+(\\d+)\\s+DE\\s+(\\d+)/i);
      const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
      const skipBtn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Omitir por ahora'));
      if (
        match &&
        Number(match[1]) === ${totalQuestions} &&
        Number(match[2]) === ${totalQuestions} &&
        sess.playIndex === ${totalQuestions - 1} &&
        skipBtn &&
        !skipBtn.disabled
      ) {
        return { domNum: Number(match[1]), playIndex: sess.playIndex };
      }
      return null;
    })()`,
    8000,
  );
  return finalCheck;
}

async function waitForStudentCompletionScreen(page, label, timeoutMs = 10000) {
  try {
    await page.waitFor(
      `document.body.innerText.includes('Salir de la sala') && !document.body.innerText.includes('Registrando respuestas…')`,
      timeoutMs,
    );
  } catch (waitErr) {
    const domDiag = await page.eval(`(() => {
      const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
      const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
      return {
        playTop: (document.querySelector('.play-top')?.innerText || '').trim(),
        bodyText: (document.body.innerText || '').slice(0, 600),
        playIndex: sess.playIndex ?? null,
        finished: sess.finished ?? null,
        submissionStatus: sess.submissionStatus ?? null,
        submitted: sess.submitted ?? null,
        buttons: Array.from(document.querySelectorAll('button')).map(b => ({ text: (b.innerText || '').trim(), disabled: b.disabled })),
        queue: q.map(i => ({ kind: i.kind, pid: i.payload?.participantId, attempts: i.attempts })),
      };
    })()`);
    const lastGuestCalls = page.networkRecords
      .filter((r) => r.url.includes('student-room-guest'))
      .slice(-8)
      .map((r) => ({
        status: r.status,
        failed: r.failed || false,
        action: (() => {
          try {
            return JSON.parse(r.postData || '{}').action;
          } catch {
            return null;
          }
        })(),
        response: (r.responseBody || '').slice(0, 200),
      }));
    throw new Error(
      `${waitErr.message} | DIAG(${label})=${JSON.stringify(redactSensitiveData({ ...domDiag, lastGuestCalls }))}`,
    );
  }
}

async function dismissSplashIfPresent(page) {
  await page.eval(`(() => {
    try { sessionStorage.setItem('edueval-splash-seen', 'true'); } catch {}
    const splash = document.querySelector('.splash-overlay');
    if (splash) splash.click();
  })()`);
  await sleep(150);
}

async function answerCurrentStudentActivityInDom(page) {
  const actType = await page.eval(`(() => {
    const area = document.querySelector('.answer-area');
    if (!area) return '';
    const cls = Array.from(area.classList).find(c => c.startsWith('answer-') && c !== 'answer-area');
    return cls ? cls.slice('answer-'.length) : '';
  })()`);

  if (actType === 'trueFalse') {
    await page.clickButtonByText('Verdadero');
  } else if (actType === 'singleChoice') {
    await page.clickButtonByText('Mitocondria');
  } else if (actType === 'multiSelect') {
    await page.clickButtonByText('NADH');
    await page.clickButtonByText('FADH2');
  } else if (actType === 'fillBlanks') {
    // Prueba explícita R-UI-02: dos fichas idénticas "ATP" y liberación/reselección
    const rUi02Check = await page.eval(`(async () => {
      const getAtpChips = () => Array.from(document.querySelectorAll('button.sorting-chip')).filter(b => (b.innerText || '').trim() === 'ATP');
      const initialAtp = getAtpChips();
      if (initialAtp.length < 2) return { ok: false, reason: 'Menos de 2 fichas ATP' };
      // Seleccionar primera ficha ATP para el hueco 1
      initialAtp[0].click();
      await new Promise(r => setTimeout(r, 80));
      const afterFirstClick = getAtpChips();
      const enabledCountAfterFirst = afterFirstClick.filter(b => !b.disabled).length;
      // Liberar el hueco 1 haciendo clic sobre el hueco lleno y volver a seleccionarlo
      const filledSlot = document.querySelector('.fill-blank-slot.filled');
      if (filledSlot) {
        filledSlot.click();
        await new Promise(r => setTimeout(r, 80));
      }
      const afterRelease = getAtpChips();
      const enabledAfterRelease = afterRelease.filter(b => !b.disabled).length;
      // Ahora colocar las dos fichas ATP en los huecos 1 y 2, y "mitocondria" en el hueco 3
      afterRelease.filter(b => !b.disabled)[0].click();
      await new Promise(r => setTimeout(r, 80));
      getAtpChips().filter(b => !b.disabled)[0].click();
      await new Promise(r => setTimeout(r, 80));
      const mitoChip = Array.from(document.querySelectorAll('button.sorting-chip')).find(b => !b.disabled && (b.innerText || '').trim() === 'mitocondria');
      if (mitoChip) mitoChip.click();
      await new Promise(r => setTimeout(r, 80));
      return {
        ok: enabledCountAfterFirst === 1 && enabledAfterRelease === 2,
        enabledCountAfterFirst,
        enabledAfterRelease,
      };
    })()`);
    page._rUi02Result = rUi02Check;
  } else if (actType === 'spotError') {
    await page.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button.spot-error-segment')).find(b => (b.innerText || '').includes('consumiendo dos moléculas de ATP'));
      if (btn) btn.click();
    })()`);
  } else if (actType === 'markWords') {
    await page.eval(`(async () => {
      for (const word of ['cloroplasto', 'pared']) {
        const token = Array.from(document.querySelectorAll('button.mark-word-token')).find(
          t => (t.innerText || '').trim().toLowerCase() === word
        );
        if (token) {
          token.click();
          await new Promise(r => setTimeout(r, 80));
        }
      }
    })()`);
  } else if (actType === 'gridCheck') {
    await page.eval(`(async () => {
      const clickRowCol = async (rowSubstr, colIdx) => {
        const rows = Array.from(document.querySelectorAll('.grid-check-desktop-view tbody tr'));
        const tr = rows.find(r => (r.innerText || '').includes(rowSubstr));
        if (!tr) return;
        const btns = Array.from(tr.querySelectorAll('button.grid-check-cell-btn'));
        if (btns[colIdx]) {
          btns[colIdx].click();
          await new Promise(r => setTimeout(r, 80));
        }
      };
      await clickRowCol('Glucólisis', 0);
      await clickRowCol('Ciclo de Krebs', 1);
    })()`);
  } else if (actType === 'vennDiagram') {
    await page.eval(`(async () => {
      const assignVenn = async (cardSubstr, btnSubstr) => {
        const cards = Array.from(document.querySelectorAll('.venn-concept-card'));
        const card = cards.find(c => (c.innerText || '').includes(cardSubstr));
        if (!card) return;
        const btns = Array.from(card.querySelectorAll('button.venn-btn-choice'));
        const b = btns.find(x => (x.innerText || '').includes(btnSubstr));
        if (b) {
          b.click();
          await new Promise(r => setTimeout(r, 80));
        }
      };
      await assignVenn('Consume oxígeno', 'Respiración aerobia');
      await assignVenn('Utiliza gradiente', 'Ambos procesos');
      await assignVenn('Fija dióxido', 'Fotosíntesis');
    })()`);
  } else if (actType === 'shortAnswer') {
    await page.setInputValue('input.short-answer-input', 'ósmosis');
  } else if (actType === 'matching') {
    await page.eval(`(async () => {
      const pairs = [
        ['Bomba sodio-potasio', 'Transporte activo primario contra gradiente'],
        ['Acuaporina', 'Canal proteico para paso rápido de agua'],
      ];
      for (const [lTxt, rTxt] of pairs) {
        const left = Array.from(document.querySelectorAll('.matching-card.left')).find(b => (b.innerText || '').includes(lTxt));
        if (left && !left.classList.contains('active')) {
          left.click();
          await new Promise(r => setTimeout(r, 90));
        }
        const right = Array.from(document.querySelectorAll('.matching-card.right')).find(b => (b.innerText || '').includes(rTxt));
        if (right) {
          right.click();
          await new Promise(r => setTimeout(r, 90));
        }
      }
    })()`);
  } else if (actType === 'sorting') {
    await page.eval(`(async () => {
      const assign = async (chipText, catText) => {
        const chip = Array.from(document.querySelectorAll('.sorting-items button.sorting-chip')).find(b => (b.innerText || '').includes(chipText));
        if (chip) {
          chip.click();
          await new Promise(r => setTimeout(r, 90));
        }
        const drop = Array.from(document.querySelectorAll('.sorting-drop')).find(d => (d.innerText || '').includes(catText));
        if (drop) {
          drop.click();
          await new Promise(r => setTimeout(r, 90));
        }
      };
      await assign('Difusión facilitada por canal', 'Transporte pasivo');
      await assign('Endocitosis mediada por receptor', 'Transporte activo');
    })()`);
  } else if (actType === 'ordering') {
    await page.eval(`(async () => {
      const targetOrder = [
        'Glucólisis en el citosol',
        'Ciclo del ácido cítrico en la matriz',
        'Fosforilación oxidativa en las crestas',
      ];
      for (let targetIdx = 0; targetIdx < targetOrder.length; targetIdx += 1) {
        for (let guard = 0; guard < 6; guard += 1) {
          const items = Array.from(document.querySelectorAll('.ordering-item'));
          const curIdx = items.findIndex(el => (el.innerText || '').includes(targetOrder[targetIdx]));
          if (curIdx <= targetIdx) break;
          const upBtn = items[curIdx].querySelector('button[title="Subir"]');
          if (upBtn && !upBtn.disabled) upBtn.click();
          await new Promise(r => setTimeout(r, 70));
        }
      }
    })()`);
  } else if (actType === 'scenario') {
    await page.eval(`(() => {
      const card = Array.from(document.querySelectorAll('button.scenario-choice-card')).find(b => (b.innerText || '').includes('Activar la fermentación láctica'));
      if (card) card.click();
    })()`);
  }

  await sleep(150);
  try {
    await page.clickButtonByText('Comprobar respuesta');
  } catch (err) {
    const diag = await page.eval(`({
      actType: ${JSON.stringify(actType)},
      cardText: (document.querySelector('.play-card')?.innerText || '').slice(0, 500),
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({ text: (b.innerText || '').trim(), disabled: b.disabled })),
    })`);
    throw new Error(`${err.message} | DIAG=${JSON.stringify(diag)}`);
  }
  await sleep(150);
  return actType;
}

export async function runUiE2eChromiumSuite() {
  const runtimeState = JSON.parse(fs.readFileSync(path.join(RC_CONFIG.workDir, 'runtime_state.json'), 'utf8'));
  const { appUrl, users } = runtimeState;

  const pg = new PgClient({
    socketPath: `/tmp/.s.PGSQL.${RC_CONFIG.postgres.port}`,
    user: RC_CONFIG.postgres.superuser,
    database: RC_CONFIG.postgres.dbName,
  });
  await pg.connect();

  const browserMain = new CdpBrowser(RC_CONFIG.ports.chromiumDebug, 'main');
  await browserMain.launch();

  const results = [];
  const record = (id, title, status, details) => {
    const cleanDetails = redactSensitiveData(details);
    if (status === 'PASA' && cleanDetails && typeof cleanDetails === 'object' && cleanDetails.cause) {
      delete cleanDetails.cause;
    }
    results.push({ id, title, status, details: cleanDetails });
  };

  try {
    // =========================================================================
    // FLUJO 1: DOCENTE E2E (Login -> Importar JSON v2 13 tipos -> Aprobar -> Crear/Abrir/Iniciar Sala)
    // =========================================================================
    const teacherPage = await browserMain.newPage();
    await teacherPage.goto(`${appUrl}/?panel=teacher`, 700);
    await dismissSplashIfPresent(teacherPage);

    await teacherPage.waitForSelector('input[type="email"]', 10000);
    await teacherPage.setInputValue('input[type="email"]', users.teacherOwner.email);
    await teacherPage.setInputValue('input[type="password"]', users.teacherOwner.password);
    await teacherPage.clickButtonByText('Ingresar con contraseña');
    await teacherPage.waitForText('Contenido', 12000);
    await teacherPage.clickButtonByText('Contenido');
    await teacherPage.waitForText('Importar JSON', 10000);

    // Abrir modal Importar JSON y validar el documento v2 con 13 tipos
    await teacherPage.clickButtonByText('Importar JSON');
    await teacherPage.waitForSelector('textarea:not([readonly])', 8000);
    await teacherPage.setInputValue('textarea:not([readonly])', JSON.stringify(EDUEVAL_V2_13_FIXTURE));
    await teacherPage.clickButtonByText('Validar estructura JSON');
    await teacherPage.waitForText('Aceptar e ir a propuestas', 8000);
    await teacherPage.clickButtonByText('Aceptar e ir a propuestas');

    // Esperar a que persistCloudTemplate sincronice las 13 actividades en PostgreSQL
    await teacherPage.waitForText('Aprobar todas', 10000);
    await sleep(1200);

    // =========================================================================
    // FLUJO 1D: Reproducción de defecto abierto de Fase D (D-P0-07) sobre propuesta en nube
    // =========================================================================
    const patchRequestsBefore = teacherPage.networkRecords.filter(
      (r) => r.method === 'PATCH' && r.url.includes('/rest/v1/activities'),
    ).length;

    const editedTitle = 'Título Editado Solo Local D-P0-07';
    await teacherPage.clickButtonByText('Ver variantes');
    await sleep(300);
    await teacherPage.clickButtonByText('Editar');
    await sleep(400);
    const inputValueBeforeSave = await teacherPage.eval(`((newTitle) => {
      const modal = document.querySelector('.activity-editor-modal');
      if (!modal) return '';
      const inputs = Array.from(modal.querySelectorAll('input'));
      if (inputs[0]) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter.call(inputs[0], newTitle);
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        return inputs[0].value;
      }
      return '';
    })(${JSON.stringify(editedTitle)})`);
    await teacherPage.clickButtonByText('Guardar cambios y habilitar');
    await sleep(700);

    // Verificar que el nuevo valor es visible en la UI/estado local tras guardar (RC-EV-04)
    await teacherPage.clickButtonByText('Ver variantes');
    await sleep(300);
    const visibleInUiAfterSave = await teacherPage.eval(`((expectedTitle) => {
      const modalText = document.querySelector('.variant-drilldown-modal')?.innerText || '';
      const localStore = localStorage.getItem('edueval-activities') || '';
      const closeBtn = document.querySelector('.variant-drilldown-modal button[aria-label="Cerrar modal"]');
      if (closeBtn) closeBtn.click();
      return modalText.includes(expectedTitle) && localStore.includes(expectedTitle);
    })(${JSON.stringify(editedTitle)})`);
    await sleep(250);

    const patchRequestsAfter = teacherPage.networkRecords.filter(
      (r) => r.method === 'PATCH' && r.url.includes('/rest/v1/activities'),
    ).length;
    const dbEditedCheck = await waitForDb(
      pg,
      `SELECT id::text AS id, title FROM public.activities WHERE owner_id = $1 AND title = $2`,
      [users.teacherOwner.id, editedTitle],
      (rows) => rows.length === 1,
      { label: 'persistencia de edición inicial D-P0-07' },
    );

    // Verificación E2E-DOC-04 (R2-C):
    // 1) Aislamiento entre teacherOwner, teacherOther, ítem legado sin ownerId y estudiante + syncLabel
    // 2) Preservación tras >=3 fallos 500 consecutivos de teacherOwner y recuperación exitosa al retirar fallos
    // 3) Concurrencia real v1 tardía (delayMs + 500) vs v2 nueva confirmada en PostgreSQL
    const doc04TargetId = dbEditedCheck[0].id;

    // 1) Sembrar ítems ajenos/legado/estudiantil en edueval-sync-queue
    await teacherPage.eval(`((ownerOtherId, targetActId, roomIdFake) => {
      const acts = JSON.parse(localStorage.getItem('edueval-activities') || '[]');
      const targetAct = acts.find(a => a.id === targetActId) || acts[0];
      const foreignItems = [
        {
          id: 'sync-other-teacher-1',
          kind: 'activity_update',
          ownerId: ownerOtherId,
          payload: { activity: { ...targetAct, title: 'NO TOCAR TEACHER OTHER' }, ownerId: ownerOtherId },
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
        {
          id: 'sync-legacy-ownerless-1',
          kind: 'activity_update',
          payload: { activity: { ...targetAct, title: 'NO TOCAR LEGADO SIN OWNER' } },
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
        {
          id: 'sync-student-foreign-1',
          kind: 'attempt',
          payload: {
            roomId: roomIdFake,
            roomCode: 'EDU-999',
            participantId: '00000000-0000-4000-8000-000000000099',
            guestToken: 'foreign-student-token',
            record: { id: 'att-foreign-1', roomId: roomIdFake, roomCode: 'EDU-999' },
          },
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ];
      localStorage.setItem('edueval-sync-queue', JSON.stringify(foreignItems));
      window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
    })(${JSON.stringify(users.teacherOther.id)}, ${JSON.stringify(doc04TargetId)}, '00000000-0000-4000-8000-000000000098')`);
    await sleep(250);

    const syncLabelWhenZeroOwned = await teacherPage.eval(`(() => {
      const top = document.querySelector('.topbar')?.innerText || '';
      const side = document.querySelector('.sidebar')?.innerText || '';
      return (top + ' ' + side).trim();
    })()`);
    const syncLabelIgnoresForeignWhenZero = !/\b\d+\s+pendiente/i.test(syncLabelWhenZeroOwned);

    // 2) Inyectar fallo 500 en PATCH /rest/v1/activities y editar actividad de teacherOwner
    const retryTitleDoc04 = 'Título Resiliente 3 Fallos DE-R2';
    await setFaultRules([
      { method: 'PATCH', pathIncludes: '/rest/v1/activities', status: 500, body: { message: 'Injected 500 E2E-DOC-04' }, remaining: 20 },
    ]);
    await openAndSaveFirstVariantTitle(teacherPage, retryTitleDoc04);

    await teacherPage.waitFor(`(() => {
      const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
      return q.some(i => i.ownerId === ${JSON.stringify(users.teacherOwner.id)} && i.kind === 'activity_update');
    })()`, 8000);

    const syncLabelWithOneOwned = await teacherPage.eval(`(() => {
      const top = document.querySelector('.topbar')?.innerText || '';
      const side = document.querySelector('.sidebar')?.innerText || '';
      return (top + ' ' + side).trim();
    })()`);
    const ownedQueueCountCheck = await teacherPage.eval(`((ownerId) => {
      const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
      return {
        total: q.length,
        ownedTeacherCount: q.filter(i => i.kind !== 'attempt' && i.ownerId === ownerId).length,
      };
    })(${JSON.stringify(users.teacherOwner.id)})`);
    const syncLabelCountsOnlyOwned =
      !/\b[2-9]\s+pendientes?\b/i.test(syncLabelWithOneOwned) &&
      (!/\b\d+\s+pendiente/i.test(syncLabelWithOneOwned) || syncLabelWithOneOwned.includes('1 pendiente')) &&
      ownedQueueCountCheck.total === 4 &&
      ownedQueueCountCheck.ownedTeacherCount === 1;

    // Provocar >= 3 fallos 500 consecutivos y verificar que NO se descarta el pendiente de teacherOwner
    for (let step = 0; step < 5; step += 1) {
      const curState = await teacherPage.eval(`(() => {
        const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
        const own = q.find(i => i.ownerId === ${JSON.stringify(users.teacherOwner.id)} && i.kind === 'activity_update');
        return own ? { attempts: own.attempts, nextRetryAt: own.nextRetryAt || null } : null;
      })()`);
      if (!curState || curState.attempts >= 3) break;
      const prevAttempts = curState.attempts;
      await waitItemReadyAndDispatchOnline(
        teacherPage,
        `(i) => i.ownerId === ${JSON.stringify(users.teacherOwner.id)} && i.kind === 'activity_update'`,
      );
      await teacherPage.waitFor(`(() => {
        const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
        const own = q.find(i => i.ownerId === ${JSON.stringify(users.teacherOwner.id)} && i.kind === 'activity_update');
        return Boolean(own && own.attempts > ${prevAttempts});
      })()`, 10000);
    }

    const queueDuringFailures = await teacherPage.eval(`JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]')`);
    const ownerItemAfter3Fails = queueDuringFailures.find(
      (i) => i.ownerId === users.teacherOwner.id && i.kind === 'activity_update',
    );
    const preservedAfter3Failures = Boolean(ownerItemAfter3Fails && ownerItemAfter3Fails.attempts >= 3);

    const foreignUntouchedCheck = (queue) => {
      const otherItem = queue.find((i) => i.id === 'sync-other-teacher-1');
      const legacyItem = queue.find((i) => i.id === 'sync-legacy-ownerless-1');
      const studentItem = queue.find((i) => i.id === 'sync-student-foreign-1');
      return Boolean(
        otherItem &&
          otherItem.ownerId === users.teacherOther.id &&
          otherItem.attempts === 0 &&
          !otherItem.lastError &&
          legacyItem &&
          !legacyItem.ownerId &&
          legacyItem.attempts === 0 &&
          !legacyItem.lastError &&
          studentItem &&
          !studentItem.ownerId &&
          studentItem.attempts === 0 &&
          !studentItem.lastError,
      );
    };
    const foreignUntouchedDuringFailures = foreignUntouchedCheck(queueDuringFailures);

    // Retirar fallos y esperar recuperación exitosa de teacherOwner sin tocar los 3 ítems ajenos/legado/estudiantil
    await clearFaultRules();
    await waitItemReadyAndDispatchOnline(
      teacherPage,
      `(i) => i.ownerId === ${JSON.stringify(users.teacherOwner.id)} && i.kind === 'activity_update'`,
      25000,
    );
    await teacherPage.waitFor(`(() => {
      const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
      return !q.some(i => i.ownerId === ${JSON.stringify(users.teacherOwner.id)});
    })()`, 12000);
    await waitForDb(
      pg,
      `SELECT title FROM public.activities WHERE id = $1`,
      [doc04TargetId],
      (rows) => rows[0]?.title === retryTitleDoc04,
      { label: 'recuperación en PostgreSQL tras >=3 fallos 500 (E2E-DOC-04)' },
    );
    const queueAfterRecoveryDoc04 = await teacherPage.eval(`JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]')`);
    const foreignUntouchedAfterRecovery = foreignUntouchedCheck(queueAfterRecoveryDoc04);

    // Limpiar ítems ajenos sintéticos antes de la prueba de concurrencia
    await teacherPage.eval(`(() => {
      localStorage.setItem('edueval-sync-queue', '[]');
      window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
    })()`);

    // 3) Concurrencia real v1 tardía (AbortController + guarda de versión updated_at en servidor/cola) vs v2 nueva confirmada en PostgreSQL
    const titleV1Late = 'Título Concurrencia V1 Tardía';
    const titleV2Final = 'Título Concurrencia V2 Definitiva';
    const netIdxBeforeConcurrency = teacherPage.networkRecords.length;

    await setFaultRules([
      { method: 'PATCH', pathIncludes: '/rest/v1/activities', delayMs: 2500, status: 500, body: { message: 'Delayed 500 v1' }, remaining: 1 },
    ]);
    await openAndSaveFirstVariantTitle(teacherPage, titleV1Late);
    await sleep(350);
    await openAndSaveFirstVariantTitle(teacherPage, titleV2Final);

    await waitForCondition(
      () => {
        const recentPatches = teacherPage.networkRecords
          .slice(netIdxBeforeConcurrency)
          .filter((r) => r.method === 'PATCH' && r.url.includes('/rest/v1/activities'));
        const hasV1Initiated = recentPatches.some((r) => (r.postData || '').includes(titleV1Late));
        const hasV2Succeeded = recentPatches.some(
          (r) => (r.postData || '').includes(titleV2Final) && (r.status === 200 || r.status === 204),
        );
        return hasV1Initiated && hasV2Succeeded;
      },
      { timeoutMs: 12000, label: 'inicio/aborto de PATCH v1 y respuesta 200/204 de PATCH v2' },
    );

    await clearFaultRules();
    const dbV2AfterAbort = await waitForDb(
      pg,
      `SELECT title, updated_at FROM public.activities WHERE id = $1`,
      [doc04TargetId],
      (rows) => rows[0]?.title === titleV2Final && Boolean(rows[0]?.updated_at),
      { label: 'confirmación de v2 en PostgreSQL tras aborto de v1' },
    );

    // Probar explícitamente la guarda de versión del servidor/cola (updated_at estrictamente anterior al de v2)
    const olderIso = new Date(Date.parse(dbV2AfterAbort[0].updated_at) - 60_000).toISOString();
    await teacherPage.eval(`((actId, ownerId, staleTitle, staleIso) => {
      const acts = JSON.parse(localStorage.getItem('edueval-activities') || '[]');
      const baseAct = acts.find(a => a.id === actId);
      if (!baseAct) throw new Error('Actividad base no encontrada para prueba de guarda de versión');
      const staleQueueItem = {
        id: 'sync-stale-version-guard-1',
        kind: 'activity_update',
        ownerId,
        payload: {
          activity: { ...baseAct, title: staleTitle, updatedAt: staleIso },
          ownerId,
          updatedAt: staleIso,
          clientRevision: 1,
        },
        createdAt: staleIso,
        attempts: 0,
        entityVersion: staleIso,
        clientRevision: 1,
      };
      localStorage.setItem('edueval-sync-queue', JSON.stringify([staleQueueItem]));
      window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
      window.dispatchEvent(new Event('online'));
    })(${JSON.stringify(doc04TargetId)}, ${JSON.stringify(users.teacherOwner.id)}, ${JSON.stringify(titleV1Late)}, ${JSON.stringify(olderIso)})`);

    await teacherPage.waitFor(`(() => {
      const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
      return q.filter(i => i.ownerId === ${JSON.stringify(users.teacherOwner.id)}).length === 0;
    })()`, 12000);

    const dbConcurrencyRow = await pg.query(
      `SELECT title, updated_at FROM public.activities WHERE id = $1`,
      [doc04TargetId],
    );
    const concurrencyQueueAfter = await teacherPage.eval(`JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]')`);
    const concurrencyPreservedV2 =
      dbConcurrencyRow.rows[0]?.title === titleV2Final &&
      concurrencyQueueAfter.filter((i) => i.ownerId === users.teacherOwner.id).length === 0;

    // Aprobar las 13 propuestas y esperar sincronización de status='published' en PostgreSQL
    await teacherPage.clickButtonByText('Aprobar todas');
    await waitForDb(
      pg,
      `SELECT count(*)::int AS cnt
       FROM public.activities
       WHERE owner_id = $1
         AND template_id = (SELECT id FROM public.evaluation_templates WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1)
         AND status = 'published'`,
      [users.teacherOwner.id],
      (rows) => rows[0]?.cnt === 13,
      { label: 'publicación de las 13 actividades aprobadas' },
    );

    const dbTemplates = await pg.query(
      `SELECT id, title, status FROM public.evaluation_templates WHERE owner_id = $1 ORDER BY created_at DESC`,
      [users.teacherOwner.id],
    );
    const dbActivities = await pg.query(
      `SELECT id, type, title, status FROM public.activities WHERE owner_id = $1 AND template_id = $2`,
      [users.teacherOwner.id, dbTemplates.rows[0]?.id],
    );
    const publishedTypes = dbActivities.rows.filter((a) => a.status === 'published').map((a) => a.type);

    // Ir a Salas -> Nueva sala -> Evaluar este tema (13) y crear sala con las 13 actividades publicadas
    await teacherPage.clickButtonByText('Salas');
    await teacherPage.waitForText('Nueva sala', 8000);
    await teacherPage.clickButtonByText('Nueva sala');
    await teacherPage.waitForText('Evaluar este tema (13)', 8000);
    await teacherPage.clickButtonByText('Evaluar este tema (13)');
    await teacherPage.waitForSelector('.room-builder input[placeholder*="Evaluación"]', 8000);
    await teacherPage.setInputValue('.room-builder input[placeholder*="Evaluación"]', 'Sala Integrada 13 Tipos RC');
    await sleep(250);
    await teacherPage.clickButtonByText('Crear sala (13 preguntas)');

    let mainRoom = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await sleep(250);
      const res = await pg.query(
        `SELECT id, code, name, status, question_count FROM public.rooms
         WHERE owner_id = $1 AND name = 'Sala Integrada 13 Tipos RC' LIMIT 1`,
        [users.teacherOwner.id],
      );
      if (res.rows[0]) {
        mainRoom = res.rows[0];
        break;
      }
    }

    // Abrir e iniciar específicamente la Sala Integrada 13 Tipos RC
    await teacherPage.eval(`(() => {
      const card = Array.from(document.querySelectorAll('article.room-card')).find(c => (c.innerText || '').includes('Sala Integrada 13 Tipos RC'));
      const btn = card ? Array.from(card.querySelectorAll('button')).find(b => (b.innerText || '').includes('Abrir sala')) : null;
      if (btn) btn.click();
    })()`);
    await sleep(700);
    await teacherPage.eval(`(() => {
      const card = Array.from(document.querySelectorAll('article.room-card')).find(c => (c.innerText || '').includes('Sala Integrada 13 Tipos RC'));
      const btn = card ? Array.from(card.querySelectorAll('button')).find(b => (b.innerText || '').includes('Iniciar evaluación')) : null;
      if (btn) btn.click();
    })()`);
    await sleep(1000);

    const dbRoomRes = await pg.query(
      `SELECT id, code, name, status, question_count FROM public.rooms
       WHERE owner_id = $1 AND name = 'Sala Integrada 13 Tipos RC' LIMIT 1`,
      [users.teacherOwner.id],
    );
    mainRoom = dbRoomRes.rows[0];
    const dbRoomActs = await pg.query(
      `SELECT count(*)::int AS cnt FROM public.room_activities WHERE room_id = $1`,
      [mainRoom?.id],
    );

    record(
      'E2E-DOC-01',
      'Flujo docente real en Chromium: login, importación JSON v2 de 13 tipos, aprobación, creación y apertura de sala en nube',
      dbTemplates.rows.length === 1 &&
        publishedTypes.length === 13 &&
        Boolean(mainRoom) &&
        mainRoom.status === 'active' &&
        dbRoomActs.rows[0].cnt === 13
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        templateId: dbTemplates.rows[0]?.id,
        publishedActivitiesCount: publishedTypes.length,
        publishedTypes,
        roomId: mainRoom?.id,
        roomCode: mainRoom?.code,
        roomStatus: mainRoom?.status,
        roomActivitiesLinked: dbRoomActs.rows[0].cnt,
      },
    );

    // =========================================================================
    // FLUJO 1B: Recuperación en segunda sesión limpia + aislamiento de docente ajeno
    // =========================================================================
    const browserSecond = new CdpBrowser(RC_CONFIG.ports.chromiumDebug + 1, 'second');
    await browserSecond.launch();
    let recoveredInSecondSession = false;
    let isolatedFromOtherTeacher = false;
    try {
      const page2 = await browserSecond.newPage();
      await page2.goto(`${appUrl}/?panel=teacher`, 600);
      await dismissSplashIfPresent(page2);
      await page2.waitForSelector('input[type="email"]', 8000);
      await page2.setInputValue('input[type="email"]', users.teacherOwner.email);
      await page2.setInputValue('input[type="password"]', users.teacherOwner.password);
      await page2.clickButtonByText('Ingresar con contraseña');
      await page2.waitForText('Salas', 10000);
      await page2.clickButtonByText('Salas');
      await sleep(800);
      recoveredInSecondSession = await page2.eval(
        `document.body.innerText.includes('Sala Integrada 13 Tipos RC') && document.body.innerText.includes(${JSON.stringify(mainRoom.code)})`,
      );
      await page2.close();

      // Contexto limpio para docente ajeno
      const browserOther = new CdpBrowser(RC_CONFIG.ports.chromiumDebug + 2, 'other_teacher');
      await browserOther.launch();
      try {
        const pageOther = await browserOther.newPage();
        await pageOther.goto(`${appUrl}/?panel=teacher`, 600);
        await dismissSplashIfPresent(pageOther);
        await pageOther.waitForSelector('input[type="email"]', 8000);
        await pageOther.setInputValue('input[type="email"]', users.teacherOther.email);
        await pageOther.setInputValue('input[type="password"]', users.teacherOther.password);
        await pageOther.clickButtonByText('Ingresar con contraseña');
        await pageOther.waitForText('Salas', 10000);
        await pageOther.clickButtonByText('Salas');
        await sleep(800);
        const seesOwnerRoom = await pageOther.eval(
          `document.body.innerText.includes('Sala Integrada 13 Tipos RC')`,
        );
        isolatedFromOtherTeacher = !seesOwnerRoom;
        await pageOther.close();
      } finally {
        await browserOther.close();
      }
    } finally {
      await browserSecond.close();
    }

    record(
      'E2E-DOC-02',
      'Recuperación de salas/plantillas en segunda sesión limpia y aislamiento frente a docente_ajeno',
      recoveredInSecondSession && isolatedFromOtherTeacher ? 'PASA' : 'FALLA_PRODUCTO',
      {
        recoveredInSecondSession,
        isolatedFromOtherTeacher,
      },
    );

    // =========================================================================
    // FLUJO 1C: Verificación de deleteRoom (RC-FIX-03) ante fallo remoto, revocación de DELETE y éxito real
    // =========================================================================
    // Crear una sala descartable desde la sesión del propietario
    await teacherPage.clickButtonByText('Salas');
    await teacherPage.waitForText('Nueva sala', 8000);
    await teacherPage.clickButtonByText('Nueva sala');
    await teacherPage.waitForText('Evaluar este tema (13)', 8000);
    await teacherPage.clickButtonByText('Evaluar este tema (13)');
    await teacherPage.waitForSelector('.room-builder input[placeholder*="Evaluación"]', 8000);
    await teacherPage.setInputValue('.room-builder input[placeholder*="Evaluación"]', 'Sala Descartable Delete RC');
    await sleep(250);
    await teacherPage.clickButtonByText('Crear sala (13 preguntas)');

    let dispRoom = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await sleep(250);
      const dispRoomRes = await pg.query(
        `SELECT id, code FROM public.rooms WHERE owner_id = $1 AND name = 'Sala Descartable Delete RC' LIMIT 1`,
        [users.teacherOwner.id],
      );
      if (dispRoomRes.rows[0]) {
        dispRoom = dispRoomRes.rows[0];
        break;
      }
    }

    const clickDeleteDisposableRoom = async () => {
      await teacherPage.eval(`(() => {
        const cards = Array.from(document.querySelectorAll('article.room-card'));
        const targetCard = cards.find(c => (c.innerText || '').includes('Sala Descartable Delete RC'));
        if (!targetCard) return;
        const btn = Array.from(targetCard.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Eliminar sala');
        if (btn) btn.click();
      })()`);
    };

    // Caso A: Inyectar fallo HTTP 500 al borrar en /rest/v1/rooms
    await setFaultRules([
      { method: 'DELETE', pathIncludes: '/rest/v1/rooms', status: 500, body: { message: 'Fallo remoto simulado en rooms' }, remaining: 1 },
    ]);
    await clickDeleteDisposableRoom();
    await sleep(800);
    const toastAfterFault = await teacherPage.eval(`document.body.innerText`);
    const preservedOnFault = toastAfterFault.includes('No se pudo eliminar la sala') && toastAfterFault.includes('Sala Descartable Delete RC');
    await clearFaultRules();

    // Caso B: Revocar permiso DELETE en room_participants para authenticated (escenario si 0000_init no lo otorgó)
    await pg.query(`REVOKE DELETE ON public.room_participants FROM authenticated`);
    await clickDeleteDisposableRoom();
    await sleep(800);
    const toastAfterRevoke = await teacherPage.eval(`document.body.innerText`);
    const preservedOnRevoke = toastAfterRevoke.includes('No se pudo eliminar la sala') && toastAfterRevoke.includes('participantes');

    // Caso C: Otorgar DELETE y verificar borrado completo en nube y UI
    await pg.query(`GRANT DELETE ON public.room_participants TO authenticated`);
    await clickDeleteDisposableRoom();
    await sleep(900);
    const checkDeletedDb = await pg.query(`SELECT count(*)::int AS cnt FROM public.rooms WHERE id = $1`, [dispRoom.id]);

    record(
      'E2E-DOC-03',
      'deleteRoom (RC-FIX-03): preservación local ante error remoto o falta de GRANT DELETE en room_participants, y borrado real cuando procede',
      preservedOnFault && preservedOnRevoke && checkDeletedDb.rows[0].cnt === 0 ? 'PASA' : 'FALLA_PRODUCTO',
      {
        disposableRoomId: dispRoom?.id,
        preservedOnRemote500: preservedOnFault,
        preservedOnMissingDeleteGrant: preservedOnRevoke,
        remainingInDbAfterValidDelete: checkDeletedDb.rows[0].cnt,
      },
    );

    record(
      'E2E-DOC-04',
      'Sincronización docente endurecida (D-P0-07 / DE-R2): aislamiento por ownerId + syncLabel, >=3 fallos 500 sin descarte y concurrencia v1 tardía vs v2 nueva',
      inputValueBeforeSave === editedTitle &&
        visibleInUiAfterSave &&
        patchRequestsAfter > patchRequestsBefore &&
        dbEditedCheck.length === 1 &&
        syncLabelIgnoresForeignWhenZero &&
        syncLabelCountsOnlyOwned &&
        preservedAfter3Failures &&
        foreignUntouchedDuringFailures &&
        foreignUntouchedAfterRecovery &&
        concurrencyPreservedV2
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        defectId: 'D-P0-07',
        inputValueBeforeSave,
        expectedEditedTitle: editedTitle,
        inputMatchedBeforeSave: inputValueBeforeSave === editedTitle,
        visibleInUiAndLocalStoreAfterSave: visibleInUiAfterSave,
        patchRequestsToActivities: patchRequestsAfter - patchRequestsBefore,
        persistedInPostgres: dbEditedCheck.length === 1,
        isolationAndSyncLabel: {
          syncLabelIgnoresForeignWhenZero,
          syncLabelCountsOnlyOwned,
          foreignUntouchedDuringFailures,
          foreignUntouchedAfterRecovery,
        },
        threeConsecutiveFailuresPreservedAndRecovered: {
          attemptsObservedDuringFault: ownerItemAfter3Fails?.attempts ?? null,
          preservedAfter3Failures,
          recoveredTitle: retryTitleDoc04,
        },
        concurrencyLateV1VsNewV2: {
          persistedTitleInPostgres: dbConcurrencyRow.rows[0]?.title || null,
          expectedTitleV2: titleV2Final,
          preservedV2: concurrencyPreservedV2,
        },
      },
    );

    // =========================================================================
    // FLUJO 1E: Edición de plantilla con persistencia en nube (D-P0-08)
    // =========================================================================
    await teacherPage.clickButtonByText('Contenido');
    await teacherPage.waitForText('✎ Editar plantilla', 10000);
    await teacherPage.clickButtonByText('✎ Editar plantilla');
    await teacherPage.waitForSelector('.template-modal', 8000);

    const targetTemplateInfo = await teacherPage.eval(`(() => {
      const activeId = JSON.parse(localStorage.getItem('edueval-active-template-id') || 'null');
      const tmpls = JSON.parse(localStorage.getItem('edueval-templates') || '[]');
      const target = tmpls.find((t) => t.id === activeId) || tmpls[0] || null;
      return target ? { id: target.id, title: target.title } : null;
    })()`);
    const expectedTmplId = targetTemplateInfo?.id || dbTemplates.rows[0]?.id;
    const expectedTmplTitle = targetTemplateInfo?.title || dbTemplates.rows[0]?.title;

    const editedTmplDesc = 'Descripción de prueba D-P0-08 editada en UI';
    await teacherPage.setInputValue('.template-modal textarea[placeholder*="aprenderá"]', editedTmplDesc);
    await sleep(250);

    // Cambiar dificultad a Avanzado en el selector UI
    await teacherPage.eval(`(() => {
      const modal = document.querySelector('.template-modal');
      if (!modal) return;
      const sel = modal.querySelector('select');
      if (sel) {
        sel.value = 'Avanzado';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await sleep(200);

    // Agregar concepto explícito para validar estructura y asegurar formatos compatibles
    await teacherPage.clickButtonByText('＋ Agregar concepto');
    await sleep(200);

    await teacherPage.eval(`(() => {
      const modal = document.querySelector('.template-modal');
      if (!modal) return;
      const nameInput = modal.querySelector('input[aria-label="Nombre del concepto"]');
      const defInput = modal.querySelector('textarea[aria-label="Definición"]');
      if (nameInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        setter.call(nameInput, 'ATP Bioenergético');
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (defInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter.call(defInput, 'Molécula universal de almacenamiento y transferencia de energía libre celular.');
        defInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await sleep(250);

    const expectedConceptName = 'ATP Bioenergético';
    const expectedConceptDef = 'Molécula universal de almacenamiento y transferencia de energía libre celular.';

    const patchTmplBefore = teacherPage.networkRecords.filter(
      (r) => r.method === 'PATCH' && r.url.includes('/rest/v1/evaluation_templates'),
    ).length;

    await teacherPage.clickButtonByText('Aceptar contenido');
    await sleep(800);

    const patchTmplAfter = teacherPage.networkRecords.filter(
      (r) => r.method === 'PATCH' && r.url.includes('/rest/v1/evaluation_templates'),
    ).length;

    const dbTmplCheck = await pg.query(
      `SELECT id, title, description, difficulty, content, updated_at
       FROM public.evaluation_templates
       WHERE id = $1 AND owner_id = $2`,
      [expectedTmplId, users.teacherOwner.id],
    );

    const tmplRow = dbTmplCheck.rows[0];
    const tmplContentSaved = tmplRow?.content;
    const dbContentExact =
      Boolean(tmplRow) &&
      tmplRow.id === expectedTmplId &&
      tmplRow.title === expectedTmplTitle &&
      tmplRow.description === editedTmplDesc &&
      tmplRow.difficulty === 'Avanzado' &&
      Array.isArray(tmplContentSaved?.concepts) &&
      tmplContentSaved.concepts.some(
        (c) => c.name === expectedConceptName && c.definition === expectedConceptDef,
      );

    // Comprobar recuperación en segunda sesión limpia con coincidencia exacta de campos
    const browserSecondTmpl = new CdpBrowser(RC_CONFIG.ports.chromiumDebug + 3, 'second_tmpl');
    await browserSecondTmpl.launch();
    let secondSessionTmplOk = false;
    try {
      const pageTmpl = await browserSecondTmpl.newPage();
      await pageTmpl.goto(`${appUrl}/?panel=teacher`, 600);
      await dismissSplashIfPresent(pageTmpl);
      await pageTmpl.setInputValue('input[type="email"]', users.teacherOwner.email);
      await pageTmpl.setInputValue('input[type="password"]', users.teacherOwner.password);
      await pageTmpl.clickButtonByText('Ingresar con contraseña');
      await pageTmpl.waitForText('Contenido', 10000);
      await pageTmpl.clickButtonByText('Contenido');
      await sleep(600);
      secondSessionTmplOk = await pageTmpl.eval(
        `((targetId, expectedTitle, expectedDesc, expectedDiff, expectedConceptName, expectedConceptDef) => {
          const tmpls = JSON.parse(localStorage.getItem('edueval-templates') || '[]');
          const tmpl = tmpls.find((t) => t.id === targetId);
          if (!tmpl) return false;
          if (tmpl.title !== expectedTitle) return false;
          if (tmpl.description !== expectedDesc) return false;
          if (tmpl.difficulty !== expectedDiff) return false;
          const concepts = Array.isArray(tmpl.concepts) ? tmpl.concepts : (Array.isArray(tmpl.content?.concepts) ? tmpl.content.concepts : []);
          return concepts.some((c) => c.name === expectedConceptName && c.definition === expectedConceptDef);
        })(${JSON.stringify(expectedTmplId)}, ${JSON.stringify(expectedTmplTitle)}, ${JSON.stringify(editedTmplDesc)}, 'Avanzado', ${JSON.stringify(expectedConceptName)}, ${JSON.stringify(expectedConceptDef)})`,
      );
      await pageTmpl.close();
    } finally {
      await browserSecondTmpl.close();
    }

    record(
      'E2E-DOC-05',
      'Edición de plantilla con persistencia de content (conceptos/situaciones) y difficulty en Supabase y recuperación en segunda sesión (D-P0-08)',
      patchTmplAfter > patchTmplBefore &&
        dbTmplCheck.rows.length === 1 &&
        dbContentExact &&
        secondSessionTmplOk
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        defectId: 'D-P0-08',
        templateId: expectedTmplId,
        patchRequestsToTemplates: patchTmplAfter - patchTmplBefore,
        persistedInPostgres: dbTmplCheck.rows.length === 1,
        persistedTitle: tmplRow?.title,
        persistedDescription: tmplRow?.description,
        persistedDifficulty: tmplRow?.difficulty,
        hasExactConceptInPostgres: dbContentExact,
        expectedConceptName,
        expectedConceptDef,
        conceptsCount: tmplContentSaved?.concepts?.length || 0,
        secondSessionRecoveredExactContentAndDifficulty: secondSessionTmplOk,
      },
    );

    // =========================================================================
    // FLUJO 1F: Creación de sala con 2 dependencias locales en 3 ciclos reales con orden (D-P0-09 / DE-R3)
    // =========================================================================
    await clearFaultRules();
    await teacherPage.eval(`(() => {
      localStorage.setItem('edueval-sync-queue', '[]');
      window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
    })()`);

    const manualLocalTitleA = 'Actividad Manual Local D-P0-09 A';
    const manualLocalTitleB = 'Actividad Manual Local D-P0-09 B';
    const depRoomName = 'Sala con Dependencias Locales D-P0-09';

    // Ciclo 1 (parte 1): fallo 500 explícito en POST /rest/v1/activities para A y B (cubre creación inicial y reintento automático en cola)
    await setFaultRules([
      { method: 'POST', pathIncludes: '/rest/v1/activities', bodyIncludes: manualLocalTitleA, status: 500, body: { message: 'Injected Ciclo 1 A 500' }, remaining: 20 },
      { method: 'POST', pathIncludes: '/rest/v1/activities', bodyIncludes: manualLocalTitleB, status: 500, body: { message: 'Injected Ciclo 1 B 500' }, remaining: 20 },
    ]);

    for (const title of [manualLocalTitleA, manualLocalTitleB]) {
      await teacherPage.clickButtonByText('Contenido');
      await teacherPage.waitForText('＋ Agregar actividad', 8000);
      await teacherPage.clickButtonByText('＋ Agregar actividad');
      await teacherPage.waitForSelector('.activity-editor-modal', 8000);

      await teacherPage.eval(`((newTitle) => {
        const modal = document.querySelector('.activity-editor-modal');
        if (!modal) return;
        const titleInput = modal.querySelector('input');
        if (titleInput) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter.call(titleInput, newTitle);
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const optInputs = Array.from(modal.querySelectorAll('.choice-line input:not([type="radio"])'));
        if (optInputs[0]) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter.call(optInputs[0], 'Opción 1');
          optInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (optInputs[1]) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter.call(optInputs[1], 'Opción 2');
          optInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        }
        const radio = modal.querySelector('input[type="radio"]');
        if (radio) radio.click();
        const hintArea = modal.querySelector('textarea[placeholder*="Se muestra tras confirmar"]');
        if (hintArea) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          setter.call(hintArea, 'Pista orientadora.');
          hintArea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })(${JSON.stringify(title)})`);
      await sleep(150);

      await teacherPage.clickButtonByText('Crear actividad publicada');
      await teacherPage.waitFor(`!document.querySelector('.activity-editor-modal')`, 8000);
    }

    const localIdsCycle1 = await waitForCondition(
      async () =>
        teacherPage.eval(`(() => {
          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          const acts = JSON.parse(localStorage.getItem('edueval-activities') || '[]');
          const a = acts.find(x => x.title === ${JSON.stringify(manualLocalTitleA)});
          const b = acts.find(x => x.title === ${JSON.stringify(manualLocalTitleB)});
          if (!a || !b || uuidRe.test(String(a.id)) || uuidRe.test(String(b.id))) return null;
          const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
          const qA = q.find(i => i.kind === 'activity' && i.payload?.activity?.title === ${JSON.stringify(manualLocalTitleA)});
          const qB = q.find(i => i.kind === 'activity' && i.payload?.activity?.title === ${JSON.stringify(manualLocalTitleB)});
          if (!qA || !qB || (qA.attempts || 0) < 1 || (qB.attempts || 0) < 1) return null;
          return { localIdA: a.id, localIdB: b.id };
        })()`),
      { timeoutMs: 12000, pollMs: 150, label: 'IDs locales no-UUID y attempts >= 1 en cola para A y B (Ciclo 1)' },
    );

    // Limpiar ítems 'activity' individuales una vez concluido su POST + reintento inmediato en backoff,
    // garantizando que la reconciliación ocurra vía el ítem 'room'.
    await teacherPage.eval(`(() => {
      const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]').filter(i => i.kind !== 'activity');
      localStorage.setItem('edueval-sync-queue', JSON.stringify(q));
      window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
    })()`);

    // Ciclo 1 (parte 2): permitir que A se sincronice a UUID mientras B falla 500
    await setFaultRules([
      { method: 'POST', pathIncludes: '/rest/v1/activities', bodyIncludes: manualLocalTitleB, status: 500, body: { message: 'Injected Ciclo 1 B 500' }, remaining: 20 },
    ]);

    await teacherPage.clickButtonByText('Salas');
    await teacherPage.waitForText('Ajustes del examen', 8000);
    await teacherPage.clickButtonByText('Ajustes del examen');
    await teacherPage.waitForSelector('.room-builder input[placeholder*="Evaluación"]', 8000);
    await teacherPage.setInputValue('.room-builder input[placeholder*="Evaluación"]', depRoomName);

    // Desmarcar todas primero y marcar en orden exacto [A, B]
    await teacherPage.eval(`(async (titles) => {
      const labels = Array.from(document.querySelectorAll('.room-builder label.activity-check-card'));
      for (const l of labels) {
        const cb = l.querySelector('input[type="checkbox"]');
        if (cb && cb.checked) cb.click();
      }
      await new Promise(r => setTimeout(r, 80));
      for (const t of titles) {
        const targetCard = labels.find(l => (l.innerText || '').includes(t));
        if (targetCard) {
          const cb = targetCard.querySelector('input[type="checkbox"]');
          if (cb && !cb.checked) cb.click();
          await new Promise(r => setTimeout(r, 60));
        }
      }
    })(${JSON.stringify([manualLocalTitleA, manualLocalTitleB])})`);

    await teacherPage.waitFor(
      `Boolean(document.querySelector('.room-builder .modal-actions button.primary-button')?.innerText?.includes('2 preguntas'))`,
      8000,
    );
    await teacherPage.eval(`(() => {
      const btn = document.querySelector('.room-builder .modal-actions button.primary-button');
      if (btn && !btn.disabled) btn.click();
    })()`);

    let cycle1RoomItem = null;
    try {
      cycle1RoomItem = await waitForCondition(
        async () => {
          const match = await teacherPage.eval(`(() => {
            const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
            const roomItem = q.find(i => i.kind === 'room' && i.ownerId === ${JSON.stringify(users.teacherOwner.id)} && i.payload?.room?.name === ${JSON.stringify(depRoomName)});
            if (!roomItem) return null;
            const ids = roomItem.payload?.room?.activityIds || [];
            const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (ids.length === 2 && uuidRe.test(String(ids[0])) && !uuidRe.test(String(ids[1]))) {
              return roomItem;
            }
            return null;
          })()`);
          return match;
        },
        { timeoutMs: 12000, pollMs: 150, label: 'ítem room en cola con [uuidA, localIdB] (Ciclo 1)' },
      );
    } catch (err) {
      const diagQueue = await teacherPage.eval(`(() => {
        const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
        return q.map(i => ({ id: i.id, kind: i.kind, ownerId: i.ownerId, name: i.payload?.room?.name, activityIds: i.payload?.room?.activityIds }));
      })()`);
      const diagRooms = await pg.query(
        `SELECT id::text AS id, name, status FROM public.rooms WHERE owner_id = $1 AND name = $2`,
        [users.teacherOwner.id, depRoomName],
      );
      throw new Error(`${err.message} | diagQueue=${JSON.stringify(diagQueue)} | diagRooms=${JSON.stringify(diagRooms.rows)}`);
    }

    const cycle1PreservedBAndSnapshot =
      cycle1RoomItem.payload?.room?.activityIds?.[1] === localIdsCycle1.localIdB &&
      JSON.stringify(cycle1RoomItem.payload).includes(manualLocalTitleB);

    // Ciclo 2: recargar página, permitir que B se sincronice a UUID, pero inyectar fallo 500 en POST /rest/v1/rooms
    await setFaultRules([
      { method: 'POST', pathIncludes: '/rest/v1/rooms', status: 500, body: { message: 'Injected Ciclo 2 rooms 500' }, remaining: 20 },
    ]);
    await teacherPage.reload(900);
    await dismissSplashIfPresent(teacherPage);

    // Esperar a que B se sincronice a UUID y ambos UUIDs queden in-place en el ítem 'room'
    let cycle2RoomItem = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        cycle2RoomItem = await teacherPage.waitFor(`(() => {
          const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
          const roomItem = q.find(i => i.kind === 'room' && i.ownerId === ${JSON.stringify(users.teacherOwner.id)} && i.payload?.room?.name === ${JSON.stringify(depRoomName)});
          if (!roomItem) return null;
          const ids = roomItem.payload?.room?.activityIds || [];
          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          return (ids.length === 2 && uuidRe.test(String(ids[0])) && uuidRe.test(String(ids[1]))) ? roomItem : null;
        })()`, 6000);
        if (cycle2RoomItem) break;
      } catch {
        await waitItemReadyAndDispatchOnline(
          teacherPage,
          `(i) => i.kind === 'room' && i.ownerId === ${JSON.stringify(users.teacherOwner.id)}`,
        );
      }
    }

    const dbActsCycle2 = await pg.query(
      `SELECT id::text AS id, title FROM public.activities WHERE owner_id = $1 AND title = ANY($2::text[])`,
      [users.teacherOwner.id, [manualLocalTitleA, manualLocalTitleB]],
    );
    const cycle2BothUuidsNoDuplicates =
      Boolean(cycle2RoomItem) &&
      isUuid(cycle2RoomItem.payload?.room?.activityIds?.[0]) &&
      isUuid(cycle2RoomItem.payload?.room?.activityIds?.[1]) &&
      dbActsCycle2.rows.length === 2;

    // Ciclo 3: permitir POST /rest/v1/rooms, inyectar fallo 500 en POST /rest/v1/room_activities (1 vez), luego limpiar fallos y disparar online
    const netIdxBeforeCycle3 = teacherPage.networkRecords.length;
    await setFaultRules([
      { method: 'POST', pathIncludes: '/rest/v1/room_activities', status: 500, body: { message: 'Injected Ciclo 3 room_activities 500 once' }, remaining: 1 },
    ]);
    await waitItemReadyAndDispatchOnline(
      teacherPage,
      `(i) => i.kind === 'room' && i.ownerId === ${JSON.stringify(users.teacherOwner.id)}`,
    );
    await waitForCondition(
      () =>
        teacherPage.networkRecords
          .slice(netIdxBeforeCycle3)
          .some((r) => r.method === 'POST' && r.url.includes('/rest/v1/room_activities') && r.status === 500),
      { timeoutMs: 12000, label: 'fallo 500 único en POST /rest/v1/room_activities (Ciclo 3)' },
    );

    await clearFaultRules();
    await waitItemReadyAndDispatchOnline(
      teacherPage,
      `(i) => i.kind === 'room' && i.ownerId === ${JSON.stringify(users.teacherOwner.id)}`,
    );
    await teacherPage.waitFor(`(() => {
      const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
      return q.filter(i => i.ownerId === ${JSON.stringify(users.teacherOwner.id)}).length === 0;
    })()`, 12000);

    const dbRoomsCycle3 = await waitForDb(
      pg,
      `SELECT id::text AS id, name FROM public.rooms WHERE owner_id = $1 AND name = $2`,
      [users.teacherOwner.id, depRoomName],
      (rows) => rows.length === 1,
      { label: 'creación final única de sala en Ciclo 3 (E2E-DOC-06)' },
    );
    const dbActsCycle3 = await pg.query(
      `SELECT id::text AS id, title FROM public.activities WHERE owner_id = $1 AND title = ANY($2::text[])`,
      [users.teacherOwner.id, [manualLocalTitleA, manualLocalTitleB]],
    );
    const dbRoomActsOrdered = await pg.query(
      `SELECT ra.position, ra.activity_id::text AS activity_id, a.title
       FROM public.room_activities ra
       JOIN public.activities a ON a.id = ra.activity_id
       WHERE ra.room_id = $1
       ORDER BY ra.position ASC`,
      [dbRoomsCycle3[0].id],
    );
    const remainingQueueDoc06 = await teacherPage.eval(`JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]')`);

    const exactOrderAndNoDupes =
      dbRoomsCycle3.length === 1 &&
      dbActsCycle3.rows.length === 2 &&
      dbRoomActsOrdered.rows.length === 2 &&
      dbRoomActsOrdered.rows[0].position === 0 &&
      dbRoomActsOrdered.rows[0].title === manualLocalTitleA &&
      dbRoomActsOrdered.rows[1].position === 1 &&
      dbRoomActsOrdered.rows[1].title === manualLocalTitleB &&
      remainingQueueDoc06.filter((i) => i.ownerId === users.teacherOwner.id).length === 0;

    // -------------------------------------------------------------------------
    // Flujo 1F - Parte 2: Contraejemplo exacto de R2-B (sala encolada antes de migrar A,
    // reintento de la cola con queueOnFailure=false, fallo parcial en B, actualización in-place
    // del payload serializado con multiplicidad [A, B, A], recarga/reintento sano,
    // y creación final con 3 vínculos exactos en room_activities sin duplicados).
    // -------------------------------------------------------------------------
    await clearFaultRules();

    const r2bLocalIdA = `loc-r2b-act-${Date.now()}-a`;
    const r2bLocalIdB = `loc-r2b-act-${Date.now()}-b`;
    const r2bTitleA = `Actividad R2-B Multi A ${Date.now()}`;
    const r2bTitleB = `Actividad R2-B Multi B ${Date.now()}`;
    const r2bPromptA = '¿Pregunta con multiplicidad A?';
    const r2bPromptB = '¿Pregunta con multiplicidad B?';
    const r2bRoomName = `Sala R2-B Multiplicidad Pre-Encolada ${Date.now()}`;
    const r2bRoomLocalId = `r2b-room-${Date.now()}`;
    const r2bRoomCode = `EDU-R2B-${Math.floor(100 + Math.random() * 899)}`;
    const r2bQueueItemId = `queue-r2b-room-${Date.now()}`;

    // Encolar ítem room directamente en la cola durable ANTES de que A o B existan en la nube
    const r2bItemToEnqueue = {
      id: r2bQueueItemId,
      kind: 'room',
      ownerId: users.teacherOwner.id,
      attempts: 0,
      createdAt: new Date().toISOString(),
      payload: {
        localId: r2bRoomLocalId,
        ownerId: users.teacherOwner.id,
        room: {
          id: r2bRoomLocalId,
          name: r2bRoomName,
          code: r2bRoomCode,
          status: 'ready',
          questionCount: 3,
          activityIds: [r2bLocalIdA, r2bLocalIdB, r2bLocalIdA], // Multiplicidad [A, B, A]
          activities: [r2bLocalIdA, r2bLocalIdB, r2bLocalIdA],
          ownerId: users.teacherOwner.id,
          createdAt: new Date().toISOString(),
        },
        localActivitiesSnapshot: {
          [r2bLocalIdA]: {
            id: r2bLocalIdA,
            title: r2bTitleA,
            type: 'singleChoice',
            prompt: r2bPromptA,
            options: ['Opción A1', 'Opción A2'],
            correctAnswer: 'Opción A1',
            status: 'draft',
            ownerId: users.teacherOwner.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          [r2bLocalIdB]: {
            id: r2bLocalIdB,
            title: r2bTitleB,
            type: 'singleChoice',
            prompt: r2bPromptB,
            options: ['Opción B1', 'Opción B2'],
            correctAnswer: 'Opción B1',
            status: 'draft',
            ownerId: users.teacherOwner.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
    };

    await teacherPage.eval(
      `((item) => {
        const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
        q.push(item);
        localStorage.setItem('edueval-sync-queue', JSON.stringify(q));

        const r = JSON.parse(localStorage.getItem('edueval-rooms') || '[]');
        r.push(item.payload.room);
        localStorage.setItem('edueval-rooms', JSON.stringify(r));

        window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
      })(${JSON.stringify(r2bItemToEnqueue)})`
    );

    // Inyectar fallo 500 en POST /rest/v1/activities para B
    // A pasará y se convertirá en UUID
    await setFaultRules([
      { method: 'POST', pathIncludes: '/rest/v1/activities', bodyIncludes: r2bTitleB, status: 500, body: { message: 'Injected R2-B B 500' }, remaining: 20 },
    ]);

    // Disparar reintento desde la cola (queueOnFailure = false)
    await waitItemReadyAndDispatchOnline(
      teacherPage,
      `(i) => i.id === ${JSON.stringify(r2bQueueItemId)}`,
    );

    // Esperar a que el ítem sea procesado y falle por B con actualización in-place
    const r2bPartialState = await waitForCondition(
      async () =>
        teacherPage.eval(`((itemId, localIdB) => {
          const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
          const item = q.find((i) => i.id === itemId);
          if (!item) return null;
          if ((item.attempts || 0) < 1) return null;
          const ids = item.payload?.room?.activityIds || [];
          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          if (
            ids.length === 3 &&
            uuidRe.test(String(ids[0])) &&
            ids[1] === localIdB &&
            ids[2] === ids[0]
          ) {
            return {
              queueItemId: item.id,
              attempts: item.attempts,
              activityIds: ids,
              uuidA: ids[0],
              snapshotKeys: Object.keys(item.payload?.localActivitiesSnapshot || {}),
            };
          }
          return null;
        })(${JSON.stringify(r2bQueueItemId)}, ${JSON.stringify(r2bLocalIdB)})`),
      { timeoutMs: 12000, pollMs: 150, label: 'actualización in-place en cola con multiplicidad [uuidA, locB, uuidA] tras fallo de B en queueOnFailure=false' },
    );

    const r2bIdentityPreserved = r2bPartialState.queueItemId === r2bQueueItemId;
    const r2bMultiplicityInPlace =
      r2bPartialState.activityIds.length === 3 &&
      isUuid(r2bPartialState.uuidA) &&
      r2bPartialState.activityIds[0] === r2bPartialState.uuidA &&
      r2bPartialState.activityIds[1] === r2bLocalIdB &&
      r2bPartialState.activityIds[2] === r2bPartialState.uuidA &&
      !r2bPartialState.snapshotKeys.includes(r2bLocalIdA) &&
      r2bPartialState.snapshotKeys.includes(r2bLocalIdB);

    // Recarga y reintento sano sin fallos
    await clearFaultRules();
    await teacherPage.reload(900);
    await dismissSplashIfPresent(teacherPage);

    await waitItemReadyAndDispatchOnline(
      teacherPage,
      `(i) => i.id === ${JSON.stringify(r2bQueueItemId)}`,
    );

    // Esperar a que la cola termine de procesar el ítem
    await teacherPage.waitFor(`(() => {
      const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
      return !q.some((i) => i.id === ${JSON.stringify(r2bQueueItemId)});
    })()`, 15000);

    // Verificar en PostgreSQL: sala única, 2 actividades únicas en la nube, y 3 vínculos con orden y multiplicidad
    const dbR2bRoom = await waitForDb(
      pg,
      `SELECT id::text AS id, name FROM public.rooms WHERE owner_id = $1 AND name = $2`,
      [users.teacherOwner.id, r2bRoomName],
      (rows) => rows.length === 1,
      { label: 'creación final de sala R2-B en Postgres' },
    );

    const dbR2bActivities = await pg.query(
      `SELECT id::text AS id, title, prompt FROM public.activities WHERE owner_id = $1 AND title = ANY($2::text[])`,
      [users.teacherOwner.id, [r2bTitleA, r2bTitleB]],
    );

    const dbR2bRoomActivities = await pg.query(
      `SELECT ra.position, ra.activity_id::text AS activity_id, a.title
       FROM public.room_activities ra
       JOIN public.activities a ON a.id = ra.activity_id
       WHERE ra.room_id = $1
       ORDER BY ra.position ASC`,
      [dbR2bRoom[0].id],
    );

    const r2bActAInDb = dbR2bActivities.rows.find((a) => a.title === r2bTitleA);
    const r2bActBInDb = dbR2bActivities.rows.find((a) => a.title === r2bTitleB);

    const r2bContraexampleOk =
      r2bIdentityPreserved &&
      r2bMultiplicityInPlace &&
      dbR2bRoom.length === 1 &&
      dbR2bActivities.rows.length === 2 &&
      Boolean(r2bActAInDb) &&
      Boolean(r2bActBInDb) &&
      r2bActAInDb?.prompt === r2bPromptA &&
      r2bActBInDb?.prompt === r2bPromptB &&
      dbR2bRoomActivities.rows.length === 3 &&
      dbR2bRoomActivities.rows[0].position === 0 &&
      dbR2bRoomActivities.rows[0].activity_id === r2bActAInDb.id &&
      dbR2bRoomActivities.rows[1].position === 1 &&
      dbR2bRoomActivities.rows[1].activity_id === r2bActBInDb.id &&
      dbR2bRoomActivities.rows[2].position === 2 &&
      dbR2bRoomActivities.rows[2].activity_id === r2bActAInDb.id;

    record(
      'E2E-DOC-06',
      'Reconciliación progresiva en 3 ciclos UI y contraejemplo R2-B (sala pre-encolada, fallo parcial queueOnFailure=false con multiplicidad [A,B,A] in-place, recarga/reintento sano y vínculos exactos sin duplicados) (D-P0-09 / DE-R3)',
      cycle1PreservedBAndSnapshot && cycle2BothUuidsNoDuplicates && exactOrderAndNoDupes && r2bContraexampleOk
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        defectId: 'D-P0-09',
        uiCycleSequence: {
          cycle1: {
            localIdA: localIdsCycle1.localIdA,
            localIdB: localIdsCycle1.localIdB,
            inPlaceActivityIds: cycle1RoomItem?.payload?.room?.activityIds || [],
            preservedBAndSnapshot: cycle1PreservedBAndSnapshot,
          },
          cycle2: {
            inPlaceActivityIds: cycle2RoomItem?.payload?.room?.activityIds || [],
            activitiesInPostgresCount: dbActsCycle2.rows.length,
            bothUuidsNoDuplicates: cycle2BothUuidsNoDuplicates,
          },
          cycle3: {
            roomsCountInPostgres: dbRoomsCycle3.length,
            activitiesCountInPostgres: dbActsCycle3.rows.length,
            orderedRoomActivities: dbRoomActsOrdered.rows,
            remainingTeacherQueueCount: remainingQueueDoc06.filter((i) => i.ownerId === users.teacherOwner.id).length,
            exactOrderAndNoDupes,
          },
        },
        r2bContraexample: {
          r2bRoomLocalId,
          r2bQueueItemId,
          r2bIdentityPreserved,
          r2bMultiplicityInPlace,
          r2bPartialInPlaceActivityIds: r2bPartialState?.activityIds || [],
          dbActivitiesCount: dbR2bActivities.rows.length,
          orderedRoomActivities: dbR2bRoomActivities.rows,
          multiplicityMatchesExactUuids:
            dbR2bRoomActivities.rows.length === 3 &&
            dbR2bRoomActivities.rows[0]?.activity_id === dbR2bRoomActivities.rows[2]?.activity_id &&
            dbR2bRoomActivities.rows[0]?.activity_id !== dbR2bRoomActivities.rows[1]?.activity_id,
          r2bContraexampleOk,
        },
      },
    );

    // =========================================================================
    // FLUJO 2: ESTUDIANTE 13 TIPOS EN CHROMIUM + SANITIZACIÓN RED + RECARGA + DUPLICADOS FILLBLANKS
    // =========================================================================
    const studentPage = await browserMain.newPage();
    await studentPage.goto(`${appUrl}/?panel=student`, 600);
    await dismissSplashIfPresent(studentPage);

    await studentPage.setInputValue('input[placeholder*="nombre"]', 'Estudiante E2E 13 Tipos');
    await studentPage.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
    await studentPage.clickButtonByText('Entrar a la sala');
    await studentPage.waitForText('Comprobar respuesta', 10000);

    // Capturar enunciado y orden completo de preguntas antes de recargar
    const promptBeforeReload = await studentPage.eval(`document.querySelector('.play-prompt')?.innerText || ''`);
    const sessionBeforeReload = await studentPage.eval(`sessionStorage.getItem('edueval-student-session')`);
    const qIdsBeforeReload = sessionBeforeReload ? JSON.stringify(JSON.parse(sessionBeforeReload).questionIds) : '';

    // Recargar la página a mitad de sesión y verificar estabilidad del orden y restauración por token
    await studentPage.reload(900);
    await dismissSplashIfPresent(studentPage);
    await studentPage.waitForText('Comprobar respuesta', 10000);
    const promptAfterReload = await studentPage.eval(`document.querySelector('.play-prompt')?.innerText || ''`);
    const sessionAfterReload = await studentPage.eval(`sessionStorage.getItem('edueval-student-session')`);
    const qIdsAfterReload = sessionAfterReload ? JSON.stringify(JSON.parse(sessionAfterReload).questionIds) : '';

    // Responder las 13 actividades en orden en el navegador real
    const answeredTypes = [];
    for (let idx = 0; idx < 13; idx += 1) {
      const t = await answerCurrentStudentActivityInDom(studentPage);
      answeredTypes.push(t);
      if (idx < 12) {
        await studentPage.clickButtonByText('Siguiente actividad');
        await sleep(180);
      } else {
        await studentPage.clickButtonByText('Finalizar evaluación');
        await sleep(300);
        const hasConfirmModal = await studentPage.eval(`Boolean(document.querySelector('.finish-confirm-modal'))`);
        if (hasConfirmModal) {
          await studentPage.clickButtonByText('Entregar evaluación');
          await sleep(300);
        }
      }
    }

    try {
      await studentPage.waitForText('¡Terminaste!', 15000);
    } catch (waitErr) {
      const diagDom = await studentPage.eval(`({
        bodyText: document.body ? document.body.innerText : '',
        buttons: Array.from(document.querySelectorAll('button')).map(b => ({ text: (b.innerText || '').trim(), disabled: b.disabled, class: b.className })),
        htmlSnippet: (document.body ? document.body.innerHTML : '').slice(0, 1000),
      })`);
      const guestCalls = studentPage.networkRecords.filter(r => r.url.includes('student-room-guest'));
      console.error('DIAGNOSTICO TIMEOUT ¡Terminaste!:', JSON.stringify(redactSensitiveData({ diagDom, guestCallsCount: guestCalls.length, guestCalls: guestCalls.map(c => ({ url: c.url, method: c.method, postData: c.postData, responseBody: c.responseBody })) }), null, 2));
      throw waitErr;
    }
    await sleep(600);

    // Inspeccionar tráfico real capturado por CDP hacia /functions/v1/student-room-guest
    const guestNetworkCalls = studentPage.networkRecords.filter((r) =>
      r.url.includes('/functions/v1/student-room-guest') && r.responseBody,
    );
    const leakedPaths = [];
    const actionsCaptured = [];
    for (const call of guestNetworkCalls) {
      try {
        const reqObj = call.postData ? JSON.parse(call.postData) : {};
        const resObj = JSON.parse(call.responseBody);
        actionsCaptured.push(reqObj.action || 'unknown');
        if (reqObj.action === 'join' || reqObj.action === 'status') {
          scanForbiddenKeys(resObj, `$[${reqObj.action}]`, leakedPaths);
        }
      } catch {
        // ignorar si no es JSON
      }
    }

    const e2eAttemptRow = await pg.query(
      `SELECT a.id, a.score::float AS score, a.max_score::float AS max_score,
              a.correct_count, a.answered_count, a.omitted_count, a.total_questions
       FROM public.attempts a
       JOIN public.room_participants p ON p.id = a.participant_id
       WHERE a.room_id = $1 AND p.display_name = 'Estudiante E2E 13 Tipos' LIMIT 1`,
      [mainRoom.id],
    );
    const e2eAnswersCount = await pg.query(
      `SELECT count(*)::int AS cnt, count(*) FILTER (WHERE correct = true)::int AS correct_cnt
       FROM public.attempt_answers WHERE attempt_id = $1`,
      [e2eAttemptRow.rows[0]?.id],
    );

    record(
      'E2E-STU-01',
      'Recorrido E2E de los 13 tipos en Chromium, estabilidad tras recarga, fichas duplicadas fillBlanks (R-UI-02) y calificación autoritativa 130/130',
      answeredTypes.length === 13 &&
        new Set(answeredTypes).size === 13 &&
        promptBeforeReload === promptAfterReload &&
        qIdsBeforeReload === qIdsAfterReload &&
        Boolean(sessionBeforeReload) &&
        studentPage._rUi02Result?.ok === true &&
        leakedPaths.length === 0 &&
        e2eAttemptRow.rows[0]?.score === 130 &&
        e2eAttemptRow.rows[0]?.max_score === 130 &&
        e2eAttemptRow.rows[0]?.correct_count === 13 &&
        e2eAnswersCount.rows[0]?.cnt === 13 &&
        e2eAnswersCount.rows[0]?.correct_cnt === 13
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        answeredTypes,
        uniqueTypesCount: new Set(answeredTypes).size,
        orderStableAcrossReload: promptBeforeReload === promptAfterReload && qIdsBeforeReload === qIdsAfterReload,
        rUi02DuplicateFillBlanksCheck: studentPage._rUi02Result,
        networkActionsCaptured: actionsCaptured,
        forbiddenKeysLeakedInJoinOrStatus: leakedPaths,
        persistedAttempt: e2eAttemptRow.rows[0],
        persistedAnswersSummary: e2eAnswersCount.rows[0],
      },
    );

    // =========================================================================
    // FLUJO 2B: Estudiante omite todas las actividades en UI (R-UI-01)
    // =========================================================================
    const omitPage = await browserMain.newPage();
    await omitPage.goto(`${appUrl}/?panel=student`, 600);
    await dismissSplashIfPresent(omitPage);
    await omitPage.setInputValue('input[placeholder*="nombre"]', '=SUM(1,1) Estudiante Omite Todas');
    await omitPage.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
    await omitPage.clickButtonByText('Entrar a la sala');
    await omitPage.waitForText('Omitir por ahora', 10000);

    for (let idx = 0; idx < 13; idx += 1) {
      await omitPage.clickButtonByText('Omitir por ahora');
      await sleep(100);
    }
    await omitPage.waitForText('¡Terminaste!', 10000);
    await sleep(500);

    const omitAttemptRow = await pg.query(
      `SELECT a.score::float AS score, a.correct_count, a.answered_count, a.omitted_count, a.total_questions, p.display_name
       FROM public.attempts a
       JOIN public.room_participants p ON p.id = a.participant_id
       WHERE a.room_id = $1 AND p.display_name = '=SUM(1,1) Estudiante Omite Todas' LIMIT 1`,
      [mainRoom.id],
    );
    await omitPage.close();

    record(
      'E2E-STU-02',
      'Omisión real desde la UI ("Omitir por ahora") contabilizada en servidor (R-UI-01)',
      omitAttemptRow.rows[0]?.omitted_count === 13 &&
        omitAttemptRow.rows[0]?.answered_count === 0 &&
        omitAttemptRow.rows[0]?.score === 0
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        persistedOmitAttempt: omitAttemptRow.rows[0],
      },
    );

    // =========================================================================
    // FLUJO 3: Resiliencia de sesión estudiantil Fase E + R2-C (E2E-RES-01 .. E2E-RES-08)
    // Se ejecuta en un perfil de navegador estudiantil limpio (sin authSession docente en localStorage)
    // =========================================================================
    const browserResStudent = new CdpBrowser(RC_CONFIG.ports.chromiumDebug + 4, 'student_resilience');
    await browserResStudent.launch();
    try {
      // -----------------------------------------------------------------------
      // 3A: E2E-RES-01 · Fallo 500 en submit_attempt + verificación exacta por pregunta/occurrence_id
      // -----------------------------------------------------------------------
      const failSubmitPage = await browserResStudent.newPage();
      try {
        await failSubmitPage.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(failSubmitPage);
        await failSubmitPage.setInputValue('input[placeholder*="nombre"]', 'Estudiante Error Submit 500');
        await failSubmitPage.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await failSubmitPage.clickButtonByText('Entrar a la sala');
        await failSubmitPage.waitForText('Omitir por ahora', 10000);

        const res01AnsweredTypes = [];
        for (let idx = 0; idx < 2; idx += 1) {
          const t = await answerCurrentStudentActivityInDom(failSubmitPage);
          res01AnsweredTypes.push(t);
          await advanceAfterAnswer(failSubmitPage, idx + 2, 13);
        }

        const res01CapturedMeta = await failSubmitPage.eval(`(() => {
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          return {
            questionIds: Array.isArray(sess.questionIds) ? sess.questionIds.slice(0, 2) : [],
            occurrenceIds: Array.isArray(sess.occurrenceIds) ? sess.occurrenceIds.slice(0, 2) : [],
            responses: sess.responses || {},
          };
        })()`);

        await skipStudentQuestionsToLast(failSubmitPage, 13);

        // Fase 1: Fallo HTTP 500 en submit_attempt
        await setFaultRules([
          { method: 'POST', pathIncludes: '/functions/v1/student-room-guest', action: 'submit_attempt', status: 500, body: { error: 'Simulated 500 on submit_attempt' }, remaining: 20 },
        ]);
        await failSubmitPage.clickButtonByText('Omitir por ahora');
        await waitForStudentCompletionScreen(failSubmitPage, 'E2E-RES-01');

        const uiTextDuringFault = await failSubmitPage.eval(`document.body.innerText`);
        const falseSuccessDuringFault =
          uiTextDuringFault.includes('Respuesta recibida en el servidor') ||
          uiTextDuringFault.includes('PARTICIPACIÓN REGISTRADA');
        const syncQueueDuringFaultRaw = await failSubmitPage.eval(`localStorage.getItem('edueval-sync-queue')`);
        const syncQueueDuringFault = syncQueueDuringFaultRaw ? JSON.parse(syncQueueDuringFaultRaw) : [];
        const dbDuringFault = await pg.query(
          `SELECT count(*)::int AS cnt FROM public.attempts a
           JOIN public.room_participants p ON p.id = a.participant_id
           WHERE a.room_id = $1 AND p.display_name = 'Estudiante Error Submit 500'`,
          [mainRoom.id],
        );

        // Fase 2: Retirar fallo 500 y recuperar
        await clearFaultRules();
        await waitItemReadyAndDispatchOnline(failSubmitPage, `(i) => i.kind === 'attempt'`);
        await failSubmitPage.eval(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Reintentar sincronización'));
          if (btn && !btn.disabled) btn.click();
        })()`);

        const dbAfterRecovery = await waitForDb(
          pg,
          `SELECT a.id::text AS id, a.status, a.answered_count, a.omitted_count, a.score::float AS score, a.max_score::float AS max_score, a.total_questions, a.events
           FROM public.attempts a
           JOIN public.room_participants p ON p.id = a.participant_id
           WHERE a.room_id = $1 AND p.display_name = 'Estudiante Error Submit 500'`,
          [mainRoom.id],
          (rows) => rows.length === 1,
          { label: 'recuperación del intento E2E-RES-01 en PostgreSQL' },
        );

        await failSubmitPage.reload(900);
        await dismissSplashIfPresent(failSubmitPage);
        await failSubmitPage.waitFor(`JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]').length === 0`, 8000);

        const syncQueueAfterRecoveryRaw = await failSubmitPage.eval(`localStorage.getItem('edueval-sync-queue')`);
        const syncQueueAfterRecovery = syncQueueAfterRecoveryRaw ? JSON.parse(syncQueueAfterRecoveryRaw) : [];
        const dbRoomOccurrences = await pg.query(
          `SELECT id::text AS occurrence_id, activity_id::text AS activity_id FROM public.room_activities WHERE room_id = $1`,
          [mainRoom.id],
        );
        const attemptAnswersDb = await pg.query(
          `SELECT activity_id::text AS activity_id, occurrence_id::text AS occurrence_id, question_index, status, correct, score::float AS score, response, response_text
           FROM public.attempt_answers
           WHERE attempt_id = $1 ORDER BY question_index ASC`,
          [dbAfterRecovery[0]?.id],
        );

        const roomOccurrenceSet = new Set(dbRoomOccurrences.rows.map((r) => r.occurrence_id));
        const distinctAttemptOccurrences = new Set(attemptAnswersDb.rows.map((r) => r.occurrence_id));
        const allOccurrencesValidAndDistinct =
          attemptAnswersDb.rows.length === 13 &&
          distinctAttemptOccurrences.size === 13 &&
          attemptAnswersDb.rows.every((r) => roomOccurrenceSet.has(r.occurrence_id));

        const answeredAnswers = attemptAnswersDb.rows.filter((a) => a.status === 'answered');
        const omittedAnswers = attemptAnswersDb.rows.filter((a) => a.status === 'omitted');
        const answeredRowsMatchCaptured =
          answeredAnswers.length === 2 &&
          res01CapturedMeta.questionIds.length === 2 &&
          res01CapturedMeta.occurrenceIds.length === 2 &&
          [0, 1].every((idx) => {
            const row = answeredAnswers.find((r) => r.occurrence_id === res01CapturedMeta.occurrenceIds[idx]);
            return Boolean(
              row &&
                row.activity_id === res01CapturedMeta.questionIds[idx] &&
                row.correct === true &&
                row.score === 10 &&
                typeof row.response_text === 'string' &&
                row.response_text.trim() !== '' &&
                row.response &&
                typeof row.response === 'object' &&
                row.response.type === res01AnsweredTypes[idx],
            );
          });
        const omittedRowsExact =
          omittedAnswers.length === 11 &&
          omittedAnswers.every((row) => row.correct === false && row.score === 0 && (row.response_text || '') === '');
        const attemptMetaExact =
          dbAfterRecovery[0]?.status === 'completed' &&
          dbAfterRecovery[0]?.score === 20 &&
          dbAfterRecovery[0]?.max_score === 130 &&
          Array.isArray(dbAfterRecovery[0]?.events) &&
          dbAfterRecovery[0].events.some((ev) => ev && ev.type === 'finished');

        record(
          'E2E-RES-01',
          'Entrega estudiantil ante fallo HTTP 500 y verificación exacta en attempt_answers por occurrence_id/activity_id (E-UNI-P1-13 / E-P0-10)',
          !falseSuccessDuringFault &&
            dbDuringFault.rows[0].cnt === 0 &&
            dbAfterRecovery.length === 1 &&
            dbAfterRecovery[0].answered_count === 2 &&
            dbAfterRecovery[0].omitted_count === 11 &&
            attemptMetaExact &&
            allOccurrencesValidAndDistinct &&
            answeredRowsMatchCaptured &&
            omittedRowsExact &&
            syncQueueAfterRecovery.length === 0
            ? 'PASA'
            : 'FALLA_PRODUCTO',
          {
            defectIds: ['E-UNI-P1-13', 'E-P0-10'],
            capturedBeforeFault: {
              questionIds: res01CapturedMeta.questionIds,
              occurrenceIds: res01CapturedMeta.occurrenceIds,
              answeredTypes: res01AnsweredTypes,
            },
            phase1DuringFault: {
              falseServerConfirmationDisplayed: falseSuccessDuringFault,
              attemptsInPostgresDuringFault: dbDuringFault.rows[0].cnt,
              queuedItemsCount: syncQueueDuringFault.length,
              queuedItemHasGuestToken: syncQueueDuringFaultRaw ? syncQueueDuringFaultRaw.includes('guestToken') : false,
            },
            phase2AfterFaultCleared: {
              attemptsInPostgresAfterRecovery: dbAfterRecovery.length,
              attemptStatus: dbAfterRecovery[0]?.status,
              authoritativeScore: dbAfterRecovery[0]?.score,
              authoritativeMaxScore: dbAfterRecovery[0]?.max_score,
              hasFinishedEvent: Array.isArray(dbAfterRecovery[0]?.events) && dbAfterRecovery[0].events.some((ev) => ev?.type === 'finished'),
              answersDetailedRowsCount: attemptAnswersDb.rows.length,
              distinctOccurrencesCount: distinctAttemptOccurrences.size,
              allOccurrencesValidAndDistinct,
              answeredRowsMatchCaptured,
              omittedRowsExact,
              remainingQueuedItemsCount: syncQueueAfterRecovery.length,
            },
          },
        );
      } finally {
        await clearFaultRules().catch(() => {});
        await failSubmitPage.close().catch(() => {});
      }

      // -----------------------------------------------------------------------
      // 3B: E2E-RES-02 · Fallo 429 en restoreStudentSession + programación de nextRetryAt con Retry-After sin spam
      // -----------------------------------------------------------------------
      const restore429Page = await browserResStudent.newPage();
      try {
        await restore429Page.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(restore429Page);
        await restore429Page.setInputValue('input[placeholder*="nombre"]', 'Estudiante Error 429');
        await restore429Page.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await restore429Page.clickButtonByText('Entrar a la sala');
        await restore429Page.waitForText('Comprobar respuesta', 10000);

        for (let idx = 0; idx < 2; idx += 1) {
          await answerCurrentStudentActivityInDom(restore429Page);
          await advanceAfterAnswer(restore429Page, idx + 2, 13);
        }

        const stateBefore429 = await restore429Page.eval(`(() => {
          const raw = sessionStorage.getItem('edueval-student-session');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return {
            hasSnapshot: true,
            playIndex: parsed.playIndex,
            answeredKeysCount: Object.keys(parsed.responses || {}).length,
            questionIdsCount: Array.isArray(parsed.questionIds) ? parsed.questionIds.length : 0,
            responses: parsed.responses || {},
            questionIds: parsed.questionIds || [],
            occurrenceIds: parsed.occurrenceIds || [],
            hasGuestTokenInSnapshot: Boolean(parsed.guestToken),
            hasSeparateGuestTokenKey: Boolean(sessionStorage.getItem('edueval-student-guest-token')),
            hasSeparateParticipantIdKey: Boolean(sessionStorage.getItem('edueval-student-participant-id')),
          };
        })()`);

        // Fase 1: Recargar durante fallo transitorio HTTP 429
        await setFaultRules([
          { method: 'POST', pathIncludes: '/functions/v1/student-room-guest', status: 429, headers: { 'Retry-After': '10' }, body: { error: 'Rate limit transitorio', retryAfter: 10 }, remaining: 20 },
        ]);
        await restore429Page.reload(900);
        await dismissSplashIfPresent(restore429Page);

        const stateDuring429 = await restore429Page.eval(`(() => {
          const raw = sessionStorage.getItem('edueval-student-session');
          return {
            hasRecoverableSnapshot: Boolean(raw),
            snapshotContent: raw ? JSON.parse(raw) : null,
            separateGuestTokenKeyStillPresent: Boolean(sessionStorage.getItem('edueval-student-guest-token')),
            separateParticipantIdKeyStillPresent: Boolean(sessionStorage.getItem('edueval-student-participant-id')),
            returnedToEntryScreen: document.body.innerText.includes('Entrar a la sala'),
          };
        })()`);
        stateDuring429.snapshotContent = redactSensitiveData(stateDuring429.snapshotContent);

        // Fase 2: Retirar 429 y recargar para recuperar sesión y respuestas intactas
        await clearFaultRules();
        await restore429Page.reload(900);
        await dismissSplashIfPresent(restore429Page);
        await restore429Page.waitForSelector('.play-prompt', 10000);

        const stateAfterHealthyRetry = await restore429Page.eval(`(() => {
          const raw = sessionStorage.getItem('edueval-student-session');
          const parsed = raw ? JSON.parse(raw) : null;
          return {
            hasRecoverableSnapshot: Boolean(raw),
            playIndexRecovered: parsed?.playIndex ?? null,
            answeredKeysRecovered: parsed ? Object.keys(parsed.responses || {}).length : 0,
            responses: parsed?.responses || {},
            questionIds: parsed?.questionIds || [],
            occurrenceIds: parsed?.occurrenceIds || [],
            isInPlayView: Boolean(document.querySelector('.play-prompt')),
            stuckAtEntryScreen: document.body.innerText.includes('Entrar a la sala'),
          };
        })()`);

        // Fase 3 (R2-C): Verificar que ante 429 con Retry-After en submit_attempt se programa nextRetryAt sin spamear inmediatamente
        await skipStudentQuestionsToLast(restore429Page, 13);

        await setFaultRules([
          {
            method: 'POST',
            pathIncludes: '/functions/v1/student-room-guest',
            action: 'submit_attempt',
            status: 429,
            headers: { 'Retry-After': '15' },
            body: { error: 'Rate limit 429 en entrega', retryAfter: 15 },
            remaining: 10,
          },
        ]);
        await restore429Page.clickButtonByText('Omitir por ahora');
        const queued429Item = await restore429Page.waitFor(`(() => {
          const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
          const it = q.find(i => i.kind === 'attempt' && i.nextRetryAt);
          return it || null;
        })()`, 10000);

        const submitCountAfter429 = restore429Page.networkRecords.filter(
          (r) => r.url.includes('/functions/v1/student-room-guest') && (r.postData || '').includes('submit_attempt'),
        ).length;
        await restore429Page.eval(`window.dispatchEvent(new Event('online'))`);
        await sleep(900);
        const submitCountAfterImmediateOnline = restore429Page.networkRecords.filter(
          (r) => r.url.includes('/functions/v1/student-room-guest') && (r.postData || '').includes('submit_attempt'),
        ).length;

        const nextRetryAtScheduledFuture = Boolean(
          queued429Item?.nextRetryAt && Date.parse(queued429Item.nextRetryAt) > Date.now() + 5000,
        );
        const didNotSpamImmediately = submitCountAfterImmediateOnline === submitCountAfter429;

        await restore429Page.eval(`(() => {
          localStorage.setItem('edueval-sync-queue', '[]');
          window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
        })()`);

        const responsesMatch429 = JSON.stringify(stateBefore429?.responses) === JSON.stringify(stateAfterHealthyRetry?.responses);
        const questionIdsMatch429 = JSON.stringify(stateBefore429?.questionIds) === JSON.stringify(stateAfterHealthyRetry?.questionIds);
        const occurrenceIdsMatch429 = JSON.stringify(stateBefore429?.occurrenceIds) === JSON.stringify(stateAfterHealthyRetry?.occurrenceIds);

        record(
          'E2E-RES-02',
          'Preservación de respuestas tras 429 al recargar y programación de nextRetryAt con Retry-After sin spam inmediato (E-P0-11 / R2-C)',
          stateBefore429?.hasSnapshot &&
            stateBefore429?.playIndex === 2 &&
            stateBefore429?.answeredKeysCount === 2 &&
            stateDuring429.hasRecoverableSnapshot &&
            stateAfterHealthyRetry.isInPlayView &&
            stateAfterHealthyRetry.playIndexRecovered === 2 &&
            stateAfterHealthyRetry.answeredKeysRecovered === 2 &&
            responsesMatch429 &&
            questionIdsMatch429 &&
            occurrenceIdsMatch429 &&
            nextRetryAtScheduledFuture &&
            didNotSpamImmediately
            ? 'PASA'
            : 'FALLA_PRODUCTO',
          {
            defectId: 'E-P0-11',
            before429Reload: stateBefore429,
            after429Reload: stateDuring429,
            afterHealthyRetryReload: stateAfterHealthyRetry,
            responsesMatch: responsesMatch429,
            questionIdsMatch: questionIdsMatch429,
            occurrenceIdsMatch: occurrenceIdsMatch429,
            retryAfterScheduling: {
              nextRetryAt: queued429Item?.nextRetryAt || null,
              retryAfterSeconds: queued429Item?.retryAfterSeconds ?? null,
              nextRetryAtScheduledFuture,
              submitCountAfter429,
              submitCountAfterImmediateOnline,
              didNotSpamImmediately,
            },
          },
        );
      } finally {
        await clearFaultRules().catch(() => {});
        await restore429Page.close().catch(() => {});
      }

      // -----------------------------------------------------------------------
      // 3C: E2E-RES-03 · Pérdida REAL de acuse tras commit (afterUpstreamStatus: 502)
      // + comprobación 409 conflicto de nombre (sin alreadyAttempted) vs 401 status
      // -----------------------------------------------------------------------
      const lostAckPage = await browserResStudent.newPage();
      const conflictPage = await browserResStudent.newPage();
      try {
        await lostAckPage.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(lostAckPage);
        await lostAckPage.setInputValue('input[placeholder*="nombre"]', 'Estudiante Perdida Acuse 502');
        await lostAckPage.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await lostAckPage.clickButtonByText('Entrar a la sala');
        await lostAckPage.waitForText('Comprobar respuesta', 10000);

        await answerCurrentStudentActivityInDom(lostAckPage);
        await advanceAfterAnswer(lostAckPage, 2, 13);
        await skipStudentQuestionsToLast(lostAckPage, 13);

        // Configurar pérdida REAL de acuse post-commit: el worker Deno + PostgreSQL ejecutan y confirman, luego pasarela devuelve 502
        await setFaultRules([
          {
            method: 'POST',
            pathIncludes: '/functions/v1/student-room-guest',
            action: 'submit_attempt',
            afterUpstreamStatus: 502,
            afterUpstreamBody: { error: 'Simulated 502 Bad Gateway after PostgreSQL commit' },
            remaining: 10,
          },
        ]);
        await lostAckPage.clickButtonByText('Omitir por ahora');
        await waitForStudentCompletionScreen(lostAckPage, 'E2E-RES-03');

        const dbLostAckCheck1 = await waitForDb(
          pg,
          `SELECT a.id::text AS id, a.score::float AS score, a.answered_count
           FROM public.attempts a
           JOIN public.room_participants p ON p.id = a.participant_id
           WHERE a.room_id = $1 AND p.display_name = 'Estudiante Perdida Acuse 502'`,
          [mainRoom.id],
          (rows) => rows.length === 1,
          { label: 'commit real en PostgreSQL antes del 502 post-commit (E2E-RES-03)' },
        );

        const uiBeforeReload502 = await lostAckPage.eval(`(() => {
          const text = document.body.innerText || '';
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          return {
            textHasConfirmed: text.includes('Respuesta recibida en el servidor') || text.includes('PARTICIPACIÓN REGISTRADA'),
            textHasPending: text.includes('Pendiente de sincronización') || text.includes('EVALUACIÓN GUARDADA LOCALMENTE'),
            submissionStatus: sess.submissionStatus || null,
          };
        })()`);
        const pendingDuringLostAck =
          !uiBeforeReload502.textHasConfirmed &&
          uiBeforeReload502.textHasPending &&
          uiBeforeReload502.submissionStatus === 'pending_sync';

        // Retirar regla 502 y recargar -> reconcilia con submit_attempt (alreadySaved: true + attemptId) o 409 alreadyAttempted -> confirmed sin duplicar
        await clearFaultRules();
        const submitCountBeforeReload = lostAckPage.networkRecords.length;
        await lostAckPage.reload(900);
        await dismissSplashIfPresent(lostAckPage);
        await lostAckPage.waitFor(
          `document.body.innerText.includes('¡Terminaste!') || document.body.innerText.includes('Respuesta recibida en el servidor')`,
          12000,
        );

        const postReloadSubmitCalls = lostAckPage.networkRecords
          .slice(submitCountBeforeReload)
          .filter((r) => r.url.includes('/functions/v1/student-room-guest') && (r.postData || '').includes('submit_attempt'));
        const reconciledViaSubmitAlreadySaved = postReloadSubmitCalls.some((r) => {
          try {
            const body = JSON.parse(r.responseBody || '{}');
            return body.alreadySaved === true && typeof body.attemptId === 'string' && body.attemptId.length > 0;
          } catch {
            return false;
          }
        });

        const sessionAfterLostAck = await lostAckPage.eval(`(() => {
          const raw = sessionStorage.getItem('edueval-student-session');
          return raw ? JSON.parse(raw) : null;
        })()`);
        const dbLostAckCheck2 = await pg.query(
          `SELECT a.id::text AS id, a.score::float AS score, a.answered_count
           FROM public.attempts a
           JOIN public.room_participants p ON p.id = a.participant_id
           WHERE a.room_id = $1 AND p.display_name = 'Estudiante Perdida Acuse 502'`,
          [mainRoom.id],
        );

        // Limpiar edueval-sync-queue antes de la comprobación en conflictPage
        await lostAckPage.eval(`(() => {
          localStorage.setItem('edueval-sync-queue', '[]');
          window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
        })()`);

        // Parte 2: Comprobar en otra pestaña limpia que rechazo 409 conflicto de nombre (sin alreadyAttempted) + 401 status JAMÁS transiciona a confirmed
        await conflictPage.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(conflictPage);
        await conflictPage.setInputValue('input[placeholder*="nombre"]', 'Estudiante Perdida Acuse 502');
        await conflictPage.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await conflictPage.clickButtonByText('Entrar a la sala');
        await conflictPage.waitFor(
          `document.body.innerText.includes('ya está participando') || document.body.innerText.includes('Conflicto') || document.body.innerText.includes('Entrar a la sala')`,
          8000,
        );
        await sleep(300);
        const conflictJoin409Ui = await conflictPage.eval(`(() => {
          const t = document.body.innerText || '';
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          return {
            stayedOnEntry: t.includes('Entrar a la sala'),
            neverConfirmed: !t.includes('¡Terminaste!') && !t.includes('Respuesta recibida en el servidor') && sess.submissionStatus !== 'confirmed',
          };
        })()`);

        // También probar snapshot con 409 sin alreadyAttempted en join + 401 en status -> jamás transiciona a confirmed
        await setFaultRules([
          { method: 'POST', pathIncludes: '/functions/v1/student-room-guest', action: 'join', status: 409, body: { error: 'Conflicto de nombre sin alreadyAttempted' }, remaining: 5 },
          { method: 'POST', pathIncludes: '/functions/v1/student-room-guest', action: 'status', status: 401, body: { error: 'Sesión expirada', code: 'TOKEN_EXPIRED' }, remaining: 5 },
        ]);
        await conflictPage.eval(`((code, rId) => {
          const fakeSnap = {
            studentName: 'Estudiante Conflicto 409',
            roomCode: code,
            room: { id: rId, code, name: 'Sala', status: 'active', activities: [] },
            participantId: '00000000-0000-4000-8000-000000000077',
            guestToken: 'fake-token-conflict',
            questionIds: [],
            occurrenceIds: [],
            responses: {},
            answerTimes: {},
            startedAt: new Date().toISOString(),
            events: [],
            finished: false,
            playIndex: 0,
            submitted: false,
            submissionStatus: 'working',
          };
          sessionStorage.setItem('edueval-student-session', JSON.stringify(fakeSnap));
        })(${JSON.stringify(mainRoom.code)}, ${JSON.stringify(mainRoom.id)})`);
        await conflictPage.reload(900);
        await dismissSplashIfPresent(conflictPage);
        await sleep(600);
        const conflictAnd401NeverConfirmed = await conflictPage.eval(`(() => {
          const t = document.body.innerText || '';
          const sessRaw = sessionStorage.getItem('edueval-student-session');
          const sess = sessRaw ? JSON.parse(sessRaw) : null;
          return !t.includes('¡Terminaste!') && !t.includes('Respuesta recibida en el servidor') && sess?.submissionStatus !== 'confirmed';
        })()`);

        record(
          'E2E-RES-03',
          'Pérdida real de acuse post-commit (afterUpstreamStatus: 502), reconciliación a confirmed y rechazo 409 conflicto nombre / 401 status nunca confirmed (DE-R1 / R2-C)',
          dbLostAckCheck1.length === 1 &&
            pendingDuringLostAck &&
            dbLostAckCheck2.rows.length === 1 &&
            sessionAfterLostAck?.submissionStatus === 'confirmed' &&
            conflictJoin409Ui.stayedOnEntry &&
            conflictJoin409Ui.neverConfirmed &&
            conflictAnd401NeverConfirmed
            ? 'PASA'
            : 'FALLA_PRODUCTO',
          {
            attemptId: dbLostAckCheck1[0]?.id,
            pendingDuringLostAck,
            uiBeforeReload502,
            attemptsCountInDb: dbLostAckCheck2.rows.length,
            notDuplicated: dbLostAckCheck2.rows.length === 1,
            reconciledViaSubmitAlreadySaved,
            restoredSubmissionStatus: sessionAfterLostAck?.submissionStatus || null,
            conflict409And401Check: {
              conflictJoin409Ui,
              conflictAnd401NeverConfirmed,
            },
          },
        );
      } finally {
        await clearFaultRules().catch(() => {});
        await lostAckPage.close().catch(() => {});
        await conflictPage.close().catch(() => {});
      }

      // -----------------------------------------------------------------------
      // 3D: E2E-RES-04 · Dos participantes A y B reales en el mismo dispositivo y consulta DB
      // -----------------------------------------------------------------------
      const multiPartPage = await browserResStudent.newPage();
      try {
        await multiPartPage.eval(`(() => {
          try {
            localStorage.setItem('edueval-sync-queue', '[]');
            localStorage.setItem('edueval-attempts', '[]');
          } catch {}
        })()`);
        await multiPartPage.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(multiPartPage);

        // Participante A entra a mainRoom, responde P0, falla submit_attempt con 500
        await multiPartPage.setInputValue('input[placeholder*="nombre"]', 'Participante A Dispositivo Compartido');
        await multiPartPage.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await multiPartPage.clickButtonByText('Entrar a la sala');
        await multiPartPage.waitForText('Comprobar respuesta', 10000);

        const participantIdA = await multiPartPage.eval(`sessionStorage.getItem('edueval-student-participant-id') || ''`);
        const answeredTypeA = await answerCurrentStudentActivityInDom(multiPartPage);
        const res04MetaA = await multiPartPage.eval(`(() => {
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          return {
            occIdA: Array.isArray(sess.occurrenceIds) ? sess.occurrenceIds[0] : null,
            actIdA: Array.isArray(sess.questionIds) ? sess.questionIds[0] : null,
          };
        })()`);
        await advanceAfterAnswer(multiPartPage, 2, 13);
        await skipStudentQuestionsToLast(multiPartPage, 13);

        await setFaultRules([
          {
            method: 'POST',
            pathIncludes: '/functions/v1/student-room-guest',
            action: 'submit_attempt',
            bodyIncludes: participantIdA,
            status: 500,
            body: { error: 'Simulated 500 for Participant A' },
            remaining: 50,
          },
        ]);
        await multiPartPage.clickButtonByText('Omitir por ahora');
        await multiPartPage.waitFor(
          `(() => {
            const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
            return q.some(i => i.kind === 'attempt' && i.payload?.participantId === ${JSON.stringify(participantIdA)} && Boolean(i.payload?.guestToken));
          })()`,
          10000,
        );

        // Mismo navegador (conservando edueval-sync-queue en localStorage), limpiar sessionStorage para nuevo ingreso de Participante B
        await multiPartPage.eval(`sessionStorage.clear()`);
        await multiPartPage.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(multiPartPage);

        await multiPartPage.setInputValue('input[placeholder*="nombre"]', 'Participante B Dispositivo Compartido');
        await multiPartPage.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await multiPartPage.clickButtonByText('Entrar a la sala');
        await multiPartPage.waitForText('Comprobar respuesta', 10000);

        const participantIdB = await multiPartPage.eval(`sessionStorage.getItem('edueval-student-participant-id') || ''`);
        // Participante B omite P0 y responde P1
        await multiPartPage.clickButtonByText('Omitir por ahora');
        await waitForStudentQuestionNumber(multiPartPage, 2, 13, 8000);
        const answeredTypeB = await answerCurrentStudentActivityInDom(multiPartPage);
        const res04MetaB = await multiPartPage.eval(`(() => {
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          return {
            occIdBOmitted0: Array.isArray(sess.occurrenceIds) ? sess.occurrenceIds[0] : null,
            actIdBOmitted0: Array.isArray(sess.questionIds) ? sess.questionIds[0] : null,
            occIdBAnswered1: Array.isArray(sess.occurrenceIds) ? sess.occurrenceIds[1] : null,
            actIdBAnswered1: Array.isArray(sess.questionIds) ? sess.questionIds[1] : null,
          };
        })()`);
        await advanceAfterAnswer(multiPartPage, 3, 13);
        await skipStudentQuestionsToLast(multiPartPage, 13);

        // Permitir A pero bloquear B con regla selectiva bodyIncludes: participantIdB
        await setFaultRules([
          {
            method: 'POST',
            pathIncludes: '/functions/v1/student-room-guest',
            action: 'submit_attempt',
            bodyIncludes: participantIdB,
            status: 500,
            body: { error: 'Simulated 500 for Participant B' },
            remaining: 50,
          },
        ]);
        await multiPartPage.clickButtonByText('Omitir por ahora');
        await waitForStudentCompletionScreen(multiPartPage, 'E2E-RES-04-B');

        // Disparar flush para que A confirme mientras B sigue bloqueado
        await waitItemReadyAndDispatchOnline(
          multiPartPage,
          `(i) => i.kind === 'attempt' && i.payload?.participantId === ${JSON.stringify(participantIdA)}`,
        );

        const dbAttemptsA = await waitForDb(
          pg,
          `SELECT id::text AS id, answered_count, omitted_count, score::float AS score FROM public.attempts WHERE participant_id = $1`,
          [participantIdA],
          (rows) => rows.length === 1,
          { timeoutMs: 15000, label: 'confirmación de intento A mientras B sigue pendiente (E2E-RES-04)' },
        );
        const dbAnswersA = await pg.query(
          `SELECT activity_id::text AS activity_id, occurrence_id::text AS occurrence_id, question_index, status, correct, score::float AS score, response
           FROM public.attempt_answers WHERE attempt_id = $1 AND status = 'answered'`,
          [dbAttemptsA[0].id],
        );
        const dbAttemptsB = await pg.query(
          `SELECT id::text AS id FROM public.attempts WHERE participant_id = $1`,
          [participantIdB],
        );

        const toastDuringAFlush = await multiPartPage.eval(`(() => {
          const toastEl = document.querySelector('.toast');
          return toastEl ? (toastEl.innerText || '').trim() : '';
        })()`);
        const noConfirmationToastInB =
          !toastDuringAFlush.includes('sincronizada con éxito') &&
          !toastDuringAFlush.includes('confirmada') &&
          !toastDuringAFlush.includes('PARTICIPACIÓN');

        const uiAndQueueStateB = await multiPartPage.eval(`((idA, idB) => {
          const text = document.body.innerText || '';
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
          return {
            activeParticipantId: sess.participantId || null,
            submissionStatusB: sess.submissionStatus || null,
            uiShowsConfirmed: text.includes('Respuesta recibida en el servidor') || text.includes('PARTICIPACIÓN REGISTRADA') || text.includes('Comprobante Oficial'),
            uiShowsPendingSync: text.includes('Pendiente de sincronización') || text.includes('Respaldo Local (Pendiente)') || text.includes('EVALUACIÓN GUARDADA LOCALMENTE'),
            queueHasA: q.some(i => i.payload?.participantId === idA),
            queueHasB: q.some(i => i.payload?.participantId === idB),
          };
        })(${JSON.stringify(participantIdA)}, ${JSON.stringify(participantIdB)})`);

        // Ahora retirar fallos y recuperar B también sin vaciar manualmente la cola
        await clearFaultRules();
        await waitItemReadyAndDispatchOnline(
          multiPartPage,
          `(i) => i.kind === 'attempt' && i.payload?.participantId === ${JSON.stringify(participantIdB)}`,
        );
        await multiPartPage.eval(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Reintentar sincronización') && !b.disabled);
          if (btn) btn.click();
        })()`);

        const dbAttemptsBRecovered = await waitForDb(
          pg,
          `SELECT id::text AS id, answered_count, omitted_count, score::float AS score FROM public.attempts WHERE participant_id = $1`,
          [participantIdB],
          (rows) => rows.length === 1,
          { timeoutMs: 15000, label: 'recuperación posterior de intento B en PostgreSQL (E2E-RES-04)' },
        );
        const dbAnswersBRecovered = await pg.query(
          `SELECT activity_id::text AS activity_id, occurrence_id::text AS occurrence_id, question_index, status, correct, score::float AS score, response
           FROM public.attempt_answers WHERE attempt_id = $1 ORDER BY question_index ASC`,
          [dbAttemptsBRecovered[0].id],
        );
        const dbAttemptsAFinal = await pg.query(
          `SELECT id::text AS id FROM public.attempts WHERE participant_id = $1`,
          [participantIdA],
        );

        await multiPartPage.waitFor(
          `document.body.innerText.includes('¡Terminaste!') && document.body.innerText.includes('Ver e Imprimir Comprobante Oficial') && JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]').length === 0`,
          12000,
        );

        const queueAfterBothRecovered = await multiPartPage.eval(`JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]')`);
        const sessBAfterRecovery = await multiPartPage.eval(`JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}')`);

        // Abrir comprobante oficial de B y verificar su contenido aislado
        await multiPartPage.clickButtonByText('Ver e Imprimir Comprobante Oficial');
        await multiPartPage.waitForSelector('iframe[title="Vista previa de examen"]', 8000);
        const voucherBHtml = await multiPartPage.eval(`document.querySelector('iframe[title="Vista previa de examen"]')?.getAttribute('srcdoc') || ''`);
        await multiPartPage.eval(`(() => {
          const closeBtn = document.querySelector('.blank-exam-modal button[aria-label="Cerrar"]');
          if (closeBtn) closeBtn.click();
        })()`);

        const aAnswerExact =
          dbAnswersA.rows.length === 1 &&
          Boolean(res04MetaA.occIdA && res04MetaA.actIdA) &&
          dbAnswersA.rows[0].occurrence_id === res04MetaA.occIdA &&
          dbAnswersA.rows[0].activity_id === res04MetaA.actIdA &&
          dbAnswersA.rows[0].status === 'answered' &&
          dbAnswersA.rows[0].correct === true &&
          dbAnswersA.rows[0].score === 10 &&
          dbAnswersA.rows[0].response?.type === answeredTypeA;

        const bRowAnswered1 = dbAnswersBRecovered.rows.find((r) => r.occurrence_id === res04MetaB.occIdBAnswered1);
        const bRowOmitted0 = dbAnswersBRecovered.rows.find((r) => r.occurrence_id === res04MetaB.occIdBOmitted0);
        const bAnswersExact =
          dbAttemptsBRecovered.length === 1 &&
          dbAttemptsBRecovered[0].answered_count === 1 &&
          dbAttemptsBRecovered[0].omitted_count === 12 &&
          Boolean(res04MetaB.occIdBAnswered1 && res04MetaB.actIdBAnswered1 && res04MetaB.occIdBOmitted0 && res04MetaB.actIdBOmitted0) &&
          Boolean(
            bRowAnswered1 &&
              bRowAnswered1.activity_id === res04MetaB.actIdBAnswered1 &&
              bRowAnswered1.status === 'answered' &&
              bRowAnswered1.correct === true &&
              bRowAnswered1.score === 10 &&
              bRowAnswered1.response?.type === answeredTypeB,
          ) &&
          Boolean(
            bRowOmitted0 &&
              bRowOmitted0.activity_id === res04MetaB.actIdBOmitted0 &&
              bRowOmitted0.status === 'omitted' &&
              bRowOmitted0.correct === false &&
              bRowOmitted0.score === 0,
          ) &&
          dbAttemptsAFinal.rows.length === 1 &&
          dbAttemptsAFinal.rows[0].id !== dbAttemptsBRecovered[0].id;

        const bVoucherIsolated =
          sessBAfterRecovery?.submissionStatus === 'confirmed' &&
          sessBAfterRecovery?.serverAttemptId === dbAttemptsBRecovered[0].id &&
          sessBAfterRecovery?.attemptRecord?.id === dbAttemptsBRecovered[0].id &&
          voucherBHtml.includes('Participante B Dispositivo Compartido') &&
          voucherBHtml.includes('Confirmado en servidor') &&
          voucherBHtml.includes('<b>1</b> respondidas') &&
          !voucherBHtml.includes('Participante A Dispositivo Compartido') &&
          !voucherBHtml.includes(dbAttemptsA[0].id);

        const res04Ok =
          Boolean(participantIdA && participantIdB && participantIdA !== participantIdB) &&
          dbAttemptsA.length === 1 &&
          dbAttemptsA[0].answered_count === 1 &&
          aAnswerExact &&
          dbAttemptsB.rows.length === 0 &&
          noConfirmationToastInB &&
          uiAndQueueStateB.activeParticipantId === participantIdB &&
          uiAndQueueStateB.submissionStatusB === 'pending_sync' &&
          !uiAndQueueStateB.uiShowsConfirmed &&
          uiAndQueueStateB.uiShowsPendingSync &&
          !uiAndQueueStateB.queueHasA &&
          uiAndQueueStateB.queueHasB &&
          bAnswersExact &&
          queueAfterBothRecovered.length === 0 &&
          bVoucherIsolated;

        record(
          'E2E-RES-04',
          'Dos participantes reales A y B en el mismo dispositivo: A confirma sin toast/cruce en B y luego B recupera su propio intento P1 en PostgreSQL y comprobante oficial (DE-R1 / R2-C)',
          res04Ok ? 'PASA' : 'FALLA_PRODUCTO',
          {
            participantIdA,
            participantIdB,
            duringAFlushOnly: {
              dbAttemptA: dbAttemptsA[0] || null,
              res04MetaA,
              dbAnsweredOccurrenceA: dbAnswersA.rows[0]?.occurrence_id ?? null,
              dbAnsweredActivityA: dbAnswersA.rows[0]?.activity_id ?? null,
              dbAnsweredCanonicalIndexA: dbAnswersA.rows[0]?.question_index ?? null,
              aAnswerExact,
              dbAttemptsCountB: dbAttemptsB.rows.length,
              toastDuringAFlush,
              noConfirmationToastInB,
              uiAndQueueStateB,
            },
            afterBRecovery: {
              dbAttemptB: dbAttemptsBRecovered[0] || null,
              res04MetaB,
              bAnswersExact,
              totalSeparateAttempts: dbAttemptsAFinal.rows.length + dbAttemptsBRecovered.length,
              queueLengthAfterBoth: queueAfterBothRecovered.length,
              bServerAttemptId: sessBAfterRecovery?.serverAttemptId || null,
              bVoucherIsolated,
            },
          },
        );
      } finally {
        await clearFaultRules().catch(() => {});
        await multiPartPage.close().catch(() => {});
      }

      // -----------------------------------------------------------------------
      // 3E: E2E-RES-05 · Acuse 200 incompleto sin attemptId válido
      // -----------------------------------------------------------------------
      const incompleteAckPage = await browserResStudent.newPage();
      try {
        await incompleteAckPage.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(incompleteAckPage);
        await incompleteAckPage.setInputValue('input[placeholder*="nombre"]', 'Estudiante Acuse Incompleto');
        await incompleteAckPage.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await incompleteAckPage.clickButtonByText('Entrar a la sala');
        await incompleteAckPage.waitForText('Comprobar respuesta', 10000);

        await answerCurrentStudentActivityInDom(incompleteAckPage);
        await advanceAfterAnswer(incompleteAckPage, 2, 13);
        await skipStudentQuestionsToLast(incompleteAckPage, 13);

        await setFaultRules([
          { method: 'POST', pathIncludes: '/functions/v1/student-room-guest', action: 'submit_attempt', status: 200, body: { ok: true, attemptId: null, message: 'Payload sin attemptId' }, remaining: 10 },
        ]);

        await incompleteAckPage.clickButtonByText('Omitir por ahora');
        await waitForStudentCompletionScreen(incompleteAckPage, 'E2E-RES-05');

        const uiIncompleteText = await incompleteAckPage.eval(`document.body.innerText`);
        const displayedFalseSuccess = uiIncompleteText.includes('✓ PARTICIPACIÓN REGISTRADA') || uiIncompleteText.includes('Respuesta recibida en el servidor');
        const displayedPendingSync = uiIncompleteText.includes('EVALUACIÓN GUARDADA LOCALMENTE') || uiIncompleteText.includes('Pendiente de sincronización') || uiIncompleteText.includes('salvo');
        const sessionIncomplete = await incompleteAckPage.eval(`(() => {
          const raw = sessionStorage.getItem('edueval-student-session');
          return raw ? JSON.parse(raw) : null;
        })()`);

        await incompleteAckPage.eval(`(() => {
          localStorage.setItem('edueval-sync-queue', '[]');
          window.dispatchEvent(new CustomEvent('edueval-sync-changed'));
        })()`);

        record(
          'E2E-RES-05',
          'Acuse 200 incompleto sin attemptId: no fabrica identificador local como remoto ni confirma la entrega (DE-R1)',
          !displayedFalseSuccess && sessionIncomplete?.submissionStatus === 'pending_sync'
            ? 'PASA'
            : 'FALLA_PRODUCTO',
          {
            displayedFalseSuccess,
            displayedPendingSync,
            submissionStatus: sessionIncomplete?.submissionStatus,
          },
        );
      } finally {
        await clearFaultRules().catch(() => {});
        await incompleteAckPage.close().catch(() => {});
      }

      // -----------------------------------------------------------------------
      // 3F: E2E-RES-06 (R2-C) · Envío interrumpido real en pleno vuelo (delayMs: 2500 -> reload) sin fabricar attemptRecord
      // -----------------------------------------------------------------------
      const res06Page = await browserResStudent.newPage();
      try {
        await res06Page.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(res06Page);
        await res06Page.setInputValue('input[placeholder*="nombre"]', 'Estudiante Envio Interrumpido RES06');
        await res06Page.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await res06Page.clickButtonByText('Entrar a la sala');
        await res06Page.waitForText('Comprobar respuesta', 10000);

        const participantId06 = await res06Page.eval(`sessionStorage.getItem('edueval-student-participant-id') || ''`);
        const answeredType06 = await answerCurrentStudentActivityInDom(res06Page);
        const res06Meta = await res06Page.eval(`(() => {
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          return {
            occId06: Array.isArray(sess.occurrenceIds) ? sess.occurrenceIds[0] : null,
            actId06: Array.isArray(sess.questionIds) ? sess.questionIds[0] : null,
          };
        })()`);
        await advanceAfterAnswer(res06Page, 2, 13);
        await skipStudentQuestionsToLast(res06Page, 13);

        // Inyectar pausa real en submit_attempt para recargar en pleno vuelo antes de que responda la pasarela
        await setFaultRules([
          {
            method: 'POST',
            pathIncludes: '/functions/v1/student-room-guest',
            action: 'submit_attempt',
            delayMs: 2500,
            status: 500,
            body: { error: 'Interrupted mid-flight' },
            remaining: 5,
          },
        ]);
        await res06Page.clickButtonByText('Omitir por ahora');
        await sleep(350);

        const midFlightState = await res06Page.eval(`(() => {
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          return {
            submissionStatus: sess.submissionStatus || null,
            finished: Boolean(sess.finished),
            submitted: Boolean(sess.submitted),
            hasAttemptRecordFromApp: Boolean(sess.attemptRecord),
            uiSubmitting: (document.body.innerText || '').includes('Registrando respuestas…'),
          };
        })()`);
        const dbBefore06 = await pg.query(`SELECT count(*)::int AS cnt FROM public.attempts WHERE participant_id = $1`, [participantId06]);

        // Recargar en pleno vuelo antes de que la pasarela responda
        await res06Page.reload(900);
        await clearFaultRules();
        await dismissSplashIfPresent(res06Page);

        const throwRes06WaitDiag = async (stage, err) => {
          const domDiag = await res06Page.eval(`(() => {
            const s = JSON.parse(sessionStorage.getItem('edueval-student-session') || 'null');
            const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
            return {
              bodyText: (document.body?.innerText || '').slice(0, 700),
              buttons: Array.from(document.querySelectorAll('button')).map(b => ({ text: (b.innerText || '').trim(), disabled: b.disabled })),
              sess: s ? {
                finished: s.finished,
                submissionStatus: s.submissionStatus,
                serverAttemptId: s.serverAttemptId,
                playIndex: s.playIndex,
                hasAttemptRecord: Boolean(s.attemptRecord),
              } : null,
              queue: q.map(i => ({
                kind: i.kind,
                pid: i.payload?.participantId,
                attempts: i.attempts,
                nextRetryAt: i.nextRetryAt,
                lastError: i.lastError,
              })),
            };
          })()`);
          const guestCalls = res06Page.networkRecords
            .filter((r) => r.url.includes('student-room-guest'))
            .slice(-10)
            .map((r) => ({
              status: r.status,
              failed: Boolean(r.failed),
              action: (() => {
                try {
                  return JSON.parse(r.postData || '{}').action;
                } catch {
                  return null;
                }
              })(),
              response: (r.responseBody || '').slice(0, 200),
            }));
          throw new Error(
            `${err.message} | DIAG_RES06(${stage})=${JSON.stringify(redactSensitiveData({ ...domDiag, guestCalls }))}`,
          );
        };

        // Esperar que termine la restauración y si queda pending_sync, disparar reintento real
        try {
          await res06Page.waitFor(
            `document.body.innerText.includes('¡Terminaste!') || document.body.innerText.includes('Reintentar sincronización')`,
            12000,
          );
        } catch (waitErr) {
          await throwRes06WaitDiag('post_reload_restore', waitErr);
        }
        await res06Page.eval(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Reintentar sincronización') && !b.disabled);
          if (btn) btn.click();
        })()`);

        const dbAfter06 = await waitForDb(
          pg,
          `SELECT id::text AS id, answered_count, omitted_count, score::float AS score, status FROM public.attempts WHERE participant_id = $1`,
          [participantId06],
          (rows) => rows.length === 1,
          { timeoutMs: 12000, label: 'reconciliación tras envío interrumpido en pleno vuelo (E2E-RES-06)' },
        );
        const dbAnswers06 = await pg.query(
          `SELECT activity_id::text AS activity_id, occurrence_id::text AS occurrence_id, question_index, status, correct, score::float AS score, response
           FROM public.attempt_answers WHERE attempt_id = $1 AND status = 'answered'`,
          [dbAfter06[0].id],
        );
        try {
          await res06Page.waitFor(
            `document.body.innerText.includes('¡Terminaste!') && document.body.innerText.includes('Respuesta recibida en el servidor')`,
            10000,
          );
        } catch (waitErr) {
          await throwRes06WaitDiag('post_db_confirmed_ui', waitErr);
        }
        const sessAfter06 = await res06Page.eval(`JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}')`);
        const queueAfter06 = await res06Page.eval(`JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]')`);
        const answer06Exact =
          dbAnswers06.rows.length === 1 &&
          Boolean(res06Meta.occId06 && res06Meta.actId06) &&
          dbAnswers06.rows[0].occurrence_id === res06Meta.occId06 &&
          dbAnswers06.rows[0].activity_id === res06Meta.actId06 &&
          dbAnswers06.rows[0].correct === true &&
          dbAnswers06.rows[0].score === 10 &&
          dbAnswers06.rows[0].response?.type === answeredType06;

        record(
          'E2E-RES-06',
          'Envío interrumpido real en pleno vuelo (delayMs + reload antes de respuesta): reconstruye sobre durable, reconcilia y persiste 1 intento exacto en PostgreSQL (R2-C)',
          midFlightState.submissionStatus === 'submitting' &&
            midFlightState.hasAttemptRecordFromApp &&
            dbBefore06.rows[0].cnt === 0 &&
            dbAfter06.length === 1 &&
            dbAfter06[0].answered_count === 1 &&
            dbAfter06[0].score === 10 &&
            answer06Exact &&
            sessAfter06?.submissionStatus === 'confirmed' &&
            !queueAfter06.some((i) => i.payload?.participantId === participantId06)
            ? 'PASA'
            : 'FALLA_PRODUCTO',
          {
            participantId06,
            res06Meta,
            midFlightState,
            attemptsBeforeReload: dbBefore06.rows[0].cnt,
            persistedAttemptAfterReload: dbAfter06[0] || null,
            answeredOccurrence06: dbAnswers06.rows[0]?.occurrence_id ?? null,
            answeredActivity06: dbAnswers06.rows[0]?.activity_id ?? null,
            answeredCanonicalIndex06: dbAnswers06.rows[0]?.question_index ?? null,
            answer06Exact,
            submissionStatusAfterReload: sessAfter06?.submissionStatus || null,
          },
        );
      } finally {
        await clearFaultRules().catch(() => {});
        await res06Page.close().catch(() => {});
      }

      // -----------------------------------------------------------------------
      // 3G: E2E-RES-07 (R2-C) · Fallo durable en localStorage (QuotaExceededError) + recuperación en memoria
      // -----------------------------------------------------------------------
      const res07Page = await browserResStudent.newPage();
      try {
        await res07Page.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(res07Page);
        await res07Page.setInputValue('input[placeholder*="nombre"]', 'Estudiante QuotaExceeded RES07');
        await res07Page.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await res07Page.clickButtonByText('Entrar a la sala');
        await res07Page.waitForText('Comprobar respuesta', 10000);

        const participantId07 = await res07Page.eval(`sessionStorage.getItem('edueval-student-participant-id') || ''`);
        await answerCurrentStudentActivityInDom(res07Page);
        await advanceAfterAnswer(res07Page, 2, 13);
        await skipStudentQuestionsToLast(res07Page, 13);

        // Inyectar QuotaExceededError sobre edueval-sync-queue + fallo 500 en submit_attempt
        await res07Page.eval(`(() => {
          const origSetItem = Storage.prototype.setItem;
          window.__quotaFaultActive = true;
          Storage.prototype.setItem = function(key, val) {
            if (this === window.localStorage && key === 'edueval-sync-queue' && window.__quotaFaultActive) {
              const err = new DOMException('Simulated QuotaExceededError', 'QuotaExceededError');
              throw err;
            }
            return origSetItem.call(this, key, val);
          };
        })()`);
        await setFaultRules([
          { method: 'POST', pathIncludes: '/functions/v1/student-room-guest', action: 'submit_attempt', status: 500, body: { error: 'Simulated 500 during QuotaExceeded' }, remaining: 20 },
        ]);

        await res07Page.clickButtonByText('Omitir por ahora');
        await waitForStudentCompletionScreen(res07Page, 'E2E-RES-07');

        const uiDuringQuotaFault = await res07Page.eval(`document.body.innerText || ''`);
        const noFalseSafeClaim =
          !uiDuringQuotaFault.includes('Tus respuestas están a salvo') &&
          !uiDuringQuotaFault.includes('EVALUACIÓN GUARDADA LOCALMENTE') &&
          !uiDuringQuotaFault.includes('PARTICIPACIÓN REGISTRADA') &&
          !uiDuringQuotaFault.includes('Respuesta recibida en el servidor');
        const warnsAboutLocalStorageFailure =
          uiDuringQuotaFault.includes('RESPALDO AUTOMÁTICO NO DISPONIBLE') &&
          uiDuringQuotaFault.includes('No se pudo guardar el respaldo en el almacenamiento del navegador');
        const dbDuringQuota07 = await pg.query(`SELECT count(*)::int AS cnt FROM public.attempts WHERE participant_id = $1`, [participantId07]);

        // Limpiar fallos de red y QuotaExceededError y reintentar desde estado en memoria
        await clearFaultRules();
        await res07Page.eval(`(() => { window.__quotaFaultActive = false; })()`);
        await res07Page.eval(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Reintentar') && !b.disabled);
          if (btn) btn.click();
        })()`);

        const dbAfterRetry07 = await waitForDb(
          pg,
          `SELECT id::text AS id, answered_count, score::float AS score FROM public.attempts WHERE participant_id = $1`,
          [participantId07],
          (rows) => rows.length === 1,
          { timeoutMs: 12000, label: 'recuperación en PostgreSQL desde memoria tras QuotaExceededError (E2E-RES-07)' },
        );
        await res07Page.waitFor(
          `document.body.innerText.includes('¡Terminaste!') || document.body.innerText.includes('Respuesta recibida en el servidor')`,
          10000,
        );

        record(
          'E2E-RES-07',
          'Fallo durable en localStorage (QuotaExceededError): no afirma que respuestas están a salvo, advierte fallo local y recupera desde memoria al limpiar fallos (R2-C)',
          noFalseSafeClaim &&
            warnsAboutLocalStorageFailure &&
            dbDuringQuota07.rows[0].cnt === 0 &&
            dbAfterRetry07.length === 1 &&
            dbAfterRetry07[0].answered_count === 1 &&
            dbAfterRetry07[0].score === 10
            ? 'PASA'
            : 'FALLA_PRODUCTO',
          {
            participantId07,
            noFalseSafeClaim,
            warnsAboutLocalStorageFailure,
            attemptsDuringFault: dbDuringQuota07.rows[0].cnt,
            persistedAttemptAfterMemoryRetry: dbAfterRetry07[0] || null,
            uiSnippetDuringFault: uiDuringQuotaFault.slice(0, 450),
          },
        );
      } finally {
        await clearFaultRules().catch(() => {});
        await res07Page.close().catch(() => {});
      }

      // -----------------------------------------------------------------------
      // 3H: E2E-RES-08 (R2-C) · Rechazo terminal HTTP 401 (TOKEN_EXPIRED) en submit_attempt
      // -----------------------------------------------------------------------
      const res08Page = await browserResStudent.newPage();
      try {
        await res08Page.goto(`${appUrl}/?panel=student`, 600);
        await dismissSplashIfPresent(res08Page);
        await res08Page.setInputValue('input[placeholder*="nombre"]', 'Estudiante Rechazo 401 RES08');
        await res08Page.setInputValue('input[placeholder*="EDU-"]', mainRoom.code);
        await res08Page.clickButtonByText('Entrar a la sala');
        await res08Page.waitForText('Comprobar respuesta', 10000);

        const participantId08 = await res08Page.eval(`sessionStorage.getItem('edueval-student-participant-id') || ''`);
        await answerCurrentStudentActivityInDom(res08Page);
        await advanceAfterAnswer(res08Page, 2, 13);
        await skipStudentQuestionsToLast(res08Page, 13);

        await setFaultRules([
          {
            method: 'POST',
            pathIncludes: '/functions/v1/student-room-guest',
            action: 'submit_attempt',
            status: 401,
            body: { error: 'Tu sesión estudiantil expiró.', code: 'TOKEN_EXPIRED' },
            remaining: 10,
          },
        ]);
        await res08Page.clickButtonByText('Omitir por ahora');
        await waitForStudentCompletionScreen(res08Page, 'E2E-RES-08');

        const rejectedCheck08 = await res08Page.eval(`((pid) => {
          const text = document.body.innerText || '';
          const sess = JSON.parse(sessionStorage.getItem('edueval-student-session') || '{}');
          const q = JSON.parse(localStorage.getItem('edueval-sync-queue') || '[]');
          const btns = Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim());
          const hasHtmlDownloadBtn = btns.some(t => t.includes('Descargar Respaldo Local No Confirmado (.html)'));
          const hasTxtDownloadBtn = btns.some(t => t.includes('Descargar respaldo local no confirmado (.txt)'));
          const hasRetryBtn = btns.some(t => t.includes('Reintentar sincronización'));
          const hasRejectedBanner =
            text.includes('ENTREGA NO CONFIRMADA') &&
            text.includes('Entrega rechazada por el servidor (no confirmada)');
          const hasVoucherBox = Boolean(document.querySelector('.completion-voucher-box'));
          return {
            submissionStatus: sess.submissionStatus || null,
            hasRejectedBanner,
            noFalseConfirmedOrPending: !text.includes('¡Terminaste!') && !text.includes('PARTICIPACIÓN REGISTRADA') && !text.includes('Pendiente de sincronización remota'),
            hasHtmlDownloadBtn,
            hasTxtDownloadBtn,
            hasVoucherBox,
            retryButtonHidden: !hasRetryBtn,
            removedFromRetryQueue: !q.some(i => i.payload?.participantId === pid),
          };
        })(${JSON.stringify(participantId08)})`);

        // Verificar que NO entra en bucle de polling durante >3.2s
        const guestCallsBeforeWait = res08Page.networkRecords.filter((r) => r.url.includes('/functions/v1/student-room-guest')).length;
        await sleep(3200);
        const guestCallsAfterWait = res08Page.networkRecords.filter((r) => r.url.includes('/functions/v1/student-room-guest')).length;
        const noPollingLoop = guestCallsAfterWait === guestCallsBeforeWait;

        record(
          'E2E-RES-08',
          'Rechazo terminal HTTP 401 (TOKEN_EXPIRED) en submit_attempt: estado rejected, descarga .html/.txt preservada, cola limpia, sin botón de reintento ni bucle de polling (R2-C)',
          rejectedCheck08.submissionStatus === 'rejected' &&
            rejectedCheck08.hasRejectedBanner &&
            rejectedCheck08.noFalseConfirmedOrPending &&
            rejectedCheck08.hasHtmlDownloadBtn &&
            rejectedCheck08.hasTxtDownloadBtn &&
            rejectedCheck08.hasVoucherBox &&
            rejectedCheck08.retryButtonHidden &&
            rejectedCheck08.removedFromRetryQueue &&
            noPollingLoop
            ? 'PASA'
            : 'FALLA_PRODUCTO',
          {
            participantId08,
            ...rejectedCheck08,
            guestCallsBeforeWait,
            guestCallsAfterWait,
            noPollingLoop,
          },
        );
      } finally {
        await clearFaultRules().catch(() => {});
        await res08Page.close().catch(() => {});
      }
    } finally {
      await browserResStudent.close();
    }

    // =========================================================================
    // FLUJO 4: Regresiones de cliente en Chromium (390x844, Día/Noche, Impresión HTML RC-EV-03, SaaS/CSV/PWA RC-EV-01)
    // =========================================================================
    // 4A: Viewport móvil 390x844 y modo Día/Noche
    await studentPage.setViewport(390, 844, true);
    const mobileOverflowStudent = await studentPage.eval(
      `document.documentElement.scrollWidth > window.innerWidth + 2`,
    );
    await studentPage.setViewport(1280, 800, false);

    const themeCheck = await teacherPage.eval(`(() => {
      const root = document.documentElement;
      root.setAttribute('data-theme', 'light');
      const lightPaper = getComputedStyle(root).getPropertyValue('--paper').trim();
      root.setAttribute('data-theme', 'dark');
      const darkPaper = getComputedStyle(root).getPropertyValue('--paper').trim();
      root.setAttribute('data-theme', 'light');
      return { lightPaper, darkPaper, distinct: Boolean(lightPaper && darkPaper && lightPaper !== darkPaper) };
    })()`);

    record(
      'E2E-CLI-01',
      'Responsividad móvil (390x844) sin desborde horizontal y variables CSS en modo Día y Noche',
      !mobileOverflowStudent && themeCheck.distinct ? 'PASA' : 'FALLA_PRODUCTO',
      {
        mobileOverflowStudent,
        themeCheck,
      },
    );

    // 4B (RC-EV-03): Comprobación del documento HTML imprimible (srcdoc de generateExamHtmlDocument) anclado a la sala del fixture de 13 actividades
    await teacherPage.clickButtonByText('Salas');
    await sleep(400);
    const clickedFixtureRoomPrint = await teacherPage.eval(`((roomCode) => {
      const cards = Array.from(document.querySelectorAll('article.room-card'));
      const targetCard = cards.find(
        c => (c.innerText || '').includes(roomCode) || (c.innerText || '').includes('Sala Integrada 13 Tipos RC')
      );
      if (!targetCard) return false;
      const openBtn = Array.from(targetCard.querySelectorAll('button')).find(
        b => (b.innerText || '').includes('Examen en blanco')
      );
      if (!openBtn) return false;
      openBtn.click();
      return true;
    })(${JSON.stringify(mainRoom.code)})`);

    await teacherPage.waitForSelector('iframe.exam-preview-frame[title="Vista previa de examen"]', 8000);
    await sleep(400);

    const printHtmlAudit = await teacherPage.eval(`(() => {
      const iframe = document.querySelector('iframe.exam-preview-frame[title="Vista previa de examen"]');
      const srcdoc = iframe ? iframe.getAttribute('srcdoc') || '' : '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(srcdoc, 'text/html');
      const cards = Array.from(doc.querySelectorAll('article.question-card')).map(card => ({
        num: card.querySelector('.q-num')?.textContent?.trim() || '',
        typeLabel: card.querySelector('.q-type')?.textContent?.trim() || '',
        title: card.querySelector('.q-title')?.textContent?.trim() || '',
        prompt: card.querySelector('.q-prompt')?.textContent?.trim() || '',
        answerBlockHtmlLength: (card.querySelector('.answer-block')?.innerHTML || '').trim().length,
      }));
      const closeBtn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Cerrar vista previa'));
      if (closeBtn) closeBtn.click();
      return {
        artifactInspected: 'HTML imprimible en iframe[title="Vista previa de examen"].srcdoc (no PDF renderizado)',
        examTitle: doc.querySelector('.exam-title')?.textContent?.trim() || '',
        metaLine: doc.querySelector('.exam-meta-line')?.textContent?.trim() || '',
        scenarioExcludedForPaperNotice: (doc.querySelector('.exam-meta-line')?.textContent || '').includes('omitida(s) para papel'),
        totalQuestionCardsInHtml: cards.length,
        cardsWithRenderedBodyCount: cards.filter(c => c.answerBlockHtmlLength > 0).length,
        cardsWithRenderedBodyTypes: cards.filter(c => c.answerBlockHtmlLength > 0).map(c => c.typeLabel),
        cardsWithEmptyAnswerBlockCount: cards.filter(c => c.answerBlockHtmlLength === 0).length,
        cardsWithEmptyAnswerBlock: cards.filter(c => c.answerBlockHtmlLength === 0).map(c => ({
          typeLabel: c.typeLabel,
          title: c.title,
          answerBlockHtmlLength: c.answerBlockHtmlLength,
        })),
        hasMultiSelectOptionsInPrint: srcdoc.includes('NADH') && srcdoc.includes('FADH2'),
        hasFillBlanksTextInPrint: srcdoc.includes('hidrólisis de') && srcdoc.includes('mitocondria'),
        hasSpotErrorSegmentsInPrint: srcdoc.includes('difusión simple mueve solutos'),
        hasMarkWordsTextInPrint: srcdoc.includes('célula vegetal posee'),
        hasGridCheckMatrixInPrint: srcdoc.includes('Matriz mitocondrial'),
      };
    })()`);
    const pdfPath = path.join(RC_CONFIG.evidenciasDir, 'examen_en_blanco_carta_fg.pdf');
    let pdfBytesLength = 0;
    let pdfHeader = '';
    try {
      const examSrcDoc = await teacherPage.eval(`(() => {
        const iframe = document.querySelector('iframe.exam-preview-frame[title="Vista previa de examen"]');
        return iframe ? iframe.getAttribute('srcdoc') || iframe.srcdoc || '' : '';
      })()`);
      if (examSrcDoc && examSrcDoc.length > 500) {
        const pdfPage = await browserMain.newPage();
        await pdfPage.goto(`data:text/html;charset=utf-8,${encodeURIComponent(examSrcDoc)}`, 1500);
        await sleep(400);
        const pdfPrintResult = await pdfPage.send('Page.printToPDF', {
          paperWidth: 8.5,
          paperHeight: 11.0,
          marginTop: 0.47,
          marginBottom: 0.47,
          marginLeft: 0.47,
          marginRight: 0.47,
          printBackground: true,
          preferCSSPageSize: true,
        });
        if (pdfPrintResult?.data) {
          const buffer = Buffer.from(pdfPrintResult.data, 'base64');
          pdfBytesLength = buffer.length;
          pdfHeader = buffer.slice(0, 8).toString('utf8');
          fs.writeFileSync(pdfPath, buffer);
        }
        await pdfPage.close();
      }
    } catch (e) {
      console.warn('Advertencia generando PDF Carta:', e.message);
    }
    await sleep(300);

    record(
      'E2E-CLI-02',
      'Comprobación del HTML imprimible (srcdoc) en Examen en Blanco sobre la sala del fixture de 13 tipos (G-UNI-P1-03)',
      clickedFixtureRoomPrint &&
        printHtmlAudit.examTitle.includes('Sala Integrada 13 Tipos RC') &&
        (printHtmlAudit.totalQuestionCardsInHtml === 13 || printHtmlAudit.totalQuestionCardsInHtml === 12) &&
        printHtmlAudit.cardsWithEmptyAnswerBlockCount === 0 &&
        printHtmlAudit.hasMultiSelectOptionsInPrint &&
        printHtmlAudit.hasFillBlanksTextInPrint &&
        printHtmlAudit.hasSpotErrorSegmentsInPrint &&
        printHtmlAudit.hasMarkWordsTextInPrint &&
        printHtmlAudit.hasGridCheckMatrixInPrint
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        defectId: 'G-UNI-P1-03',
        anchoredToFixtureRoomCode: mainRoom.code,
        clickedFixtureRoomPrint,
        ...printHtmlAudit,
        cause:
          'En el HTML imprimible (srcdoc de generateExamHtmlDocument) para la Sala Integrada 13 Tipos RC, 1 actividad interactiva (scenario) se excluye explícitamente para papel y se generan 12 tarjetas <article class="question-card">: 7 tipos renderizan su cuerpo en .answer-block, pero 5 tipos (multiSelect, fillBlanks, spotError, markWords y gridCheck) dejan <div class="answer-block"></div> vacío (answerBlockHtmlLength=0).',
      },
    );

    // 4C (RC-EV-01): Separación de E2E-CLI-03 en pruebas observables individuales sin literal false
    // 4C.1 -> E2E-CLI-03A: Persistencia de alta de institución en vista Superadmin SaaS (G-SAAS-01)
    const browserAdmin = new CdpBrowser(RC_CONFIG.ports.chromiumDebug + 5, 'admin_super');
    await browserAdmin.launch();
    try {
      const adminPage = await browserAdmin.newPage();
      await adminPage.goto(`${appUrl}/?panel=admin`, 600);
      await dismissSplashIfPresent(adminPage);
      await adminPage.waitForSelector('input[type="email"]', 8000);
      await adminPage.setInputValue('input[type="email"]', users.adminDirector.email);
      await adminPage.setInputValue('input[type="password"]', users.adminDirector.password);
      await adminPage.clickButtonByText('Ingresar con contraseña');
      await sleep(1200);

      const adminPlatformCalled = adminPage.networkRecords.some(
        (r) => r.url.includes('/functions/v1/admin-platform-data') && r.status === 200,
      );

      // Cambiar a vista Superadmin ("Administración general") y registrar una institución nueva
      await adminPage.clickButtonByText('Administración general');
      await sleep(400);

      await adminPage.clickButtonByText('Registrar institución');
      await sleep(300);
      await adminPage.setInputValue('input[placeholder*="Unidad Educativa"]', 'Colegio Fantasma SaaS RC');
      await adminPage.setInputValue('input[placeholder*="COL-SAN-SIMON"]', 'COL-FANTASMA-RC');
      await adminPage.setInputValue('.institution-register-modal input[type="number"]', '45');
      await adminPage.setInputValue('input[placeholder*="Roberto Valdez"]', 'Director Prueba RC');
      await adminPage.setInputValue('input[placeholder*="director@"]', 'dir@fantasma.synthetic.local');
      const netCountBeforeSaaS = adminPage.networkRecords.length;
      await adminPage.eval(`(() => {
        const submitBtn = document.querySelector('.institution-register-modal button[type="submit"]');
        if (submitBtn) submitBtn.click();
      })()`);
      await sleep(500);

      const netRequestsDuringSaaSCreate = adminPage.networkRecords
        .slice(netCountBeforeSaaS)
        .filter((r) => r.url.includes('/rest/v1/') || r.url.includes('/functions/v1/'));
      const visibleInFirstAdminSession = await adminPage.eval(
        `document.body.innerText.includes('Colegio Fantasma SaaS RC') && (localStorage.getItem('edueval-institutions') || '').includes('COL-FANTASMA-RC')`,
      );

      // Simular segunda sesión limpia borrando únicamente la caché local de instituciones y recargando
      await adminPage.eval(`localStorage.removeItem('edueval-institutions')`);
      await adminPage.reload(900);
      await dismissSplashIfPresent(adminPage);
      await sleep(600);
      await adminPage.clickButtonByText('Administración general').catch(() => {});
      await sleep(400);
      const persistedInCleanAdminSession = await adminPage.eval(
        `document.body.innerText.includes('Colegio Fantasma SaaS RC')`,
      );
      await adminPage.close();

      record(
        'E2E-CLI-03A',
        'Persistencia en nube de alta y cupos de institución en vista Superadmin SaaS entre sesiones limpias (G-SAAS-01)',
        adminPlatformCalled &&
          visibleInFirstAdminSession &&
          netRequestsDuringSaaSCreate.length > 0 &&
          persistedInCleanAdminSession
          ? 'PASA'
          : 'FALLA_PRODUCTO',
        {
          defectId: 'G-SAAS-01',
          adminPlatformDataCloudOk: adminPlatformCalled,
          visibleInFirstSessionAfterCreate: visibleInFirstAdminSession,
          networkRequestsDuringInstitutionCreate: netRequestsDuringSaaSCreate.length,
          persistedInSecondCleanSession: persistedInCleanAdminSession,
          cause:
            'addInstitution en src/App.tsx (~711-731) guarda la nueva institución únicamente en el estado React y localStorage ("edueval-institutions"), emitiendo 0 peticiones de red y perdiendo el registro al abrir otra sesión limpia.',
        },
      );
    } finally {
      await browserAdmin.close();
    }

    // 4C.2 -> E2E-CLI-03B: Neutralización de fórmulas peligrosas (=, +, -, @) al descargar el Blob CSV en Resultados docentes (G-CSV-01)
    // Recargar teacherPage para hidratar los intentos desde PostgreSQL (incluyendo '=SUM(1,1) Estudiante Omite Todas')
    await teacherPage.reload(1000);
    await dismissSplashIfPresent(teacherPage);
    await teacherPage.waitForText('Resultados', 10000);
    await teacherPage.clickButtonByText('Resultados');
    await sleep(800);

    await teacherPage.eval(`(() => {
      window.__capturedCsvBlobs = [];
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function(blob) {
        if (blob && blob.type && blob.type.includes('text/csv')) {
          blob.text().then(t => window.__capturedCsvBlobs.push(t));
        }
        return origCreate(blob);
      };
    })()`);
    await teacherPage.waitFor(`Boolean(Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Exportar todas a CSV') && !b.disabled))`, 15000);
    await teacherPage.clickButtonByText('Exportar todas a CSV');
    await sleep(400);

    const capturedCsvText = await teacherPage.eval(`window.__capturedCsvBlobs?.[0] || ''`);
    const hasRawFormulaCell = capturedCsvText.includes(';"=SUM(1,1) Estudiante Omite Todas";');
    const hasNeutralizedFormulaCell =
      capturedCsvText.includes(';"\'=SUM(1,1) Estudiante Omite Todas";') ||
      capturedCsvText.includes(';"\\t=SUM(1,1) Estudiante Omite Todas";');

    record(
      'E2E-CLI-03B',
      'Neutralización de prefijos de fórmula (=, +, -, @) en el archivo CSV exportado desde Resultados docentes (G-CSV-01)',
      capturedCsvText.length > 0 && !hasRawFormulaCell && hasNeutralizedFormulaCell
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        defectId: 'G-CSV-01',
        csvBlobCapturedLength: capturedCsvText.length,
        hasRawFormulaCellInExportedCsv: hasRawFormulaCell,
        hasNeutralizedFormulaCellInExportedCsv: hasNeutralizedFormulaCell,
        sampleFormulaSnippet:
          capturedCsvText
            .split('\n')
            .find((line) => line.includes('=SUM(1,1)'))
            ?.slice(0, 140) || '',
        cause:
          'exportCsv en src/App.tsx (~1698-1710) escapa comillas dobles pero no prefija con comilla simple (\') ni tabulador las celdas que inician con =, +, - o @, emitiendo ;"=SUM(1,1) Estudiante Omite Todas"; directamente en el Blob CSV.',
      },
    );

    // 4C.3 -> E2E-CLI-03C: Verificación observable del Service Worker (/sw.js VERSION='evaluedu-shell-v12') y manifest PWA
    const pwaCheck = await teacherPage.eval(`(async () => {
      const swRes = await fetch('/sw.js');
      const swSource = await swRes.text();
      const mfRes = await fetch('/manifest.webmanifest');
      const mfText = await mfRes.text();
      const versionMatch = swSource.match(/const\\s+VERSION\\s*=\\s*['"]([^'"]+)['"]/);
      const regs = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
      return {
        swHttpStatus: swRes.status,
        swVersionConstant: versionMatch ? versionMatch[1] : null,
        manifestHttpStatus: mfRes.status,
        manifestValidJson: (() => { try { return Boolean(JSON.parse(mfText).name); } catch { return false; } })(),
        activeRegistrationsCount: regs.length,
      };
    })()`);
    const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

    record(
      'E2E-CLI-03C',
      'Disponibilidad y registro de Service Worker (/sw.js con VERSION="evaluedu-shell-v12") y manifiesto PWA',
      pwaCheck.swHttpStatus === 200 &&
        pwaCheck.swVersionConstant === 'evaluedu-shell-v12' &&
        pwaCheck.manifestHttpStatus === 200 &&
        pwaCheck.manifestValidJson
        ? 'PASA'
        : 'FALLA_PRODUCTO',
      {
        ...pwaCheck,
        editorialObservationsNotCountedAsFailure: {
          packageJsonVersion: pkgJson.version,
          uiDisplayedVersion: 'v1.3',
          swVersionConstant: pwaCheck.swVersionConstant,
          note:
            'La diferencia editorial entre package.json ("0.1.0"), la etiqueta visual ("v1.3") y const VERSION = "evaluedu-shell-v12" en public/sw.js (G-UNI-P1-01), así como la ausencia de precaché de fuentes externas (G-UNI-P2-04), se registran como hallazgos estáticos/editoriales y no como fallo funcional de caché.',
        },
      },
    );
  } finally {
    await clearFaultRules().catch(() => {});
    await browserMain.close();
    await pg.close();
  }

  const outPath = path.join(RC_CONFIG.evidenciasDir, 'ui_e2e_chromium_results.json');
  fs.writeFileSync(outPath, JSON.stringify({ suite: 'ui_e2e_chromium', results }, null, 2));
  return results;
}
