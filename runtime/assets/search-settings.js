'use strict';

(() => {
  const API_PREFIX = location.pathname.startsWith('/tender-v2') ? '/tender-v2' : '';
  const WRITE_HEADERS = {
    'Content-Type': 'application/json',
    'X-Tender-Search-Settings-Action': 'search-settings-v1',
  };
  const DEFAULT_SETTINGS = {
    types: {small: false, commercial: false, research: false, proposals: false},
    statuses: {cancelled: false, completed: false},
    lots: {mode: null, shareEnabled: false, share: 50, excludeUnsuitable: false},
    price: {minEnabled: false, min: null, maxEnabled: false, max: null, missingEnabled: false, missingAction: 'MANUAL_REVIEW'},
    participation: {msp: false, smp: false},
    delivery: {one: false, periodic: false, security: false},
    regions: {moscow: false, spb: false, mo: false, lo: false, all: false},
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  let current = {version: 0, created_at_utc: null, actor: null, comment: '', settings: clone(DEFAULT_SETTINGS)};
  let savedSettings = clone(DEFAULT_SETTINGS);
  let versions = [];

  const pane = () => document.getElementById('search-settings-pane');
  const workspace = () => document.querySelector('.app-workspace');
  const publicPath = path => `${API_PREFIX}${path}`;
  const setActivePanel = view => {
    document.querySelectorAll('.sidebar .nav-item').forEach(node => node.classList.remove('active'));
    document.querySelector(`[data-panel-view="${view}"]`)?.classList.add('active');
    if (view === 'registry') document.getElementById('nav-tenders-btn')?.classList.add('active');
    if (view === 'logistics') document.getElementById('nav-logistics-btn')?.classList.add('active');
  };
  const getPath = path => path.split('.').reduce((value, key) => value[key], current.settings);
  const setPath = (path, value) => {
    const parts = path.split('.');
    const last = parts.pop();
    const target = parts.reduce((node, key) => node[key], current.settings);
    target[last] = value;
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fetchJson = async (path, options = {}) => {
    const response = await fetch(`${API_PREFIX}${path}`, {credentials: 'same-origin', cache: 'no-store', ...options});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `Ошибка ${response.status}`);
    return payload;
  };
  const enabledCount = () => {
    const f = current.settings;
    return [f.types.small, f.types.commercial, f.types.research, f.types.proposals, f.statuses.cancelled, f.statuses.completed,
      Boolean(f.lots.mode), f.lots.shareEnabled, f.lots.excludeUnsuitable, f.price.minEnabled, f.price.maxEnabled,
      f.price.missingEnabled, f.participation.msp, f.participation.smp, f.delivery.one, f.delivery.periodic,
      f.delivery.security, f.regions.moscow, f.regions.spb, f.regions.mo, f.regions.lo, f.regions.all].filter(Boolean).length;
  };
  const valid = () => {
    const p = current.settings.price;
    if ((p.minEnabled && p.min === null) || (p.maxEnabled && p.max === null)) return false;
    return !(p.minEnabled && p.maxEnabled && Number(p.min) > Number(p.max));
  };
  const changed = () => JSON.stringify(current.settings) !== JSON.stringify(savedSettings);
  const switchRow = (path, label, control = '') => `<div class="search-setting-row"><span class="search-setting-title">${label}</span><span class="search-setting-control">${control}</span><label class="search-switch"><input type="checkbox" data-search-switch="${path}"><span class="search-slider"></span></label></div>`;

  const render = () => {
    pane().innerHTML = `
      <section class="search-settings-fullpage" aria-labelledby="search-settings-title">
        <div class="search-settings-header">
          <div><h1 id="search-settings-title">Настройка поиска</h1><p>Условия собраны в одном месте. Пока все фильтры выключены, собираются все тендеры.</p></div>
          <div class="search-settings-actions"><input id="search-settings-comment" maxlength="500" placeholder="Комментарий к версии"><button class="btn-action btn-orange" id="search-settings-save" type="button">Сохранить новую версию</button><button class="btn-action btn-outline" id="search-settings-cancel" type="button">Отменить изменения</button><button class="btn-action search-settings-reset" id="search-settings-reset" type="button">Сбросить все фильтры</button></div>
        </div>
        <div class="search-settings-status" id="search-settings-status" aria-live="polite"></div>
        <div class="search-settings-summary">
          <div><b>Включено фильтров</b><strong id="search-stat-enabled">0</strong></div><div><b>Активная версия</b><strong id="search-stat-version">v0</strong></div><div><b>Несохранённые</b><strong id="search-stat-changed">Нет</strong></div><div><b>Состояние сбора</b><strong>Все тендеры</strong></div><div><b>Применение</b><strong>Не включено</strong></div><div><b>Неизвестные данные</b><strong>Ручная проверка</strong></div>
        </div>
        <div class="search-settings-notice" id="search-settings-notice"></div>
        <div class="search-settings-grid">
          <section class="search-settings-card"><h2>Виды процедур <span>4 тумблера</span></h2><div>${switchRow('types.small', 'Закупки малого объёма')}${switchRow('types.commercial', 'Коммерческие закупки')}${switchRow('types.research', 'Запросы цен и исследования рынка')}${switchRow('types.proposals', 'Запрос предложений')}</div></section>
          <section class="search-settings-card"><h2>Статусы закупки <span>2 тумблера</span></h2><div>${switchRow('statuses.cancelled', 'Исключать отменённые')}${switchRow('statuses.completed', 'Исключать завершённые')}</div></section>
          <section class="search-settings-card"><h2>НМЦК и ценовые условия <span>Диапазон цен</span></h2><div>${switchRow('price.minEnabled', 'Минимальная НМЦК', '<input class="search-number-input" data-search-price="min" inputmode="decimal" placeholder="Сумма в рублях">')}${switchRow('price.maxEnabled', 'Максимальная НМЦК', '<input class="search-number-input" data-search-price="max" inputmode="decimal" placeholder="Сумма в рублях">')}${switchRow('price.missingEnabled', 'Цена не указана', '<select class="search-select-input" id="search-missing-action"><option value="MANUAL_REVIEW">Проверить вручную</option><option value="EXCLUDE">Исключить закупку</option></select>')}</div></section>
          <section class="search-settings-card"><h2>Правила для смешанных лотов <span>Сопоставление товаров</span></h2><div class="search-settings-card-body"><div class="search-setting-title">Режим обработки лотов</div><div class="search-mode-grid"><button data-search-mode="ONLY_OUR" type="button">Только наши товары</button><button data-search-mode="ALLOW_MIXED" type="button">Разрешать смешанные</button><button data-search-mode="EXCLUDE_MIXED" type="button">Исключать смешанные</button><button data-search-mode="MANUAL_REVIEW" type="button">Ручная проверка</button></div>${switchRow('lots.shareEnabled', 'Минимальная доля подходящих строк', '<input id="search-share" type="range" min="0" max="100"><strong id="search-share-value"></strong>')}${switchRow('lots.excludeUnsuitable', 'Исключать при неподходящей обязательной строке')}</div></section>
          <section class="search-settings-card"><h2>Ограничения и МСП / СМП <span>2 тумблера</span></h2><div>${switchRow('participation.msp', 'Исключать закупки только для МСП')}${switchRow('participation.smp', 'Исключать закупки только для СМП/СОНКО')}</div></section>
          <section class="search-settings-card"><h2>Поставка и обеспечение <span>Условия контракта</span></h2><div>${switchRow('delivery.one', 'Разовая поставка')}${switchRow('delivery.periodic', 'Периодическая поставка')}${switchRow('delivery.security', 'Исключать с обеспечением исполнения')}</div></section>
          <section class="search-settings-card"><h2>Регионы поставки <span>География</span></h2><div>${switchRow('regions.moscow', 'Москва')}${switchRow('regions.spb', 'Санкт-Петербург')}${switchRow('regions.mo', 'Московская область')}${switchRow('regions.lo', 'Ленинградская область')}${switchRow('regions.all', 'Все регионы')}</div></section>
          <section class="search-settings-card"><h2>История версий <span>Серверная SQLite</span></h2><div class="search-history" id="search-settings-history"></div></section>
          <section class="search-settings-card search-settings-wide"><h2>Сводка правил <span>Применяется при ручном сборе</span></h2><div class="search-rules" id="search-settings-rules"></div></section>
        </div>
      </section>`;
    updateUi();
  };

  const activeRules = () => {
    const f = current.settings;
    const rules = [];
    const types = [['small', 'Закупки малого объёма'], ['commercial', 'Коммерческие закупки'], ['research', 'Запросы цен и исследования рынка'], ['proposals', 'Запрос предложений']].filter(([key]) => f.types[key]).map(([, label]) => label);
    if (types.length) rules.push(`Виды процедур: ${types.join(', ')}`);
    if (f.statuses.cancelled) rules.push('Исключать отменённые закупки');
    if (f.statuses.completed) rules.push('Исключать завершённые закупки');
    if (f.lots.mode) rules.push({ONLY_OUR:'Только лоты с нашими товарами', ALLOW_MIXED:'Разрешать смешанные лоты', EXCLUDE_MIXED:'Исключать смешанные лоты', MANUAL_REVIEW:'Смешанные лоты проверять вручную'}[f.lots.mode]);
    if (f.lots.shareEnabled) rules.push(`Минимальная доля подходящих строк: ${f.lots.share}%`);
    if (f.lots.excludeUnsuitable) rules.push('Исключать неподходящую обязательную строку');
    if (f.price.minEnabled) rules.push(`Минимальная НМЦК: ${f.price.min ?? 'не задана'}`);
    if (f.price.maxEnabled) rules.push(`Максимальная НМЦК: ${f.price.max ?? 'не задана'}`);
    if (f.price.missingEnabled) rules.push(`Цена не указана: ${f.price.missingAction === 'EXCLUDE' ? 'исключить' : 'ручная проверка'}`);
    if (f.participation.msp) rules.push('Исключать закупки только для МСП');
    if (f.participation.smp) rules.push('Исключать закупки только для СМП/СОНКО');
    if (f.delivery.one) rules.push('Разовая поставка');
    if (f.delivery.periodic) rules.push('Периодическая поставка');
    if (f.delivery.security) rules.push('Исключать закупки с обеспечением исполнения');
    const regions = [['moscow','Москва'],['spb','Санкт-Петербург'],['mo','Московская область'],['lo','Ленинградская область'],['all','Все регионы']].filter(([key]) => f.regions[key]).map(([, label]) => label);
    if (regions.length) rules.push(`Регионы: ${regions.join(', ')}`);
    return rules;
  };

  const updateUi = ({preservePriceFocus = false} = {}) => {
    pane().querySelectorAll('[data-search-switch]').forEach(input => { input.checked = Boolean(getPath(input.dataset.searchSwitch)); });
    pane().querySelectorAll('[data-search-mode]').forEach(button => button.classList.toggle('active', button.dataset.searchMode === current.settings.lots.mode));
    ['min', 'max'].forEach(name => {
      const input = pane().querySelector(`[data-search-price="${name}"]`);
      if (input && (!preservePriceFocus || document.activeElement !== input)) input.value = current.settings.price[name] ?? '';
    });
    const missing = pane().querySelector('#search-missing-action');
    if (missing) missing.value = current.settings.price.missingAction;
    const share = pane().querySelector('#search-share');
    if (share && document.activeElement !== share) share.value = String(current.settings.lots.share);
    pane().querySelector('#search-share-value').textContent = `${current.settings.lots.share}%`;
    pane().querySelector('#search-stat-enabled').textContent = String(enabledCount());
    pane().querySelector('#search-stat-version').textContent = `v${current.version}`;
    pane().querySelector('#search-stat-changed').textContent = changed() ? 'Есть' : 'Нет';
    const status = pane().querySelector('#search-settings-status');
    status.textContent = current.created_at_utc ? `Сохранено: ${new Date(current.created_at_utc).toLocaleString('ru-RU')} · ${current.actor || 'пользователь'}` : 'Версия ещё не сохранена';
    const notice = pane().querySelector('#search-settings-notice');
    if (!valid()) notice.textContent = 'Нужно указать корректные границы НМЦК: минимальная сумма не может превышать максимальную.';
    else if (!enabledCount()) notice.textContent = 'Все фильтры выключены — по умолчанию собираются все тендеры.';
    else notice.textContent = 'Правила сохранены и будут применены при следующем ручном запуске сбора.';
    pane().querySelector('#search-settings-save').disabled = !valid();
    pane().querySelector('#search-settings-rules').innerHTML = activeRules().length ? `<ul>${activeRules().map(rule => `<li>${escapeHtml(rule)}</li>`).join('')}</ul>` : '<p>Все условия выключены. Ограничения не применяются.</p>';
    pane().querySelector('#search-settings-history').innerHTML = versions.length ? versions.map(item => `<div class="search-history-row"><span><strong>v${item.version}</strong><small>${escapeHtml(new Date(item.created_at_utc).toLocaleString('ru-RU'))} · ${escapeHtml(item.comment || 'Без комментария')}</small></span><button class="btn-action btn-outline" data-search-restore="${item.version}" type="button">Восстановить</button></div>`).join('') : '<p>Сохранённых версий пока нет.</p>';
  };

  const refresh = async () => {
    const [record, history] = await Promise.all([fetchJson('/api/search-settings'), fetchJson('/api/search-settings/history')]);
    current = record;
    savedSettings = clone(record.settings);
    versions = history.items || [];
    updateUi();
  };
  const show = async () => {
    workspace().classList.add('view-search-settings');
    setActivePanel('settings');
    localStorage.setItem('okan_tender_panel_view_v1', 'settings');
    if (location.pathname !== publicPath('/settings')) history.replaceState(null, '', publicPath('/settings'));
    if (!pane().dataset.ready) { render(); pane().dataset.ready = '1'; }
    try { await refresh(); } catch (error) { pane().querySelector('#search-settings-status').textContent = `Не удалось загрузить настройки: ${error.message}`; }
  };
  const registry = () => {
    if (typeof window.openTenderWorkspace === 'function') {
      window.openTenderWorkspace();
      return;
    }
    workspace().classList.remove('view-search-settings');
    setActivePanel('registry');
    localStorage.setItem('okan_tender_panel_view_v1', 'registry');
    if (location.pathname !== publicPath('/') && !location.pathname.includes('/tenders/')) history.replaceState(null, '', publicPath('/'));
  };
  const save = async () => {
    const button = pane().querySelector('#search-settings-save');
    const comment = pane().querySelector('#search-settings-comment').value.trim();
    button.disabled = true;
    try {
      current = await fetchJson('/api/search-settings', {method: 'PUT', headers: WRITE_HEADERS, body: JSON.stringify({settings: current.settings, comment})});
      savedSettings = clone(current.settings);
      pane().querySelector('#search-settings-comment').value = '';
      versions = (await fetchJson('/api/search-settings/history')).items || [];
      updateUi();
    } catch (error) { pane().querySelector('#search-settings-status').textContent = `Настройки не сохранены: ${error.message}`; }
    finally { if (button) button.disabled = !valid(); }
  };
  const restore = async version => {
    try { current = await fetchJson(`/api/search-settings/restore/${encodeURIComponent(version)}`, {method: 'POST', headers: WRITE_HEADERS}); savedSettings = clone(current.settings); versions = (await fetchJson('/api/search-settings/history')).items || []; updateUi(); }
    catch (error) { pane().querySelector('#search-settings-status').textContent = `Не удалось восстановить версию: ${error.message}`; }
  };
  const reset = async () => {
    try { current = await fetchJson('/api/search-settings/reset', {method: 'POST', headers: WRITE_HEADERS}); savedSettings = clone(current.settings); versions = (await fetchJson('/api/search-settings/history')).items || []; updateUi(); }
    catch (error) { pane().querySelector('#search-settings-status').textContent = `Не удалось сбросить настройки: ${error.message}`; }
  };
  const amount = value => {
    const normal = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!normal) return null;
    const parsed = Number(normal);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-panel-view]');
    if (nav) {
      event.preventDefault();
      if (nav.dataset.panelView === 'settings') show();
      else if (nav.dataset.panelView === 'logistics') window.showLogisticsWorkspace?.();
      else registry();
      return;
    }
    if (!workspace()?.classList.contains('view-search-settings')) return;
    const mode = event.target.closest('[data-search-mode]');
    if (mode) { current.settings.lots.mode = current.settings.lots.mode === mode.dataset.searchMode ? null : mode.dataset.searchMode; updateUi(); return; }
    const restoreButton = event.target.closest('[data-search-restore]');
    if (restoreButton) { restore(Number(restoreButton.dataset.searchRestore)); return; }
    if (event.target.id === 'search-settings-save') { save(); return; }
    if (event.target.id === 'search-settings-cancel') { current.settings = clone(savedSettings); updateUi(); return; }
    if (event.target.id === 'search-settings-reset') { reset(); }
  });
  document.addEventListener('change', event => {
    if (!workspace()?.classList.contains('view-search-settings')) return;
    if (event.target.matches('[data-search-switch]')) { setPath(event.target.dataset.searchSwitch, event.target.checked); updateUi(); }
    if (event.target.id === 'search-missing-action') { current.settings.price.missingAction = event.target.value; updateUi(); }
  });
  document.addEventListener('input', event => {
    if (!workspace()?.classList.contains('view-search-settings')) return;
    if (event.target.matches('[data-search-price]')) { current.settings.price[event.target.dataset.searchPrice] = amount(event.target.value); updateUi({preservePriceFocus: true}); }
    if (event.target.id === 'search-share') { current.settings.lots.share = Math.max(0, Math.min(100, Number(event.target.value) || 0)); updateUi(); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    if (location.pathname === publicPath('/settings')) show();
    else if (location.pathname === publicPath('/') || location.pathname === API_PREFIX) registry();
  });
  window.addEventListener('popstate', () => {
    if (location.pathname === publicPath('/settings')) show();
    else if (location.pathname === publicPath('/') || location.pathname === API_PREFIX) registry();
  });
})();
