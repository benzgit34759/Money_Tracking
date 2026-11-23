'use strict';
/* Batch slip import: group images by account/type/category, OCR amount + date offline, review, save. Uses globals from app.js. */

const SL = { groups: [], seq: 0, worker: null, workerP: null, queue: [], busy: false, status: '' };

/* ---------- OCR engine (Tesseract.js, all files served locally) ---------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src, onload: res, onerror: () => rej(new Error('โหลด ' + src + ' ไม่ได้')) });
    document.head.appendChild(s);
  });
}
function getWorker() {
  if (SL.workerP) return SL.workerP;
  SL.workerP = (async () => {
    if (!window.Tesseract) await loadScript('vendor/tesseract/tesseract.min.js');
    const abs = (p) => new URL(p, location.href).href;
    setSlipStatus('กำลังเตรียมตัวอ่านสลิป (ครั้งแรกอาจใช้เวลาสักครู่)…');
    const w = await Tesseract.createWorker(['tha', 'eng'], 1, {
      workerPath: abs('vendor/tesseract/worker.min.js'),
      corePath: abs('vendor/tesseract/core'),
      langPath: abs('vendor/tesseract/lang'),
      gzip: true,
    });
    SL.worker = w;
    setSlipStatus('');
    return w;
  })().catch((e) => { SL.workerP = null; setSlipStatus('เตรียมตัวอ่านสลิปไม่สำเร็จ: ' + e.message); throw e; });
  return SL.workerP;
}
function setSlipStatus(msg) { SL.status = msg; const el = $('#slipStatus'); if (el) el.textContent = msg; }

async function fileHash(file) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `f:${file.name}:${file.size}:${file.lastModified}`;
  }
}

async function pumpQueue() {
  if (SL.busy) return;
  SL.busy = true;
  try {
    while (SL.queue.length) {
      const it = SL.queue.shift();
      if (!findItem(it.id)) continue; // removed meanwhile
      it.status = 'reading';
      updateItem(it);
      try {
        const w = await getWorker();
        const { data } = await w.recognize(it.file);
        const r = SlipParse.parse(data.text);
        it.ocrText = r.text;
        if (r.amount != null && it.amount === '') it.amount = String(r.amount);
        if (r.date && !it.dateTouched) { it.date = r.date; it.dateSrc = 'slip'; }
        it.status = r.amount != null ? 'done' : 'noamount';
      } catch (e) {
        it.status = 'error';
        it.error = e.message;
      }
      checkDup(it);
      updateItem(it);
      updateSlipFooter();
    }
  } finally {
    SL.busy = false;
  }
}

/* ---------- model helpers ---------- */
function newGroup() {
  const last = SL.groups[SL.groups.length - 1];
  const account = last?.account || S.meta.lastAccount || activeAccounts()[0]?.name || '';
  const mode = last?.mode || 'expense';
  return { id: ++SL.seq, account, mode, category: catsFor(mode, account)[0] || '', items: [] };
}
function findItem(id) { for (const g of SL.groups) { const it = g.items.find((x) => x.id === id); if (it) return it; } return null; }
function groupOf(it) { return SL.groups.find((g) => g.items.includes(it)); }

function checkDup(it) {
  const g = groupOf(it);
  if (!g) return;
  const amt = evalAmount(it.amount);
  const sameFile = S.tx.find((t) => t.slipHash && t.slipHash === it.hash) ||
    SL.groups.some((gg) => gg.items.some((x) => x !== it && x.hash === it.hash && x.id < it.id));
  const signedAmt = g.mode === 'expense' ? -amt : amt;
  const similar = !sameFile && amt > 0 && S.tx.find((t) => t.account === g.account && t.date === it.date && r2(t.amount) === r2(signedAmt));
  const prev = it.dup;
  it.dup = sameFile ? 'same' : similar ? 'similar' : '';
  if (it.dup && it.dup !== prev && !it.includeTouched) it.include = false;
  if (!it.dup && prev && !it.includeTouched) it.include = true;
}

async function addFiles(group, files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const it = {
      id: ++SL.seq, file, url: URL.createObjectURL(file), hash: await fileHash(file),
      amount: '', date: isoDate(new Date(file.lastModified || Date.now())), dateSrc: 'file',
      note: '', include: true, status: 'queued', dup: '',
    };
    group.items.push(it);
    checkDup(it);
    SL.queue.push(it);
  }
  renderSlipGroups();
  pumpQueue();
}

/* ---------- view ---------- */
function renderSlip(v) {
  if (!SL.groups.length) SL.groups.push(newGroup());
  v.innerHTML = `
    <p class="muted small" style="margin:0 4px 10px">แบ่งภาพสลิปเป็นกลุ่มตามบัญชีและหมวด แอปจะอ่าน <b>ยอดเงิน</b> และ <b>วันที่</b> จากสลิปให้ (ในเครื่อง ไม่ต้องต่อเน็ต) ตรวจ/แก้ แล้วกดบันทึกครั้งเดียว</p>
    <div id="slipStatus" class="muted small" style="margin:0 4px 8px">${esc(SL.status)}</div>
    <div id="slipGroups"></div>
    <button class="btn" style="width:100%;margin-top:10px" data-slip="add-group">+ เพิ่มกลุ่ม (บัญชี/หมวดอื่น)</button>
    <div class="slip-footer card" id="slipFooter"></div>`;
  renderSlipGroups();
  getWorker().catch(() => {}); // warm up while the user picks images
}

function accOptions(sel) {
  return activeAccounts().map((a) => `<option ${a.name === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

function renderSlipGroups() {
  const host = $('#slipGroups');
  if (!host) return;
  host.innerHTML = SL.groups.map((g, gi) => {
    const cats = catsFor(g.mode, g.account);
    if (g.category && !cats.includes(g.category)) cats.unshift(g.category);
    return `<div class="card slip-group" data-gid="${g.id}">
      <div class="row" style="justify-content:space-between"><b>กลุ่ม ${gi + 1}</b>
        ${SL.groups.length > 1 ? `<button class="btn sm" data-slip="del-group">ลบกลุ่ม</button>` : ''}</div>
      <div class="slip-head">
        <select data-gf="account">${accOptions(g.account)}</select>
        <div class="seg"><button data-gmode="expense" class="${g.mode === 'expense' ? 'on' : ''}">รายจ่าย</button><button data-gmode="income" class="${g.mode === 'income' ? 'on' : ''}">รายรับ</button></div>
        <select data-gf="category">${cats.map((c) => `<option value="${esc(c)}" ${c === g.category ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')}</select>
      </div>
      <ul class="list slip-items">${g.items.map(itemHtml).join('')}</ul>
      <label class="btn primary slip-pick">+ เลือกภาพสลิป<input type="file" accept="image/*" multiple hidden data-gfiles></label>
    </div>`;
  }).join('');
  updateSlipFooter();
}

const STATUS_TXT = { queued: 'รออ่าน…', reading: 'กำลังอ่าน…', done: '', noamount: 'อ่านยอดไม่ได้ — กรอกเอง', error: 'อ่านไม่สำเร็จ — กรอกเอง' };
function itemHtml(it) {
  const warn = it.dup === 'same' ? 'สลิปนี้เคยบันทึกแล้ว' : it.dup === 'similar' ? 'มีรายการยอดและวันเดียวกันอยู่แล้ว — อาจซ้ำ' : '';
  return `<li class="slip-item ${it.include ? '' : 'off'}" data-iid="${it.id}">
    <img src="${it.url}" alt="สลิป" data-slip="zoom">
    <div class="slip-fields">
      <div class="row">
        <input class="slip-amt" data-if="amount" inputmode="decimal" placeholder="ยอดเงิน" value="${esc(it.amount)}">
        <input type="date" data-if="date" value="${it.date}">
      </div>
      <div class="row">
        <input data-if="note" placeholder="โน้ต (ไม่บังคับ)" value="${esc(it.note)}">
        <label class="check" style="margin:0;flex:none"><input type="checkbox" data-if="include" ${it.include ? 'checked' : ''}> ลง</label>
        <button class="btn sm" data-slip="del-item" aria-label="เอาออก" style="flex:none">✕</button>
      </div>
      <div class="small"><span class="muted">${STATUS_TXT[it.status] || ''}${it.status === 'done' || it.status === 'noamount' ? (it.dateSrc === 'file' ? ' วันที่จากไฟล์ภาพ ตรวจอีกครั้ง' : '') : ''}</span>
        ${warn ? `<span class="warn-txt">${warn}</span>` : ''}</div>
    </div>
  </li>`;
}

function updateItem(it) {
  const el = $(`[data-iid="${it.id}"]`);
  if (!el) return;
  const focused = el.contains(document.activeElement);
  if (focused) { // don't clobber what the user is typing; refresh only the status line
    const tmp = document.createElement('ul');
    tmp.innerHTML = itemHtml(it);
    el.querySelector('.small').replaceWith(tmp.querySelector('.small'));
    el.classList.toggle('off', !it.include);
    return;
  }
  el.outerHTML = itemHtml(it);
}

function readyItems() {
  const out = [];
  for (const g of SL.groups) for (const it of g.items) {
    const a = evalAmount(it.amount);
    if (it.include && a > 0 && it.date && g.account && g.category) out.push({ g, it, a });
  }
  return out;
}

function updateSlipFooter() {
  const f = $('#slipFooter');
  if (!f) return;
  const all = SL.groups.reduce((n, g) => n + g.items.length, 0);
  const pending = SL.groups.reduce((n, g) => n + g.items.filter((x) => x.status === 'queued' || x.status === 'reading').length, 0);
  const ready = readyItems();
  const total = ready.reduce((s, r) => s + (r.g.mode === 'expense' ? -r.a : r.a), 0);
  f.innerHTML = `<div class="grow small">${all ? `${ready.length}/${all} รายการพร้อมบันทึก${pending ? ` · กำลังอ่าน ${pending}` : ''}<br><b class="${total < 0 ? 'neg' : 'pos'}">${signed(total)}</b>` : '<span class="muted">ยังไม่มีภาพ</span>'}</div>
    <button class="btn primary" data-slip="save" ${ready.length ? '' : 'disabled'}>บันทึก ${ready.length || ''} รายการ</button>`;
  f.classList.toggle('hidden', !all);
}

async function saveSlips() {
  const ready = readyItems();
  if (!ready.length) return;
  const add = ready.map(({ g, it, a }) => ({
    id: nextId(), note: it.note.trim(), amount: g.mode === 'expense' ? -a : a, category: g.category,
    account: g.account, date: it.date, exclude: false, slipHash: it.hash,
  }));
  await saveTx(add);
  const saved = new Set(ready.map((r) => r.it));
  for (const g of SL.groups) {
    g.items.filter((x) => saved.has(x)).forEach((x) => URL.revokeObjectURL(x.url));
    g.items = g.items.filter((x) => !saved.has(x));
  }
  setMeta('lastAccount', ready[0].g.account);
  toast(`บันทึก ${add.length} รายการแล้ว`);
  const left = SL.groups.reduce((n, g) => n + g.items.length, 0);
  if (!left) { SL.groups = []; go('home'); } else render();
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-slip],[data-gmode]');
  if (!el || !$('#slipGroups')) return;
  const gEl = el.closest('[data-gid]');
  const g = gEl && SL.groups.find((x) => x.id === +gEl.dataset.gid);
  const iEl = el.closest('[data-iid]');
  const it = iEl && findItem(+iEl.dataset.iid);
  if (el.dataset.gmode && g) {
    g.mode = el.dataset.gmode;
    g.category = catsFor(g.mode, g.account)[0] || '';
    g.items.forEach(checkDup);
    return renderSlipGroups();
  }
  switch (el.dataset.slip) {
    case 'add-group': SL.groups.push(newGroup()); return renderSlipGroups();
    case 'del-group':
      if (g.items.length && !confirm('ลบกลุ่มนี้พร้อมภาพทั้งหมด?')) return;
      g.items.forEach((x) => URL.revokeObjectURL(x.url));
      SL.groups = SL.groups.filter((x) => x !== g);
      return renderSlipGroups();
    case 'del-item':
      URL.revokeObjectURL(it.url);
      g.items = g.items.filter((x) => x !== it);
      return renderSlipGroups();
    case 'zoom':
      return openModal(`<img src="${it.url}" style="width:100%;border-radius:10px" alt="สลิป">
        ${it.ocrText ? `<details class="small muted" style="margin-top:8px"><summary>ข้อความที่อ่านได้</summary><pre style="white-space:pre-wrap">${esc(it.ocrText)}</pre></details>` : ''}
        <div class="btns"><button class="btn" data-act="close">ปิด</button></div>`);
    case 'save': return saveSlips();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!$('#slipGroups') || !t.closest('#slipGroups')) return;
  const gEl = t.closest('[data-gid]');
  const g = gEl && SL.groups.find((x) => x.id === +gEl.dataset.gid);
  if (!g) return;
  if (t.matches('[data-gfiles]')) { const files = [...t.files]; t.value = ''; return addFiles(g, files); }
  if (t.dataset.gf === 'account') { g.account = t.value; g.category = catsFor(g.mode, g.account)[0] || g.category; g.items.forEach(checkDup); return renderSlipGroups(); }
  if (t.dataset.gf === 'category') { g.category = t.value; return updateSlipFooter(); }
  const iEl = t.closest('[data-iid]');
  const it = iEl && findItem(+iEl.dataset.iid);
  if (!it || !t.dataset.if) return;
  if (t.dataset.if === 'include') { it.include = t.checked; it.includeTouched = true; iEl.classList.toggle('off', !it.include); }
  else {
    it[t.dataset.if] = t.value;
    if (t.dataset.if === 'date') { it.dateTouched = true; it.dateSrc = 'user'; }
    if (t.dataset.if !== 'note') { checkDup(it); updateItem(it); }
  }
  updateSlipFooter();
});

document.addEventListener('input', (e) => {
  if (e.target.closest && e.target.closest('#slipGroups') && e.target.dataset.if) {
    const it = findItem(+e.target.closest('[data-iid]').dataset.iid);
    if (it && e.target.dataset.if !== 'include') { it[e.target.dataset.if] = e.target.value; updateSlipFooter(); }
  }
});
