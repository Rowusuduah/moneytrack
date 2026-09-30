'use strict';

// Responsive presentation controls. Financial records and calculations remain in app.js.
document.addEventListener('DOMContentLoaded', () => {
  const phone = window.matchMedia('(max-width: 820px)');
  const more = document.getElementById('mobile-more');
  const moreMenu = document.getElementById('mobile-more-menu');
  const tablist = document.querySelector('#nav [role="tablist"]');
  const secondaryTabs = new Set(['tab-analysis', 'tab-wealth', 'tab-africa']);

  function closeMore() {
    moreMenu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
  }
  function refreshMore() {
    const selected = document.querySelector('#nav [role="tab"][aria-selected="true"]')?.id;
    const active = secondaryTabs.has(selected);
    more.classList.toggle('active', active);
    if (active) more.setAttribute('aria-current', 'page');
    else more.removeAttribute('aria-current');
    moreMenu.querySelectorAll('[data-open-tab]').forEach(button => {
      if (button.dataset.openTab === selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  more.addEventListener('click', () => {
    moreMenu.hidden = !moreMenu.hidden;
    more.setAttribute('aria-expanded', moreMenu.hidden ? 'false' : 'true');
    if (!moreMenu.hidden) moreMenu.querySelector('button')?.focus();
  });
  moreMenu.addEventListener('click', event => {
    const button = event.target.closest('[data-open-tab]');
    if (!button) return;
    switchTab(button.dataset.openTab);
    closeMore();
    more.focus();
    window.scrollTo({ top: 0, behavior: 'instant' });
    refreshMore();
  });
  document.addEventListener('click', event => {
    if (!moreMenu.hidden && !moreMenu.contains(event.target) && !more.contains(event.target)) closeMore();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !moreMenu.hidden) { closeMore(); more.focus(); }
  });
  const selectedObserver = new MutationObserver(refreshMore);
  tablist.querySelectorAll('[role="tab"]').forEach(tab => {
    selectedObserver.observe(tab, { attributes: true, attributeFilter: ['aria-selected'] });
  });
  refreshMore();
  tablist.addEventListener('click', event => {
    if (event.target.closest('[role="tab"]')) {
      closeMore();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  });
  // The underlying tab list still contains the three sections exposed by More.
  // Arrow keys on the phone should only land on controls that are visible.
  tablist.addEventListener('keydown', event => {
    if (!phone.matches || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const visible = ['tab-accounts', 'tab-tracker', 'tab-things'].map(id => document.getElementById(id));
    const at = visible.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const next = visible[(at + (event.key === 'ArrowRight' ? 1 : visible.length - 1)) % visible.length];
    next.focus();
    switchTab(next.id);
  }, true);

  const filterToggle = document.getElementById('tracker-filter-toggle');
  const extraFilters = document.getElementById('tracker-extra-filters');
  filterToggle.addEventListener('click', () => {
    const open = extraFilters.classList.toggle('open');
    filterToggle.setAttribute('aria-expanded', String(open));
  });
  function refreshFilterLabel() {
    const active = (document.getElementById('filter-account')?.value || 'all') !== 'all' ||
      (document.getElementById('filter-type')?.value || 'all') !== 'all';
    filterToggle.textContent = active ? 'More filters · active' : 'More filters';
  }
  extraFilters.addEventListener('change', refreshFilterLabel);
  refreshFilterLabel();

  const accountTools = document.getElementById('account-tools');
  const toolsToggle = document.getElementById('account-tools-toggle');
  [
    '#financial-ratios-card', '#nw-trend-card', '#balance-trends-card',
    '#update-balances-card', '#sec-accounts [data-collapse="backup"]',
    '#sec-accounts [data-collapse="balance-history"]', '#debt-details-card',
    '#sec-accounts [data-collapse="loans-out"]', '#manage-accounts-card'
  ].forEach(selector => {
    const card = document.querySelector(selector);
    if (card) accountTools.appendChild(card);
  });
  function openAccountTools() {
    accountTools.classList.add('open');
    toolsToggle.setAttribute('aria-expanded', 'true');
  }
  toolsToggle.addEventListener('click', () => {
    const open = accountTools.classList.toggle('open');
    toolsToggle.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('qa-update-balances')?.addEventListener('click', openAccountTools, true);

  const thingsSelect = document.getElementById('things-mobile-switcher');
  const thingsNav = document.querySelector('.things-section-nav');
  const thingsSections = ['overview', 'items', 'stores', 'analysis', 'purchases', 'review'];
  function showThingsSection(section) {
    if (!thingsSections.includes(section)) return;
    thingsSections.forEach(name => {
      document.getElementById('things-sec-' + name).hidden = name !== section;
    });
    thingsNav.querySelectorAll('[data-things-section]').forEach(button => {
      const active = button.dataset.thingsSection === section;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    thingsSelect.value = section;
  }
  thingsNav.addEventListener('click', event => {
    const button = event.target.closest('[data-things-section]');
    if (button) showThingsSection(button.dataset.thingsSection);
  });
  thingsSelect.addEventListener('change', () => showThingsSection(thingsSelect.value));
  document.getElementById('sec-things').addEventListener('click', event => {
    if (!event.target.closest('a[href="#things-sec-review"]')) return;
    event.preventDefault();
    showThingsSection('review');
    document.getElementById('things-list-view').scrollIntoView({ block: 'start' });
  });
  showThingsSection('items');
});
