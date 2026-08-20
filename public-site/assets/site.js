(() => {
  'use strict';

  const header = document.querySelector('[data-header]');
  const menu = document.querySelector('[data-menu]');
  const toggle = document.querySelector('[data-menu-toggle]');
  const year = document.querySelector('[data-year]');

  if (year) year.textContent = String(new Date().getFullYear());

  const closeMenu = () => {
    if (!menu || !toggle) return;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    const label = toggle.querySelector('.sr-only');
    if (label) label.textContent = 'เปิดเมนู';
  };

  if (menu && toggle) {
    toggle.addEventListener('click', () => {
      const open = !menu.classList.contains('is-open');
      menu.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      const label = toggle.querySelector('.sr-only');
      if (label) label.textContent = open ? 'ปิดเมนู' : 'เปิดเมนู';
    });

    menu.addEventListener('click', (event) => {
      if (event.target instanceof HTMLAnchorElement) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMenu();
        toggle.focus();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 980) closeMenu();
    });
  }

  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 10);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
})();
