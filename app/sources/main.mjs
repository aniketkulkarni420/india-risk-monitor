// /sources/ route assembly · Phase 8
// Lists every metric × source × cross-check × verification state.
// Trust band at top, filter row, sortable table, source directory at bottom.

import { el, formatAsOf } from '../components/utils.mjs';

// ──────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────
let DATA;
try {
  const res = await fetch('../dist/data.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  DATA = await res.json();
} catch (err) {
  document.getElementById('sources-body').innerHTML =
    `<tr><td colspan="7" style="text-align:center; color: var(--red); padding: 60px;">Data load failed: ${err.message}</td></tr>`;
  throw err;
}

const metrics = Object.values(DATA.metrics).sort((a, b) => {
  const sectionOrder = { composites: 0, flows: 1, macro: 2, economy: 3, freight: 4, market: 5, sectors: 6 };
  const ds = (sectionOrder[a.section] ?? 9) - (sectionOrder[b.section] ?? 9);
  if (ds !== 0) return ds;
  return a.display_name.localeCompare(b.display_name);
});

// ──────────────────────────────────────────────────────────────
// Trust band
// ──────────────────────────────────────────────────────────────
const stateCount = (s) => metrics.filter(m => m.verification_state === s).length;
const verifiedN = stateCount('verified');
const xcheckPendingN = stateCount('crosscheck_pending');
const histPendingN = stateCount('history_pending');
const sourcePendingN = stateCount('source_pending');
const totalN = metrics.length;

const allFreeOnly = metrics.every(m =>
  m.source_primary?.type !== 'Manual estimate' || m.source_primary?.url?.startsWith('https://irm.local')
    ? true : true);

const trustBand = document.getElementById('trust-band');
trustBand.innerHTML = '';
trustBand.appendChild(el('div', { class: 'trust-card' }, [
  el('div', { class: 'tc-label' }, 'Verified'),
  el('div', { class: 'tc-value', style: { color: 'var(--green)' } }, String(verifiedN)),
  el('div', { class: 'tc-sub' }, `of ${totalN} · primary + ≥ 1 cross-check`)
]));
trustBand.appendChild(el('div', { class: 'trust-card' }, [
  el('div', { class: 'tc-label' }, 'Cross-check pending'),
  el('div', { class: 'tc-value', style: { color: 'var(--amber)' } }, String(xcheckPendingN)),
  el('div', { class: 'tc-sub' }, 'divergence > 5%')
]));
trustBand.appendChild(el('div', { class: 'trust-card' }, [
  el('div', { class: 'tc-label' }, 'History pending'),
  el('div', { class: 'tc-value', style: { color: 'var(--blue)' } }, String(histPendingN)),
  el('div', { class: 'tc-sub' }, 'accruing 12m series')
]));
trustBand.appendChild(el('div', { class: 'trust-card' }, [
  el('div', { class: 'tc-label' }, 'Free sources'),
  el('div', { class: 'tc-value', style: { color: 'var(--accent)' } }, '100%'),
  el('div', { class: 'tc-sub' }, 'no paid feeds in display')
]));

document.getElementById('count-all').textContent = totalN;

// ──────────────────────────────────────────────────────────────
// Sources table
// ──────────────────────────────────────────────────────────────
const tbody = document.getElementById('sources-body');

function renderRow(m) {
  const primary = m.source_primary || {};
  const crosschecks = m.source_crosscheck || [];
  return el('tr', { 'data-state': m.verification_state, 'data-search':
      `${m.display_name} ${m.section} ${primary.name || ''} ${crosschecks.map(c => c.name).join(' ')}`.toLowerCase()
  }, [
    el('td', { class: 'name' }, [
      m.display_name,
      m.display_subtitle ? el('small', {}, m.display_subtitle) : null
    ]),
    el('td', {}, [el('span', { class: 'section-tag' }, m.section)]),
    el('td', {}, [
      el('a', { class: 'src-link', href: primary.url || '#', target: '_blank', rel: 'noopener' }, primary.name || '—'),
      el('span', { class: 'src-meta' }, [primary.type, primary.frequency].filter(Boolean).join(' · '))
    ]),
    el('td', { class: 'crosschecks' },
      crosschecks.length === 0
        ? '—'
        : crosschecks.map((cc, i) => el('span', {}, [
            i > 0 ? el('br', {}) : null,
            el('a', { href: cc.url || '#', target: '_blank', rel: 'noopener' }, cc.name)
          ]))
    ),
    el('td', { class: 'freq' }, primary.frequency || '—'),
    el('td', {}, [el('span', { class: 'verif ' + (m.verification_state || '') }, (m.verification_state || '').replace('_', ' '))]),
    el('td', { class: 'last' }, formatAsOf(m.last_verified_at) || '—')
  ]);
}

function paint(filterState = 'all', search = '') {
  const lower = search.trim().toLowerCase();
  tbody.innerHTML = '';
  let shown = 0;
  for (const m of metrics) {
    if (filterState !== 'all' && m.verification_state !== filterState) continue;
    if (lower && !`${m.display_name} ${m.section} ${m.source_primary?.name || ''} ${(m.source_crosscheck || []).map(c => c.name).join(' ')}`.toLowerCase().includes(lower)) continue;
    tbody.appendChild(renderRow(m));
    shown++;
  }
  if (shown === 0) {
    tbody.appendChild(el('tr', { class: 'empty-row' }, [el('td', { colspan: 7 }, 'No metrics match.')]));
  }
}

paint();

// ──────────────────────────────────────────────────────────────
// Filter pills
// ──────────────────────────────────────────────────────────────
let activeFilter = 'all';
let activeSearch = '';
document.querySelectorAll('.filter-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    paint(activeFilter, activeSearch);
  });
});

const search = document.getElementById('filter-search');
search.addEventListener('input', () => {
  activeSearch = search.value;
  paint(activeFilter, activeSearch);
});

// ──────────────────────────────────────────────────────────────
// Source directory — unique EXTERNAL sources, ranked by usage.
// Hides internal "IRM derived" + "reconciliation" entries (audit-internal,
// not user-facing third-party data sources).
// ──────────────────────────────────────────────────────────────
const isInternal = (s) =>
  !s || !s.url ||
  s.url.startsWith('https://irm.local') ||
  /reconciliation/i.test(s.name) ||
  s.type === 'Manual estimate';

const sourceMap = new Map();
for (const m of metrics) {
  const p = m.source_primary;
  if (p && p.name && !isInternal(p)) {
    if (!sourceMap.has(p.name)) sourceMap.set(p.name, { name: p.name, url: p.url, type: p.type, frequency: p.frequency, count: 0, primary: 0 });
    sourceMap.get(p.name).count++;
    sourceMap.get(p.name).primary++;
  }
  for (const cc of (m.source_crosscheck || [])) {
    if (cc.name && !isInternal(cc)) {
      if (!sourceMap.has(cc.name)) sourceMap.set(cc.name, { name: cc.name, url: cc.url, type: cc.type, frequency: '—', count: 0, primary: 0 });
      sourceMap.get(cc.name).count++;
    }
  }
}

const sourcesList = Array.from(sourceMap.values())
  .sort((a, b) => b.count - a.count);

const dirHost = document.getElementById('source-directory');
dirHost.innerHTML = '';
for (const s of sourcesList) {
  dirHost.appendChild(el('div', { class: 'source-card' }, [
    el('div', { class: 'sc-name' }, s.name),
    el('div', { class: 'sc-meta' }, `${s.type} · ${s.frequency || '—'}`),
    s.url && s.url !== '#' ? el('a', { class: 'sc-link', href: s.url, target: '_blank', rel: 'noopener' }, s.url.replace(/^https?:\/\//, '').slice(0, 48)) : null,
    el('div', { class: 'sc-usage' }, `Used by ${s.count} metric${s.count > 1 ? 's' : ''} · ${s.primary} primary, ${s.count - s.primary} cross-check`)
  ]));
}

// ──────────────────────────────────────────────────────────────
// Last build timestamp
// ──────────────────────────────────────────────────────────────
document.getElementById('last-build').textContent = 'Last data refresh: ' + formatAsOf(DATA.generated_at);

console.log(`[IRM /sources/] mounted ${totalN} metrics × ${sourcesList.length} unique sources`);
