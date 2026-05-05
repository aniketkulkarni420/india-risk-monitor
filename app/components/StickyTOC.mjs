// StickyTOC · Phase 5.5 upgrade
// Right-rail TOC with metric counts + shock badges per section.
// Engages after scrolling past the hero (scrollY > 720).
// Highlights active section via IntersectionObserver.
//
// Props:
//   sections: [{ id, label, count?, shockCount?, watchCount? }]
//   engage_after?: number = 720
//   onJump?: (section_id) => void

import { el } from './utils.mjs';

export function renderStickyTOC(props) {
  const { sections, engage_after = 720, onJump } = props;

  const links = sections.map(s => {
    const meta = [];
    if (typeof s.count === 'number') meta.push(el('span', { class: 'toc-meta' }, String(s.count)));
    if (s.shockCount > 0) meta.push(el('span', { class: 'toc-shock' }, s.shockCount + ' SHOCK'));
    else if (s.watchCount > 0) meta.push(el('span', { class: 'toc-meta toc-watch' }, s.watchCount + ' watch'));

    return el('a', {
      href: '#' + s.id,
      class: 'toc-link toc-link-upgraded',
      'data-section': s.id,
      onclick: (e) => { if (onJump) { e.preventDefault(); onJump(s.id); } }
    }, [
      el('span', {}, s.label),
      meta.length ? el('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, meta) : null
    ].filter(Boolean));
  });

  const wrap = el('aside', { class: 'sticky-toc', 'aria-label': 'On this page' }, [
    el('div', { class: 'toc-eyebrow' }, 'On this page'),
    el('nav', { class: 'toc-list' }, links)
  ]);

  // Engage on scroll
  const onScroll = () => {
    if (window.scrollY > engage_after) wrap.classList.add('engaged');
    else wrap.classList.remove('engaged');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Active highlight via IntersectionObserver
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        wrap.querySelectorAll('.toc-link').forEach(a => {
          a.classList.toggle('active', a.dataset.section === id);
        });
      }
    }
  }, { rootMargin: '-30% 0px -60% 0px' });

  setTimeout(() => {
    sections.forEach(s => {
      const target = document.getElementById(s.id);
      if (target) observer.observe(target);
    });
  }, 0);

  wrap._cleanup = () => {
    window.removeEventListener('scroll', onScroll);
    observer.disconnect();
  };

  return wrap;
}
