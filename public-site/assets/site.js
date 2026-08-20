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

(() => {
  const grid = document.querySelector('[data-gallery-grid]');
  const preview = document.querySelector('[data-gallery-preview]');
  if (!grid && !preview) return;
  const filters = document.querySelector('[data-gallery-filters]');
  const more = document.querySelector('[data-gallery-more]');
  const lightbox = document.querySelector('[data-lightbox]');
  let items = [], visible = [], active = -1, limit = 24, category = 'all', opener = null;
  const safeAsset = value => typeof value === 'string' && /^\/assets\/gallery\/[a-zA-Z0-9/_-]+\.(?:avif|webp|jpe?g|png)$/.test(value) ? value : '';
  const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const validItem = item => item && item.status === 'PUBLISHED' && text(item.id, 80) && text(item.title, 160) && text(item.alt, 300) && safeAsset(item.thumbnail) && safeAsset(item.display) && Number.isInteger(item.width) && item.width > 0 && Number.isInteger(item.height) && item.height > 0;

  function picture(item, thumbnail) {
    const node = document.createElement('picture');
    const avif = safeAsset(thumbnail ? item.thumbnailAvif : item.displayAvif);
    const webp = safeAsset(thumbnail ? item.thumbnailWebp : item.displayWebp);
    if (avif) { const source = document.createElement('source'); source.type = 'image/avif'; source.srcset = avif; node.append(source); }
    if (webp) { const source = document.createElement('source'); source.type = 'image/webp'; source.srcset = webp; node.append(source); }
    const image = document.createElement('img'); image.src = safeAsset(thumbnail ? item.thumbnail : item.display); image.alt = text(item.alt, 300); image.width = item.width; image.height = item.height; image.loading = thumbnail ? 'lazy' : 'eager'; image.decoding = 'async'; image.addEventListener('error', () => { const error = document.createElement('span'); error.className = 'gallery-image-error'; error.textContent = 'ไม่สามารถโหลดภาพนี้ได้'; node.replaceChildren(error); }); node.append(image);
    return node;
  }

  function card(item, index, canOpen) {
    const figure = document.createElement('figure'); figure.className = 'gallery-card';
    const ratio = item.width / item.height; figure.dataset.orientation = ratio > 1.12 ? 'landscape' : ratio < .88 ? 'portrait' : 'square';
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', `เปิดภาพขนาดใหญ่: ${text(item.alt, 300)}`); button.append(picture(item, true));
    if (canOpen) button.addEventListener('click', () => open(index)); else button.disabled = true;
    const caption = document.createElement('figcaption'); const label = document.createElement('span'); label.textContent = text(item.categoryLabel, 80); const title = document.createElement('strong'); title.textContent = text(item.title, 160); caption.append(label, title);
    const detail = text(item.caption, 500); if (detail) { const p = document.createElement('p'); p.textContent = detail; caption.append(p); }
    figure.append(button, caption); return figure;
  }

  function render() {
    if (!grid) return;
    visible = items.filter(item => category === 'all' || item.category === category);
    grid.replaceChildren();
    if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; const strong = document.createElement('strong'); strong.textContent = 'ยังไม่มีภาพที่เผยแพร่ในหมวดนี้'; const span = document.createElement('span'); span.textContent = 'Gallery จะแสดงเฉพาะภาพงานจริงที่ Owner อนุมัติแล้ว'; empty.append(strong, span); grid.append(empty); if (more) more.hidden = true; return; }
    visible.slice(0, limit).forEach((item, index) => grid.append(card(item, index, true)));
    if (more) more.hidden = visible.length <= limit;
  }

  function open(index) { if (!lightbox || !visible[index]) return; opener = document.activeElement; active = index; updateLightbox(); lightbox.hidden = false; document.body.classList.add('lightbox-open'); lightbox.querySelector('[data-lightbox-close]')?.focus(); }
  function close() { if (!lightbox) return; lightbox.hidden = true; document.body.classList.remove('lightbox-open'); active = -1; if (opener instanceof HTMLElement) opener.focus(); }
  function move(step) { if (!visible.length) return; active = (active + step + visible.length) % visible.length; updateLightbox(); }
  function updateLightbox() { const item = visible[active]; if (!item || !lightbox) return; lightbox.querySelector('[data-lightbox-picture]')?.replaceChildren(picture(item, false)); const title = lightbox.querySelector('[data-lightbox-title]'); const caption = lightbox.querySelector('[data-lightbox-caption]'); if (title) title.textContent = text(item.title, 160); if (caption) caption.textContent = text(item.caption, 500); }

  fetch('/assets/gallery.json', { credentials: 'same-origin' }).then(response => { if (!response.ok) throw new Error('gallery'); return response.json(); }).then(data => {
    if (data?.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.categories)) throw new Error('manifest');
    const labels = new Map(data.categories.map(entry => [text(entry.id, 80), text(entry.label, 80)]));
    items = data.items.filter(validItem).map(item => ({ ...item, categoryLabel: labels.get(item.category) || 'ผลงาน' })).sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || Number(a.order || 0) - Number(b.order || 0));
    if (filters) data.categories.forEach(entry => { const id = text(entry.id, 80), label = text(entry.label, 80); if (!id || !label || !items.some(item => item.category === id)) return; const button = document.createElement('button'); button.type = 'button'; button.dataset.category = id; button.textContent = label; button.setAttribute('aria-pressed', 'false'); filters.append(button); });
    render();
    if (preview) { preview.replaceChildren(); if (!items.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.innerHTML = '<strong>กำลังเตรียมภาพผลงานจริง</strong><span>จะแสดงเฉพาะภาพที่ได้รับอนุญาตให้เผยแพร่</span>'; preview.append(empty); } else items.slice(0, 6).forEach(item => preview.append(card(item, 0, false))); }
  }).catch(() => { const target = grid || preview; if (target) target.innerHTML = '<div class="empty-state"><strong>โหลด Gallery ไม่สำเร็จ</strong><span>กรุณารีเฟรชหน้า หรือลองใหม่ภายหลัง</span></div>'; });

  filters?.addEventListener('click', event => { const button = event.target.closest('button[data-category]'); if (!button) return; category = button.dataset.category || 'all'; limit = 24; filters.querySelectorAll('button').forEach(node => { const current = node === button; node.classList.toggle('is-active', current); node.setAttribute('aria-pressed', String(current)); }); render(); });
  more?.addEventListener('click', () => { limit += 24; render(); });
  lightbox?.querySelector('[data-lightbox-close]')?.addEventListener('click', close); lightbox?.querySelector('[data-lightbox-prev]')?.addEventListener('click', () => move(-1)); lightbox?.querySelector('[data-lightbox-next]')?.addEventListener('click', () => move(1));
  lightbox?.addEventListener('click', event => { if (event.target === lightbox) close(); });
  document.addEventListener('keydown', event => { if (!lightbox || lightbox.hidden) return; if (event.key === 'Escape') close(); if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); if (event.key === 'Tab') { const controls = [...lightbox.querySelectorAll('button')]; const current = controls.indexOf(document.activeElement); const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length; event.preventDefault(); controls[next]?.focus(); } });
})();
