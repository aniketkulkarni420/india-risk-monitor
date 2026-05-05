// Cmd-K palette · Phase 5.5
// Single global navigation surface. Replaces the lost V55 search input + filter pills.
// Trigger: ⌘K / Ctrl+K. Searches metrics, sections, sources. Jump in one keystroke.
//
// API:
//   wire({ metrics, sections, openMetric }) — call once on boot
//   open() / closeCmdK()

import { el, statusClass } from './utils.mjs';

let _kBackdrop = null, _kPanel = null, _input = null, _results = null;
let _kOpen = false;
let _items = [];        // flattened result list of all candidates
let _filtered = [];     // current filtered list
let _selected = 0;      // selected index into _filtered
let _ctx = null;        // { metrics, sections, openMetric }

function ensureCmdKMounted() {
  if (_kPanel) return;

  _kBackdrop = el('div', { class: 'cmdk-backdrop', onclick: closeCmdK});
  _kPanel = el('div', { class: 'cmdk-panel', role: 'dialog', 'aria-modal': 'true' });

  _input = el('input', {
    type: 'search', placeholder: 'Search metrics, sections, sources…',
    autocomplete: 'off', spellcheck: 'false'
  });
  _input.addEventListener('input', refresh);
  _input.addEventListener('keydown', onKeyDown);

  const inputRow = el('div', { class: 'cmdk-input-row' }, [
    el('span', { class: 'icon' }, '⌘K'),
    _input,
    el('span', { class: 'esc' }, 'esc to close')
  ]);

  _results = el('div', { class: 'cmdk-results' });

  const foot = el('div', { class: 'cmdk-foot' }, [
    el('span', {}, [el('span', { class: 'key' }, '↑↓'), 'navigate ', el('span', { class: 'key' }, '⏎'), 'open']),
    el('span', {}, ['esc to close'])
  ]);

  _kPanel.appendChild(inputRow);
  _kPanel.appendChild(_results);
  _kPanel.appendChild(foot);

  document.body.appendChild(_kBackdrop);
  document.body.appendChild(_kPanel);

  // Global Cmd-K shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      _kOpen ? closeCmdK() : openCmdK();
    }
    if (e.key === 'Escape' && _kOpen) closeCmdK();
  });
}

export function wireCmdK(ctx) {
  ensureCmdKMounted();
  _ctx = ctx;
  buildItems();
}

function buildItems() {
  if (!_ctx) return;
  _items = [];

  // Metrics
  for (const m of Object.values(_ctx.metrics)) {
    _items.push({
      kind: 'METRIC',
      name: m.display_name,
      meta: m.section + (m.sub_cluster ? ' · ' + m.sub_cluster : ''),
      status: m.status,
      action: () => _ctx.openMetric(m.metric_id),
      keywords: [m.metric_id, m.display_name, m.section, m.source_primary?.name].filter(Boolean).join(' ').toLowerCase()
    });
  }

  // Sections
  for (const s of (_ctx.sections || [])) {
    _items.push({
      kind: 'SECTION',
      name: s.label,
      meta: (s.count || 0) + ' metrics' + (s.shockCount ? ' · ' + s.shockCount + ' SHOCK' : ''),
      status: s.shockCount > 0 ? 'shock' : null,
      action: () => { closeCmdK(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }); },
      keywords: [s.id, s.label].join(' ').toLowerCase()
    });
  }

  // Filters (saved searches)
  _items.push({
    kind: 'FILTER', name: 'Show all metrics in shock state', meta: 'jump to /sources/?filter=shock',
    action: () => { closeCmdK(); window.location.href = './sources/'; },
    keywords: 'shock state filter'
  });
  _items.push({
    kind: 'FILTER', name: 'Show all crosscheck-pending metrics', meta: 'data quality watch',
    action: () => { closeCmdK(); window.location.href = './sources/'; },
    keywords: 'crosscheck pending filter'
  });
  _items.push({
    kind: 'PAGE', name: 'Sources & methodology', meta: '/sources/',
    action: () => { closeCmdK(); window.location.href = './sources/'; },
    keywords: 'sources methodology trust'
  });
}

export function openCmdK() {
  ensureCmdKMounted();
  _kOpen = true;
  _kBackdrop.classList.add('open');
  _kPanel.classList.add('open');
  _input.value = '';
  refresh();
  setTimeout(() => _input.focus(), 50);
}

export function closeCmdK() {
  if (!_kPanel) return;
  _kOpen = false;
  _kBackdrop.classList.remove('open');
  _kPanel.classList.remove('open');
}

function refresh() {
  const q = _input.value.trim().toLowerCase();
  _filtered = q
    ? _items.filter(it => it.keywords.includes(q)).slice(0, 30)
    : _items.slice(0, 12); // default: top 12
  _selected = 0;
  paint();
}

function paint() {
  _results.innerHTML = '';
  if (_filtered.length === 0) {
    _results.appendChild(el('div', { class: 'cmdk-empty' }, 'No matches.'));
    return;
  }

  // Group by kind
  const groups = {};
  for (const it of _filtered) {
    if (!groups[it.kind]) groups[it.kind] = [];
    groups[it.kind].push(it);
  }
  const order = ['METRIC', 'SECTION', 'FILTER', 'PAGE', 'SOURCE'];
  let idx = 0;
  for (const kind of order) {
    if (!groups[kind]) continue;
    _results.appendChild(el('div', { class: 'cmdk-group-head' }, kind));
    for (const it of groups[kind]) {
      const myIdx = idx;
      const item = el('div', {
        class: 'cmdk-item' + (myIdx === _selected ? ' selected' : ''),
        'data-idx': myIdx,
        onclick: () => { it.action(); closeCmdK(); }
      }, [
        el('span', { class: 'cmdk-kind' }, it.kind),
        el('span', { class: 'cmdk-name' }, it.name),
        it.status === 'shock'
          ? el('span', { class: 'pill', style: { background: 'var(--red)', color: '#1a0808', fontWeight: 700, letterSpacing: '.08em' } }, 'SHOCK')
          : it.status ? el('span', { class: 'pill ' + statusClass(it.status) }, it.status) : null,
        it.meta ? el('span', { class: 'cmdk-meta' }, it.meta) : null
      ].filter(Boolean));
      _results.appendChild(item);
      idx++;
    }
  }
}

function onKeyDown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _selected = Math.min(_filtered.length - 1, _selected + 1);
    paint();
    scrollSelectedIntoView();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _selected = Math.max(0, _selected - 1);
    paint();
    scrollSelectedIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const it = _filtered[_selected];
    if (it) { it.action(); closeCmdK(); }
  }
}

function scrollSelectedIntoView() {
  const sel = _results.querySelector('.cmdk-item.selected');
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
}
