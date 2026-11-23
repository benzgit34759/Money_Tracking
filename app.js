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
const TH_WD = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
/** Day header: "วันนี้" / "เมื่อวาน" / "จ. 3 พ.ย. 2026". */
const dayLabel = (d) => {
  if (d === today()) return 'วันนี้';
  if (d === addDays(today(), -1)) return 'เมื่อวาน';
  return `${TH_WD[new Date(d + 'T00:00:00').getDay()]} ${dateLabel(d)}`;
};
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
/** Shown in Settings. Keep in step with CACHE ('moneyapp-v<N>') in sw.js so a phone can tell it got the update. */
const APP_VERSION = 9;

const T_OUT = 'Outgoing transfer';
const T_IN = 'Incoming transfer';
const C_OPEN = 'ยอดยกมา';
const C_ADJ = 'ปรับยอด';
const SPECIAL = new Set([T_OUT, T_IN, C_OPEN, C_ADJ]);
const isTransfer = (t) => t.category === T_OUT || t.category === T_IN;
/** Counts toward income/expense reports (same rule as Money Lover's "Exclude Report"). */
const reportable = (t) => !t.exclude && !SPECIAL.has(t.category);

/* ---------- category look: Thai label, emoji icon, colour hue ----------
   Display only — the stored category name stays as-is (English, Money Lover compatible). */
const CAT_DEFS = [
  // names (| separated)                                   Thai label        icon  hue
  ['Food & Beverage|Food|Restaurants|Cafe',               'อาหาร',           '🍜', 18],
  ['Bills & Utilities',                                    'บิลและค่าน้ำไฟ',     '🧾', 40],
  ['Electricity Bill',                                     'ค่าไฟ',            '⚡', 45],
  ['Water Bill',                                           'ค่าน้ำ',            '💧', 200],
  ['Internet Bill',                                        'ค่าเน็ต',           '🌐', 210],
  ['Phone Bill',                                           'ค่าโทรศัพท์',        '📱', 220],
  ['Gas Bill',                                             'ค่าแก๊ส',           '🔥', 25],
  ['Television Bill',                                      'ค่าทีวี',            '📺', 230],
  ['Rentals|Rent',                                         'ค่าเช่า',           '🏠', 255],
  ['Transportation|Taxi|Parking Fees',                     'เดินทาง',          '🚌', 165],
  ['Fuel Bill|Petrol|Fuel',                                'น้ำมัน',            '⛽', 0],
  ['Shopping|Clothing|Footwear|Accessories|Electronics',   'ช้อปปิ้ง',          '🛍️', 330],
  ['Personal Items',                                       'ของใช้ส่วนตัว',      '🧴', 300],
  ['Entertainment|Movies|Games',                           'บันเทิง',           '🎬', 280],
  ['Travel',                                               'ท่องเที่ยว',         '✈️', 190],
  ['Friends & Lover',                                      'เพื่อนและคนรัก',     '💞', 340],
  ['Medical|Pharmacy|Health & Fitness|Fitness',            'สุขภาพ',            '💊', 355],
  ['Medication for Sale',                                  'ยาสำหรับขาย',       '📦', 150],
  ['Gifts & Donations|Charity|Funeral|Marriage',           'ของขวัญ/บริจาค',    '🎁', 320],
  ['Family|Children & Babies|Pets',                        'ครอบครัว',          '👪', 30],
  ['Home Improvement|Home Services',                       'บ้าน',             '🛠️', 35],
  ['Education|Books',                                      'การศึกษา',          '📚', 240],
  ['Insurances',                                           'ประกัน',           '🛡️', 215],
  ['Fees & Charges|Pay Interest',                          'ค่าธรรมเนียม',       '🏦', 60],
  ['Investment|Business',                                  'ลงทุน',            '📈', 140],
  ['Loan|Debt|Repayment|Withdrawal',                       'กู้/ชำระหนี้',        '💳', 260],
  ['Other Expense|Others',                                 'รายจ่ายอื่นๆ',        '🏷️', 90],
  ['Salary',                                               'เงินเดือน',          '💰', 120],
  ['From Selling|Selling',                                 'รายได้จากการขาย',   '🏪', 130],
  ['Collect Interest',                                     'ดอกเบี้ยรับ',         '🪙', 100],
  ['Award|Gifts',                                          'รางวัล/ของขวัญ',    '🏆', 50],
  ['Other Income',                                         'รายรับอื่นๆ',        '💵', 110],
  [T_OUT + '|' + T_IN,                                     'โอนเงิน',          '⇄', -1],
  [C_OPEN + '|' + C_ADJ,                                   '',                 '⚖️', -1],
];
const CAT_META = {};
for (const [names, th, icon, hue] of CAT_DEFS) for (const n of names.split('|')) CAT_META[n] = { th: th || n, icon, hue };
const hashHue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360; return h; };
const catMeta = (name) => CAT_META[name] || { th: name, icon: (name || '?').trim().charAt(0).toUpperCase() || '🏷️', hue: hashHue(name) };
const catLabel = (name) => catMeta(name).th;
/** CSS vars for a colour hue; -1 = neutral grey. Consumed by .cic / .acard / .tcat in styles.css. */
const hueVars = (h) => (h < 0 ? '--h:0;--sat:0' : `--h:${h};--sat:1`);
/** Coloured round category icon. */
const catIcon = (name, cls = '') => `<span class="cic ${cls}" style="${hueVars(catMeta(name).hue)}" aria-hidden="true">${esc(catMeta(name).icon)}</span>`;

/* ---------- bank look: colour by well-known Thai bank names, else a stable hue ---------- */
const BANK_HUES = [
  [/กสิกร|kbank|kasikorn/i, 135], [/กรุงเทพ|bbl|bangkok bank/i, 215], [/ไทยพาณิชย์|scb/i, 275],
  [/กรุงไทย|ktb/i, 195], [/กรุงศรี|krungsri|bay/i, 48], [/ทหารไทย|ttb|ธนชาต/i, 230],
  [/ออมสิน|gsb/i, 330], [/ธ\.?ก\.?ส|baac/i, 160], [/uob|ยูโอบี/i, 225], [/cimb|ซีไอเอ็มบี/i, 355],
  [/เงินสด|cash/i, -1], [/true ?money|ทรูมันนี่/i, 25],
];
const bankHue = (name) => { for (const [re, h] of BANK_HUES) if (re.test(name)) return h; return hashHue(name); };

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
  txCat: '',
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
const bankGuess = (name) => (name.includes('-') ? name.split('-').pop().trim() : '');
/** Account's bank: the saved value, or (if never saved) guessed from the name suffix. '' = no bank. */
const accBank = (a) => a.bank ?? bankGuess(a.name);
const bankNames = () => [...new Set(S.accounts.map(accBank).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'th'));
/** [{ bank, total, accounts: [names] }] — every account with a bank (hidden and excluded ones too), for checking against the real bank. */
function bankTotals(bal) {
  const g = {};
  for (const a of S.accounts) {
    const b = accBank(a);
    if (!b) continue;
    const r = (g[b] ||= { bank: b, total: 0, accounts: [] });
    r.total += bal[a.name] || 0;
    r.accounts.push(a.name);
  }
  return Object.values(g).sort((x, y) => x.bank.localeCompare(y.bank, 'th'));
}

/* ---------- account filter for reports (home / analysis) ----------
   Stored per screen in meta 'sel_<key>' as { mode: 'inc'|'exc'|'all'|'custom', names: [] }.
   Default 'inc' = accounts counted in the total. */
const SEL_LABEL = { all: 'ทุกบัญชี', inc: 'เฉพาะที่นับยอดรวม', exc: 'เฉพาะที่ไม่นับยอดรวม' };
const getSel = (key) => S.meta['sel_' + key] || { mode: 'inc', names: [] };
const setSel = (key, sel) => setMeta('sel_' + key, sel);
/** Set of account names to include, or null for "no filter" (every transaction). */
function selAccounts(key) {
  const s = getSel(key);
  if (s.mode === 'all') return null;
  if (s.mode === 'custom') return new Set(s.names);
  return new Set(S.accounts.filter((a) => (s.mode === 'exc') === !!a.excludeTotal).map((a) => a.name));
}
function selLabel(key) {
  const s = getSel(key);
  if (s.mode !== 'custom') return SEL_LABEL[s.mode];
  return s.names.length === 1 ? s.names[0] : `เลือก ${s.names.length} บัญชี`;
}
/** The single selected account name, or '' when the filter covers zero or several accounts. */
function selSingle(key) {
  const set = selAccounts(key);
  return set && set.size === 1 ? [...set][0] : '';
}
const selButton = (key) => `<button class="btn sm accsel" data-accsel="${key}">🏦 ${esc(selLabel(key))} ▾</button>`;

function openAccPicker(key) {
  const cur = selAccounts(key);
  const checked = (n) => (!cur || cur.has(n) ? 'checked' : '');
  const item = (a) => `<label class="check"><input type="checkbox" data-pick="${esc(a.name)}" ${checked(a.name)}> ${esc(a.name)}${a.archived ? ' <span class="badge">ซ่อน</span>' : ''}</label>`;
  const inc = S.accounts.filter((a) => !a.excludeTotal), exc = S.accounts.filter((a) => a.excludeTotal);
  openModal(`
    <h2>เลือกบัญชีที่จะดู</h2>
    <div class="btns" style="margin-top:6px">
      <button class="btn sm" data-preset="inc">นับยอดรวม</button>
      <button class="btn sm" data-preset="exc">ไม่นับยอดรวม</button>
      <button class="btn sm" data-preset="all">ทั้งหมด</button>
    </div>
    <h3>บัญชีที่นับในยอดรวม (Include)</h3>${inc.map(item).join('') || '<p class="muted small">—</p>'}
    <h3>บัญชีที่ไม่นับในยอดรวม (Exclude)</h3>${exc.map(item).join('') || '<p class="muted small">— ตั้งได้ที่ ตั้งค่า › บัญชี</p>'}
    <div class="btns"><button class="btn" data-act="close">ยกเลิก</button><button class="btn primary" id="pkSave">ตกลง</button></div>`, (m) => {
    $$('[data-preset]', m).forEach((b) => (b.onclick = async () => { await setSel(key, { mode: b.dataset.preset, names: [] }); closeModal(); render(); }));
    $('#pkSave', m).onclick = async () => {
      const names = $$('[data-pick]', m).filter((c) => c.checked).map((c) => c.dataset.pick);
      if (!names.length) return toast('กรุณาเลือกอย่างน้อย 1 บัญชี');
      await setSel(key, names.length === S.accounts.length ? { mode: 'all', names: [] } : { mode: 'custom', names });
      closeModal(); render();
    };
  });
}

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
function monthly(metric, accs) {
  const m = {};
  for (const t of S.tx) {
    if (!reportable(t) || (accs && !accs.has(t.account))) continue;
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
  // most used in this account first, then most used overall, then by Thai label
  const freq = {}, all = {};
  for (const t of S.tx) {
    all[t.category] = (all[t.category] || 0) + 1;
    if (!account || t.account === account) freq[t.category] = (freq[t.category] || 0) + 1;
  }
  return S.meta.categories
    .filter((c) => c.type === type && !SPECIAL.has(c.name))
    .map((c) => c.name)
    .sort((a, b) => (freq[b] || 0) - (freq[a] || 0) || (all[b] || 0) - (all[a] || 0) || catLabel(a).localeCompare(catLabel(b), 'th'));
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
  delete m.dataset.dirty;
  // Remember that the user typed something, so the back button can ask before throwing it away.
  $('.sheet', m).addEventListener('input', (e) => {
    if (e.target.matches('input:not([type=checkbox]):not([type=radio]), textarea')) m.dataset.dirty = '1';
  });
  mount && mount($('.sheet', m));
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; delete m.dataset.dirty; }

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
  if (view !== S.view) {
    // Page history for the back button. Revisiting a page already in the history
    // rewinds to it instead of growing the list (home → tx → an → tx: back goes home).
    const i = NAV.stack.findIndex((x) => x.view === view);
    if (i >= 0) NAV.stack.length = i;
    else NAV.stack.push(navSnap());
  }
  Object.assign(S, opts);
  S.view = view;
  render();
  window.scrollTo(0, 0);
}

/* ---------- back button (Android / browser) ----------
   The app keeps one extra "guard" history entry. Pressing back consumes it (popstate);
   we then handle the back ourselves and re-add the guard, so the app never leaves by accident.
   Order: close an open dialog (ask first if something was typed) → previous page → home →
   on home, a second press within 2 s exits. */
const NAV = { stack: [], exitArmed: 0 };
const navSnap = () => ({ view: S.view, txMonth: S.txMonth, txAcc: S.txAcc, txSearch: S.txSearch, txCat: S.txCat });
const armBack = () => { if (!history.state?.guard) history.pushState({ guard: 1 }, ''); };

window.addEventListener('popstate', () => {
  const m = $('#modal');
  if (!m.hidden) {
    if (m.dataset.dirty && !confirm('ยังไม่ได้บันทึก ต้องการทิ้งข้อมูลที่กรอกไว้?')) return armBack();
    closeModal();
    return armBack();
  }
  if (NAV.stack.length || S.view !== 'home') {
    Object.assign(S, NAV.stack.pop() || { view: 'home' });
    render();
    window.scrollTo(0, 0);
    return armBack();
  }
  if (Date.now() - NAV.exitArmed < 2000) return history.back(); // second press: leave the app
  NAV.exitArmed = Date.now();
  toast('กด back อีกครั้งเพื่อออกจากแอป');
  armBack();
});

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
  const sys = SPECIAL.has(t.category); // transfers / opening balance / adjustments: shown faded
  return `<li data-tx="${t.id}" class="row txi ${sys ? 'sys' : ''}">
    ${catIcon(t.category)}
    <div class="grow"><div class="title">${esc(catLabel(t.category))}${t.exclude && !sys ? '<span class="badge">ไม่นับรายงาน</span>' : ''}</div>
    <div class="sub">${esc(sub) || '&nbsp;'}</div></div>
    <div class="amt ${sys ? '' : t.amount < 0 ? 'neg' : 'pos'}">${signed(t.amount)}</div>
  </li>`;
}

/* ---------- home ---------- */
function renderHome(v) {
  const bal = balances();
  const accs = activeAccounts();
  const total = accs.filter((a) => !a.excludeTotal).reduce((s, a) => s + (bal[a.name] || 0), 0);
  const nEx = accs.filter((a) => a.excludeTotal).length;
  const ym = curYM();
  const hSel = selAccounts('home');
  const inSel = (n) => !hSel || hSel.has(n);

  // this month: income / expense / by category (for the selected accounts), spend per account (for budgets)
  let inc = 0, exp = 0;
  const spentAcc = {}, byCat = {};
  for (const t of S.tx) {
    if (!reportable(t) || !t.date.startsWith(ym)) continue;
    if (t.amount < 0) spentAcc[t.account] = (spentAcc[t.account] || 0) - t.amount;
    if (!inSel(t.account)) continue;
    if (t.amount > 0) inc += t.amount;
    else { exp -= t.amount; byCat[t.category] = (byCat[t.category] || 0) - t.amount; }
  }
  const net = inc - exp;

  // budget ring: selected accounts that have a monthly budget
  const budAccs = accs.filter((a) => a.budget > 0 && inSel(a.name));
  const bud = budAccs.reduce((s, a) => s + a.budget, 0);
  const budSpent = budAccs.reduce((s, a) => s + (spentAcc[a.name] || 0), 0);
  const [yy, mm] = ym.split('-').map(Number);
  const daysLeft = new Date(yy, mm, 0).getDate() - new Date().getDate();
  let ring = '';
  if (bud > 0) {
    const p = budSpent / bud, C = 2 * Math.PI * 26;
    const col = p > 1 ? 'var(--neg)' : p > 0.85 ? 'var(--warn)' : 'var(--brand)';
    const left = bud - budSpent;
    ring = `<div class="card budget-ring">
      <svg width="68" height="68" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--line)" stroke-width="8"/>
        <circle cx="32" cy="32" r="26" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(Math.min(p, 1) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>
        <text x="32" y="37" text-anchor="middle">${Math.round(p * 100)}%</text></svg>
      <div class="grow"><div class="title">งบเดือนนี้</div>
        <div class="sub">ใช้ไป ${money0(budSpent)} จาก ${money0(bud)}</div>
        <div class="sub" style="color:${left < 0 ? 'var(--neg)' : 'var(--pos)'}">${left < 0 ? `เกินงบ ${money0(-left)}` : `เหลือใช้ได้ ${money0(left)}`} · อีก ${daysLeft} วัน</div></div>
    </div>`;
  }

  // top spending categories
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topMax = top[0]?.[1] || 1;
  const topHtml = top.map(([c, x]) => `<div class="tcat" data-gocat="${esc(c)}" style="${hueVars(catMeta(c).hue)}">
      ${catIcon(c)}<div class="grow"><div class="row"><span class="grow">${esc(catLabel(c))}</span><b class="num">${money0(x)}</b></div>
      <div class="progress"><i style="width:${(x / topMax) * 100}%"></i></div></div></div>`).join('');

  // accounts grouped by bank; an account with no bank is its own card
  const bankTot = Object.fromEntries(bankTotals(bal).map((g) => [g.bank, g.total]));
  const groups = [], gi = {};
  for (const a of accs) {
    const b = accBank(a);
    if (b) { if (!gi[b]) groups.push((gi[b] = { name: b, hue: bankHue(b), total: bankTot[b] || 0, accs: [] })); gi[b].accs.push(a); }
    else groups.push({ name: a.name, hue: bankHue(a.name), total: bal[a.name] || 0, accs: [a], solo: true });
  }
  const budgetBar = (a) => {
    if (!(a.budget > 0)) return '';
    const sp = spentAcc[a.name] || 0;
    return `<div class="progress ${sp > a.budget ? 'over' : sp > a.budget * 0.85 ? 'near' : ''}"><i style="width:${Math.min(100, (sp / a.budget) * 100)}%"></i></div>`;
  };
  const accRow = (a) => {
    const b = bal[a.name] || 0, prog = budgetBar(a);
    return `<div class="arow" data-goacc="${esc(a.name)}"><div class="row"><span class="grow">${esc(a.name)}${a.excludeTotal ? '<span class="badge">ไม่นับยอดรวม</span>' : ''}</span>
      <span class="num ${b < 0 ? 'neg' : ''}">${money(b)}</span></div>${prog}</div>`;
  };
  const groupsHtml = groups.map((g) => `<div class="acard" style="${hueVars(g.hue)}" ${g.solo ? `data-goacc="${esc(g.name)}"` : ''}>
      <div class="ah">${esc(g.name)}${g.solo && g.accs[0].excludeTotal ? '<span class="badge">ไม่นับยอดรวม</span>' : ''}${g.solo ? '' : `<span>${g.accs.length} บัญชี</span>`}</div>
      <div class="av num ${g.total < 0 ? 'neg' : ''}">${money(g.total)}</div>
      ${g.solo ? (g.accs[0].budget > 0 ? `${budgetBar(g.accs[0])}<div class="ab">ใช้ไป ${money0(spentAcc[g.name] || 0)} / งบ ${money0(g.accs[0].budget)}</div>` : '') : g.accs.map(accRow).join('')}
    </div>`).join('');

  const recent = S.tx.filter((t) => t.category !== C_OPEN && t.category !== C_ADJ)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 6);

  v.innerHTML = `
    <div class="hero">
      <div class="hk">${nEx ? `ยอดรวม (ไม่รวม ${nEx} บัญชี)` : 'ยอดรวมทุกบัญชี'}</div>
      <div class="big num">฿${money(total)}</div>
      <div class="h3c">
        <div>รายรับ<b class="num">${money0(inc)}</b></div>
        <div>รายจ่าย<b class="num">${money0(exp)}</b></div>
        <div>คงเหลือ<b class="num">${net > 0 ? '+' : ''}${money0(net)}</b></div>
      </div>
      <div class="hsel"><span>${ymLabel(ym)}</span>${selButton('home')}</div>
    </div>
    ${ring}
    <button class="btn" style="width:100%;margin-top:10px" data-view="slip">📎 แนบสลิปหลายภาพ</button>
    ${top.length ? `<h3><span>จ่ายมากสุดเดือนนี้</span><a data-view="an">ดูวิเคราะห์ ›</a></h3><div class="card pad">${topHtml}</div>` : ''}
    <h3>บัญชี</h3>
    <div class="agrid">${groupsHtml}</div>
    <h3><span>รายการล่าสุด</span><a data-view="tx">ดูทั้งหมด ›</a></h3>
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
    <div id="txChips" class="chips"></div>
    <div id="txList"></div>`;
  $('#txChips').onclick = (e) => {
    const c = e.target.closest('[data-chip]');
    if (c) { S.txCat = c.dataset.chip; fillTxList(); }
  };
  $('#txAcc').onchange = (e) => { S.txAcc = e.target.value; fillTxList(); };
  $('#txSearch').oninput = (e) => { S.txSearch = e.target.value; fillTxList(); };
  fillTxList();
}

function fillTxList() {
  const q = S.txSearch.trim().toLowerCase();
  let list = S.tx.filter((t) => (!S.txAcc || t.account === S.txAcc) &&
    (q ? `${t.note} ${t.category} ${catLabel(t.category)} ${t.account} ${t.amount}`.toLowerCase().includes(q) : t.date.startsWith(S.txMonth)));
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  // category chips: the most used categories in this list (+ the selected one)
  const cnt = {};
  for (const t of list) if (!SPECIAL.has(t.category)) cnt[t.category] = (cnt[t.category] || 0) + 1;
  const chipCats = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 10);
  if (S.txCat && !chipCats.includes(S.txCat)) chipCats.unshift(S.txCat);
  $('#txChips').innerHTML = chipCats.length < 2 && !S.txCat ? '' :
    `<button class="chip ${S.txCat ? '' : 'on'}" data-chip="">ทั้งหมด</button>` +
    chipCats.map((c) => `<button class="chip ${c === S.txCat ? 'on' : ''}" data-chip="${esc(c)}">${esc(catMeta(c).icon)} ${esc(catLabel(c))}</button>`).join('');
  if (S.txCat) list = list.filter((t) => t.category === S.txCat);
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
      html += `<div class="day-h"><span>${dayLabel(day)}</span><span class="num">${dsum ? signed(dsum) : ''}</span></div><ul class="list">`;
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
    <label class="amt-box"><span>จำนวนเงิน (พิมพ์ 120+35 ได้)</span><input id="fAmt" class="amount-in" inputmode="decimal" autocomplete="off" placeholder="0" value="${st.amount}"></label>
    <div class="chips center" id="fQuick">${[20, 50, 100, 500].map((n) => `<button type="button" class="chip" data-q="${n}">+${n}</button>`).join('')}</div>
    <div id="fCatRow"><input type="hidden" id="fCat"><div class="cgrid" id="fCatGrid"></div></div>
    <div id="fFreqRow"><div class="flabel">ใช้บ่อย</div><div class="chips" id="fFreq"></div></div>
    <div class="two">
      <label class="f"><span id="fAccL">บัญชี</span><select id="fAcc">${accOpts(st.account)}</select></label>
      <label class="f"><span>วันที่</span><input id="fDate" type="date" value="${st.date}"></label>
    </div>
    <label class="f" id="fToRow"><span>โอนไปบัญชี</span><select id="fTo"><option value="">— เลือก —</option>${accOpts(st.to)}</select></label>
    <label class="f" id="fNoteRow"><span>โน้ต (เช่น ชื่อร้าน)</span><input id="fNote" list="fNotes" autocomplete="off" value="${esc(st.note)}"><datalist id="fNotes"></datalist></label>
    <label class="check" id="fExRow"><input type="checkbox" id="fEx" ${st.exclude ? 'checked' : ''}> ไม่นับในรายงาน</label>
    <div class="btns">
      ${t ? '<button class="btn danger" id="fDel">ลบ</button>' : ''}
      <button class="btn" data-act="close">ยกเลิก</button>
      <button class="btn primary" id="fSave">บันทึก</button>
    </div>`, (m) => {
    // Category picker: icon grid, most-used first; "more" reveals the rest.
    const SHOW = 11;
    const fillCats = () => {
      const cats = catsFor(st.mode, $('#fAcc', m).value);
      if (st.category && !cats.includes(st.category)) cats.unshift(st.category);
      if (!st.category) st.category = cats[0] || '';
      let shown = st.allCats ? cats : cats.slice(0, SHOW);
      if (st.category && !shown.includes(st.category)) shown = [st.category, ...shown.slice(0, SHOW - 1)];
      const tile = (attr, icon, label, on = false) => `<button type="button" class="ctile ${on ? 'on' : ''}" ${attr}>${icon}<span>${label}</span></button>`;
      $('#fCatGrid', m).innerHTML = shown.map((c) => tile(`data-cat="${esc(c)}"`, catIcon(c), esc(catLabel(c)), c === st.category)).join('')
        + (cats.length > shown.length ? tile('data-catmore', '<span class="cic" style="--h:0;--sat:0">⋯</span>', 'เพิ่มเติม') : '')
        + tile('data-catnew', '<span class="cic" style="--h:0;--sat:0">＋</span>', 'หมวดใหม่');
      $('#fCat', m).value = st.category;
    };
    $('#fCatGrid', m).onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-cat')) st.category = b.dataset.cat;
      else if (b.hasAttribute('data-catmore')) st.allCats = true;
      else if (b.hasAttribute('data-catnew')) {
        const name = (prompt('ชื่อหมวดใหม่') || '').trim();
        if (!name) return;
        if (!S.meta.categories.some((c) => c.name === name)) setMeta('categories', [...S.meta.categories, { name, type: st.mode }]);
        st.category = name;
      }
      fillCats();
    };
    // Quick amount buttons add to whatever is typed.
    const setAmt = (val) => { const a = $('#fAmt', m); a.value = val; a.dispatchEvent(new Event('input', { bubbles: true })); };
    $('#fQuick', m).onclick = (e) => {
      const b = e.target.closest('[data-q]');
      if (b) setAmt(String(r2((evalAmount($('#fAmt', m).value) || 0) + +b.dataset.q)));
    };
    // "Frequently used": same note + category + amount seen 2+ times in this account → one tap fills all three.
    let freq = [];
    const fillFreq = () => {
      const acc = $('#fAcc', m).value, f = {};
      if (!t && st.mode !== 'transfer') {
        for (const x of S.tx) {
          if (x.account !== acc || !x.note || !reportable(x) || (st.mode === 'expense' ? x.amount >= 0 : x.amount <= 0)) continue;
          const k = JSON.stringify([x.note, x.category, Math.abs(x.amount)]);
          f[k] = (f[k] || 0) + 1;
        }
      }
      freq = Object.entries(f).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => JSON.parse(k));
      $('#fFreq', m).innerHTML = freq.map(([note, c, a], i) => `<button type="button" class="chip" data-fq="${i}">${esc(catMeta(c).icon)} ${esc(note)} ${money(a)}</button>`).join('');
      $('#fFreqRow', m).classList.toggle('hidden', !freq.length);
    };
    $('#fFreq', m).onclick = (e) => {
      const b = e.target.closest('[data-fq]');
      if (!b) return;
      const [note, c, a] = freq[+b.dataset.fq];
      $('#fNote', m).value = note;
      st.category = c;
      fillCats();
      setAmt(String(a));
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
      $('#fAmt', m).classList.toggle('neg', mode === 'expense');
      $('#fAmt', m).classList.toggle('pos', mode === 'income');
      if (!tr) { if (!catsFor(mode).includes(st.category) && !SPECIAL.has(st.category)) st.category = ''; fillCats(); }
      fillFreq();
    };
    $$('#fMode button', m).forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
    $('#fAcc', m).onchange = () => { fillCats(); fillNotes(); fillFreq(); };
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
  const accs = selAccounts('an'), acc = selSingle('an'), metric = S.anMetric, a = accountByName(acc);
  const m = monthly(metric, accs);
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
    if (!reportable(t) || (accs && !accs.has(t.account))) continue;
    if (metric === 'expense' ? t.amount >= 0 : t.amount <= 0) continue;
    const ym = t.date.slice(0, 7), v2 = Math.abs(t.amount);
    if (ym === S.anMonth) catSel[t.category] = (catSel[t.category] || 0) + v2;
    if (l3set.has(ym)) cat3[t.category] = (cat3[t.category] || 0) + v2 / 3;
  }
  const cats = [...new Set([...Object.keys(catSel), ...Object.keys(cat3)])].sort((x, y) => (catSel[y] || 0) - (catSel[x] || 0) || (cat3[y] || 0) - (cat3[x] || 0));
  const word = metric === 'expense' ? 'รายจ่าย' : 'รายรับ';

  v.innerHTML = `
    <div class="toolbar">
      ${selButton('an')}
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
    <h3>${word}รายเดือน · ${esc(selLabel('an'))}</h3>
    <div class="card" style="padding:10px 6px 0">${barChart(months, vals, { avg: avg3, budget, sel: S.anMonth })}
      <div class="legend"><span><i style="background:var(--warn)"></i>เฉลี่ย 3 เดือน</span>${budget ? '<span><i style="background:var(--neg)"></i>งบ</span>' : ''}<span>แตะแท่งเพื่อดูแยกหมวด</span></div>
    </div>
    <h3>แยกตามหมวด · ${ymLabel(S.anMonth)} เทียบเฉลี่ย 3 เดือน</h3>
    <div class="card tbl-wrap"><table>
      <tr><th>หมวด</th><th>${ymLabel(S.anMonth)}</th><th>เฉลี่ย 3 ด.</th><th>ต่าง</th></tr>
      ${cats.map((c) => {
        const s = catSel[c] || 0, av = cat3[c] || 0, d = s - av;
        return `<tr class="clickable" data-catsearch="${esc(c)}"><td><span class="row" style="gap:8px">${catIcon(c, 'sm')}${esc(catLabel(c))}</span></td><td class="num">${money0(s)}</td><td class="num muted">${money0(av)}</td>
          <td class="num ${metric === 'expense' ? (d > 0 ? 'neg' : 'pos') : (d > 0 ? 'pos' : 'neg')}">${Math.round(d) ? signed(Math.round(d)) : '0'}</td></tr>`;
      }).join('') || '<tr><td colspan="4" class="muted">ไม่มีข้อมูล</td></tr>'}
    </table></div>
    ${metric === 'expense' ? budgetTable(accs) : ''}`;

  $$('[data-metric]', v).forEach((b) => (b.onclick = () => { S.anMetric = b.dataset.metric; render(); }));
  $$('[data-range]', v).forEach((b) => (b.onclick = () => { S.anRange = +b.dataset.range; render(); }));
  $$('svg [data-ym]', v).forEach((b) => (b.onclick = () => { S.anMonth = b.dataset.ym; render(); }));
}

function budgetTable(accs) {
  const by = expenseByAccount();
  const cur = curYM(), l3 = lastComplete(3), l6 = lastComplete(6);
  const rows = activeAccounts().filter((a) => !accs || accs.has(a.name)).map((a) => {
    const m = by[a.name] || {};
    return { a, now: m[cur] || 0, avg3: avgOf(m, l3), avg6: avgOf(m, l6) };
  }).filter((r) => r.avg6 > 0 || r.a.budget > 0 || r.now > 0);
  return `<h3>งบรายเดือนแต่ละบัญชี</h3>
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
      ${S.accounts.map((a) => `<li data-editacc="${a.id}" class="row"><div class="grow"><div class="title">${esc(a.name)}${a.archived ? '<span class="badge">ซ่อน</span>' : ''}${a.excludeTotal ? '<span class="badge">ไม่นับยอดรวม</span>' : ''}</div>
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
    <p class="muted small" style="margin:14px 4px">${S.tx.length.toLocaleString()} รายการ${dates.length ? ` · ${dateLabel(dates[0])} – ${dateLabel(dates[dates.length - 1])}` : ''} · <span id="persist"></span></p>
    <footer class="credit"><div>กระเป๋าเงิน · เวอร์ชัน ${APP_VERSION}</div><div>Designed by JPX</div></footer>`;
  if (navigator.storage?.persisted) navigator.storage.persisted().then((p) => { const el = $('#persist'); if (el) el.textContent = p ? 'พื้นที่เก็บข้อมูลถาวร ✓' : 'พื้นที่เก็บข้อมูลอาจถูกล้างได้ — โปรดสำรองข้อมูล'; });
}

function openAccountForm(a) {
  const bal = a ? balances()[a.name] || 0 : 0;
  openModal(`
    <h2>${a ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'}</h2>
    <label class="f"><span>ชื่อบัญชี</span><input id="aName" value="${esc(a?.name || '')}"></label>
    ${a ? '' : '<label class="f"><span>ยอดเงินเริ่มต้น</span><input id="aBal" inputmode="decimal" value="0"></label>'}
    <label class="f"><span>ธนาคาร (ไว้ดูยอดรวมต่อธนาคาร · เว้นว่างได้)</span><input id="aBank" list="aBanks" autocomplete="off" value="${esc(a ? accBank(a) : '')}">
      <datalist id="aBanks">${bankNames().map((b) => `<option value="${esc(b)}">`).join('')}</datalist></label>
    <label class="f"><span>งบรายจ่ายต่อเดือน (0 = ไม่ตั้ง)</span><input id="aBud" inputmode="numeric" value="${a?.budget || 0}"></label>
    <label class="check"><input type="checkbox" id="aExT" ${a?.excludeTotal ? 'checked' : ''}> ไม่นับบัญชีนี้ในยอดรวม (Exclude from Total)</label>
    ${a ? `<label class="check"><input type="checkbox" id="aArc" ${a.archived ? 'checked' : ''}> ซ่อนบัญชีนี้ (เลิกใช้)</label>
    <p class="muted small">ยอดคงเหลือปัจจุบัน: ${money(bal)} บาท</p>` : ''}
    <div class="btns"><button class="btn" data-act="close">ยกเลิก</button><button class="btn primary" id="aSave">บันทึก</button></div>`, (m) => {
    // Suggest the bank from the name suffix ("บัญชีเที่ยว-กสิกร" -> "กสิกร") until the user edits the bank field.
    let bankTouched = !!a?.bank;
    $('#aBank', m).oninput = () => (bankTouched = true);
    $('#aName', m).oninput = () => { if (!bankTouched) $('#aBank', m).value = bankGuess($('#aName', m).value); };
    $('#aSave', m).onclick = async () => {
      const name = $('#aName', m).value.trim();
      if (!name) return toast('กรุณาใส่ชื่อบัญชี');
      if (S.accounts.some((x) => x.name === name && x !== a)) return toast('มีบัญชีชื่อนี้แล้ว');
      const budget = Math.max(0, evalAmount($('#aBud', m).value) || 0);
      const excludeTotal = $('#aExT', m).checked;
      const bank = $('#aBank', m).value.trim();
      if (a) {
        if (name !== a.name) {
          const changed = S.tx.filter((t) => t.account === a.name);
          changed.forEach((t) => (t.account = name));
          await DB.put('tx', changed);
          if (S.meta.lastAccount === a.name) setMeta('lastAccount', name);
        }
        Object.assign(a, { name, budget, excludeTotal, bank, archived: $('#aArc', m).checked });
        await DB.put('accounts', a);
      } else {
        const acc = { id: S.accounts.reduce((mx, x) => Math.max(mx, x.id), 0) + 1, name, budget, excludeTotal, bank, archived: false, order: S.accounts.length };
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
  const el = e.target.closest('[data-act],[data-view],[data-tx],[data-goacc],[data-editacc],[data-setbudget],[data-editbudget],[data-anacc],[data-catsearch],[data-accsel],[data-gocat]');
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
  if (d.accsel) return openAccPicker(d.accsel);
  if (d.gocat) return go('tx', { txCat: d.gocat, txSearch: '', txAcc: '', txMonth: curYM() });
  if (d.anacc) { await setSel('an', { mode: 'custom', names: [d.anacc] }); return go('an'); }
  if (d.catsearch) return go('tx', { txSearch: d.catsearch, txAcc: selSingle('an') });
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
  armBack();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// exposed for debugging / tests
window.MoneyApp = { S, importMoneyLoverCSV, balances, monthly, render };
