// Загрузка и расчёты. Здесь нет ничего про внешний вид: только данные.
// Формулы совпадают с листами «Сводка» и «Динамика» в таблице аналитики, поэтому цифры сходятся.
(function () {
  const BASE = ['publications', 'reach', 'actions', 'registrations', 'forms', 'valid', 'sales', 'revenue', 'cost'];

  // Все показатели. fmt: int — число, money — тенге, pct — процент с десятой, pct0 — целый процент.
  const METRICS = [
    {key: 'publications', label: 'Публикации', fmt: 'int'},
    {key: 'reach', label: 'Охват', fmt: 'int'},
    {key: 'actions', label: 'Целевые действия', fmt: 'int'},
    {key: 'registrations', label: 'Регистрации в бота', fmt: 'int'},
    {key: 'forms', label: 'Анкеты', fmt: 'int'},
    {key: 'valid', label: 'Валидные анкеты', fmt: 'int'},
    {key: 'sales', label: 'Продажи', fmt: 'int'},
    {key: 'revenue', label: 'Сумма продаж', fmt: 'money'},
    {key: 'cost', label: 'Затраты', fmt: 'money'},
    {key: 'cpl', label: 'Цена анкеты (CPL)', fmt: 'money'},
    {key: 'cpValid', label: 'Цена валидной анкеты', fmt: 'money'},
    {key: 'regToForm', label: 'Конверсия регистрация → анкета', fmt: 'pct'},
    {key: 'formToSale', label: 'Конверсия анкета → продажа', fmt: 'pct'},
    {key: 'payback', label: 'Окупаемость', fmt: 'pct0'},
    {key: 'romi', label: 'ROMI', fmt: 'pct0'},
  ];
  const METRIC = {}; METRICS.forEach(m => { METRIC[m.key] = m; });

  const DIR = {O: 'Органика', P: 'Платный', B: 'Работа с базой', U: 'Не определено'};
  const PLAN_METRICS = ['forms', 'valid', 'sales', 'revenue'];

  // ---------- загрузка ----------
  const CACHE_KEY = 'dash-data-v1';
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; } }
  function writeCache(api) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({at: Date.now(), api: api})); } catch (e) {} }

  async function load(opts) {
    opts = opts || {};
    const url = CONFIG.API_URL + (opts.fresh ? '&fresh=1' : '') + (opts.key ? '&key=' + encodeURIComponent(opts.key) : '');
    try {
      const r = await fetch(url, {cache: 'no-store'});
      const api = await r.json();
      if (!api.ok) throw new Error(api.error || 'таблица не отдала данные');
      writeCache(api);
      return {db: normalize(api), fromCache: false};
    } catch (e) {
      const c = readCache();
      if (c && Date.now() - c.at < CONFIG.CACHE_MINUTES * 60000) return {db: normalize(c.api), fromCache: true, error: e.message};
      throw e;
    }
  }

  // Последние сохранённые данные (чтобы сразу что-то показать, пока таблица отвечает).
  function cached() {
    const c = readCache();
    return c && Date.now() - c.at < CONFIG.CACHE_MINUTES * 60000 ? normalize(c.api) : null;
  }

  function normalize(api) {
    const cols = api.factColumns;
    const facts = api.facts.map(r => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return o; });
    const ads = (api.ads || []).map(r => ({date: r[0], spendUsd: r[1], impressions: r[2], clicks: r[3], entries: r[4]}));
    const igDaily = (api.igDaily || []).map(r => ({date: r[0], followers: r[1], growth: r[2], accountReach: r[3]}));
    const channelsByDir = {};
    (api.channels || []).forEach(p => { (channelsByDir[p[0]] = channelsByDir[p[0]] || []).push(p[1]); });
    const dates = facts.map(f => f.date).filter(Boolean).sort();
    return Object.assign({}, api, {facts, ads, igDaily, channelsByDir,
      minDate: dates[0] || api.since, maxDate: api.today || dates[dates.length - 1]});
  }

  // ---------- выборка и суммы ----------
  // f: {from, to, directions: Set|null, channels: Set|null}. Канал задаётся вместе с направлением: «Органика|Рилсы».
  function filter(db, f) {
    return db.facts.filter(x => x.date >= f.from && x.date <= f.to &&
      (!f.directions || f.directions.has(x.direction)) && (!f.channels || f.channels.has(x.direction + '|' + x.channel)));
  }
  function zero() { const t = {}; BASE.forEach(k => { t[k] = 0; }); return t; }
  function add(t, r) { BASE.forEach(k => { t[k] += Number(r[k]) || 0; }); return t; }
  // Доли и цены: пусто, если делить не на что (как в таблице). Конверсии больше 100% не показываем:
  // так бывает, когда часть анкет пришла без регистрации в боте (например, по рекламе), и цифра вводит в заблуждение.
  function derive(t) {
    const ratio = (a, b, cap) => (!b || !a || (cap && a > b)) ? null : a / b;
    t.cpl = ratio(t.cost, t.forms);
    t.cpValid = ratio(t.cost, t.valid);
    t.regToForm = ratio(t.forms, t.registrations, true);
    t.formToSale = ratio(t.sales, t.forms, true);
    t.payback = ratio(t.revenue, t.cost);
    t.romi = t.cost ? (t.revenue - t.cost) / t.cost : null;
    return t;
  }
  function sum(rows) { const t = zero(); rows.forEach(r => add(t, r)); return derive(t); }

  // Итоги по направлениям и каналам: {dir: {total, channels: {chan: total}}}
  function byDirChannel(db, rows) {
    const out = {};
    Object.keys(db.channelsByDir).forEach(d => { out[d] = {total: zero(), channels: {}}; db.channelsByDir[d].forEach(c => { out[d].channels[c] = zero(); }); });
    rows.forEach(r => {
      const d = out[r.direction] || (out[r.direction] = {total: zero(), channels: {}});
      add(d.total, r); add(d.channels[r.channel] || (d.channels[r.channel] = zero()), r);
    });
    Object.values(out).forEach(d => { derive(d.total); Object.values(d.channels).forEach(derive); });
    return out;
  }

  // Единицы: публикации, креативы, свои ссылки. Одна строка = единица в своём направлении и канале.
  function byUnit(db, rows) {
    const m = {};
    rows.forEach(r => {
      if (!r.unit) return; // общие расходы без единицы
      const k = r.unit + '\u0001' + r.direction + '\u0001' + r.channel;
      const x = m[k] || (m[k] = Object.assign({key: r.unit, direction: r.direction, channel: r.channel, first: r.date, last: r.date}, zero()));
      add(x, r); if (r.date < x.first) x.first = r.date; if (r.date > x.last) x.last = r.date;
    });
    return Object.values(m).map(x => {
      const u = db.units[x.key] || {};
      return derive(Object.assign(x, {
        title: u.title || unitTitle(x.key), link: u.link || (u.instagram && u.instagram.link) || '', code: u.code || '',
        keyword: u.keyword || '', material: u.material || u.title || unitTitle(x.key), type: u.type || '', pubDate: u.date || '',
        format: (u.details && u.details.format) || '', info: u,
        isAds: x.key.indexOf('ads:') === 0, isUnknown: x.key.indexOf('none:') === 0,
      }));
    });
  }
  function unitTitle(k) {
    if (k.indexOf('utm:') === 0) return 'Креатив: ' + k.slice(4);
    if (k.indexOf('none:') === 0) return 'Источник не определён';
    if (k.indexOf('m:') === 0) return 'Своя ссылка: ' + k.slice(2).split('|').filter(Boolean).join(' · ');
    return k;
  }
  // ---------- периоды ----------
  function iso(d) { return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function parse(s) { const p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function addDays(s, n) { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function weekStart(s) { const d = parse(s); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return iso(d); }
  function monthStart(s) { return s.slice(0, 7) + '-01'; }
  function monthEnd(s) { const d = parse(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return iso(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000) + 1; }
  function bucketOf(s, grain) { return grain === 'week' ? weekStart(s) : grain === 'month' ? monthStart(s) : s; }

  // Ряды по дням / неделям / месяцам за период, включая пустые.
  function byPeriod(rows, from, to, grain) {
    const out = [], idx = {};
    for (let s = bucketOf(from, grain); s <= to;) {
      const b = {start: s, end: grain === 'week' ? addDays(s, 6) : grain === 'month' ? monthEnd(s) : s};
      b.from = b.start < from ? from : b.start; b.to = b.end > to ? to : b.end;
      Object.assign(b, zero()); idx[s] = b; out.push(b);
      s = grain === 'week' ? addDays(s, 7) : grain === 'month' ? addDays(monthEnd(s), 1) : addDays(s, 1);
    }
    rows.forEach(r => { const b = idx[bucketOf(r.date, grain)]; if (b) add(b, r); });
    return out.map(derive);
  }

  // ---------- план-факт ----------
  // План из листа «План». Если нет строки «Все» — план = сумма направлений; нет строки направления — сумма его каналов.
  function planFor(db, month) {
    const rows = (db.plan || []).filter(p => p.month === month);
    const pick = p => { const o = {}; PLAN_METRICS.forEach(k => { o[k] = p[k]; }); return o; };
    const addPlan = (a, b) => { PLAN_METRICS.forEach(k => { if (b[k] != null) a[k] = (a[k] || 0) + b[k]; }); return a; };
    const total = rows.filter(p => p.direction === 'Все' && !p.channel).map(pick)[0] || null;
    const dirs = {}, chans = {};
    rows.forEach(p => {
      if (p.direction === 'Все') return;
      if (p.channel) chans[p.direction + '|' + p.channel] = addPlan(chans[p.direction + '|' + p.channel] || {}, p);
      else dirs[p.direction] = addPlan(dirs[p.direction] || {}, p);
    });
    Object.keys(chans).forEach(k => { const d = k.split('|')[0]; if (!rows.some(p => p.direction === d && !p.channel)) dirs[d] = addPlan(dirs[d] || {}, chans[k]); });
    const sumDirs = Object.values(dirs).reduce((a, b) => addPlan(a, b), {});
    return {total: total || (Object.keys(dirs).length ? sumDirs : null), dirs, chans, has: rows.length > 0};
  }
  // Прогноз к концу месяца по текущему темпу (только для текущего месяца).
  function forecast(fact, month, today) {
    const start = month + '-01', end = monthEnd(start);
    if (today < start) return null;
    if (today > end) return fact;
    const passed = daysBetween(start, today), all = daysBetween(start, end);
    return fact / passed * all;
  }

  // ---------- форматирование ----------
  const nf = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0});
  const nf2 = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  // Короткая запись больших сумм: 6,0 млн ₸, 850 тыс ₸.
  function fmtShort(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' млн ₸';
    if (a >= 1e4) return Math.round(v / 1e3) + ' тыс ₸';
    return fmt(v, 'money');
  }
  function fmt(v, kind) {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '—';
    if (kind === 'money') return nf.format(Math.round(v)) + ' ₸';
    if (kind === 'pct') return (v * 100).toFixed(1).replace('.', ',') + '%';
    if (kind === 'pct0') return nf.format(Math.round(v * 100)) + '%';
    if (kind === 'usd') return '$' + nf2.format(v);
    return nf.format(Math.round(v));
  }
  function fmtMetric(key, v) { return fmt(v, (METRIC[key] || {}).fmt || 'int'); }
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  function dShort(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) : '—'; }
  function dFull(s) { return s ? dShort(s) + '.' + s.slice(0, 4) : '—'; }
  function monthLabel(s) { return MONTHS[+s.slice(5, 7) - 1] + ' ' + s.slice(0, 4); }
  function weekday(s) { return WD[parse(s).getUTCDay()]; }
  function periodLabel(b, grain) {
    if (grain === 'month') return monthLabel(b.start);
    if (grain === 'week') return b.from === b.to ? dShort(b.from) : dShort(b.from) + '–' + dShort(b.to);
    return dShort(b.start) + ' ' + weekday(b.start);
  }
  function rangeLabel(a, b) { return !a ? '—' : a === b ? dFull(a) : dShort(a) + '–' + dFull(b); }

  window.Data = {BASE, METRICS, METRIC, DIR, PLAN_METRICS, load, cached, normalize, fmtShort, filter, zero, add, derive, sum, byDirChannel, byUnit,
    unitTitle, byPeriod, planFor, forecast, iso, parse, addDays, monthStart, monthEnd, daysBetween, fmt, fmtMetric, dShort, dFull,
    monthLabel, weekday, periodLabel, rangeLabel};
})();
