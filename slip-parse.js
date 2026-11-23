'use strict';
/* Extract amount + date from OCR text of a Thai bank transfer slip. Pure functions (also runs in Node for tests). */
const SlipParse = (() => {
  const MONTHS = [
    ['มค', 'มกราคม', 'jan'], ['กพ', 'กุมภาพันธ์', 'feb'], ['มีค', 'มีนาคม', 'mar'], ['เมย', 'เมษายน', 'apr'],
    ['พค', 'พฤษภาคม', 'may'], ['มิย', 'มิถุนายน', 'jun'], ['กค', 'กรกฎาคม', 'jul'], ['สค', 'สิงหาคม', 'aug'],
    ['กย', 'กันยายน', 'sep'], ['ตค', 'ตุลาคม', 'oct'], ['พย', 'พฤศจิกายน', 'nov'], ['ธค', 'ธันวาคม', 'dec'],
  ];
  const pad = (n) => String(n).padStart(2, '0');

  /** Tesseract puts spaces between Thai letters and may output Thai digits; undo both. */
  function normalize(text) {
    return String(text)
      .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
      .replace(/([฀-๿])[ \t]+(?=[฀-๿])/g, '$1')
      .replace(/([฀-๿])[ \t]*\.[ \t]*(?=[฀-๿])/g, '$1.')
      .replace(/([฀-๿])[ \t]+\./g, '$1.')
      .replace(/(\d)[ \t]*([,.])[ \t]*(\d)/g, '$1$2$3')
      .replace(/[ \t]+/g, ' ');
  }

  function monthIndex(tok) {
    const k = tok.replace(/[.\s]/g, '').toLowerCase();
    if (k.length < 2) return -1;
    for (let i = 0; i < 12; i++) {
      const [ab, full, en] = MONTHS[i];
      if (k === ab || k.startsWith(full) || full.startsWith(k) && k.length >= 4 || k.startsWith(en)) return i;
    }
    return -1;
  }

  /** 2-digit years can be BE (69 = 2569 = 2026) or CE (26 = 2026): take whichever is nearest to now. */
  function fixYear(y, now) {
    const cy = now.getFullYear();
    if (y >= 2400) return y - 543;
    if (y >= 1900) return y;
    const be = 1957 + y, ce = 2000 + y;
    return Math.abs(be - cy) <= Math.abs(ce - cy) ? be : ce;
  }

  function validDate(y, m, d, now) {
    const dt = new Date(y, m, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
    const max = new Date(now.getTime() + 36 * 3600e3), min = new Date(now.getFullYear() - 3, 0, 1);
    if (dt > max || dt < min) return null;
    return `${y}-${pad(m + 1)}-${pad(d)}`;
  }

  function findDate(t, now) {
    let m;
    // 10 พ.ย. 69 / 10 พฤศจิกายน 2569 / 10 Nov 2026 / 10 Nov, 2026
    const re1 = /(\d{1,2})\s*([ก-๙a-zA-Z.]{2,12})\s*,?\s*(\d{4}|\d{2})(?!\d)/g;
    while ((m = re1.exec(t))) {
      const mi = monthIndex(m[2]);
      if (mi < 0) continue;
      const r = validDate(fixYear(+m[3], now), mi, +m[1], now);
      if (r) return r;
    }
    // 2026-11-10
    const re2 = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g;
    while ((m = re2.exec(t))) {
      const r = validDate(fixYear(+m[1], now), +m[2] - 1, +m[3], now);
      if (r) return r;
    }
    // 10/11/2026 or 10/11/69 (day first, Thai style)
    const re3 = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?!\d)/g;
    while ((m = re3.exec(t))) {
      const r = validDate(fixYear(+m[3], now), +m[2] - 1, +m[1], now);
      if (r) return r;
    }
    return null;
  }

  const KEY_AMT = /จำนวน|ยอดเงิน|ยอดโอน|ยอดชำระ|amount|total|ยอด/i;
  const KEY_CUR = /บาท|thb|฿/i;
  const KEY_BAD = /ค่าธรรมเนียม|fee|คงเหลือ|balance|ส่วนลด/i;

  function findAmount(t) {
    const lines = t.split(/\n/).map((s) => s.trim());
    const cands = [];
    lines.forEach((line, i) => {
      const prev = lines[i - 1] || '';
      const re = /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?(?![\d])/g;
      let m;
      while ((m = re.exec(line))) {
        const hasDec = !!m[2];
        const after = line.slice(m.index + m[0].length, m.index + m[0].length + 6);
        const before = line.slice(Math.max(0, m.index - 3), m.index);
        const curNear = KEY_CUR.test(after) || /฿/.test(before);
        if (!hasDec && !curNear) continue; // bare integers are usually times, refs, account numbers
        const digits = m[1].replace(/,/g, '');
        if (!hasDec && digits.length > 7) continue;
        const v = parseFloat(digits + (m[2] || ''));
        if (!(v > 0) || v >= 1e8) continue;
        let score = hasDec ? 2 : 0;
        if (KEY_AMT.test(line)) score += 5; else if (KEY_AMT.test(prev)) score += 4;
        if (curNear) score += 3; else if (KEY_CUR.test(line)) score += 1;
        if (KEY_BAD.test(line) || (KEY_BAD.test(prev) && !KEY_AMT.test(line))) score -= 10;
        if (/,\d{3}/.test(m[1])) score += 1;
        cands.push({ v, score, i });
      }
    });
    cands.sort((a, b) => b.score - a.score || a.i - b.i);
    return cands.length && cands[0].score > 0 ? cands[0].v : null;
  }

  function parse(text, now = new Date()) {
    const t = normalize(text);
    return { amount: findAmount(t), date: findDate(t, now), text: t };
  }

  return { parse, normalize, findAmount, findDate };
})();

if (typeof module !== 'undefined') module.exports = SlipParse;
