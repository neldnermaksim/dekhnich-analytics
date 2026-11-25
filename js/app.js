// Интерфейс дашборда: вкладки, фильтры, таблицы, карточка публикации.
// Расчёты лежат в data.js, настройки в config.js. Каждая вкладка = одна функция render… ниже.
(function () {
  'use strict';
  const D = window.Data, C = window.CONFIG;

  const DIRS = ['Органика', 'Платный', 'Работа с базой', 'Не определено'];
  const DIR_CLASS = {'Органика': 'organic', 'Платный': 'paid', 'Работа с базой': 'base', 'Не определено': 'unknown'};
  const DIR_COLOR = {'Органика': '#14794f', 'Платный': '#a65b00', 'Работа с базой': '#6d48c5', 'Не определено': '#b42318'};

  // Вкладки. filters: какие фильтры показывать (all — период, направления, каналы; channels — период и каналы своего направления).
  const TABS = [
    {id: 'summary', label: 'Сводка', filters: 'all', render: renderSummary},
    {id: 'organic', label: 'Органика', dir: 'Органика', filters: 'channels', render: renderDirection},
    {id: 'paid', label: 'Платный трафик', dir: 'Платный', filters: 'channels', render: renderPaid},
    {id: 'base', label: 'Работа с базой', dir: 'Работа с базой', filters: 'channels', render: renderDirection},
    {id: 'dynamics', label: 'Динамика', filters: 'all', render: renderDynamics},
    {id: 'plan', label: 'План-факт', filters: 'none', render: renderPlan},
    {id: 'quality', label: 'Качество данных', filters: 'period', render: renderQuality},
  ];
  const TAB_OF_DIR = {'Органика': 'organic', 'Платный': 'paid', 'Работа с базой': 'base', 'Не определено': 'quality'};

  // Состояние: что выбрано сейчас. ui хранит сортировки, поиск и переключатели внутри вкладок.
  const S = {db: null, fromCache: false, tab: 'summary', from: '', to: '', preset: '', dirs: null, chans: null, ui: {}};
  const TABLES = {}; // видимые строки каждой таблицы, для выгрузки в CSV

  const $ = id => document.getElementById(id);
  const esc = v => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const tab = () => TABS.find(t => t.id === S.tab) || TABS[0];
  const ui = (k, def) => (k in S.ui ? S.ui[k] : def);
  const M = (k, v) => D.fmtMetric(k, v);

  // ================= Загрузка =================
  async function start() {
    $('logo').textContent = C.LOGO; $('appTitle').textContent = C.TITLE; document.title = C.TITLE;
    $('sheetLink').href = C.SHEET_URL;
    readHash();
    bindEvents();
    await reload(false);
  }

  async function reload(fresh) {
    const btn = $('reloadBtn'); btn.disabled = true;
    if (!S.db) { // пока таблица отвечает (3–8 секунд), показываем последние сохранённые данные
      const c = D.cached();
      if (c) { S.db = c; S.fromCache = 'loading'; if (!S.from) applyPreset(S.preset || C.DEFAULT_PERIOD); clampPeriod(); render(); }
    }
    if (S.db) $('view').classList.add('busy');
    try {
      const r = await D.load({fresh: fresh});
      S.db = r.db; S.fromCache = r.fromCache;
      if (r.db.sheetUrl) $('sheetLink').href = r.db.sheetUrl;
      if (!S.from) applyPreset(S.preset || C.DEFAULT_PERIOD);
      clampPeriod();
      render();
    } catch (e) {
      if (S.db) { S.fromCache = true; render(); return; }
      $('view').innerHTML = `<div class="error-box"><b>Не получилось загрузить данные из таблицы.</b><br>${esc(e.message)}<br><br>
        <button class="btn" data-action="retry">Попробовать ещё раз</button></div>`;
      $('updatedLabel').innerHTML = '<i class="warn"></i> Нет связи с таблицей';
    } finally {
      btn.disabled = false; $('view').classList.remove('busy');
    }
  }

  // ================= Период и фильтры =================
  function applyPreset(p) {
    const db = S.db, today = db.maxDate;
    S.preset = p;
    if (p === 'today') { S.from = S.to = today; }
    else if (p === 'yesterday') { S.from = S.to = D.addDays(today, -1); }
    else if (p === '7') { S.from = D.addDays(today, -6); S.to = today; }
    else if (p === '30') { S.from = D.addDays(today, -29); S.to = today; }
    else if (p === 'prevmonth') { S.from = D.monthStart(D.addDays(D.monthStart(today), -1)); S.to = D.monthEnd(S.from); }
    else if (p === 'all') { S.from = db.minDate; S.to = today; }
    else { S.preset = 'month'; S.from = D.monthStart(today); S.to = today; }
  }
  function clampPeriod() {
    if (!S.from || !S.to) applyPreset('month');
    if (S.from > S.to) { const x = S.from; S.from = S.to; S.to = x; }
  }
  function currentFilter() {
    const t = tab();
    if (t.dir) {
      const own = S.chans ? [...S.chans].filter(k => k.indexOf(t.dir + '|') === 0) : [];
      return {from: S.from, to: S.to, directions: new Set([t.dir]), channels: own.length ? new Set(own) : null};
    }
    if (t.filters === 'period') return {from: S.from, to: S.to, directions: null, channels: null};
    return {from: S.from, to: S.to, directions: S.dirs, channels: S.chans};
  }
  function rowsNow() { return D.filter(S.db, currentFilter()); }

  function filterHeading() {
    const t = tab(), f = currentFilter();
    const parts = [D.rangeLabel(S.from, S.to) + ' (' + D.daysBetween(S.from, S.to) + ' дн.)'];
    if (t.dir) parts.push(t.dir);
    else if (t.filters === 'all') parts.push(S.dirs ? [...S.dirs].join(', ') : 'все направления');
    if (t.filters === 'all' || t.filters === 'channels') parts.push(f.channels ? [...f.channels].map(k => k.split('|')[1]).join(', ') : 'все каналы');
    return parts.join(' · ');
  }

  // ================= Отрисовка =================
  function render() {
    const db = S.db; if (!db) return;
    const t = tab();
    $('nav').innerHTML = TABS.map(x => `<button type="button" class="nav-btn ${x.id === S.tab ? 'active' : ''}" data-tab="${x.id}">${esc(x.label)}</button>`).join('');
    const upd = db.updated || '';
    $('updatedLabel').innerHTML = S.fromCache === 'loading' ? `<i class="warn"></i> Данные на ${esc(upd)}, загружаю свежие…`
      : S.fromCache ? `<i class="warn"></i> Таблица не ответила, показаны сохранённые данные на ${esc(upd)}`
      : `<i></i> Данные таблицы на ${esc(upd)} · обновляются каждый час`;

    // фильтры
    $('filters').hidden = t.filters === 'none';
    $('dirFilter').hidden = t.filters !== 'all';
    $('chanFilter').hidden = !(t.filters === 'all' || t.filters === 'channels');
    $('filterHeading').textContent = filterHeading();
    $('dateFrom').value = S.from; $('dateTo').value = S.to;
    $('dateFrom').min = $('dateTo').min = db.minDate; $('dateFrom').max = $('dateTo').max = db.maxDate;
    document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('active', b.dataset.preset === S.preset));
    $('dirChips').innerHTML = `<button type="button" class="${!S.dirs ? 'active' : ''}" data-dir="">Все</button>` +
      DIRS.map(d => `<button type="button" class="${DIR_CLASS[d]} ${S.dirs && S.dirs.has(d) ? 'active' : ''}" data-dir="${esc(d)}">${esc(d === 'Платный' ? 'Платный трафик' : d)}</button>`).join('');
    const chanDirs = t.dir ? [t.dir] : (S.dirs ? [...S.dirs] : DIRS);
    const chans = [];
    chanDirs.forEach(d => (db.channelsByDir[d] || []).forEach(c => chans.push([d, c])));
    const ownSel = S.chans ? chans.filter(p => S.chans.has(p[0] + '|' + p[1])).length : 0;
    $('chanChips').innerHTML = `<button type="button" class="${!ownSel ? 'active' : ''}" data-chan="">Все</button>` +
      chans.map(p => `<button type="button" class="${DIR_CLASS[p[0]]} ${S.chans && S.chans.has(p[0] + '|' + p[1]) ? 'active' : ''}" data-chan="${esc(p[0] + '|' + p[1])}">${esc(p[1])}${!t.dir && chanDirs.length > 1 && (p[1] === 'Общие расходы' || p[1] === 'Instagram') ? `<em>${esc(p[0])}</em>` : ''}</button>`).join('');

    // вкладка
    const active = document.activeElement, focusKey = active && active.dataset ? active.dataset.search : null;
    const caret = focusKey ? active.selectionStart : 0;
    $('view').innerHTML = t.render();
    if (focusKey) { const el = document.querySelector(`[data-search="${focusKey}"]`); if (el) { el.focus(); el.setSelectionRange(caret, caret); } }
    writeHash();
  }

  function pageTitle(eyebrow, title, text) {
    const db = S.db;
    return `<div class="page-title"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1><p>${text}</p></div>
      <div class="source-status"><b>${S.fromCache ? 'Сохранённые данные' : 'Живые данные из таблицы'}</b><span>обновлено ${esc(db.updated || '—')}</span></div></div>`;
  }
  function kpi(label, value, small, cls) {
    return `<article class="${cls || ''}"><span>${esc(label)}</span><strong>${value}</strong><small>${small || '&nbsp;'}</small></article>`;
  }
  function pill(dir, text) { return `<span class="pill ${DIR_CLASS[dir] || 'gray'}">${esc(text || dir)}</span>`; }
  function share(a, b) { return b ? D.fmt(a / b, 'pct') : '—'; }

  // ---------- таблица с сортировкой, поиском, итогом и CSV ----------
  // cols: [{key, label, fmt, num, get(r), html(r), sum: true|false}]. Итог: суммы базовых показателей и пересчёт долей.
  function table(id, cols, rows, opt) {
    opt = opt || {};
    const st = S.ui['t:' + id] || (S.ui['t:' + id] = {sort: opt.sort || null, asc: !!opt.asc, q: ''});
    let list = rows;
    if (opt.search && st.q) { const q = st.q.toLowerCase(); list = list.filter(r => opt.search(r).toLowerCase().indexOf(q) >= 0); }
    if (st.sort) {
      const c = cols.find(x => x.key === st.sort) || cols[0], g = c.get || (r => r[c.key]);
      list = list.slice().sort((a, b) => cmp(g(a), g(b), st.asc));
    }
    let tot = null;
    if (opt.totals !== false) {
      tot = D.sum(list);
      cols.forEach(c => { if (c.sum && !(c.key in tot && D.BASE.indexOf(c.key) >= 0)) { const g = c.get || (r => r[c.key]); tot[c.key] = list.reduce((s, r) => s + (Number(g(r)) || 0), 0); } });
    }
    TABLES[id] = {cols, rows: list, tot, name: opt.csvName || id};
    const val = (c, r) => c.html ? c.html(r) : (c.fmt ? D.fmt((c.get || (x => x[c.key]))(r), c.fmt) : esc((c.get || (x => x[c.key]))(r)));
    const th = cols.map(c => `<th class="${c.num ? 'num' : ''} ${st.sort === c.key ? 'sorted' + (st.asc ? ' asc' : '') : ''}" data-sort="${id}|${c.key}" ${c.tip ? `title="${esc(c.tip)}"` : ''}>${esc(c.label)}</th>`).join('');
    const body = list.length ? list.map(r => {
      const attrs = opt.rowAttrs ? opt.rowAttrs(r) : '';
      return `<tr ${attrs}>${cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${val(c, r)}</td>`).join('')}</tr>` + (opt.after ? opt.after(r) : '');
    }).join('') : `<tr><td colspan="${cols.length}" class="empty">${esc(opt.empty || 'Нет данных за выбранный период')}</td></tr>`;
    const hasTot = c => !c.noTotal && c.fmt && tot && (c.key in tot);
    let span = cols.findIndex((c, i) => i > 0 && hasTot(c)); if (span < 1) span = cols.length;
    const foot = tot && list.length ? `<tfoot><tr><td colspan="${span}">Итого по видимым строкам: ${list.length}</td>${cols.slice(span).map(c =>
      hasTot(c) ? `<td class="num">${D.fmt(tot[c.key], c.fmt)}</td>` : '<td></td>').join('')}</tr></tfoot>` : '';
    return `<div class="table-wrap ${opt.short ? 'short' : ''}"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
  }
  function tableTools(id, opt) {
    opt = opt || {};
    const q = (S.ui['t:' + id] || {}).q || '';
    return (opt.search ? `<input type="search" placeholder="${esc(opt.search)}" value="${esc(q)}" data-search="${id}">` : '') +
      `<button type="button" class="btn" data-csv="${id}">Скачать CSV</button>`;
  }
  function cmp(a, b, asc) {
    const ea = a === null || a === undefined || a === '', eb = b === null || b === undefined || b === '';
    if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1; // пустые всегда внизу
    const r = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ru');
    return asc ? r : -r;
  }
  function downloadCsv(id) {
    const t = TABLES[id]; if (!t) return;
    const cell = (c, r) => {
      const v = (c.get || (x => x[c.key]))(r);
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') {
        if (c.fmt === 'pct' || c.fmt === 'pct0') return (Math.round(v * 1000) / 10).toString().replace('.', ',') + '%';
        if (c.fmt === 'usd') return v.toFixed(2).replace('.', ',');
        return String(Math.round(v));
      }
      return String(c.csv ? c.csv(r) : v);
    };
    const q = s => /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    const lines = [t.cols.map(c => q(c.label)).join(';')];
    t.rows.forEach(r => lines.push(t.cols.map(c => q(cell(c, r))).join(';')));
    if (t.tot) lines.push(t.cols.map((c, i) => i === 0 ? 'Итого' : (c.noTotal || !(c.key in t.tot) || !c.fmt) ? '' : q(cell(Object.assign({}, c, {get: x => x[c.key]}), t.tot))).join(';'));
    const blob = new Blob(['﻿' + lines.join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${t.name}_${S.from}_${S.to}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- общие кусочки ----------
  function titleCell(r) {
    const link = safeUrl(r.link);
    const sub = [r.code ? esc(r.code) : '', link ? `<a class="ext" href="${esc(link)}" target="_blank" rel="noreferrer" title="Открыть публикацию в новой вкладке">открыть ↗</a>` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="unit-link" data-unit="${esc(r.key)}" title="${esc(r.title)}">${esc(r.title)}</button>` +
      (sub ? `<span class="code">${sub}</span>` : '');
  }
  function igViews(r) {
    const ig = r.info && r.info.instagram;
    return ig && r.pubDate && r.pubDate >= S.from && r.pubDate <= S.to ? ig.views : null;
  }
  const COL = {
    pub: {key: 'pubDate', label: 'Дата', get: r => r.pubDate || null, html: r => r.pubDate ? D.dShort(r.pubDate) : '<span class="muted">—</span>'},
    chan: {key: 'channel', label: 'Канал', html: r => `<span class="pill gray">${esc(r.channel)}</span>`},
    dir: {key: 'direction', label: 'Направление', html: r => pill(r.direction)},
    title: {key: 'title', label: 'Публикация / единица', cls: 'title-cell', html: titleCell, csv: r => r.title},
    kw: {key: 'keyword', label: 'Слово'},
    format: {key: 'format', label: 'Формат'},
    views: {key: 'views', label: 'Просмотры', num: true, fmt: 'int', sum: true, get: igViews, tip: 'Из Instagram, за всё время публикации. Показываем, если публикация вышла в выбранный период'},
  };
  const metricCol = (k, extra) => Object.assign({key: k, label: D.METRIC[k].label.replace(' в бота', ''), num: true, fmt: D.METRIC[k].fmt}, extra || {});
  function unitRows(rows, opt) {
    opt = opt || {};
    return D.byUnit(S.db, rows).filter(u => (opt.ads || !u.isAds) && (opt.unknown !== false || !u.isUnknown));
  }
  function unitSearch(r) { return [r.title, r.code, r.keyword, r.format, r.channel, r.material].join(' '); }

  const TOP_METRICS = ['revenue', 'sales', 'valid', 'forms', 'registrations', 'reach', 'actions'];
  function topPanel(id, units, title, text, def) {
    const metric = ui('top:' + id, def || 'revenue');
    const list = units.filter(u => (u[metric] || 0) > 0).sort((a, b) => b[metric] - a[metric] || b.revenue - a.revenue).slice(0, C.TOP_N);
    const max = list.length ? list[0][metric] : 0;
    const rows = list.map((u, i) => `<div class="top-row"><span>${i + 1}</span>
      <div class="t"><button type="button" class="unit-link" data-unit="${esc(u.key)}" title="${esc(u.title)}">${esc(u.title)}</button>
      <small>${esc(u.channel)}${u.pubDate ? ' · ' + D.dShort(u.pubDate) : ''}${u.code ? ' · ' + esc(u.code) : ''}</small></div>
      <div class="bar"><i style="width:${max ? Math.max(2, u[metric] / max * 100) : 0}%"></i></div><b>${M(metric, u[metric])}</b></div>`).join('');
    return `<div class="panel"><div class="panel-head"><div><h2>${esc(title)}</h2><p>${text}</p></div>
      <div class="panel-tools"><label>Показатель <select data-ui="top:${id}">${TOP_METRICS.map(k => `<option value="${k}" ${k === metric ? 'selected' : ''}>${esc(D.METRIC[k].label.toLowerCase())}</option>`).join('')}</select></label></div></div>
      ${rows ? `<div class="top-list">${rows}</div>` : `<div class="empty">За период нет ${esc(D.METRIC[metric].label.toLowerCase())}</div>`}</div>`;
  }

  // ================= Вкладка «Сводка» =================
  function renderSummary() {
    const db = S.db, rows = rowsNow(), t = D.sum(rows), dc = D.byDirChannel(db, rows);
    const adsCost = rows.filter(r => r.unit.indexOf('ads:') === 0).reduce((s, r) => s + r.cost, 0);
    const unk = (dc['Не определено'] || {}).total || D.zero();
    const costsEmpty = /пусто/i.test(statusOf('Затраты'));
    let h = pageTitle('Общая сводка', 'Маркетинг за период', `${esc(D.rangeLabel(S.from, S.to))}. Все цифры считаются по видимым фильтрам.`);
    h += `<div class="kpi-grid">` +
      kpi('Охват', M('reach', t.reach), 'публикации и показы рекламы') +
      kpi('Регистрации в бота', M('registrations', t.registrations), 'регистрация → анкета ' + M('regToForm', t.regToForm)) +
      kpi('Анкеты', M('forms', t.forms), 'цена анкеты (CPL) ' + M('cpl', t.cpl), 'strong-card') +
      kpi('Валидные анкеты', M('valid', t.valid), share(t.valid, t.forms) + ' от анкет · цена ' + M('cpValid', t.cpValid)) +
      kpi('Продажи', M('sales', t.sales), 'анкета → продажа ' + M('formToSale', t.formToSale)) +
      kpi('Сумма продаж', M('revenue', t.revenue), 'средний чек ' + (t.sales ? D.fmt(t.revenue / t.sales, 'money') : '—'), 'strong-card') +
      kpi('Затраты', M('cost', t.cost), 'реклама ' + D.fmt(adsCost, 'money') + (t.cost - adsCost ? ' · прочие ' + D.fmt(t.cost - adsCost, 'money') : '')) +
      kpi('ROMI', M('romi', t.romi), t.cost ? 'окупаемость ' + M('payback', t.payback) : 'затрат за период нет', t.romi === null ? '' : t.romi >= 0 ? 'profit-card' : 'loss-card') +
      `</div>`;
    if (unk.forms) h += `<div class="alert"><strong>${M('forms', unk.forms)} ${plural(unk.forms, 'анкета', 'анкеты', 'анкет')} без источника (${share(unk.forms, t.forms)})</strong>
      <span>В amoCRM у сделки нет метки или кода, поэтому направление не определено.</span><button type="button" data-tab="quality">Подробнее</button></div>`;
    if (costsEmpty) h += `<div class="alert info"><strong>Затраты команды не внесены</strong><span>ROMI и окупаемость сейчас считаются только по рекламе. Зарплаты и подрядчиков вносят в лист «Затраты».</span><a href="${esc(db.sheetUrl || C.SHEET_URL)}" target="_blank" rel="noreferrer">Открыть таблицу ↗</a></div>`;

    h += planSummary();

    h += `<div class="panel"><div class="panel-head"><div><h2>Направления</h2><p>Нажмите на карточку, чтобы открыть направление.</p></div></div><div class="direction-grid">` +
      DIRS.filter(d => !S.dirs || S.dirs.has(d)).map(d => {
        const x = (dc[d] || {}).total || D.derive(D.zero());
        return `<button type="button" class="direction-card ${DIR_CLASS[d]}" data-tab="${TAB_OF_DIR[d]}"><header><span>${esc(d)}</span><b>${share(x.forms, t.forms)} анкет</b></header><dl>
          <dt>Регистрации</dt><dd>${M('registrations', x.registrations)}</dd><dt>Анкеты</dt><dd>${M('forms', x.forms)}</dd>
          <dt>Валидные</dt><dd>${M('valid', x.valid)}</dd><dt>Продажи</dt><dd>${M('sales', x.sales)}</dd>
          <dt>Сумма продаж</dt><dd>${M('revenue', x.revenue)}</dd><dt>Затраты</dt><dd>${M('cost', x.cost)}</dd><dt>CPL</dt><dd>${M('cpl', x.cpl)}</dd></dl></button>`;
      }).join('') + `</div></div>`;

    const steps = [['reach', 'Охват'], ['actions', 'Целевые действия'], ['registrations', 'Регистрации'], ['forms', 'Анкеты'], ['valid', 'Валидные'], ['sales', 'Продажи']];
    const funnel = steps.map((s, i) => {
      const prev = i ? t[steps[i - 1][0]] : 0, v = t[s[0]];
      const conv = i && prev && v <= prev ? D.fmt(v / prev, 'pct') + ' от прошлого шага' : i ? '&nbsp;' : 'начало воронки';
      return `<div class="funnel-step"><div><span>${esc(s[1])}</span><strong>${M(s[0], v)}</strong><small>${conv}</small></div></div>`;
    }).join('');
    const donutBy = t.revenue ? 'revenue' : 'forms';
    const parts = DIRS.map(d => [d, ((dc[d] || {}).total || {})[donutBy] || 0]).filter(p => p[1] > 0);
    const all = parts.reduce((s, p) => s + p[1], 0);
    let acc = 0;
    const grad = parts.map(p => { const a = acc / all * 360, b = (acc += p[1]) / all * 360; return `${DIR_COLOR[p[0]]} ${a}deg ${Math.max(a, b - 1)}deg, #fff ${Math.max(a, b - 1)}deg ${b}deg`; }).join(', ');
    h += `<div class="two-col"><div class="panel"><div class="panel-head"><div><h2>Воронка</h2><p>От охвата до продажи. Конверсия больше 100% не показывается: часть анкет приходит не через бота.</p></div></div><div class="funnel">${funnel}</div></div>
      <div class="panel"><div class="panel-head"><div><h2>${donutBy === 'revenue' ? 'Сумма продаж' : 'Анкеты'} по направлениям</h2><p>Доля каждого направления.</p></div></div>
      <div class="attribution"><div class="donut" style="background:${all ? `conic-gradient(${grad})` : '#eef1f5'}"><span>${all ? (donutBy === 'revenue' ? D.fmtShort(all) : M(donutBy, all)) : '—'}</span><small>${donutBy === 'revenue' ? 'сумма продаж' : 'анкеты'}</small></div>
      <div class="legend-list">${parts.map(p => `<div class="legend-row"><i style="background:${DIR_COLOR[p[0]]}"></i><span>${esc(p[0])}</span><b>${M(donutBy, p[1])}</b><em>${D.fmt(p[1] / all, 'pct0')}</em></div>`).join('') || '<span class="muted">Нет данных</span>'}</div></div></div></div>`;

    h += topPanel('summary', unitRows(rows, {unknown: false}), `Топ-${C.TOP_N} публикаций и креативов`, 'Самые результативные за период. Нажмите на название, чтобы открыть карточку.');
    return h;
  }

  function planSummary() {
    const db = S.db, month = S.from.slice(0, 7) === S.to.slice(0, 7) ? S.to.slice(0, 7) : db.maxDate.slice(0, 7);
    const plan = D.planFor(db, month);
    if (!plan.total) return `<div class="alert info"><strong>План на ${esc(D.monthLabel(month + '-01').toLowerCase())} не заполнен</strong>
      <span>Внесите план анкет, валидных, продаж и суммы в лист «План», и здесь появится план-факт.</span><button type="button" data-tab="plan">План-факт</button></div>`;
    const fact = D.sum(D.filter(db, {from: month + '-01', to: D.monthEnd(month + '-01')}));
    return `<div class="panel"><div class="panel-head"><div><h2>План на ${esc(D.monthLabel(month + '-01').toLowerCase())}</h2><p>Весь месяц, все направления. Черта на полосе: где надо быть сегодня, чтобы выполнить план.</p></div>
      <div class="panel-tools"><button type="button" class="btn" data-tab="plan">Подробно по каналам</button></div></div>
      <div class="plan-grid">${D.PLAN_METRICS.map(k => planCard(k, fact[k], plan.total[k], month)).join('')}</div></div>`;
  }
  function planProgress(fact, plan, month) {
    const today = S.db.maxDate, start = month + '-01', end = D.monthEnd(start);
    const exp = today < start ? 0 : today > end ? 1 : D.daysBetween(start, today) / D.daysBetween(start, end);
    const p = plan ? fact / plan : 0;
    const cls = p >= 1 ? 'done' : (today >= start && p < exp - 0.1) ? 'behind' : '';
    return {p, exp, cls, bar: `<div class="progress"><i class="${cls}" style="width:${Math.min(100, p * 100)}%"></i>${exp > 0 && exp < 1 ? `<u style="left:${exp * 100}%"></u>` : ''}</div>`};
  }
  function planCard(k, fact, plan, month) {
    const m = D.METRIC[k];
    if (plan === null || plan === undefined) return `<div class="plan-card"><span>${esc(m.label)}</span><strong>${M(k, fact)}</strong><small>плана нет</small></div>`;
    const pr = planProgress(fact, plan, month), fc = D.forecast(fact, month, S.db.maxDate);
    const left = plan - fact;
    return `<div class="plan-card"><span>${esc(m.label)}</span><strong>${M(k, fact)} <em>из ${M(k, plan)}</em></strong>${pr.bar}
      <small>${left > 0 ? 'осталось ' + M(k, left) : 'план выполнен'} · ${D.fmt(pr.p, 'pct0')}</small>
      <small>${fc !== null && month >= S.db.maxDate.slice(0, 7) ? 'прогноз к концу месяца ' + M(k, fc) : '&nbsp;'}</small></div>`;
  }

  // ================= Вкладки «Органика» и «Работа с базой» =================
  function renderDirection() {
    const db = S.db, t0 = tab(), dir = t0.dir, rows = rowsNow(), t = D.sum(rows), dc = D.byDirChannel(db, rows)[dir] || {channels: {}};
    const units = unitRows(rows);
    const hasCost = t.cost > 0;
    let h = pageTitle('Направление', dir, `${esc(D.rangeLabel(S.from, S.to))}. Публикации, входы в бота, анкеты и продажи${dir === 'Органика' ? ' из Instagram' : ' из базы (ТГ-канал, бот, почта, рассылки)'}.`);
    h += `<div class="kpi-grid">` +
      kpi('Публикации', M('publications', t.publications), 'вышло за период') +
      kpi('Охват', M('reach', t.reach), 'по опубликованным за период') +
      kpi('Целевые действия', M('actions', t.actions), 'переходы, ответы, клики') +
      kpi('Регистрации в бота', M('registrations', t.registrations), 'регистрация → анкета ' + M('regToForm', t.regToForm)) +
      kpi('Анкеты', M('forms', t.forms), hasCost ? 'CPL ' + M('cpl', t.cpl) : 'валидных ' + share(t.valid, t.forms), 'strong-card') +
      kpi('Валидные анкеты', M('valid', t.valid), share(t.valid, t.forms) + ' от анкет') +
      kpi('Продажи', M('sales', t.sales), 'анкета → продажа ' + M('formToSale', t.formToSale)) +
      kpi('Сумма продаж', M('revenue', t.revenue), hasCost ? 'затраты ' + M('cost', t.cost) + ' · ROMI ' + M('romi', t.romi) : 'затрат нет', 'strong-card') +
      `</div>`;

    const chRows = Object.keys(dc.channels).map(c => Object.assign({channel: c, direction: dir}, dc.channels[c]))
      .filter(r => D.BASE.some(k => r[k]));
    const chCols = [{key: 'channel', label: 'Канал', html: r => `<button type="button" class="unit-link" data-chan-only="${esc(dir + '|' + r.channel)}" title="Показать только этот канал">${esc(r.channel)}</button>`},
      metricCol('publications'), metricCol('reach'), metricCol('registrations'), metricCol('forms'), metricCol('valid'), metricCol('sales'), metricCol('revenue')]
      .concat(hasCost ? [metricCol('cost'), metricCol('cpl', {label: 'CPL'})] : []);
    h += `<div class="two-col"><div class="panel"><div class="panel-head"><div><h2>Каналы</h2><p>Нажмите на канал, чтобы оставить только его.</p></div><div class="panel-tools">${tableTools('ch-' + t0.id)}</div></div>
      ${table('ch-' + t0.id, chCols, chRows, {sort: 'forms', short: true, csvName: 'kanaly_' + t0.id})}</div>
      ${topPanel(t0.id, units.filter(u => !u.isUnknown), `Топ-${C.TOP_N}`, 'Самые результативные публикации за период.')}</div>`;

    const unitCost = units.some(u => u.cost > 0);
    const cols = [COL.pub, COL.chan, COL.title, COL.kw, COL.format]
      .concat(dir === 'Органика' ? [COL.views] : [])
      .concat([metricCol('reach', {tip: 'У рилсов и пробников здесь просмотры (как в рабочей таблице), у остальных публикаций охват'}), metricCol('actions', {label: 'Действия'}), metricCol('registrations'), metricCol('forms'), metricCol('valid'), metricCol('sales'), metricCol('revenue'),
        metricCol('regToForm', {label: 'Рег. → анкета'})])
      .concat(unitCost ? [metricCol('cost'), metricCol('cpl', {label: 'CPL'})] : []);
    const st = S.ui['t:u-' + t0.id];
    const shown = st && st.q ? units.filter(r => unitSearch(r).toLowerCase().indexOf(st.q.toLowerCase()) >= 0).length : units.length;
    h += `<div class="panel"><div class="panel-head"><div><h2>Публикации и результаты</h2><p>Каждая строка: публикация (или своя ссылка) и что она принесла за период. Нажмите на название, чтобы открыть карточку со сценарием и статистикой Instagram.</p></div>
      <div class="panel-tools">${tableTools('u-' + t0.id, {search: 'Название, код или кодовое слово'})}</div></div>
      <div class="result-strip"><span>Строк: ${shown}</span><span>Опубликовано за период: ${M('publications', t.publications)}</span><span>С анкетами: ${units.filter(u => u.forms > 0).length}</span><span>С продажами: ${units.filter(u => u.sales > 0).length}</span></div>
      ${table('u-' + t0.id, cols, units, {sort: 'pubDate', search: unitSearch, csvName: 'publikacii_' + t0.id})}</div>`;

    if (dir === 'Органика') h += igPanel();
    return h;
  }

  function igPanel() {
    const list = S.db.igDaily.filter(r => r.date >= S.from && r.date <= S.to);
    if (!list.length) return '';
    const last = S.db.igDaily.filter(r => r.followers).slice(-1)[0];
    const cols = [{key: 'date', label: 'День', html: r => D.dShort(r.date) + ' ' + D.weekday(r.date)},
      {key: 'accountReach', label: 'Охват аккаунта', num: true, fmt: 'int', noTotal: true, tip: 'Уникальные люди за сутки по времени Meta (тихоокеанское). За сегодня Meta отдаёт цифру на следующий день'},
      {key: 'followers', label: 'Подписчики', num: true, fmt: 'int', noTotal: true}, {key: 'growth', label: 'Прирост', num: true, fmt: 'int', sum: true}];
    return `<div class="panel"><div class="panel-head"><div><h2>Аккаунт Instagram по дням</h2><p>Охват всего аккаунта (не сумма публикаций) и подписчики${last ? `: сейчас ${M('reach', last.followers)}` : ''}. Охват аккаунта за день не складывается: один человек мог видеть аккаунт несколько дней.</p></div>
      <div class="panel-tools">${tableTools('ig')}</div></div>${table('ig', cols, list, {sort: 'date', short: true, totals: true, csvName: 'instagram_po_dnyam'})}</div>`;
  }

  // ================= Вкладка «Платный трафик» =================
  function renderPaid() {
    const db = S.db, rows = rowsNow(), t = D.sum(rows);
    const ads = db.ads.filter(a => a.date >= S.from && a.date <= S.to);
    const usd = ads.reduce((s, a) => s + (a.spendUsd || 0), 0);
    const lastAds = db.ads.length ? db.ads[db.ads.length - 1].date : '';
    const ctr = t.reach ? t.actions / t.reach : null;
    let h = pageTitle('Направление', 'Платный трафик', `${esc(D.rangeLabel(S.from, S.to))}. Расход, показы, клики и входы из таблицы таргетолога; анкеты и продажи по меткам в amoCRM.`);
    h += `<div class="kpi-grid">` +
      kpi('Расход', M('cost', t.cost), usd ? D.fmt(usd, 'usd') + ' по курсу месяца' : 'нет расхода за период', 'strong-card') +
      kpi('Показы', M('reach', t.reach), 'CTR ' + (ctr === null ? '—' : D.fmt(ctr, 'pct'))) +
      kpi('Клики', M('actions', t.actions), 'цена клика ' + (t.actions ? D.fmt(t.cost / t.actions, 'money') : '—')) +
      kpi('Входы в бота', M('registrations', t.registrations), 'цена входа ' + (t.registrations ? D.fmt(t.cost / t.registrations, 'money') : '—')) +
      kpi('Анкеты', M('forms', t.forms), 'CPL ' + M('cpl', t.cpl), 'strong-card') +
      kpi('Валидные анкеты', M('valid', t.valid), share(t.valid, t.forms) + ' · цена ' + M('cpValid', t.cpValid)) +
      kpi('Продажи', M('sales', t.sales), 'на ' + M('revenue', t.revenue)) +
      kpi('ROMI', M('romi', t.romi), t.cost ? 'окупаемость ' + M('payback', t.payback) : 'расхода нет', t.romi === null ? '' : t.romi >= 0 ? 'profit-card' : 'loss-card') +
      `</div>`;
    if (lastAds && D.daysBetween(lastAds, db.maxDate) > 2) h += `<div class="alert"><strong>Реклама в таблице таргетолога по ${D.dFull(lastAds)}</strong><span>Дни после этой даты без расхода, показов и кликов, пока таргетолог их не внесёт.</span></div>`;

    const creatives = unitRows(rows).filter(u => !u.isAds);
    h += `<div class="two-col">${topPanel('paid', creatives.filter(u => !u.isUnknown), `Креативы: топ-${C.TOP_N}`, 'По меткам в amoCRM: какой креатив привёл анкету и продажу.', 'forms')}
      <div class="panel"><div class="panel-head"><div><h2>Как считается</h2></div></div><ul class="check-list">
      <li>Расход, показы, клики и входы в бота берутся из таблицы таргетолога по дням. Разбивки по креативам там нет, поэтому расход стоит одной строкой «Таргет».</li>
      <li>Анкеты и продажи привязаны к креативу по метке трафика в amoCRM («кампания | группа | объявление»).</li>
      <li>Расход в долларах переводится в тенге по среднему курсу месяца (лист «Курс»).</li>
      <li>Бюджет по рекламным кампаниям добавим, когда будет понятен формат у таргетолога.</li></ul></div></div>`;

    const crCols = [{key: 'title', label: 'Креатив', cls: 'title-cell', html: titleCell, csv: r => r.title}, metricCol('forms'), metricCol('valid'),
      {key: 'validShare', label: '% валидных', num: true, fmt: 'pct', noTotal: true, get: r => r.forms ? r.valid / r.forms : null},
      metricCol('sales'), metricCol('revenue'), metricCol('formToSale', {label: 'Анкета → продажа'})];
    h += `<div class="panel"><div class="panel-head"><div><h2>Креативы</h2><p>Анкеты и продажи по креативам за период. «Источник не определён»: платная сделка без метки креатива.</p></div>
      <div class="panel-tools">${tableTools('cr', {search: 'Креатив или группа'})}</div></div>
      ${table('cr', crCols, creatives, {sort: 'forms', search: r => r.title, csvName: 'kreativy'})}</div>`;

    // по дням: показатели «Платного» + доллары из таблицы таргетолога
    const days = D.byPeriod(rows, S.from, S.to, 'day');
    const usdBy = {}; ads.forEach(a => { usdBy[a.date] = a.spendUsd; });
    const dayRows = days.filter(b => D.BASE.some(k => b[k]) || usdBy[b.start]).map(b => Object.assign(b, {date: b.start, usd: usdBy[b.start] || 0}));
    const dCols = [{key: 'date', label: 'День', html: r => D.dShort(r.date) + ' ' + D.weekday(r.date)},
      {key: 'usd', label: 'Расход, $', num: true, fmt: 'usd', sum: true}, metricCol('cost', {label: 'Расход, ₸'}),
      metricCol('reach', {label: 'Показы'}), metricCol('actions', {label: 'Клики'}),
      {key: 'ctr', label: 'CTR', num: true, fmt: 'pct', noTotal: true, get: r => r.reach ? r.actions / r.reach : null},
      metricCol('registrations', {label: 'Входы в бота'}), metricCol('forms'), metricCol('valid'), metricCol('cpl', {label: 'CPL'}),
      metricCol('sales'), metricCol('revenue')];
    h += `<div class="panel"><div class="panel-head"><div><h2>Реклама по дням</h2><p>Дни, где был расход или результат.</p></div><div class="panel-tools">${tableTools('ads')}</div></div>
      ${table('ads', dCols, dayRows, {sort: 'date', csvName: 'reklama_po_dnyam'})}</div>`;
    return h;
  }

  // ================= Вкладка «Динамика» =================
  function renderDynamics() {
    const db = S.db, rows = rowsNow();
    const grain = ui('dyn:grain', D.daysBetween(S.from, S.to) > 120 ? 'week' : 'day');
    const metric = ui('dyn:metric', 'forms');
    const buckets = D.byPeriod(rows, S.from, S.to, grain);
    const ig = {}; db.igDaily.forEach(r => { ig[r.date] = r; });
    buckets.forEach(b => { b.date = b.start; if (grain === 'day' && ig[b.start]) { b.accountReach = ig[b.start].accountReach; b.followers = ig[b.start].followers; } });
    const vals = buckets.map(b => b[metric] === null || b[metric] === undefined ? 0 : b[metric]);
    const max = Math.max.apply(null, vals.concat([0]));
    const tot = D.sum(rows);
    const unitName = grain === 'day' ? 'день' : grain === 'week' ? 'неделю' : 'месяц';
    const best = buckets.reduce((m, b) => (b[metric] || 0) > ((m && m[metric]) || 0) ? b : m, null);
    const step = Math.ceil(buckets.length / 16);
    const open = ui('dyn:open', '');

    let h = pageTitle('Динамика', 'По дням, неделям и месяцам', `${esc(D.rangeLabel(S.from, S.to))}. Нажмите на столбик или строку, чтобы увидеть публикации и результаты этого периода.`);
    h += `<div class="panel"><div class="panel-head"><div class="chart-summary">
        <div><span>${esc(D.METRIC[metric].label)} за период</span><strong>${M(metric, tot[metric])}</strong></div>
        ${D.METRIC[metric].fmt === 'int' || D.METRIC[metric].fmt === 'money' ? `<div><span>В среднем за ${unitName}</span><strong>${M(metric, buckets.length ? tot[metric] / buckets.length : 0)}</strong></div>` : ''}
        <div><span>${grain === 'week' ? 'Лучшая неделя' : grain === 'month' ? 'Лучший месяц' : 'Лучший день'}</span><strong>${best && best[metric] ? esc(D.periodLabel(best, grain)) + ': ' + M(metric, best[metric]) : '—'}</strong></div></div>
      <div class="panel-tools"><div class="seg">${[['day', 'Дни'], ['week', 'Недели'], ['month', 'Месяцы']].map(g => `<button type="button" data-seg="dyn:grain" data-val="${g[0]}" class="${g[0] === grain ? 'active' : ''}">${g[1]}</button>`).join('')}</div>
      <label>Показатель <select data-ui="dyn:metric">${D.METRICS.map(m => `<option value="${m.key}" ${m.key === metric ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label></div></div>
      <div class="bars">${buckets.map((b, i) => {
        const v = vals[i], ht = max ? Math.max(1, v / max * 100) : 0;
        return `<div class="bar-item ${v ? '' : 'zero'}" data-day="${b.start}" data-tip-v="${esc(M(metric, b[metric]))}" data-tip-l="${esc(D.periodLabel(b, grain))}">
          ${b === best && v ? `<span class="bar-value" style="bottom:calc(${ht}% + 4px)">${esc(M(metric, v))}</span>` : ''}<div class="bar-rect" style="height:${ht}%"></div></div>`;
      }).join('')}</div>
      <div class="bar-axis">${buckets.map((b, i) => `<span>${i % step === 0 ? esc(grain === 'month' ? D.monthLabel(b.start).split(' ')[0].slice(0, 3) : D.dShort(b.from)) : ''}</span>`).join('')}</div></div>`;

    const cols = [{key: 'date', label: grain === 'day' ? 'День' : grain === 'week' ? 'Неделя' : 'Месяц', html: r => `<b>${esc(D.periodLabel(r, grain))}</b> <span class="muted small">${r.start === open ? '▲' : '▼'}</span>`},
      metricCol('publications'), metricCol('reach'), metricCol('actions', {label: 'Действия'}), metricCol('registrations'), metricCol('forms'), metricCol('valid'),
      metricCol('sales'), metricCol('revenue'), metricCol('cost'), metricCol('cpl', {label: 'CPL'})]
      .concat(grain === 'day' ? [{key: 'accountReach', label: 'Охват аккаунта IG', num: true, fmt: 'int', noTotal: true, tip: 'Охват всего аккаунта Instagram за сутки (время Meta)'}, {key: 'followers', label: 'Подписчики', num: true, fmt: 'int', noTotal: true}] : []);
    h += `<div class="panel"><div class="panel-head"><div><h2>Таблица</h2><p>Нажмите на строку: откроется список публикаций и того, что принесло результат. Пустые ${grain === 'day' ? 'дни' : 'периоды'} в таблице скрыты, на графике они есть.</p></div><div class="panel-tools">${tableTools('dyn')}</div></div>
      ${table('dyn', cols, buckets.filter(r => D.BASE.some(k => r[k]) || r.accountReach || r.followers), {sort: 'date', csvName: 'dinamika_' + grain, empty: 'За период нет данных',
        rowAttrs: r => `class="clickable ${r.start === open ? 'open' : ''}" data-day="${r.start}"`,
        after: r => r.start === open ? `<tr class="details"><td colspan="${cols.length}">${periodDetails(r)}</td></tr>` : ''})}</div>`;
    return h;
  }
  function periodDetails(b) {
    const rows = D.filter(S.db, Object.assign(currentFilter(), {from: b.from, to: b.to}));
    const units = D.byUnit(S.db, rows);
    const pubs = units.filter(u => u.publications > 0).sort((a, c) => (a.pubDate || '').localeCompare(c.pubDate || ''));
    const res = units.filter(u => u.registrations || u.forms || u.sales).sort((a, c) => c.revenue - a.revenue || c.forms - a.forms || c.registrations - a.registrations);
    const line = u => `<div>${pill(u.direction, u.channel)} ${titleCell(u)} ${u.pubDate && b.from !== b.to ? `<span class="muted small">${D.dShort(u.pubDate)}</span>` : ''}
      <span class="muted small">${[u.reach ? 'охват ' + M('reach', u.reach) : '', u.registrations ? 'рег. ' + u.registrations : '', u.forms ? 'анкет ' + u.forms : '', u.valid ? 'валидных ' + u.valid : '', u.sales ? 'продаж ' + u.sales + ' на ' + M('revenue', u.revenue) : '', u.isAds && u.cost ? 'расход ' + M('cost', u.cost) : ''].filter(Boolean).join(' · ')}</span></div>`;
    return `<div class="half"><div><h3 class="small muted">ВЫШЛО (${pubs.length})</h3><div class="day-list">${pubs.map(line).join('') || '<span class="muted">Публикаций нет</span>'}</div></div>
      <div><h3 class="small muted">ПРИНЕСЛО РЕЗУЛЬТАТ (${res.length})</h3><div class="day-list">${res.map(line).join('') || '<span class="muted">Регистраций, анкет и продаж нет</span>'}</div></div></div>`;
  }

  // ================= Вкладка «План-факт» =================
  function renderPlan() {
    const db = S.db, today = db.maxDate;
    const months = [];
    for (let m = (db.since || db.minDate).slice(0, 7); m <= D.addDays(D.monthEnd(today), 1).slice(0, 7); m = D.addDays(D.monthEnd(m + '-01'), 1).slice(0, 7)) months.push(m);
    (db.plan || []).forEach(p => { if (p.month && months.indexOf(p.month) < 0) months.push(p.month); });
    months.sort();
    const month = ui('plan:month', today.slice(0, 7));
    const plan = D.planFor(db, month);
    const rows = D.filter(db, {from: month + '-01', to: D.monthEnd(month + '-01')});
    const total = D.sum(rows), dc = D.byDirChannel(db, rows);

    let h = pageTitle('План-факт', 'План на месяц и сколько осталось', `Факт считается за весь месяц. План вносится в лист «План» таблицы: месяц, направление, канал (необязательно) и цифры.`);
    h += `<div class="panel"><div class="panel-head"><div><h2>${esc(D.monthLabel(month + '-01'))}</h2><p>${month === today.slice(0, 7) ? `Прошло ${D.daysBetween(month + '-01', today)} из ${D.daysBetween(month + '-01', D.monthEnd(month + '-01'))} дней. Прогноз: если темп сохранится.` : month > today.slice(0, 7) ? 'Месяц ещё не начался.' : 'Месяц закончился.'}</p></div>
      <div class="panel-tools"><label>Месяц <select data-ui="plan:month">${months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(D.monthLabel(m + '-01'))}</option>`).join('')}</select></label>
      <a class="btn" style="line-height:37px;text-decoration:none" href="${esc(db.sheetUrl || C.SHEET_URL)}" target="_blank" rel="noreferrer">Заполнить план в таблице ↗</a></div></div>`;
    if (!plan.has) h += `<div class="alert info"><strong>План на этот месяц не заполнен</strong><span>Пример: 300 анкет = 100 из рилсов + 150 из платного + 50 из базы. Строка «Все» — общий план; строки направлений и каналов — его разбивка. Ниже пока только факт.</span></div>`;
    h += `<div class="plan-grid">${D.PLAN_METRICS.map(k => planCard(k, total[k], plan.total ? plan.total[k] : null, month)).join('')}</div></div>`;

    // таблица: Все → направления → каналы
    const lines = [{label: 'Все', cls: 'dir-row', fact: total, plan: plan.total || {}}];
    DIRS.forEach(d => {
      const f = (dc[d] || {}).total || D.zero(), p = plan.dirs[d] || {};
      if (!D.PLAN_METRICS.some(k => f[k] || p[k] != null)) return;
      lines.push({label: d, dir: d, cls: 'dir-row', fact: f, plan: p});
      const chans = Object.keys((dc[d] || {}).channels || {});
      Object.keys(plan.chans).forEach(k => { const c = k.split('|')[1]; if (k.indexOf(d + '|') === 0 && chans.indexOf(c) < 0) chans.push(c); });
      chans.filter(c => c !== d).forEach(c => {
        const cf = ((dc[d] || {}).channels || {})[c] || D.zero(), cp = plan.chans[d + '|' + c] || {};
        if (D.PLAN_METRICS.some(k => cf[k] || cp[k] != null)) lines.push({label: c, dir: d, cls: 'chan-row', fact: cf, plan: cp});
      });
    });
    const cell = (k, l) => {
      const f = l.fact[k] || 0, p = l.plan[k];
      if (p === null || p === undefined) return `<div class="plan-cell"><b>${M(k, f)}</b><small>плана нет</small></div>`;
      const pr = planProgress(f, p, month), left = p - f;
      return `<div class="plan-cell"><b>${M(k, f)}</b> <span class="muted">из ${M(k, p)} · ${D.fmt(pr.p, 'pct0')}</span>${pr.bar}<small>${left > 0 ? 'осталось ' + M(k, left) : 'выполнено'}</small></div>`;
    };
    h += `<div class="panel"><div class="panel-head"><div><h2>По направлениям и каналам</h2><p>Каналы показаны, если по ним есть план или факт.</p></div></div>
      <div class="table-wrap short"><table><thead><tr><th>Направление / канал</th>${D.PLAN_METRICS.map(k => `<th>${esc(D.METRIC[k].label)}</th>`).join('')}</tr></thead><tbody>
      ${lines.map(l => `<tr class="${l.cls}"><td>${l.dir && l.cls === 'dir-row' ? pill(l.dir, l.label) : esc(l.label)}</td>${D.PLAN_METRICS.map(k => `<td>${cell(k, l)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <p class="note">Строка «Все» без своего плана = сумма планов направлений; направление без своего плана = сумма планов его каналов. Пустая ячейка плана в таблице = плана нет.</p></div>`;
    return h;
  }

  // ================= Вкладка «Качество данных» =================
  function statusOf(name) { const s = (S.db.statuses || []).find(x => x.source === name); return s ? s.status || '' : ''; }
  function renderQuality() {
    const db = S.db, rows = rowsNow(), t = D.sum(rows), dc = D.byDirChannel(db, rows);
    const unk = (dc['Не определено'] || {}).total || D.zero();
    const unkPaid = ((dc['Платный'] || {}).channels || {});
    const units = Object.keys(db.units).map(k => Object.assign({key: k}, db.units[k]));
    const inPeriod = u => u.date && u.date >= S.from && u.date <= S.to;
    const noLink = units.filter(u => u.code && inPeriod(u) && !u.link && u.type !== 'Кодовое слово' && u.channel !== 'Сторис');
    const autoIg = units.filter(u => inPeriod(u) && /авто \(нет в рабочей таблице\)/.test(u.source || ''));
    const noFormat = units.filter(u => u.code && inPeriod(u) && u.direction === 'Органика' && !(u.details && u.details.format));
    const lastAds = db.ads.length ? db.ads[db.ads.length - 1].date : '';
    const adsLag = lastAds ? D.daysBetween(lastAds, db.maxDate) - 1 : null;
    const costsEmpty = /пусто/i.test(statusOf('Затраты'));
    const names = list => list.slice(0, 8).map(u => `<li><button type="button" class="unit-link" data-unit="${esc(u.key)}">${esc(u.title || u.key)}</button> <span class="muted">${esc(u.code || '')} ${u.date ? D.dShort(u.date) : ''}</span></li>`).join('') + (list.length > 8 ? `<li>и ещё ${list.length - 8}</li>` : '');
    const issue = (lvl, tag, title, text, extra) => `<div class="issue ${lvl}"><span>${tag}</span><h2>${title}</h2><p>${text}</p>${extra || ''}</div>`;

    let h = pageTitle('Качество данных', 'Что сейчас неточно и откуда цифры', `${esc(D.rangeLabel(S.from, S.to))}. Проверки пересчитываются при каждом открытии.`);
    h += `<div class="quality-grid">`;
    h += unk.forms ? issue(unk.forms / (t.forms || 1) > 0.2 ? 'critical' : 'warning', 'АНКЕТЫ', `${M('forms', unk.forms)} ${plural(unk.forms, 'анкета', 'анкеты', 'анкет')} без источника (${share(unk.forms, t.forms)})`,
      'У сделки в amoCRM нет метки трафика и кода. Они входят в общий итог, но не попадают ни в одно направление.')
      : issue('ok', 'АНКЕТЫ', 'У всех анкет есть источник', 'За период нет анкет с неопределённым направлением.');
    h += costsEmpty ? issue('warning', 'ЗАТРАТЫ', 'Затраты команды не внесены', 'ROMI и окупаемость считаются только по рекламе. Зарплаты и подрядчиков вносят в лист «Затраты» по месяцам.')
      : issue('ok', 'ЗАТРАТЫ', 'Затраты внесены', esc(statusOf('Затраты')));
    h += adsLag !== null && adsLag > 1 ? issue('warning', 'РЕКЛАМА', `Таблица таргетолога по ${D.dFull(lastAds)}`, `Нет данных о расходе за ${adsLag} ${plural(adsLag, 'день', 'дня', 'дней')}: расход, показы и клики за эти дни пустые.`)
      : issue('ok', 'РЕКЛАМА', 'Реклама свежая', lastAds ? `Последний день в таблице таргетолога: ${D.dFull(lastAds)}.` : 'Данных о рекламе пока нет.');
    h += noLink.length ? issue('warning', 'ССЫЛКИ', `${noLink.length} ${plural(noLink.length, 'публикация', 'публикации', 'публикаций')} без ссылки`, 'Без ссылки на Instagram не подтягиваются охват и статистика. Добавьте ссылку в рабочую таблицу.', `<ul>${names(noLink)}</ul>`)
      : issue('ok', 'ССЫЛКИ', 'У публикаций есть ссылки', 'Все публикации периода связаны с Instagram или Telegram.');
    h += autoIg.length ? issue('info', 'INSTAGRAM', `${autoIg.length} ${plural(autoIg.length, 'публикация', 'публикации', 'публикаций')} нет в рабочей таблице`, 'Они пришли из Instagram автоматически и уже считаются. Чтобы добавить формат и сценарий, заведите их строку в рабочей таблице.', `<ul>${names(autoIg)}</ul>`)
      : issue('ok', 'INSTAGRAM', 'Все публикации Instagram есть в рабочей таблице', 'Авто-строк за период нет.');
    h += noFormat.length ? issue('info', 'ФОРМАТ', `${noFormat.length} без формата и сценария`, 'Формат, сценарий и описание берутся из рабочей таблицы (колонки «Формат», «Сценарий», «Описание») и видны в карточке публикации.', `<ul>${names(noFormat)}</ul>`)
      : issue('ok', 'ФОРМАТ', 'Формат заполнен', 'У органических публикаций периода указан формат.');
    h += `</div>`;

    h += `<div class="panel"><div class="panel-head"><div><h2>Источники данных</h2><p>Таблица обновляется сама каждый час, бот и ChatPlace дополнительно каждые 5 минут.</p></div></div>
      <div class="table-wrap short"><table><thead><tr><th>Источник</th><th>Обновлено</th><th>Состояние</th></tr></thead><tbody>
      ${(db.statuses || []).map(s => `<tr><td><b>${esc(s.source)}</b></td><td class="nowrap">${esc(s.updated)}</td><td>${esc(s.status)}</td></tr>`).join('')}</tbody></table></div></div>`;

    h += `<div class="panel"><div class="panel-head"><div><h2>Как считаются цифры</h2></div></div><ul class="check-list">
      <li><b>Публикации и охват</b> ставятся на день публикации. Охват берётся из Instagram за всё время жизни публикации. У рилсов и пробников в «Охват» идут просмотры, как в рабочей таблице; настоящий охват виден в карточке. Подписок у рилсов Instagram не отдаёт.</li>
      <li><b>Регистрации</b>: вход в бота по ссылке с кодом. Повторный вход того же человека по той же ссылке не считается. Тестовые входы исключены.</li>
      <li><b>Анкеты</b> ставятся на день создания сделки в amoCRM, <b>продажи и сумма</b> на день оплаты. Направление и креатив по метке трафика или коду.</li>
      <li><b>Пробники</b>: рилсы, которых нет в ленте профиля (пробные). Отдельный канал в органике.</li>
      <li><b>Охват аккаунта Instagram</b> за день считает Meta по своему (тихоокеанскому) времени, данные приходят с задержкой до 48 часов.</li>
      <li><b>Конверсия больше 100%</b> не показывается: часть анкет приходит не через бота (например, из рекламы сразу на сайт).</li>
      <li><b>Платный трафик</b>: расход из таблицы таргетолога по дням, без деления на креативы.</li></ul></div>`;
    return h;
  }

  // ================= Карточка публикации =================
  function openUnit(key) {
    const db = S.db, u = db.units[key] || {};
    const all = db.facts.filter(f => f.unit === key), per = all.filter(f => f.date >= S.from && f.date <= S.to);
    const ta = D.sum(all), tp = D.sum(per);
    const link = safeUrl(u.link || (u.instagram && u.instagram.link));
    const ig = u.instagram, det = u.details || {};
    const stat = (label, v, k) => `<div><span>${esc(label)}</span><b>${k ? M(k, v) : esc(v === null || v === undefined ? '—' : D.fmt(v, 'int'))}</b></div>`;
    const res = x => `<div class="stat-grid">${stat('Регистрации', x.registrations, 'registrations')}${stat('Анкеты', x.forms, 'forms')}${stat('Валидные', x.valid, 'valid')}${stat('Продажи', x.sales, 'sales')}${stat('Сумма продаж', x.revenue, 'revenue')}${x.cost ? stat('Затраты', x.cost, 'cost') : stat('Целевые действия', x.actions, 'actions')}</div>`;
    const days = all.filter(f => f.registrations || f.forms || f.sales || f.actions).sort((a, b) => b.date.localeCompare(a.date));
    let h = `<div>${pill(u.direction || 'Не определено', u.direction)} <span class="pill gray">${esc(u.channel || '')}</span>${ig && ig.kind === 'Пробник' ? ' <span class="pill gray">пробный рилс</span>' : ''}</div>
      <h2>${esc(u.title || D.unitTitle(key))}</h2>${u.code ? `<span class="code">${esc(u.code)}</span>` : ''}
      ${link ? `<a class="open-btn" href="${esc(link)}" target="_blank" rel="noreferrer">Открыть публикацию ↗</a>` : ''}
      <h3>О публикации</h3><dl>
      <dt>Дата публикации</dt><dd>${u.date ? D.dFull(u.date) + ' ' + D.weekday(u.date) : '—'}</dd>
      ${u.type ? `<dt>Тип</dt><dd>${esc(u.type)}</dd>` : ''}${u.keyword ? `<dt>Кодовое слово</dt><dd>${esc(u.keyword)}</dd>` : ''}
      ${u.funnel ? `<dt>Воронка</dt><dd>${esc(u.funnel)}</dd>` : ''}${u.material && u.material !== u.title ? `<dt>Материал</dt><dd>${esc(u.material)}</dd>` : ''}
      <dt>Формат</dt><dd>${det.format ? esc(det.format) : '<span class="muted">не указан</span>'}</dd>
      ${u.source ? `<dt>Откуда строка</dt><dd class="muted">${esc(u.source)}</dd>` : ''}</dl>`;
    h += `<h3>Сценарий</h3>${det.scenario ? `<div class="text-block">${esc(det.scenario)}</div>` : '<p class="muted small">Не заполнен. Сценарий и описание берутся из рабочей таблицы (колонки «Сценарий» и «Описание»).</p>'}
      ${det.description ? `<h3>Описание</h3><div class="text-block">${esc(det.description)}</div>` : ''}`;
    if (ig) {
      h += `<h3>Instagram · за всё время</h3><div class="stat-grid">${stat('Просмотры', ig.views)}${stat('Охват', ig.reach)}${stat('Лайки', ig.likes)}${stat('Комментарии', ig.comments)}${stat('Сохранения', ig.saves)}${stat('Репосты', ig.shares)}${stat('Взаимодействия', ig.interactions)}
        ${ig.kind === 'Сторис' ? stat('Ответы', ig.replies) + stat('Кадров', ig.frames) : ''}${ig.kind === 'Рилс' || ig.kind === 'Пробник' ? '' : stat('Подписки', ig.follows) + stat('Переходы в профиль', ig.profileVisits)}
        ${ig.reach ? `<div><span>Вовлечённость (ER)</span><b>${D.fmt(ig.interactions / ig.reach, 'pct')}</b></div>` : ''}</div>
        ${ig.caption ? `<p class="small muted" style="margin-top:10px">${esc(ig.caption)}</p>` : ''}<p class="small muted">Статистика Instagram обновлена ${esc(stamp(ig.updated))}.</p>`;
    }
    h += `<h3>Результат за выбранный период · ${esc(D.rangeLabel(S.from, S.to))}</h3>${res(tp)}<h3>Результат за всё время</h3>${res(ta)}`;
    if (days.length) h += `<h3>По дням</h3><div class="table-wrap short"><table><thead><tr><th>День</th><th class="num">Действия</th><th class="num">Рег.</th><th class="num">Анкеты</th><th class="num">Валидные</th><th class="num">Продажи</th><th class="num">Сумма</th></tr></thead><tbody>
      ${days.slice(0, 60).map(f => `<tr><td>${D.dShort(f.date)} ${D.weekday(f.date)}</td><td class="num">${M('actions', f.actions)}</td><td class="num">${M('registrations', f.registrations)}</td><td class="num">${M('forms', f.forms)}</td><td class="num">${M('valid', f.valid)}</td><td class="num">${M('sales', f.sales)}</td><td class="num">${M('revenue', f.revenue)}</td></tr>`).join('')}</tbody></table></div>`;
    $('drawerBody').innerHTML = h;
    $('drawer').hidden = false;
  }
  function stamp(v) {
    if (!v) return '—';
    if (/^\d{2}\.\d{2}\.\d{4}/.test(v)) return v;
    const d = new Date(v); if (isNaN(d)) return String(v);
    try { return new Intl.DateTimeFormat('ru-RU', {timeZone: S.db.timezone || 'Asia/Almaty', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}).format(d).replace(',', ''); }
    catch (e) { return d.toLocaleString('ru-RU'); }
  }
  function plural(n, one, few, many) { n = Math.abs(Math.round(n)) % 100; const n1 = n % 10; return n > 10 && n < 20 ? many : n1 > 1 && n1 < 5 ? few : n1 === 1 ? one : many; }

  // ================= Адрес страницы (можно делиться ссылкой на вкладку и период) =================
  function writeHash() {
    const p = new URLSearchParams();
    if (S.preset) p.set('p', S.preset); else { p.set('from', S.from); p.set('to', S.to); }
    if (S.dirs) p.set('dir', [...S.dirs].join(','));
    if (S.chans) p.set('ch', [...S.chans].join(','));
    const h = '#' + S.tab + '?' + p.toString();
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function readHash() {
    const raw = decodeURIComponent(location.hash.slice(1)), i = raw.indexOf('?');
    const id = i >= 0 ? raw.slice(0, i) : raw, p = new URLSearchParams(i >= 0 ? raw.slice(i + 1) : '');
    if (TABS.some(t => t.id === id)) S.tab = id;
    if (p.get('p')) S.preset = p.get('p');
    else if (p.get('from') && p.get('to')) { S.from = p.get('from'); S.to = p.get('to'); S.preset = ''; }
    if (p.get('dir')) S.dirs = new Set(p.get('dir').split(',').filter(d => DIRS.indexOf(d) >= 0));
    if (p.get('ch')) S.chans = new Set(p.get('ch').split(',').filter(Boolean));
    if (S.dirs && !S.dirs.size) S.dirs = null;
    if (S.chans && !S.chans.size) S.chans = null;
  }

  // ================= События =================
  function bindEvents() {
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-tab],[data-preset],[data-dir],[data-chan],[data-chan-only],[data-unit],[data-sort],[data-csv],[data-seg],[data-day],[data-action],#resetBtn,#reloadBtn,#drawerClose,#drawer');
      if (!el) return;
      if (el.id === 'drawer' && e.target !== el) return;
      if (el.id === 'drawer' || el.id === 'drawerClose') { $('drawer').hidden = true; return; }
      if (!S.db && !el.dataset.action && el.id !== 'reloadBtn') return;
      if (el.dataset.unit !== undefined) { e.preventDefault(); openUnit(el.dataset.unit); return; }
      if (el.dataset.tab) { S.tab = el.dataset.tab; render(); window.scrollTo({top: 0}); return; }
      if (el.dataset.preset) { applyPreset(el.dataset.preset); render(); return; }
      if (el.dataset.dir !== undefined) {
        const d = el.dataset.dir;
        if (!d) S.dirs = null;
        else { S.dirs = S.dirs || new Set(); S.dirs.has(d) ? S.dirs.delete(d) : S.dirs.add(d); if (!S.dirs.size) S.dirs = null; }
        if (S.chans && S.dirs) { S.chans = new Set([...S.chans].filter(k => S.dirs.has(k.split('|')[0]))); if (!S.chans.size) S.chans = null; }
        render(); return;
      }
      if (el.dataset.chan !== undefined) {
        const k = el.dataset.chan, t = tab();
        if (!k) { S.chans = S.chans && t.dir ? new Set([...S.chans].filter(x => x.indexOf(t.dir + '|') !== 0)) : null; if (S.chans && !S.chans.size) S.chans = null; }
        else { S.chans = S.chans || new Set(); S.chans.has(k) ? S.chans.delete(k) : S.chans.add(k); if (!S.chans.size) S.chans = null; }
        render(); return;
      }
      if (el.dataset.chanOnly) { const t = tab(); S.chans = new Set([...(S.chans || [])].filter(x => !t.dir || x.indexOf(t.dir + '|') !== 0)); S.chans.add(el.dataset.chanOnly); render(); return; }
      if (el.dataset.sort) {
        const [id, key] = el.dataset.sort.split('|'), st = S.ui['t:' + id] || (S.ui['t:' + id] = {q: ''});
        if (st.sort === key) st.asc = !st.asc; else { st.sort = key; st.asc = false; }
        render(); return;
      }
      if (el.dataset.csv) { downloadCsv(el.dataset.csv); return; }
      if (el.dataset.seg) { S.ui[el.dataset.seg] = el.dataset.val; render(); return; }
      if (el.dataset.day) { S.ui['dyn:open'] = ui('dyn:open', '') === el.dataset.day ? '' : el.dataset.day; render(); return; }
      if (el.dataset.action === 'retry' || el.id === 'reloadBtn') { reload(el.id === 'reloadBtn'); return; }
      if (el.id === 'resetBtn') { S.dirs = null; S.chans = null; applyPreset(C.DEFAULT_PERIOD); Object.keys(S.ui).forEach(k => { if (k.indexOf('t:') === 0) S.ui[k].q = ''; }); render(); return; }
    });
    document.addEventListener('change', e => {
      const el = e.target;
      if (el.id === 'dateFrom' || el.id === 'dateTo') {
        if (!el.value) return;
        if (el.id === 'dateFrom') S.from = el.value; else S.to = el.value;
        S.preset = ''; clampPeriod(); render(); return;
      }
      if (el.dataset.ui) { S.ui[el.dataset.ui] = el.value; render(); }
    });
    document.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.search) { const st = S.ui['t:' + el.dataset.search] || (S.ui['t:' + el.dataset.search] = {}); st.q = el.value; render(); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('drawer').hidden = true; });
    // подсказка над столбиками
    const tip = document.createElement('div'); tip.className = 'tooltip'; tip.hidden = true; document.body.appendChild(tip);
    document.addEventListener('mousemove', e => {
      const el = e.target.closest && e.target.closest('[data-tip-v]');
      if (!el) { tip.hidden = true; return; }
      tip.replaceChildren();
      const b = document.createElement('b'); b.textContent = el.dataset.tipV;
      const s = document.createElement('span'); s.textContent = el.dataset.tipL;
      tip.append(b, s); tip.hidden = false;
      const x = Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + 'px'; tip.style.top = (e.clientY - tip.offsetHeight - 10) + 'px';
    });
    window.addEventListener('hashchange', () => { readHash(); if (S.db) { if (S.preset) applyPreset(S.preset); render(); } });
  }

  document.addEventListener('DOMContentLoaded', start);
})();
