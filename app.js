'use strict';
/* กระเป๋าเงิน — offline money tracker (data model mirrors the Money Lover CSV export). */

/* ================= utils ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const curYM = () => today().slice(0, 7);
const addMonths = (ym, n) => {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
};
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d); };
const ymLabel = (ym) => { const [y, m] = ym.split('-'); return `${TH_M[+m - 1]} ${y.slice(2)}`; };
const dateLabel = (d) => { const [y, m, dd] = d.split('-'); return `${+dd} ${TH_M[+m - 1]} ${y}`; };
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => r2(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money0 = (n) => Math.round(n).toLocaleString('th-TH');
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));
const compact = (n) => (Math.abs(n) >= 1000 ? r2(n / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + 'k' : money0(n));

function evalAmount(s) {
  s = String(s).replace(/[,\s฿]/g, '');
  if (!s || !/^[\d.+\-]+$/.test(s)) return NaN;
  let total = 0;
  for (const m of s.matchAll(/([+-]?)([\d.]+)/g)) {
    const n = parseFloat(m[2]);
    if (isNaN(n)) return NaN;
    total += m[1] === '-' ? -n : n;
  }
  return r2(total);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================= constants ================= */
const T_OUT = 'Outgoing transfer';
const T_IN = 'Incoming transfer';
const C_OPEN = 'ยอดยกมา';
const C_ADJ = 'ปรับยอด';
const SPECIAL = new Set([T_OUT, T_IN, C_OPEN, C_ADJ]);
const isTransfer = (t) => t.category === T_OUT || t.category === T_IN;
/** Counts toward income/expense reports (same rule as Money Lover's "Exclude Report"). */
const reportable = (t) => !t.exclude && !SPECIAL.has(t.category);

/* ================= IndexedDB ================= */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('moneyapp', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('tx', { keyPath: 'id' });
        d.createObjectStore('accounts', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  run(stores, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(stores, 'readwrite');
      fn(t);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  getAll(store) {
    return new Promise((res, rej) => {
      const r = this.db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  put(store, objs) {
    objs = [].concat(objs);
    return this.run([store], (t) => { const s = t.objectStore(store); objs.forEach((o) => s.put(o)); });
  },
  del(store, keys) {
    keys = [].concat(keys);
    return this.run([store], (t) => { const s = t.objectStore(store); keys.forEach((k) => s.delete(k)); });
  },
  replaceAll(tx, accounts, meta) {
    return this.run(['tx', 'accounts', 'meta'], (t) => {
      ['tx', 'accounts', 'meta'].forEach((n) => t.objectStore(n).clear());
      tx.forEach((o) => t.objectStore('tx').put(o));
      accounts.forEach((o) => t.objectStore('accounts').put(o));
      Object.entries(meta).forEach(([key, value]) => t.objectStore('meta').put({ key, value }));
    });
  },
};

/* ================= state ================= */
const S = {
  tx: [],
  accounts: [],
  meta: {},
  maxId: 0,
  view: 'home',
  txMonth: curYM(),
  txAcc: '',
  txSearch: '',
  anAcc: '',
  anMetric: 'expense',
  anRange: 12,
  anMonth: curYM(),
};

async function loadState() {
  S.tx = await DB.getAll('tx');
  S.accounts = (await DB.getAll('accounts')).sort((a, b) => a.order - b.order);
  S.meta = {};
  (await DB.getAll('meta')).forEach((m) => (S.meta[m.key] = m.value));
  if (!S.meta.categories) S.meta.categories = [];
  S.maxId = S.tx.reduce((m, t) => Math.max(m, t.id), 0);
}
const setMeta = (k, v) => { S.meta[k] = v; return DB.put('meta', { key: k, value: v }); };
const nextId = () => ++S.maxId;
const activeAccounts = () => S.accounts.filter((a) => !a.archived);
const accountByName = (n) => S.accounts.find((a) => a.name === n);

async function saveTx(add = [], removeIds = []) {
  if (removeIds.length) {
    const rm = new Set(removeIds);
    S.tx = S.tx.filter((t) => !rm.has(t.id));
    await DB.del('tx', removeIds);
  }
  if (add.length) {
    const ids = new Set(add.map((t) => t.id));
    S.tx = S.tx.filter((t) => !ids.has(t.id)).concat(add);
    await DB.put('tx', add);
  }
}

/* ================= derived data ================= */
function balances() {
  const b = {};
  for (const t of S.tx) b[t.account] = (b[t.account] || 0) + Math.round(t.amount * 100);
  for (const k in b) b[k] /= 100;
  return b;
}

/** Map ym -> total (positive number) for 'expense' or 'income'. */
function monthly(metric, acc) {
  const m = {};
  for (const t of S.tx) {
    if (!reportable(t) || (acc && t.account !== acc)) continue;
    if (metric === 'expense' ? t.amount >= 0 : t.amount <= 0) continue;
    const ym = t.date.slice(0, 7);
    m[ym] = (m[ym] || 0) + Math.abs(t.amount);
  }
  return m;
}
/** Map account -> ym -> expense. */
function expenseByAccount() {
  const r = {};
  for (const t of S.tx) {
    if (!reportable(t) || t.amount >= 0) continue;
    const ym = t.date.slice(0, 7);
    (r[t.account] ||= {})[ym] = (r[t.account][ym] || 0) - t.amount;
  }
  return r;
}
const lastComplete = (n) => Array.from({ length: n }, (_, i) => addMonths(curYM(), -(i + 1)));
const avgOf = (m, months) => months.reduce((s, ym) => s + (m[ym] || 0), 0) / months.length;
const suggestBudget = (v) => (v > 0 ? Math.ceil(v / 500) * 500 : 0);

function categoryTypes() {
  const map = {};
  for (const c of S.meta.categories) map[c.name] = c.type;
  return map;
}
function catsFor(type, account) {
  const freq = {};
  for (const t of S.tx) if (!account || t.account === account) freq[t.category] = (freq[t.category] || 0) + 1;
  return S.meta.categories
    .filter((c) => c.type === type && !SPECIAL.has(c.name))
    .map((c) => c.name)
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0) || a.localeCompare(b));
}

/* ================= CSV import / export ================= */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0]);
}

const dmyToIso = (s) => { const [d, m, y] = s.trim().split('/'); return `${y}-${pad(+m)}-${pad(+d)}`; };
const isoToDmy = (s) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

/** Link the two rows of each transfer (Send to X / Received from Y) with a shared transferId. */
function pairTransfers(tx) {
  const ins = {};
  for (const t of tx) if (t.category === T_IN) (ins[`${t.date}|${t.amount}`] ||= []).push(t);
  let n = 0;
  const outs = tx.filter((t) => t.category === T_OUT);
  const link = (o, i) => { o.transferId = i.transferId = `tr${++n}`; };
  // pass 1: names match
  for (const o of outs) {
    const target = (o.note || '').replace(/^Send to /, '').trim();
    const c = (ins[`${o.date}|${-o.amount}`] || []).find((i) => !i.transferId && i.account !== o.account &&
      target && i.account.startsWith(target) && o.account.startsWith((i.note || '').replace(/^Received from /, '').trim()));
    if (c) link(o, c);
  }
  // pass 2: same date + amount, exactly one candidate
  for (const o of outs) {
    if (o.transferId) continue;
    const c = (ins[`${o.date}|${-o.amount}`] || []).filter((i) => !i.transferId && i.account !== o.account);
    if (c.length === 1) link(o, c[0]);
  }
  return n;
}

async function importMoneyLoverCSV(text) {
  const rows = parseCSV(text);
  const head = rows.shift().map((h) => h.trim());
  const col = (n) => head.indexOf(n);
  const need = ['Note', 'Amount', 'Category', 'Account', 'Date'];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error('ไม่พบคอลัมน์: ' + missing.join(', '));

  const tx = [];
  let id = 0;
  for (const r of rows) {
    const amount = parseFloat(r[col('Amount')]);
    if (isNaN(amount)) continue;
    tx.push({
      id: ++id,
      note: (r[col('Note')] || '').trim(),
      amount: r2(amount),
      category: (r[col('Category')] || '').trim(),
      account: (r[col('Account')] || '').trim(),
      date: dmyToIso(r[col('Date')]),
      exclude: col('Exclude Report') >= 0 && /^true$/i.test((r[col('Exclude Report')] || '').trim()),
    });
  }
  const paired = pairTransfers(tx);

  // accounts ordered by usage
  const cnt = {};
  tx.forEach((t) => (cnt[t.account] = (cnt[t.account] || 0) + 1));
  const accounts = Object.keys(cnt)
    .sort((a, b) => cnt[b] - cnt[a])
    .map((name, i) => ({ id: i + 1, name, budget: 0, archived: false, order: i }));

  // category types by majority sign
  const sign = {};
  tx.forEach((t) => { const s = (sign[t.category] ||= { neg: 0, pos: 0 }); t.amount < 0 ? s.neg++ : s.pos++; });
  const categories = Object.entries(sign)
    .filter(([n]) => !SPECIAL.has(n))
    .map(([name, s]) => ({ name, type: s.neg >= s.pos ? 'expense' : 'income' }));

  const meta = { categories, importedAt: new Date().toISOString() };
  await DB.replaceAll(tx, accounts, meta);
  await loadState();
  return { count: tx.length, accounts: accounts.length, paired };
}

function exportCSV() {
  const q = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const sorted = [...S.tx].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const lines = ['ID,Note,Amount,Category,Account,Currency,Date,Event,Exclude Report'];
  sorted.forEach((t, i) => {
    lines.push([i + 1, q(t.note || ''), t.amount, q(t.category), q(t.account), 'THB', isoToDmy(t.date), '', t.exclude ? 'True' : 'False'].join(','));
  });
  download(`MoneyApp-export-${today()}.csv`, '﻿' + lines.join('\n') + '\n', 'text/csv;charset=utf-8');
}

function exportBackup() {
  const data = { app: 'moneyapp', version: 1, exportedAt: new Date().toISOString(), tx: S.tx, accounts: S.accounts, meta: S.meta };
  download(`MoneyApp-backup-${today()}.json`, JSON.stringify(data), 'application/json');
  setMeta('lastBackup', new Date().toISOString());
}

async function restoreBackup(text) {
  const d = JSON.parse(text);
  if (d.app !== 'moneyapp' || !Array.isArray(d.tx)) throw new Error('ไฟล์ไม่ใช่ backup ของแอปนี้');
  await DB.replaceAll(d.tx, d.accounts || [], d.meta || {});
  await loadState();
}

/* ================= modal ================= */
function openModal(html, mount) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  mount && mount($('.sheet', m));
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

/* ================= views ================= */
const TITLES = { home: 'ภาพรวม', tx: 'รายการ', an: 'วิเคราะห์รายจ่าย', set: 'ตั้งค่า', slip: 'แนบสลิป' };

function render() {
  $('#title').textContent = TITLES[S.view];
  $$('.tabs [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  const v = $('#view');
  if (!S.accounts.length && S.view !== 'set') { v.innerHTML = emptyView(); return; }
  ({ home: renderHome, tx: renderTx, an: renderAnalysis, set: renderSettings, slip: renderSlip })[S.view](v);
}

function go(view, opts = {}) {
  Object.assign(S, opts);
  S.view = view;
  render();
  window.scrollTo(0, 0);
}

function emptyView() {
  return `<div class="card empty">
    <div class="big">👛</div>
    <h2>เริ่มต้นใช้งาน</h2>
    <p class="muted">นำเข้าไฟล์ CSV ที่ export จาก Money Lover เพื่อย้ายรายการเดิมทั้งหมดมา<br>หรือเริ่มใหม่โดยสร้างบัญชีเอง</p>
    <div class="btns" style="max-width:360px;margin:18px auto 0">
      <button class="btn primary" data-act="import-csv">นำเข้า CSV จาก Money Lover</button>
      <button class="btn" data-act="new-account">สร้างบัญชีเอง</button>
    </div>
  </div>`;
}

function txItem(t, showAccount = true) {
  const sub = [t.note, showAccount ? t.account : ''].filter(Boolean).join(' · ');
  return `<li data-tx="${t.id}" class="row">
    <div class="grow"><div class="title">${esc(t.category)}${t.exclude && !isTransfer(t) ? '<span class="badge">ไม่นับรายงาน</span>' : ''}</div>
    <div class="sub">${esc(sub) || '&nbsp;'}</div></div>
    <div class="amt ${t.amount < 0 ? 'neg' : 'pos'}">${signed(t.amount)}</div>
  </li>`;
}

/* ---------- home ---------- */
function renderHome(v) {
  const bal = balances();
  const accs = activeAccounts();
  const total = accs.reduce((s, a) => s + (bal[a.name] || 0), 0);
  const ym = curYM();
  const spent = {};
  for (const t of S.tx) if (reportable(t) && t.amount < 0 && t.date.startsWith(ym)) spent[t.account] = (spent[t.account] || 0) - t.amount;
  const recent = [...S.tx].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 8);

  v.innerHTML = `
    <div class="card hero">
      <div class="muted small">ยอดรวมทุกบัญชี</div>
      <div class="big num">฿${money(total)}</div>
      <div class="muted small">รายจ่ายเดือนนี้ (${ymLabel(ym)}) ฿${money0(Object.values(spent).reduce((a, b) => a + b, 0))}</div>
    </div>
    <button class="btn primary" style="width:100%;margin-top:10px" data-view="slip">📎 แนบสลิปหลายภาพ</button>
    <h3>บัญชี</h3>
    <ul class="card list">${accs.map((a) => {
      const b = bal[a.name] || 0, sp = spent[a.name] || 0;
      let prog = '';
      if (a.budget > 0) {
        const p = sp / a.budget;
        prog = `<div class="progress ${p > 1 ? 'over' : p > 0.85 ? 'near' : ''}"><i style="width:${Math.min(100, p * 100)}%"></i></div>
          <div class="sub">ใช้ไป ${money0(sp)} / งบ ${money0(a.budget)}</div>`;
      } else if (sp) prog = `<div class="sub">ใช้ไปเดือนนี้ ${money0(sp)}</div>`;
      return `<li data-goacc="${esc(a.name)}"><div class="row"><div class="grow title">${esc(a.name)}</div>
        <div class="amt ${b < 0 ? 'neg' : ''}">${money(b)}</div></div>${prog}</li>`;
    }).join('')}</ul>
    <h3>รายการล่าสุด</h3>
    <ul class="card list">${recent.map((t) => txItem(t)).join('') || '<li class="muted">ยังไม่มีรายการ</li>'}</ul>`;
}

/* ---------- transactions ---------- */
function renderTx(v) {
  v.innerHTML = `
    <div class="toolbar">
      <div class="monthnav">
        <button class="btn icon" data-act="tx-prev" aria-label="เดือนก่อน">‹</button>
        <b>${ymLabel(S.txMonth)}</b>
        <button class="btn icon" data-act="tx-next" aria-label="เดือนถัดไป">›</button>
      </div>
      <select id="txAcc"><option value="">ทุกบัญชี</option>${S.accounts.map((a) => `<option ${a.name === S.txAcc ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <input id="txSearch" type="search" placeholder="ค้นหาโน้ต/หมวด (ทุกเดือน)" value="${esc(S.txSearch)}">
    </div>
    <div id="txSum"></div>
    <div id="txList"></div>`;
  $('#txAcc').onchange = (e) => { S.txAcc = e.target.value; fillTxList(); };
  $('#txSearch').oninput = (e) => { S.txSearch = e.target.value; fillTxList(); };
  fillTxList();
}

function fillTxList() {
  const q = S.txSearch.trim().toLowerCase();
  let list = S.tx.filter((t) => (!S.txAcc || t.account === S.txAcc) &&
    (q ? `${t.note} ${t.category} ${t.account} ${t.amount}`.toLowerCase().includes(q) : t.date.startsWith(S.txMonth)));
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const inc = list.filter((t) => reportable(t) && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const exp = list.filter((t) => reportable(t) && t.amount < 0).reduce((s, t) => s - t.amount, 0);
  $('#txSum').innerHTML = `<div class="stats" style="margin-bottom:10px">
    <div class="card stat"><div class="k">รายรับ</div><div class="v pos">${money0(inc)}</div></div>
    <div class="card stat"><div class="k">รายจ่าย</div><div class="v neg">${money0(exp)}</div></div>
    <div class="card stat"><div class="k">${q ? 'ผลค้นหา' : 'จำนวนรายการ'}</div><div class="v">${list.length.toLocaleString()}</div></div></div>`;
  const LIMIT = 400;
  const shown = list.slice(0, LIMIT);
  let html = '', day = '';
  for (const t of shown) {
    if (t.date !== day) {
      if (day) html += '</ul>';
      day = t.date;
      const dsum = shown.filter((x) => x.date === day && reportable(x)).reduce((s, x) => s + x.amount, 0);
      html += `<div class="day-h"><span>${dateLabel(day)}</span><span class="num">${dsum ? signed(dsum) : ''}</span></div><ul class="list">`;
    }
    html += txItem(t, !S.txAcc);
  }
  if (day) html += '</ul>';
  $('#txList').innerHTML = shown.length
    ? `<div class="card" style="overflow:hidden">${html}</div>${list.length > LIMIT ? `<p class="muted small" style="text-align:center">แสดง ${LIMIT} จาก ${list.length} รายการ — พิมพ์คำค้นให้เจาะจงขึ้น</p>` : ''}`
    : '<div class="card pad muted" style="text-align:center">ไม่มีรายการ</div>';
}

/* ---------- add / edit form ---------- */
function openForm(t) {
  const st = {
    mode: 'expense', account: S.meta.lastAccount && accountByName(S.meta.lastAccount) ? S.meta.lastAccount : activeAccounts()[0]?.name || '',
    to: '', amount: '', date: today(), note: '', category: '', exclude: false, editing: [],
  };
  if (t) {
    if (t.transferId) {
      const pair = S.tx.filter((x) => x.transferId === t.transferId);
      const o = pair.find((x) => x.amount < 0) || t, i = pair.find((x) => x.amount > 0);
      Object.assign(st, { mode: 'transfer', account: o.account, to: i ? i.account : '', amount: Math.abs(t.amount), date: t.date, editing: pair });
    } else {
      Object.assign(st, { mode: t.amount < 0 ? 'expense' : 'income', account: t.account, amount: Math.abs(t.amount), date: t.date, note: t.note, category: t.category, exclude: t.exclude, editing: [t] });
    }
  }
  const accOpts = (sel) => S.accounts.filter((a) => !a.archived || a.name === sel)
    .map((a) => `<option ${a.name === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');

  openModal(`
    <h2>${t ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}</h2>
    <div class="seg" id="fMode">
      <button data-m="expense">รายจ่าย</button><button data-m="income">รายรับ</button><button data-m="transfer">โอน</button>
    </div>
    <label class="f"><span>จำนวนเงิน (พิมพ์ 120+35 ได้)</span><input id="fAmt" class="amount-in" inputmode="decimal" autocomplete="off" value="${st.amount}"></label>
    <label class="f"><span id="fAccL">บัญชี</span><select id="fAcc">${accOpts(st.account)}</select></label>
    <label class="f" id="fToRow"><span>โอนไปบัญชี</span><select id="fTo"><option value="">— เลือก —</option>${accOpts(st.to)}</select></label>
    <label class="f" id="fCatRow"><span>หมวด</span><select id="fCat"></select></label>
    <label class="f"><span>วันที่</span><input id="fDate" type="date" value="${st.date}"></label>
    <label class="f" id="fNoteRow"><span>โน้ต (เช่น ชื่อร้าน)</span><input id="fNote" list="fNotes" autocomplete="off" value="${esc(st.note)}"><datalist id="fNotes"></datalist></label>
    <label class="check" id="fExRow"><input type="checkbox" id="fEx" ${st.exclude ? 'checked' : ''}> ไม่นับในรายงาน</label>
    <div class="btns">
      ${t ? '<button class="btn danger" id="fDel">ลบ</button>' : ''}
      <button class="btn" data-act="close">ยกเลิก</button>
      <button class="btn primary" id="fSave">บันทึก</button>
    </div>`, (m) => {
    const fillCats = () => {
      const cats = catsFor(st.mode, $('#fAcc', m).value);
      if (st.category && !cats.includes(st.category)) cats.unshift(st.category);
      $('#fCat', m).innerHTML = cats.map((c) => `<option ${c === st.category ? 'selected' : ''}>${esc(c)}</option>`).join('') + '<option value="__new">+ เพิ่มหมวดใหม่…</option>';
      if (!st.category) st.category = $('#fCat', m).value;
    };
    const fillNotes = () => {
      const acc = $('#fAcc', m).value, freq = {};
      for (const x of S.tx) if (x.account === acc && x.note && !isTransfer(x)) freq[x.note] = (freq[x.note] || 0) + 1;
      $('#fNotes', m).innerHTML = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 80).map((n) => `<option value="${esc(n)}">`).join('');
    };
    const setMode = (mode) => {
      st.mode = mode;
      $$('#fMode button', m).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
      const tr = mode === 'transfer';
      $('#fToRow', m).classList.toggle('hidden', !tr);
      $('#fCatRow', m).classList.toggle('hidden', tr);
      $('#fNoteRow', m).classList.toggle('hidden', tr);
      $('#fExRow', m).classList.toggle('hidden', tr);
      $('#fAccL', m).textContent = tr ? 'จากบัญชี' : 'บัญชี';
      if (!tr) { if (!catsFor(mode).includes(st.category) && !SPECIAL.has(st.category)) st.category = ''; fillCats(); }
    };
    $$('#fMode button', m).forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
    $('#fAcc', m).onchange = () => { fillCats(); fillNotes(); };
    $('#fCat', m).onchange = (e) => {
      if (e.target.value === '__new') {
        const name = (prompt('ชื่อหมวดใหม่') || '').trim();
        if (name && !S.meta.categories.some((c) => c.name === name)) setMeta('categories', [...S.meta.categories, { name, type: st.mode }]);
        st.category = name || st.category;
        fillCats();
      } else st.category = e.target.value;
    };
    // Suggest the usual category for a known note in this account.
    $('#fNote', m).onchange = (e) => {
      const note = e.target.value.trim(), acc = $('#fAcc', m).value, freq = {};
      const allowed = new Set(catsFor(st.mode));
      for (const x of S.tx) if (x.note === note && x.account === acc && allowed.has(x.category)) freq[x.category] = (freq[x.category] || 0) + 1;
      const best = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
      if (best) { st.category = best; fillCats(); }
    };
    $('#fSave', m).onclick = () => saveForm(st, m);
    if (t) $('#fDel', m).onclick = async () => {
      if (!confirm(st.editing.length > 1 ? 'ลบรายการโอนนี้ (ทั้งสองฝั่ง)?' : 'ลบรายการนี้?')) return;
      await saveTx([], st.editing.map((x) => x.id));
      closeModal(); toast('ลบแล้ว'); render();
    };
    setMode(st.mode);
    fillNotes();
    if (!t) setTimeout(() => $('#fAmt', m).focus(), 50);
  });
}

async function saveForm(st, m) {
  const amt = evalAmount($('#fAmt', m).value);
  if (!(amt > 0)) { toast('กรุณาใส่จำนวนเงินที่มากกว่า 0'); return; }
  const account = $('#fAcc', m).value;
  const date = $('#fDate', m).value || today();
  if (!account) { toast('กรุณาเลือกบัญชี'); return; }
  const removeIds = st.editing.map((x) => x.id);
  let add;
  if (st.mode === 'transfer') {
    const to = $('#fTo', m).value;
    if (!to || to === account) { toast('กรุณาเลือกบัญชีปลายทางที่ต่างจากต้นทาง'); return; }
    const transferId = st.editing[0]?.transferId || `tr${Date.now()}`;
    const strip = (n) => n.replace(/\s*\(.*\)\s*$/, '');
    add = [
      { id: nextId(), note: `Send to ${strip(to)}`, amount: -amt, category: T_OUT, account, date, exclude: true, transferId },
      { id: nextId(), note: `Received from ${strip(account)}`, amount: amt, category: T_IN, account: to, date, exclude: true, transferId },
    ];
  } else {
    const category = $('#fCat', m).value;
    if (!category || category === '__new') { toast('กรุณาเลือกหมวด'); return; }
    const old = st.editing[0];
    add = [{
      id: old ? old.id : nextId(), note: $('#fNote', m).value.trim(),
      amount: st.mode === 'expense' ? -amt : amt, category, account, date, exclude: $('#fEx', m).checked,
    }];
    // keep the reused id; drop any other row (e.g. the other half of a former transfer)
    removeIds.splice(0, removeIds.length, ...st.editing.slice(1).map((x) => x.id));
  }
  await saveTx(add, removeIds);
  setMeta('lastAccount', account);
  closeModal();
  toast('บันทึกแล้ว');
  render();
}

/* ---------- analysis ---------- */
function barChart(months, vals, { avg, budget, sel }) {
  const W = 640, H = 230, pl = 40, pr = 8, pt = 14, pb = 26;
  const max = Math.max(...vals, avg || 0, budget || 0, 1) * 1.12;
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const bw = (W - pl - pr) / months.length;
  const cur = curYM();
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  months.forEach((ym, i) => {
    const x = pl + i * bw + bw * 0.14, h = Math.max(0, y(0) - y(vals[i]));
    const cls = ym === sel ? 'bar sel' : ym === cur ? 'bar cur' : 'bar';
    g += `<rect class="${cls}" data-ym="${ym}" x="${x}" y="${y(0) - h}" width="${bw * 0.72}" height="${h}" rx="3"><title>${ymLabel(ym)}: ${money0(vals[i])}</title></rect>`;
    g += `<rect data-ym="${ym}" x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" fill="transparent" style="cursor:pointer"/>`;
    const [yy, mm] = ym.split('-');
    g += `<text x="${pl + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${TH_M[+mm - 1]}${mm === '01' || i === 0 ? yy.slice(2) : ''}</text>`;
  });
  if (avg) g += `<line class="avg" x1="${pl}" x2="${W - pr}" y1="${y(avg)}" y2="${y(avg)}"/>`;
  if (budget) g += `<line class="bud" x1="${pl}" x2="${W - pr}" y1="${y(budget)}" y2="${y(budget)}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟรายเดือน">${g}</svg>`;
}

function renderAnalysis(v) {
  const acc = S.anAcc, metric = S.anMetric, a = accountByName(acc);
  const m = monthly(metric, acc);
  const cur = curYM();
  const months = Array.from({ length: S.anRange }, (_, i) => addMonths(cur, i - S.anRange + 1));
  const vals = months.map((ym) => m[ym] || 0);
  const l3 = lastComplete(3), l6 = lastComplete(6);
  const avg3 = avgOf(m, l3), avg6 = avgOf(m, l6);
  const budget = metric === 'expense' && a ? a.budget : 0;
  const sugg = suggestBudget(avg3);
  if (!months.includes(S.anMonth)) S.anMonth = cur;

  // category breakdown: selected month vs avg of 3 months before current month
  const catSel = {}, cat3 = {};
  const l3set = new Set(l3);
  for (const t of S.tx) {
    if (!reportable(t) || (acc && t.account !== acc)) continue;
    if (metric === 'expense' ? t.amount >= 0 : t.amount <= 0) continue;
    const ym = t.date.slice(0, 7), v2 = Math.abs(t.amount);
    if (ym === S.anMonth) catSel[t.category] = (catSel[t.category] || 0) + v2;
    if (l3set.has(ym)) cat3[t.category] = (cat3[t.category] || 0) + v2 / 3;
  }
  const cats = [...new Set([...Object.keys(catSel), ...Object.keys(cat3)])].sort((x, y) => (catSel[y] || 0) - (catSel[x] || 0) || (cat3[y] || 0) - (cat3[x] || 0));
  const word = metric === 'expense' ? 'รายจ่าย' : 'รายรับ';

  v.innerHTML = `
    <div class="toolbar">
      <select id="anAcc"><option value="">ทุกบัญชี</option>${S.accounts.map((x) => `<option ${x.name === acc ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div class="seg" style="flex:1 1 160px"><button data-metric="expense" class="${metric === 'expense' ? 'on' : ''}">รายจ่าย</button><button data-metric="income" class="${metric === 'income' ? 'on' : ''}">รายรับ</button></div>
      <div class="seg" style="flex:0 1 150px"><button data-range="6" class="${S.anRange === 6 ? 'on' : ''}">6 ด.</button><button data-range="12" class="${S.anRange === 12 ? 'on' : ''}">12 ด.</button><button data-range="24" class="${S.anRange === 24 ? 'on' : ''}">24 ด.</button></div>
    </div>
    <div class="stats">
      <div class="card stat"><div class="k">${word}เดือนนี้ (${ymLabel(cur)})</div><div class="v">${money0(m[cur] || 0)}</div></div>
      <div class="card stat"><div class="k">เฉลี่ย 3 เดือน (${ymLabel(l3[2])}–${ymLabel(l3[0])})</div><div class="v">${money0(avg3)}</div></div>
      <div class="card stat"><div class="k">เฉลี่ย 6 เดือน</div><div class="v">${money0(avg6)}</div></div>
      ${metric === 'expense' && a ? `
      <div class="card stat"><div class="k">งบต่อเดือนปัจจุบัน</div><div class="v">${budget ? money0(budget) : '—'}</div></div>
      <div class="card stat hl"><div class="k">งบที่แนะนำ (จากเฉลี่ย 3 ด.)</div><div class="v">${money0(sugg)}</div>
        ${sugg && sugg !== budget ? `<button class="btn sm primary" style="margin-top:6px" data-setbudget="${esc(a.name)}" data-val="${sugg}">ตั้งเป็นงบ</button>` : ''}</div>` : ''}
    </div>
    <h3>${word}รายเดือน${acc ? ' · ' + esc(acc) : ' · ทุกบัญชี'}</h3>
    <div class="card" style="padding:10px 6px 0">${barChart(months, vals, { avg: avg3, budget, sel: S.anMonth })}
      <div class="legend"><span><i style="background:var(--warn)"></i>เฉลี่ย 3 เดือน</span>${budget ? '<span><i style="background:var(--neg)"></i>งบ</span>' : ''}<span>แตะแท่งเพื่อดูแยกหมวด</span></div>
    </div>
    <h3>แยกตามหมวด · ${ymLabel(S.anMonth)} เทียบเฉลี่ย 3 เดือน</h3>
    <div class="card tbl-wrap"><table>
      <tr><th>หมวด</th><th>${ymLabel(S.anMonth)}</th><th>เฉลี่ย 3 ด.</th><th>ต่าง</th></tr>
      ${cats.map((c) => {
        const s = catSel[c] || 0, av = cat3[c] || 0, d = s - av;
        return `<tr class="clickable" data-catsearch="${esc(c)}"><td>${esc(c)}</td><td class="num">${money0(s)}</td><td class="num muted">${money0(av)}</td>
          <td class="num ${metric === 'expense' ? (d > 0 ? 'neg' : 'pos') : (d > 0 ? 'pos' : 'neg')}">${Math.round(d) ? signed(Math.round(d)) : '0'}</td></tr>`;
      }).join('') || '<tr><td colspan="4" class="muted">ไม่มีข้อมูล</td></tr>'}
    </table></div>
    ${metric === 'expense' ? budgetTable() : ''}`;

  $('#anAcc').onchange = (e) => { S.anAcc = e.target.value; render(); };
  $$('[data-metric]', v).forEach((b) => (b.onclick = () => { S.anMetric = b.dataset.metric; render(); }));
  $$('[data-range]', v).forEach((b) => (b.onclick = () => { S.anRange = +b.dataset.range; render(); }));
  $$('svg [data-ym]', v).forEach((b) => (b.onclick = () => { S.anMonth = b.dataset.ym; render(); }));
}

function budgetTable() {
  const by = expenseByAccount();
  const cur = curYM(), l3 = lastComplete(3), l6 = lastComplete(6);
  const rows = activeAccounts().map((a) => {
    const m = by[a.name] || {};
    return { a, now: m[cur] || 0, avg3: avgOf(m, l3), avg6: avgOf(m, l6) };
  }).filter((r) => r.avg6 > 0 || r.a.budget > 0 || r.now > 0);
  return `<h3>งบรายเดือนทุกบัญชี</h3>
  <div class="card tbl-wrap"><table>
    <tr><th>บัญชี</th><th>เดือนนี้</th><th>เฉลี่ย 3 ด.</th><th>เฉลี่ย 6 ด.</th><th>งบ</th><th>แนะนำ</th></tr>
    ${rows.map(({ a, now, avg3, avg6 }) => {
      const s = suggestBudget(avg3);
      const over = a.budget && now > a.budget;
      return `<tr><td class="clickable" data-anacc="${esc(a.name)}">${esc(a.name)}</td>
        <td class="num ${over ? 'neg' : ''}">${money0(now)}</td><td class="num">${money0(avg3)}</td><td class="num muted">${money0(avg6)}</td>
        <td class="num"><button class="btn sm" data-editbudget="${esc(a.name)}">${a.budget ? money0(a.budget) : 'ตั้ง'}</button></td>
        <td class="num">${s && s !== a.budget ? `<button class="btn sm primary" data-setbudget="${esc(a.name)}" data-val="${s}">${money0(s)}</button>` : '<span class="muted">✓</span>'}</td></tr>`;
    }).join('')}
  </table></div>
  <p class="muted small">งบแนะนำ = ค่าเฉลี่ย 3 เดือนที่ครบเดือนล่าสุด ปัดขึ้นทีละ 500 บาท · ไม่นับรายการโอนและรายการที่ตั้ง "ไม่นับในรายงาน"</p>`;
}

async function setBudget(name, val) {
  const a = accountByName(name);
  if (!a) return;
  a.budget = Math.max(0, Math.round(val) || 0);
  await DB.put('accounts', a);
  toast(`ตั้งงบ ${name} = ${money0(a.budget)} บาท/เดือน`);
  render();
}

/* ---------- settings ---------- */
function renderSettings(v) {
  const bal = balances();
  const dates = S.tx.map((t) => t.date).sort();
  const lb = S.meta.lastBackup;
  v.innerHTML = `
    <h3>บัญชี / กระเป๋าเงิน</h3>
    <ul class="card list">
      ${S.accounts.map((a) => `<li data-editacc="${a.id}" class="row"><div class="grow"><div class="title">${esc(a.name)}${a.archived ? '<span class="badge">ซ่อน</span>' : ''}</div>
        <div class="sub">งบ/เดือน: ${a.budget ? money0(a.budget) : '—'}</div></div><div class="amt ${bal[a.name] < 0 ? 'neg' : ''}">${money(bal[a.name] || 0)}</div></li>`).join('')}
      <li data-act="new-account" style="color:var(--brand);font-weight:500">+ เพิ่มบัญชี</li>
    </ul>
    <h3>ยอดคงเหลือ</h3>
    <ul class="card list">
      <li data-act="reconcile-adjust"><div class="title">ปรับยอดให้ตรงกับปัจจุบัน</div><div class="sub">กรอกยอดจริงของแต่ละบัญชี ระบบจะบันทึกส่วนต่างเป็นรายการ "ปรับยอด" วันนี้</div></li>
      <li data-act="reconcile-open"><div class="title">แก้ยอดยกมา</div><div class="sub">ปรับยอดตั้งต้นก่อนรายการแรก (ไม่กระทบรายงาน)</div></li>
    </ul>
    <h3>ข้อมูล</h3>
    <ul class="card list">
      <li data-act="import-csv"><div class="title">นำเข้า CSV จาก Money Lover</div><div class="sub">แทนที่ข้อมูลทั้งหมดในแอปนี้</div></li>
      <li data-act="export-csv"><div class="title">Export CSV (รูปแบบ Money Lover)</div><div class="sub">เปิดใน Excel ได้</div></li>
      <li data-act="backup"><div class="title">สำรองข้อมูล (Backup)</div><div class="sub">${lb ? 'ล่าสุด ' + dateLabel(lb.slice(0, 10)) : 'ยังไม่เคยสำรอง — ข้อมูลอยู่ในเครื่องนี้เท่านั้น ควรสำรองเป็นประจำ'}</div></li>
      <li data-act="restore"><div class="title">กู้คืนจาก Backup</div><div class="sub">แทนที่ข้อมูลทั้งหมดในแอปนี้</div></li>
      <li data-act="wipe" style="color:var(--neg)"><div class="title">ลบข้อมูลทั้งหมด</div></li>
    </ul>
    <p class="muted small" style="margin:14px 4px">${S.tx.length.toLocaleString()} รายการ${dates.length ? ` · ${dateLabel(dates[0])} – ${dateLabel(dates[dates.length - 1])}` : ''} · <span id="persist"></span></p>`;
  if (navigator.storage?.persisted) navigator.storage.persisted().then((p) => { const el = $('#persist'); if (el) el.textContent = p ? 'พื้นที่เก็บข้อมูลถาวร ✓' : 'พื้นที่เก็บข้อมูลอาจถูกล้างได้ — โปรดสำรองข้อมูล'; });
}

function openAccountForm(a) {
  const bal = a ? balances()[a.name] || 0 : 0;
  openModal(`
    <h2>${a ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'}</h2>
    <label class="f"><span>ชื่อบัญชี</span><input id="aName" value="${esc(a?.name || '')}"></label>
    ${a ? '' : '<label class="f"><span>ยอดเงินเริ่มต้น</span><input id="aBal" inputmode="decimal" value="0"></label>'}
    <label class="f"><span>งบรายจ่ายต่อเดือน (0 = ไม่ตั้ง)</span><input id="aBud" inputmode="numeric" value="${a?.budget || 0}"></label>
    ${a ? `<label class="check"><input type="checkbox" id="aArc" ${a.archived ? 'checked' : ''}> ซ่อนบัญชีนี้ (เลิกใช้)</label>
    <p class="muted small">ยอดคงเหลือปัจจุบัน: ${money(bal)} บาท</p>` : ''}
    <div class="btns"><button class="btn" data-act="close">ยกเลิก</button><button class="btn primary" id="aSave">บันทึก</button></div>`, (m) => {
    $('#aSave', m).onclick = async () => {
      const name = $('#aName', m).value.trim();
      if (!name) return toast('กรุณาใส่ชื่อบัญชี');
      if (S.accounts.some((x) => x.name === name && x !== a)) return toast('มีบัญชีชื่อนี้แล้ว');
      const budget = Math.max(0, evalAmount($('#aBud', m).value) || 0);
      if (a) {
        if (name !== a.name) {
          const changed = S.tx.filter((t) => t.account === a.name);
          changed.forEach((t) => (t.account = name));
          await DB.put('tx', changed);
          if (S.meta.lastAccount === a.name) setMeta('lastAccount', name);
        }
        Object.assign(a, { name, budget, archived: $('#aArc', m).checked });
        await DB.put('accounts', a);
      } else {
        const acc = { id: S.accounts.reduce((mx, x) => Math.max(mx, x.id), 0) + 1, name, budget, archived: false, order: S.accounts.length };
        S.accounts.push(acc);
        await DB.put('accounts', acc);
        const b0 = evalAmount($('#aBal', m).value) || 0;
        if (b0) await saveTx([{ id: nextId(), note: C_OPEN, amount: b0, category: C_OPEN, account: name, date: today(), exclude: true }]);
        if (!S.meta.categories.length) await setMeta('categories', DEFAULT_CATS);
      }
      closeModal(); toast('บันทึกแล้ว'); render();
    };
  });
}

const DEFAULT_CATS = [
  ...['Food & Beverage', 'Medication for Sale', 'Fuel Bill', 'Medical', 'Personal Items', 'Gifts & Donations', 'Electricity Bill', 'Water Bill', 'Internet Bill', 'Phone Bill', 'Rentals', 'Transportation', 'Investment', 'Other Expense'].map((name) => ({ name, type: 'expense' })),
  ...['From Selling', 'Salary', 'Collect Interest', 'Other Income'].map((name) => ({ name, type: 'income' })),
];

/** mode 'opening': adjust the opening-balance row; mode 'adjust': add a dated adjustment today. */
function openReconcile(mode) {
  const bal = balances();
  const accs = mode === 'opening' ? S.accounts : activeAccounts();
  openModal(`
    <h2>${mode === 'opening' ? 'ตั้งยอดยกมา' : 'ปรับยอดให้ตรงกับปัจจุบัน'}</h2>
    <p class="muted small">${mode === 'opening'
      ? 'ยอดด้านซ้ายคำนวณจากรายการทั้งหมด ถ้าไม่ตรงกับยอดจริงตอนนี้ (เช่นดูจาก Money Lover หรือแอปธนาคาร) ให้แก้ช่อง "ยอดจริง" ระบบจะเพิ่มรายการ "ยอดยกมา" ไว้ก่อนรายการแรก ประวัติและรายงานไม่เปลี่ยน'
      : 'กรอกยอดจริงของแต่ละบัญชี ระบบจะบันทึกส่วนต่างเป็นรายการ "ปรับยอด" วันนี้ (ไม่นับในรายงาน)'}</p>
    <div class="tbl-wrap"><table class="recon">
      <tr><th>บัญชี</th><th>ยอดในแอป</th><th>ยอดจริง</th></tr>
      ${accs.map((a) => `<tr><td>${esc(a.name)}</td><td class="num ${(bal[a.name] || 0) < 0 ? 'neg' : ''}">${money(bal[a.name] || 0)}</td>
        <td><input data-recon="${esc(a.name)}" inputmode="decimal" value="${r2(bal[a.name] || 0)}"></td></tr>`).join('')}
    </table></div>
    <div class="btns"><button class="btn" data-act="close">${mode === 'opening' ? 'ข้ามไปก่อน' : 'ยกเลิก'}</button><button class="btn primary" id="rSave">บันทึก</button></div>`, (m) => {
    $('#rSave', m).onclick = async () => {
      const add = [], remove = [];
      const first = S.tx.reduce((mn, t) => (t.category !== C_OPEN && t.date < mn ? t.date : mn), today());
      for (const inp of $$('[data-recon]', m)) {
        const name = inp.dataset.recon, actual = evalAmount(inp.value);
        if (isNaN(actual)) return toast(`ยอดของ ${name} ไม่ถูกต้อง`);
        const diff = r2(actual - (bal[name] || 0));
        if (!diff) continue;
        if (mode === 'opening') {
          const ex = S.tx.find((t) => t.account === name && t.category === C_OPEN);
          if (ex) {
            const amt = r2(ex.amount + diff);
            if (amt) add.push({ ...ex, amount: amt }); else remove.push(ex.id);
          } else add.push({ id: nextId(), note: C_OPEN, amount: diff, category: C_OPEN, account: name, date: addDays(first, -1), exclude: true });
        } else {
          add.push({ id: nextId(), note: C_ADJ, amount: diff, category: C_ADJ, account: name, date: today(), exclude: true });
        }
      }
      await saveTx(add, remove);
      closeModal();
      toast(add.length + remove.length ? `ปรับยอด ${add.length + remove.length} บัญชีแล้ว` : 'ยอดตรงอยู่แล้ว');
      render();
    };
  });
}

/* ================= events ================= */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act],[data-view],[data-tx],[data-goacc],[data-editacc],[data-setbudget],[data-editbudget],[data-anacc],[data-catsearch]');
  if (e.target.id === 'modal') return closeModal();
  if (!el) return;
  const d = el.dataset;
  if (d.view) return go(d.view);
  if (d.tx) { const t = S.tx.find((x) => x.id === +d.tx); return t && openForm(t); }
  if (d.goacc) return go('tx', { txAcc: d.goacc, txSearch: '', txMonth: curYM() });
  if (d.editacc) return openAccountForm(S.accounts.find((a) => a.id === +d.editacc));
  if (d.setbudget) return setBudget(d.setbudget, +d.val);
  if (d.editbudget) {
    const a = accountByName(d.editbudget);
    const v = prompt(`งบรายจ่ายต่อเดือนของ ${a.name}`, a.budget || '');
    if (v !== null) setBudget(a.name, evalAmount(v) || 0);
    return;
  }
  if (d.anacc) { S.anAcc = d.anacc; return go('an'); }
  if (d.catsearch) return go('tx', { txSearch: d.catsearch, txAcc: S.anAcc });
  switch (d.act) {
    case 'close': return closeModal();
    case 'add':
      if (!S.accounts.length) return toast('กรุณานำเข้าข้อมูลหรือสร้างบัญชีก่อน');
      return openModal(`<h2>เพิ่มรายการ</h2>
        <div class="btns" style="flex-direction:column">
          <button class="btn primary" data-act="add-manual">✏️ ลงรายการเอง</button>
          <button class="btn" data-act="add-slip">📎 แนบสลิป (อ่านยอดและวันที่ให้อัตโนมัติ)</button>
          <button class="btn" data-act="close">ยกเลิก</button>
        </div>`);
    case 'add-manual': closeModal(); return openForm();
    case 'add-slip': closeModal(); return go('slip');
    case 'tx-prev': S.txMonth = addMonths(S.txMonth, -1); return render();
    case 'tx-next': S.txMonth = addMonths(S.txMonth, 1); return render();
    case 'new-account': return openAccountForm(null);
    case 'import-csv':
      if (S.tx.length && !confirm('การนำเข้าจะแทนที่ข้อมูลทั้งหมดในแอปนี้ ต้องการดำเนินการต่อ?')) return;
      return $('#fileCsv').click();
    case 'export-csv': return exportCSV();
    case 'backup': exportBackup(); return render();
    case 'restore':
      if (S.tx.length && !confirm('การกู้คืนจะแทนที่ข้อมูลทั้งหมดในแอปนี้ ต้องการดำเนินการต่อ?')) return;
      return $('#fileJson').click();
    case 'reconcile-adjust': return openReconcile('adjust');
    case 'reconcile-open': return openReconcile('opening');
    case 'wipe':
      if (!confirm('ลบข้อมูลทั้งหมดในแอปนี้? กู้คืนไม่ได้ถ้าไม่มี Backup')) return;
      await DB.replaceAll([], [], {});
      await loadState();
      toast('ลบข้อมูลแล้ว');
      return go('home');
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

$('#fileCsv').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const r = await importMoneyLoverCSV(await f.text());
    toast(`นำเข้า ${r.count.toLocaleString()} รายการ ${r.accounts} บัญชี`);
    navigator.storage?.persist?.();
    go('home');
    openReconcile('opening');
  } catch (err) {
    alert('นำเข้าไม่สำเร็จ: ' + err.message);
  }
};

$('#fileJson').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    await restoreBackup(await f.text());
    toast('กู้คืนข้อมูลแล้ว');
    go('home');
  } catch (err) {
    alert('กู้คืนไม่สำเร็จ: ' + err.message);
  }
};

/* ================= boot ================= */
(async function boot() {
  try {
    await DB.open();
    await loadState();
  } catch (err) {
    $('#view').innerHTML = `<div class="card pad">เปิดฐานข้อมูลไม่ได้: ${esc(err.message)}</div>`;
    return;
  }
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// exposed for debugging / tests
window.MoneyApp = { S, importMoneyLoverCSV, balances, monthly, render };
