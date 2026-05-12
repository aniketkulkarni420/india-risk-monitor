// SectionFrame · the section-level wrapper.
// Every section uses one. Replaces the V60 "sectionIntro" sprawl.
//
// Renders: SectionHeader + optional LensRow + slot for content + SectionFooter
//
// Props:
//   section_id: string                  — anchor id (#flows, #macro, etc.)
//   title: string                       — section title
//   question: string                    — one-line "what this section answers"
//   lens_row?: [{ id, label, active }]  — optional 3-4 chip filter row
//   sources?: { count, names: [], last_verified }  — for footer
//   onLensClick?: (lens_id) => void
//   children: HTMLElement[]             — section body (PrimaryDisplay + SupportingTable)

import { el, formatAsOf } from './utils.mjs';

export function renderSectionFrame(props) {
  const { section_id, title, question, lens_row, sources, onLensClick, children, timeline } = props;

  // Header
  const header = el('div', { class: 'sf-header' }, [
    el('h2', { class: 'sf-title', id: section_id }, title),
    question ? el('p', { class: 'sf-question' }, question) : null
  ].filter(Boolean));

  // 5C · Optional timeline strip rendered above header
  let timelineEl = null;
  if (timeline) timelineEl = timeline;

  // Lens row (optional)
  let lensRowEl = null;
  if (lens_row && lens_row.length) {
    lensRowEl = el('div', { class: 'sf-lens-row' },
      lens_row.map(lens =>
        el('button', {
          class: 'sf-lens' + (lens.active ? ' active' : ''),
          'data-lens-id': lens.id,
          onclick: () => onLensClick && onLensClick(lens.id)
        }, lens.label)
      )
    );
  }

  // Body slot
  const body = el('div', { class: 'sf-body' }, [].concat(children).filter(Boolean));

  // Footer (optional)
  let footer = null;
  if (sources) {
    const namesText = (sources.names || []).slice(0, 4).join(', ');
    footer = el('div', { class: 'sf-footer' }, [
      el('div', { class: 'sf-footer-text' }, [
        sources.count ? `${sources.count} sources` : null,
        sources.last_verified ? ` · Last verified ${formatAsOf(sources.last_verified)}` : null,
        namesText ? ' · ' : null,
        namesText ? el('span', { style: { color: 'var(--ink-2)' } }, namesText) : null
      ].filter(Boolean)),
      el('a', { href: './sources/', class: 'sf-footer-link' }, 'View full source map →')
    ]);
  }

  return el('section', { class: 'section-frame', 'data-section': section_id },
    [timelineEl, header, lensRowEl, body, footer].filter(Boolean));
}

// Convenience header-only renderer for cases without footer
export function renderSectionHeader(title, question, section_id) {
  return el('div', { class: 'sf-header' }, [
    el('h2', { class: 'sf-title', id: section_id }, title),
    question ? el('p', { class: 'sf-question' }, question) : null
  ].filter(Boolean));
}
