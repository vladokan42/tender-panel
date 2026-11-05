(() => {
  'use strict';
  const state = {items: [], selected: '', tab: 'main', filter: 'all', map: null};
  const publicPrefix = location.pathname.startsWith('/tender-v2') ? '/tender-v2' : (location.pathname.startsWith('/tender/panel') ? '/tender/panel' : '');
  const publicPath = path => `${publicPrefix}${path}`;
  const api = async (url, options = {}) => {
    const response = await fetch(publicPath(url), {cache: 'no-store', ...options});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `Ошибка ${response.status}`);
    return body;
  };
  const uuid = () => {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `req-${[...bytes].map(value => value.toString(16).padStart(2,'0')).join('')}`;
  };
  const write = (url, method, body) => api(url, {
    method,
    headers: {'Content-Type':'application/json','X-Logistics-Action':'manual-logistics-v1','X-Request-ID':uuid()},
    body: JSON.stringify(body)
  });
  const e = (value) => window.escapeHtml ? window.escapeHtml(value) : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = (value, map) => map[value] || value || 'Не указано';
  const statusText = {ACTIVE:'Работает',PAUSED:'Приостановлен',DRAFT:'Черновик',MANUAL:'Ручной',API:'API',HYBRID:'Ручной + API',NOT_CONNECTED:'Не подключено',READY:'Работает',ERROR:'Ошибка',NOT_APPLICABLE:'Не применяется',AVAILABLE:'Доступен',LIMITED:'Ограниченно',UNAVAILABLE:'Недоступен',UNKNOWN:'Нужно уточнить',PHONE:'Телефон',EMAIL:'Эл. почта',CONTRACT:'Договор',OTHER:'Другое'};
  const badge = (text, type='neutral') => `<span class="logistics-badge ${type}">${e(text)}</span>`;
  const money = value => value === '' || value == null ? '—' : `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.ceil(Number(value)))} ₽`;
  const moneyCeil = value => value === '' || value == null ? '—' : `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.ceil(Number(value)))} ₽`;
  const dateTime = value => { if (!value) return '—'; const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : value; };
  const dateTimeMinute = value => { if (!value) return '—'; const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : value; };
  const setActiveNav = (mode) => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(mode === 'logistics' ? 'nav-logistics-btn' : 'nav-tenders-btn')?.classList.add('active');
  };
  const workspace = () => document.querySelector('.app-workspace');
  const listColumn = () => document.querySelector('.list-column');
  const detailColumn = () => document.querySelector('.detail-column');
  const panelDom = {mode: 'registry', registryList: null, registryDetail: null};
  const detachChildren = node => {
    const fragment = document.createDocumentFragment();
    while (node.firstChild) fragment.appendChild(node.firstChild);
    return fragment;
  };
  const mountLogisticsWorkspace = () => {
    if (panelDom.mode === 'logistics') return;
    const list = listColumn();
    const detail = detailColumn();
    panelDom.registryList = detachChildren(list);
    panelDom.registryDetail = detachChildren(detail);
    list.innerHTML = '<div class="list-toolbar"></div><div class="cards-scroll" id="cards-container"></div><div class="pagination-bar" hidden></div>';
    detail.innerHTML = '';
    panelDom.mode = 'logistics';
  };
  const mountRegistryWorkspace = () => {
    if (panelDom.mode !== 'logistics') return;
    const list = listColumn();
    const detail = detailColumn();
    list.replaceChildren(panelDom.registryList);
    detail.replaceChildren(panelDom.registryDetail);
    panelDom.registryList = null;
    panelDom.registryDetail = null;
    panelDom.mode = 'registry';
  };

  window.openTenderWorkspace = () => {
    workspace()?.classList.remove('view-search-settings', 'mobile-detail');
    mountRegistryWorkspace();
    setActiveNav('registry');
    try { localStorage.setItem('okan_tender_panel_view_v1', 'registry'); } catch (_) { }
    if (location.pathname !== publicPath('/')) history.replaceState(null, '', publicPath('/'));
    if (!document.querySelector('[data-tender-id]') && typeof window.loadTenderRegistry === 'function') {
      window.loadTenderRegistry().catch(error => console.error(error));
    }
  };
  window.showLogisticsWorkspace = async () => {
    workspace()?.classList.remove('view-search-settings', 'mobile-detail');
    mountLogisticsWorkspace();
    setActiveNav('logistics');
    try { localStorage.setItem('okan_tender_panel_view_v1', 'logistics'); } catch (_) { }
    if (location.pathname !== publicPath('/logistics')) history.replaceState(null, '', publicPath('/logistics'));
    document.querySelector('.list-toolbar').innerHTML = `
      <div class="logistics-demo-banner">Расчёт сравнивает тарифы логистов за километр и предложение Деловых Линий.</div>
      <div class="search-input-wrap"><input id="logistics-search" placeholder="Поиск по названию, региону или виду услуг" autocomplete="off" aria-autocomplete="none" spellcheck="false" autocorrect="off" autocapitalize="off"></div>
      <div class="filter-bar"><button class="filter-btn active" data-carrier-filter="all">Все</button><button class="filter-btn" data-carrier-filter="active">Работают</button><button class="filter-btn" data-carrier-filter="manual">Без API</button><button class="filter-btn" data-carrier-filter="api">API</button></div>
      <div class="logistics-list-actions"><button class="btn-action btn-orange" id="add-carrier-btn" type="button">+ Добавить логиста</button></div>`;
    document.getElementById('add-carrier-btn').addEventListener('click', () => openCarrierForm());
    document.getElementById('logistics-search').addEventListener('input', renderCarrierList);
    document.querySelectorAll('[data-carrier-filter]').forEach(button => button.addEventListener('click', () => {
      state.filter = button.dataset.carrierFilter;
      document.querySelectorAll('[data-carrier-filter]').forEach(item => item.classList.toggle('active', item === button));
      renderCarrierList();
    }));
    await loadCarriers();
  };

  async function loadCarriers(selectId = '') {
    const data = await api('/api/logistics/carriers');
    state.items = data.items || [];
    const count = document.getElementById('nav-logistics-count');
    if (count) count.textContent = state.items.length;
    state.selected = selectId || state.selected || state.items[0]?.id || '';
    renderCarrierList();
    if (state.selected) await selectCarrier(state.selected);
  }

  function filteredCarriers() {
    const q = (document.getElementById('logistics-search')?.value || '').toLowerCase().trim();
    return state.items.filter(item => {
      if (q && !`${item.name} ${item.regions} ${item.service_type}`.toLowerCase().includes(q)) return false;
      if (state.filter === 'active' && item.status !== 'ACTIVE') return false;
      if (state.filter === 'manual' && item.channel !== 'MANUAL') return false;
      if (state.filter === 'api' && item.channel === 'MANUAL') return false;
      return true;
    });
  }

  function renderCarrierList() {
    const items = filteredCarriers();
    document.getElementById('cards-container').innerHTML = items.map(item => {
      const apiState = item.channel === 'MANUAL' ? badge('Без API','neutral') : badge(item.api_status === 'READY' ? 'API работает' : 'API не подключено', item.api_status === 'READY' ? 'ok' : 'off');
      const status = badge(label(item.status,statusText), item.status === 'ACTIVE' ? 'ok' : item.status === 'PAUSED' ? 'warn' : 'neutral');
      return `<article class="t-card ${item.id===state.selected?'active':''}" data-carrier-id="${e(item.id)}" tabindex="0">
        <div class="t-tags">${status}${apiState}</div><div class="t-title" title="${e(item.name)}">${e(item.name)}</div>
        <div class="t-stage">${e(item.service_type)}</div><div class="logistics-card-meta"><span>Регион</span><strong>${e(item.regions || 'Не указан')}</strong><span>Тарифы</span><strong>${e(item.tariff_count || 0)} · доступно ${e(item.available_tariff_count || 0)}</strong></div>
      </article>`;
    }).join('') || '<div class="empty-state">Логисты не найдены</div>';
    document.querySelectorAll('[data-carrier-id]').forEach(card => card.addEventListener('click', () => selectCarrier(card.dataset.carrierId, true)));
  }

  async function selectCarrier(id, reveal = false) {
    state.selected = id;
    renderCarrierList();
    const carrier = await api(`/api/logistics/carriers/${encodeURIComponent(id)}`);
    renderCarrierDetail(carrier);
    if (reveal && window.matchMedia('(max-width: 700px)').matches) {
      document.querySelector('.app-workspace').classList.add('mobile-detail');
      document.querySelector('.detail-title')?.focus?.({preventScroll:true});
    }
  }

  function renderCarrierDetail(carrier) {
    const detail = document.getElementById('detail-pane');
    const apiState = carrier.channel === 'MANUAL' ? badge('Работа по телефону','neutral') : badge(carrier.api_status === 'READY' ? 'API работает' : 'API не подключено', carrier.api_status === 'READY' ? 'ok' : 'off');
    detail.innerHTML = `
      <div class="top-command-bar"><div class="bread-crumbs">Справочники / <strong>Панель логистики</strong> / ${e(carrier.name)}</div><div class="top-actions"><span class="readonly-badge">ПАНЕЛЬ v0.9.13</span></div></div>
      <div class="logistics-detail-head"><div><h1 class="detail-title">${e(carrier.name)}</h1><div class="t-tags" style="margin-top:7px">${badge(label(carrier.status,statusText),carrier.status==='ACTIVE'?'ok':'warn')}${badge(label(carrier.channel,statusText))}${apiState}</div></div>
      <div class="logistics-detail-actions"><button class="btn-action btn-outline" id="edit-carrier">Изменить карточку</button><button class="btn-action btn-orange" id="add-tariff">+ Добавить тариф</button></div></div>
      <div class="logistics-kpis">
        <div class="kpi-box accent-o"><div class="kpi-lbl">Тарифы</div><div class="kpi-num">${carrier.tariffs.length}</div><div class="kpi-sub">Включено: ${carrier.tariffs.filter(t=>t.enabled).length}</div></div>
        <div class="kpi-box accent-g"><div class="kpi-lbl">Рабочий канал</div><div class="kpi-num">${e(label(carrier.channel,statusText))}</div><div class="kpi-sub">${e(carrier.manager_name || 'Контакт не указан')}</div></div>
        <div class="kpi-box accent-b"><div class="kpi-lbl">Регионы</div><div class="kpi-num">${e(carrier.regions ? 'Заданы' : 'Не заданы')}</div><div class="kpi-sub">${e(carrier.regions || 'Нужно заполнить')}</div></div>
        <div class="kpi-box ${carrier.api_status==='READY'?'accent-g':'accent-r'}"><div class="kpi-lbl">API</div><div class="kpi-num">${e(label(carrier.api_status,statusText))}</div><div class="kpi-sub">${e(carrier.api_message || 'Состояние не указано')}</div></div>
      </div>
      <nav class="logistics-tabs"><button data-carrier-tab="main" class="${state.tab==='main'?'active':''}">Основное</button><button data-carrier-tab="tariffs" class="${state.tab==='tariffs'?'active':''}">Тарифы</button><button data-carrier-tab="contacts" class="${state.tab==='contacts'?'active':''}">Договорённости</button><button data-carrier-tab="integration" class="${state.tab==='integration'?'active':''}">Интеграция</button></nav>
      <section class="detail-workarea" id="carrier-tab-content">${carrierTab(carrier)}</section>`;
    ensureLogisticsBack();
    document.getElementById('edit-carrier').onclick = () => openCarrierForm(carrier);
    document.getElementById('add-tariff').onclick = () => openTariffForm(carrier);
    document.querySelectorAll('[data-carrier-tab]').forEach(button => button.addEventListener('click', () => {state.tab=button.dataset.carrierTab;renderCarrierDetail(carrier);}));
    document.querySelectorAll('[data-edit-tariff]').forEach(button => button.onclick = () => openTariffForm(carrier, carrier.tariffs.find(item => item.id === button.dataset.editTariff) || {}));
    const integration = document.getElementById('edit-integration');
    if (integration) integration.onclick = () => openIntegrationForm(carrier);
  }

  function ensureLogisticsBack() {
    document.getElementById('mobile-registry-back')?.remove();
    const back=document.createElement('button');
    back.type='button'; back.id='mobile-registry-back'; back.textContent='← Логисты';
    back.addEventListener('click',()=>{
      document.querySelector('.app-workspace').classList.remove('mobile-detail');
      history.replaceState(null,'',publicPath('/logistics'));
    });
    document.getElementById('detail-pane').prepend(back);
  }

  function carrierTab(carrier) {
    if (state.tab === 'tariffs') {
      const rows = carrier.tariffs.map(t => `<tr><td><strong>${e(t.name)}</strong><br><small>${e(t.route_from||'Любой маршрут')} → ${e(t.route_to||'по согласованию')}</small></td><td>${e(t.pricing_model)}</td><td class="cell-number">${money(t.base_amount)}</td><td class="cell-number">${t.per_km?money(t.per_km)+'/км':'—'}</td><td class="cell-number">${t.per_hour?money(t.per_hour)+'/ч':'—'}</td><td class="cell-center">${e(t.vehicle_type||'—')}</td><td class="cell-center">${badge(t.enabled?'Включён':'Отключён',t.enabled?'ok':'off')}</td><td>${e(dateTimeMinute(t.created_at))}</td><td>${e(dateTimeMinute(t.updated_at))}</td><td class="cell-center"><button class="btn-action btn-outline" type="button" data-edit-tariff="${e(t.id)}">Изменить</button></td></tr>`).join('');
      return `<section class="detail-section"><h2 class="section-heading">Тарифы и условия</h2><div class="table-wrap"><table class="data-table tariffs-table"><colgroup><col style="width:22%"><col style="width:14%"><col style="width:7%"><col style="width:6%"><col style="width:6%"><col style="width:8%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:11%"></colgroup><thead><tr><th>Тариф / маршрут</th><th>Модель</th><th>База</th><th>За км</th><th>За час</th><th>Машина</th><th>Состояние</th><th>Создан</th><th>Изменён</th><th>Действие</th></tr></thead><tbody>${rows||'<tr><td colspan="10" class="empty-state">Тарифы ещё не добавлены</td></tr>'}</tbody></table></div></section><div class="logistics-note"><strong>Ручной тариф</strong> участвует в предварительном расчёте, пока он включён. Машина и окончательная стоимость не подтверждены.</div>`;
    }
    if (state.tab === 'contacts') {
      const rows = carrier.communications.map(c => `<tr><td>${e(dateTime(c.contacted_at))}</td><td>${e(c.contact_name||'—')}</td><td>${e(c.channel)}</td><td>${e(c.subject)}</td><td title="${e(c.result)}">${e(c.result)}</td><td>${e(c.next_check_at||'—')}</td></tr>`).join('');
      return `<section class="detail-section"><h2 class="section-heading">Звонки и договорённости</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Когда</th><th>Контакт</th><th>Канал</th><th>Тема</th><th>Результат</th><th>Проверить снова</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty-state">Договорённости ещё не записаны</td></tr>'}</tbody></table></div></section>`;
    }
    if (state.tab === 'integration') {
      const used = carrier.channel !== 'MANUAL';
      return `<section class="detail-section"><h2 class="section-heading">Состояние интеграции</h2><div class="field-grid"><div class="field-item"><span class="field-label">Способ работы</span><div class="field-value">${e(label(carrier.channel,statusText))}</div></div><div class="field-item"><span class="field-label">Провайдер API</span><div class="field-value">${e(carrier.api_provider||'Не применяется')}</div></div><div class="field-item"><span class="field-label">Состояние API</span><div class="field-value">${e(label(carrier.api_status,statusText))}</div></div><div class="field-item"><span class="field-label">Последняя проверка</span><div class="field-value">${e(dateTime(carrier.api_last_check))}</div></div><div class="field-item" style="grid-column:1/-1"><span class="field-label">Пояснение</span><div class="field-value">${e(carrier.api_message||'—')}</div></div></div>${used?'<div class="logistics-note"><button class="btn-action btn-blue" id="edit-integration" type="button">Изменить состояние подключения</button></div>':''}</section><div class="logistics-demo-banner">${used?'Внешние запросы в этом демо отключены. Значения ключей и токенов в панели не хранятся и не показываются.':'Для этого логиста API не нужен. Тарифы, доступность и договорённости фиксируются вручную после звонка или письма.'}</div>`;
    }
    return `<section class="detail-section"><h2 class="section-heading">Карточка логиста</h2><div class="field-grid">
      ${fieldItem('Вид услуг',carrier.service_type)}${fieldItem('Контакт',carrier.manager_name)}${fieldItem('Телефон',carrier.phone)}${fieldItem('Электронная почта',carrier.email)}${fieldItem('Регионы',carrier.regions)}${fieldItem('Автопарк',carrier.fleet)}${fieldItem('Условия оплаты',carrier.payment_terms)}${fieldItem('НДС',carrier.vat_note)}${fieldItem('Надёжность и порядок проверки',carrier.reliability_note)}${fieldItem('Примечание',carrier.notes)}
      </div></section>`;
  }
  const fieldItem = (name,value) => `<div class="field-item"><span class="field-label">${e(name)}</span><div class="field-value">${e(value||'—')}</div></div>`;

  function dialog(title, body) {
    let node = document.getElementById('logistics-form-dialog');
    if (node) node.remove();
    document.body.insertAdjacentHTML('beforeend', `<dialog class="logistics-form-dialog" id="logistics-form-dialog"><div class="logistics-form-head"><h2>${e(title)}</h2><button class="dialog-close-btn" type="button" data-close-dialog aria-label="Закрыть">×</button></div>${body}</dialog>`);
    node = document.getElementById('logistics-form-dialog');
    node.querySelector('[data-close-dialog]').onclick = () => node.close();
    node.addEventListener('click', event => {if(event.target===node) node.close();});
    node.showModal(); return node;
  }
  const formValue = (form,name) => form.elements[name]?.value?.trim?.() || '';
  const formStatus = (form,text,type='') => {const n=form.querySelector('.logistics-form-status');n.textContent=text;n.className=`logistics-form-status ${type}`;};

  function openCarrierForm(carrier={}) {
    const node = dialog(carrier.id?'Изменить карточку логиста':'Добавить логиста', `<form class="logistics-form" id="carrier-form" autocomplete="off"><div class="logistics-form-fields">
      ${input('name','Название',carrier.name,true)}${select('status','Статус',[['ACTIVE','Работает'],['PAUSED','Приостановлен'],['DRAFT','Черновик']],carrier.status||'DRAFT')}
      ${select('channel','Способ работы',[['MANUAL','Ручной'],['HYBRID','Ручной + API'],['API','API']],carrier.channel||'MANUAL')}${input('service_type','Вид услуг',carrier.service_type,true)}
      ${input('manager_name','Контактное лицо',carrier.manager_name)}${input('phone','Телефон',carrier.phone)}${input('email','Электронная почта',carrier.email)}${input('website','Сайт',carrier.website)}
      ${textarea('regions','Регионы и направления',carrier.regions)}${textarea('fleet','Автопарк',carrier.fleet)}${textarea('payment_terms','Условия оплаты',carrier.payment_terms)}${input('vat_note','НДС',carrier.vat_note)}
      ${textarea('reliability_note','Как проверяем доступность и надёжность',carrier.reliability_note)}${textarea('notes','Примечание',carrier.notes)}
      <div class="logistics-form-status"></div></div><div class="logistics-form-actions"><button class="btn-action btn-outline" type="button" data-cancel>Отмена</button><button class="btn-action btn-orange" type="submit">Сохранить</button></div></form>`);
    const form=node.querySelector('form'); form.querySelector('[data-cancel]').onclick=()=>node.close();
    form.onsubmit=async event=>{event.preventDefault();formStatus(form,'Сохраняем…');const body=Object.fromEntries(new FormData(form));body.api_provider=body.channel==='MANUAL'?'':(carrier.api_provider||'');body.api_status=body.channel==='MANUAL'?'NOT_APPLICABLE':(carrier.channel===body.channel?carrier.api_status:'NOT_CONNECTED')||'NOT_CONNECTED';body.api_last_check=body.channel==='MANUAL'?'':(carrier.api_last_check||'');body.api_message=body.channel==='MANUAL'?'API не используется':(carrier.api_message||'Интеграция подготовлена, но не подключена');try{const saved=await write(carrier.id?`/api/logistics/carriers/${encodeURIComponent(carrier.id)}`:'/api/logistics/carriers',carrier.id?'PUT':'POST',body);formStatus(form,'Сохранено','ok');node.close();await loadCarriers(saved.id);}catch(err){formStatus(form,err.message,'error');}};
  }

  function openTariffForm(carrier, tariff={}) {
    const node=dialog(`${tariff.id?'Изменить':'Новый'} тариф - ${carrier.name}`,`<form class="logistics-form" id="tariff-form" autocomplete="off"><div class="logistics-form-fields">
      ${input('name','Название тарифа',tariff.name,true)}${select('enabled','Тариф включён',[['true','Да'],['false','Нет']],String(tariff.enabled ?? true))}${input('route_from','Откуда',tariff.route_from)}${input('route_to','Куда',tariff.route_to)}${input('vehicle_type','Тип машины',tariff.vehicle_type)}${select('pricing_model','Модель цены',[['Фиксированный тариф','Фиксированный тариф'],['За километр','За километр'],['За час','За час'],['Смешанный тариф','Смешанный тариф']],tariff.pricing_model||'Смешанный тариф')}
      ${input('base_amount','Базовая ставка, ₽',tariff.base_amount,'', 'number')}${input('per_km','За километр, ₽',tariff.per_km,'','number')}${input('per_hour','За час, ₽',tariff.per_hour,'','number')}${input('minimum_amount','Минимальная стоимость, ₽',tariff.minimum_amount,'','number')}
      ${input('max_weight_kg','Предельный вес, кг',tariff.max_weight_kg,'','number')}${input('max_volume_m3','Предельный объём, м³',tariff.max_volume_m3,'','number')}${select('vat_note','Цена с НДС',[['С НДС','Да'],['Без НДС','Нет'],['Не подтверждено','Не подтверждено']],tariff.vat_note||'Не подтверждено')}
      ${textarea('included_services','Что входит',tariff.included_services)}${textarea('extra_conditions','Дополнительные условия',tariff.extra_conditions)}
      <div class="logistics-form-status"></div></div><div class="logistics-form-actions"><button class="btn-action btn-outline" type="button" data-cancel>Отмена</button><button class="btn-action btn-orange" type="submit">Сохранить тариф</button></div></form>`);
    const form=node.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>node.close();form.onsubmit=async event=>{event.preventDefault();formStatus(form,'Сохраняем…');const body=Object.fromEntries(new FormData(form));const url=tariff.id?`/api/logistics/carriers/${encodeURIComponent(carrier.id)}/tariffs/${encodeURIComponent(tariff.id)}`:`/api/logistics/carriers/${encodeURIComponent(carrier.id)}/tariffs`;try{await write(url,tariff.id?'PUT':'POST',body);node.close();state.tab='tariffs';await loadCarriers(carrier.id);}catch(err){formStatus(form,err.message,'error');}};
  }

  function openIntegrationForm(carrier) {
    const node=dialog(`Состояние подключения - ${carrier.name}`,`<form class="logistics-form" id="integration-form" autocomplete="off"><div class="logistics-form-fields">${input('api_provider','Провайдер API',carrier.api_provider,true)}${select('api_status','Состояние',[['NOT_CONNECTED','Не подключено'],['READY','Работает'],['ERROR','Ошибка']],carrier.api_status||'NOT_CONNECTED')}${input('api_last_check','Последняя проверка',carrier.api_last_check||new Date().toISOString().slice(0,16),'','datetime-local')}${textarea('api_message','Результат проверки',carrier.api_message,true)}<div class="logistics-demo-banner wide">Ключи и токены здесь не вводятся. Демо хранит только состояние подключения и пояснение.</div><div class="logistics-form-status"></div></div><div class="logistics-form-actions"><button class="btn-action btn-outline" type="button" data-cancel>Отмена</button><button class="btn-action btn-orange" type="submit">Сохранить состояние</button></div></form>`);
    const form=node.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>node.close();form.onsubmit=async event=>{event.preventDefault();formStatus(form,'Сохраняем…');const body={...carrier,...Object.fromEntries(new FormData(form))};delete body.tariffs;delete body.communications;try{const saved=await write(`/api/logistics/carriers/${encodeURIComponent(carrier.id)}`,'PUT',body);node.close();state.tab='integration';await loadCarriers(saved.id);}catch(err){formStatus(form,err.message,'error');}};
  }

  function openCallForm(carrier) {
    const node=dialog(`Записать договорённость - ${carrier.name}`,`<form class="logistics-form" id="call-form" autocomplete="off"><div class="logistics-form-fields">${input('contacted_at','Дата и время',new Date().toISOString().slice(0,16),true,'datetime-local')}${input('contact_name','С кем говорили',carrier.manager_name)}${select('channel','Канал',[['PHONE','Телефон'],['EMAIL','Эл. почта'],['MESSENGER','Мессенджер'],['MEETING','Встреча']],'PHONE')}${input('subject','Тема','Тариф и доступность',true)}${textarea('result','Что подтвердили','',true)}${input('next_check_at','Проверить снова','','','date')}<div class="logistics-form-status"></div></div><div class="logistics-form-actions"><button class="btn-action btn-outline" type="button" data-cancel>Отмена</button><button class="btn-action btn-orange" type="submit">Сохранить запись</button></div></form>`);
    const form=node.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>node.close();form.onsubmit=async event=>{event.preventDefault();formStatus(form,'Сохраняем…');try{await write(`/api/logistics/carriers/${encodeURIComponent(carrier.id)}/communications`,'POST',Object.fromEntries(new FormData(form)));node.close();state.tab='contacts';await selectCarrier(carrier.id);}catch(err){formStatus(form,err.message,'error');}};
  }

  function displayDeliveryAddress(value='') {
    const raw=String(value||'').trim();
    const parts=raw.split(',').map(part=>part.trim()).filter(Boolean)
      .filter(p => !/^\d{6}$/.test(p))
      .filter(p => !/^(?:Российская\s+Федерация|Россия|РФ)$/i.test(p))
      .filter(p => !/\b(?:вн\.?\s*тер\.?\s*г\.?|внутригородск\w*|муниципальн\w*\s+округ)\b/i.test(p))
      .filter(p => !/^(?:ФКУ|ФГБУ|ГБУЗ|ГБОУ|МАОУ|МБОУ|МБДОУ|ГБДОУ|ФГУП|ГУФСИН|УФСИН|ООО|ЗАО|ПАО|АО|ИП)\b|\b(?:пищеблок|продовольственный\s+склад|продуктовый\s+склад|склад|столовая|помещение\b.*заказчик)\b/i.test(p));
    const cityIndex=parts.findIndex(part=>/^г\.?\s*Москва$/i.test(part)||/^Москва$/i.test(part));
    if(cityIndex>=0){
      const city=parts[cityIndex].replace(/^г\.?\s*/i,'г ').replace(/\s+/g,' ').trim();
      const streetParts=parts.filter((part,index)=>index!==cityIndex);
      return [...streetParts, city].join(', ');
    }
    return parts.join(', ');
  }

  function input(name,title,value='',required=false,type='text',unit='',needsReview=false) {
    const isWide=name==='delivery_address'?'wide':'';
    const displayValue=name==='delivery_address'?displayDeliveryAddress(value):value;
    const unitHtml=unit?`<span class="input-unit ${name==='stated_value'?'currency':''}">${e(unit)}</span>`:'';
    if(name==='delivery_address'){
      const reviewStar=needsReview?'<span class="address-review-star" title="Адрес требует проверки перед расчётом" aria-label="Адрес требует проверки">*</span>':'';
      const tagHtml=`<button type="button" class="btn-manual-address-tag" title="Адрес можно вбить руками или выбрать из карт"><svg class="icon-pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span>Ввод руками</span></button>`;
      return `<div class="logistics-timeline-content"><span class="logistics-timeline-label label-orange">${e(title)}${reviewStar}</span><div class="input-unit-wrap"><input name="${e(name)}" type="${e(type)}" value="${e(displayValue||'')}" ${required?'required':''} role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="delivery-address-suggestions" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">${tagHtml}</div></div>`;
    }
    return `<label class="${isWide}"><span>${e(title)}</span><div class="input-unit-wrap"><input name="${e(name)}" type="${e(type)}" value="${e(value||'')}" ${required?'required':''} ${type==='number'?'min="0" step="0.01"':''} autocomplete="off" aria-autocomplete="none" spellcheck="false" autocorrect="off" autocapitalize="off">${unitHtml}</div></label>`;
  }
  function textarea(name,title,value='',required=false){return `<label class="wide">${e(title)}<textarea name="${e(name)}" ${required?'required':''}>${e(value||'')}</textarea></label>`;}
  function select(name,title,items,value){return `<label>${e(title)}<select name="${e(name)}">${items.map(([v,t])=>`<option value="${e(v)}" ${v===value?'selected':''}>${e(t)}</option>`).join('')}</select></label>`;}

  function logisticsCalculationHtml(item) {
    const bestValue=item.best_offer ? e(item.best_offer.carrier_name) : '';
    const bestLabel=item.legacy_record ? 'Сохранённый вариант' : 'Лучший предварительный вариант';
    const calculated=item.calculated_at ? `${item.legacy_record?'Сохранено':'Рассчитано'}: ${e(dateTime(item.calculated_at))}` : '';
    const offers=(item.offers||[]).map(offer=>`<article class="logistics-offer ${offer.carrier_id===item.best_offer?.carrier_id?'best':''}"><div><strong>${e(offer.carrier_name)}</strong></div><div class="logistics-offer-price">${money(offer.amount)}</div>${offer.vat_note?`<div class="logistics-offer-note">НДС: ${e(offer.vat_note)}</div>`:''}</article>`).join('');
    const statedValue=item.stated_value ?? '';

    const cargoParamsHtml = `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 8px;">
        ${input('cargo_places','Места',item.cargo_places ?? '',true,'number','мест')}
        ${input('weight_kg','Общий вес',item.weight_kg ?? '',true,'number','кг')}
        <label><span>Общий объём</span><div class="input-unit-wrap"><input name="volume_m3" type="number" value="${e(item.volume_m3 ?? '')}" readonly autocomplete="off" aria-autocomplete="none" spellcheck="false"><span class="input-unit">м³</span></div></label>
        ${input('stated_value','Стоимость',statedValue,true,'number','₽')}
      </div>
      <div class="logistics-dimensions-grid wide" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        ${input('length_m','Длина 1 места',item.length_m ?? '',true,'number','м')}
        ${input('width_m','Ширина 1 места',item.width_m ?? '',true,'number','м')}
        ${input('height_m','Высота 1 места',item.height_m ?? '',true,'number','м')}
      </div>`;

    return `<div class="logistics-split-row"><section class="detail-section logistics-calculation">
      <form class="logistics-form" id="logistics-calculation-form" autocomplete="off">
        <input type="hidden" name="address_registry_id" value="">
        
        <div class="logistics-best-command wide" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <label style="flex:1; min-width:0;">
            <span>${bestLabel}</span>
            <div class="logistics-best-value">${bestValue||'Требуется расчёт'}</div>
            <small>${calculated}</small>
          </label>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0; margin-left:auto;">
            <button class="btn-action btn-orange" type="submit" style="white-space:nowrap; flex-shrink:0;">Рассчитать логистику</button>
            <details class="logistics-settings-dropdown" style="position:relative;">
              <summary title="Параметры и габариты груза" aria-label="Параметры и габариты груза">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </summary>
              <div class="logistics-settings-panel">
                ${cargoParamsHtml}
              </div>
            </details>
          </div>
        </div>

        <div class="logistics-timeline-container wide">
          <div class="logistics-timeline-line"></div>
          <div class="logistics-timeline-point point-a">
            <div class="logistics-timeline-dot dot-green"></div>
            <div class="logistics-timeline-content">
              <span class="logistics-timeline-label label-green">ТОЧКА А · СКЛАД ОТПРАВЛЕНИЯ</span>
              <div class="logistics-address-val"><span>${e(item.pickup_address||'Определится автоматически по ближайшему складу')}</span></div>
            </div>
          </div>
          <div class="logistics-timeline-point point-b">
            <div class="logistics-timeline-dot dot-orange"></div>
            ${input('delivery_address','ТОЧКА Б (АДРЕС ОБЪЕКТА)',item.delivery_address,true,'text','',item.delivery_address_needs_review)}
          </div>
        </div>

        <div class="logistics-settings-bottom wide">
          <details class="logistics-settings-dropdown">
            <summary>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              <span>Параметры и габариты груза</span>
            </summary>
            <div class="logistics-settings-panel">
              ${cargoParamsHtml}
            </div>
          </details>
        </div>

        <div class="logistics-form-status"></div>
      </form>
    </section>
    <section class="detail-section logistics-offers-section">
      <h2 class="section-heading">Предложения логистов</h2>
      <div class="logistics-offers">${offers||'<div class="logistics-empty-action"><strong>Предложения появятся после расчёта</strong><div>Ручные включённые тарифы и предложение API будут пересчитаны отдельно.</div></div>'}</div>
    </section>
  </div>`;
  }

  function bindLogisticsCalculation(tenderId) {
    const form=document.getElementById('logistics-calculation-form');
    if(!form)return;
    const calculateVolume=()=>{
      const count=Number(form.elements.cargo_places.value||0);
      const length=Number(form.elements.length_m.value||0);
      const width=Number(form.elements.width_m.value||0);
      const height=Number(form.elements.height_m.value||0);
      const volume=count*length*width*height;
      form.elements.volume_m3.value=Number.isFinite(volume)&&volume>0?volume.toFixed(3):'';
    };
    ['cargo_places','weight_kg','length_m','width_m','height_m','stated_value','delivery_address'].forEach(name=>form.elements[name].addEventListener('input',()=>{calculateVolume();const best=form.querySelector('.logistics-best-value');if(best)best.textContent='Требуется пересчёт';}));
    form.elements.cargo_places.min='1'; form.elements.cargo_places.max='10000'; form.elements.cargo_places.step='1';
    form.elements.weight_kg.step='0.001';
    form.elements.length_m.step='0.001'; form.elements.width_m.step='0.001'; form.elements.height_m.step='0.001';
    form.elements.stated_value.step='0.01';
    const addressInput=form.elements.delivery_address;
    if(addressInput){
      const recentKey='okan.logistics.recent-addresses.v1';
      const wrap=addressInput.closest('.input-unit-wrap')||addressInput.parentElement;
      const manualButton=wrap.querySelector('.btn-manual-address-tag');
      const registryInput=form.elements.address_registry_id;
      let timer=null, box=null, items=[], activeIndex=-1, requestNumber=0;
      const recentAddresses=()=>{
        try{return JSON.parse(localStorage.getItem(recentKey)||'[]').filter(value=>value&&typeof value==='object'&&value.id&&value.display_name).slice(0,6);}
        catch(_){return [];}
      };
      const rememberRecentAddress=item=>{
        if(!item?.id||!item?.display_name)return;
        const next=[{id:item.id,display_name:item.display_name},...recentAddresses().filter(value=>value.id!==item.id)].slice(0,6);
        try{localStorage.setItem(recentKey,JSON.stringify(next));}catch(_){ }
      };
      const closeBox=()=>{
        if(box)box.remove();
        box=null;items=[];activeIndex=-1;
        addressInput.setAttribute('aria-expanded','false');
        addressInput.removeAttribute('aria-activedescendant');
      };
      const activate=index=>{
        if(!box||!items.length)return;
        activeIndex=(index+items.length)%items.length;
        box.querySelectorAll('.logistics-suggestion-item').forEach((node,idx)=>node.classList.toggle('is-active',idx===activeIndex));
        const active=box.querySelector(`[data-idx="${activeIndex}"]`);
        if(active){addressInput.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}
      };
      async function selectAddressSuggestion(item){
        addressInput.value=item.display_name;
        addressInput.dispatchEvent(new Event('input',{bubbles:true}));
        registryInput.value=item.id||'';
        rememberRecentAddress(item);
        closeBox();
        form.requestSubmit();
      }
      const showItems=(nextItems,title='')=>{
        closeBox();
        items=nextItems.filter(item=>item&&item.display_name).slice(0,7);
        if(!items.length)return;
        box=document.createElement('div');
        box.id='delivery-address-suggestions';
        box.className='logistics-suggestions-dropdown';
        box.setAttribute('role','listbox');
        box.innerHTML=`${title?`<div class="logistics-suggestions-title">${e(title)}</div>`:''}${items.map((item,idx)=>`<button type="button" id="delivery-address-option-${idx}" class="logistics-suggestion-item" role="option" data-idx="${idx}"><svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg><span>${e(item.display_name)}</span></button>`).join('')}`;
        wrap.appendChild(box);
        addressInput.setAttribute('aria-expanded','true');
        box.querySelectorAll('.logistics-suggestion-item').forEach((node,idx)=>{
          node.addEventListener('mousedown',event=>event.preventDefault());
          node.addEventListener('click',()=>selectAddressSuggestion(items[idx]));
          node.addEventListener('mouseenter',()=>activate(idx));
        });
      };
      const showRecent=()=>showItems(recentAddresses(),'Последние адреса');
      const search=async query=>{
        const currentRequest=++requestNumber;
        try{
          const data=await api(`/api/logistics/geocode/suggest?q=${encodeURIComponent(query)}&tender_id=${encodeURIComponent(tenderId)}`);
          if(currentRequest!==requestNumber||addressInput.value.trim()!==query)return;
          showItems(data.suggestions||[]);
        }catch(_){if(currentRequest===requestNumber)closeBox();}
      };
      addressInput.addEventListener('focus',()=>{
        const query=addressInput.value.trim();
        if(query.length>=3){clearTimeout(timer);timer=setTimeout(()=>search(query),0);}
        else showRecent();
      });
      addressInput.addEventListener('input',()=>{
        registryInput.value='';
        clearTimeout(timer);
        const query=addressInput.value.trim();
        if(query.length<3){requestNumber++;showRecent();return;}
        timer=setTimeout(()=>search(query),300);
      });
      addressInput.addEventListener('keydown',event=>{
        if(event.key==='Escape'){closeBox();return;}
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();
          if(!box){showRecent();return;}
          activate(activeIndex+(event.key==='ArrowDown'?1:-1));
        }else if(event.key==='Enter'&&activeIndex>=0&&items[activeIndex]){
          event.preventDefault();selectAddressSuggestion(items[activeIndex]);
        }
      });
      manualButton?.addEventListener('click',()=>{addressInput.focus();addressInput.select();});
      document.addEventListener('click',event=>{if(box&&!wrap.contains(event.target))closeBox();},{once:false});
    }
    form.onsubmit=async event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');
      button.disabled=true; calculateVolume(); formStatus(form,'Считаем все доступные варианты…');
      try {
        await write(`/api/logistics/tenders/${encodeURIComponent(tenderId)}/calculate`,'POST',Object.fromEntries(new FormData(form)));
        await window.renderTenderLogistics(tenderId);
      } catch(err) {
        formStatus(form,err.message,'error'); button.disabled=false;
      }
    };
  }

  window.renderTenderLogistics = async tenderId => {
    const content=document.getElementById('det-detail-content');
    try {
      const item=await api(`/api/logistics/tenders/${encodeURIComponent(tenderId)}`);
      const mapHtml=`<section class="detail-section"><h2 class="section-heading">Карта маршрута (OSRM)</h2><div class="logistics-map-shell"><div class="logistics-map-route-label"><span class="logistics-route-swatch"></span><span>Автомобильный маршрут</span><span class="logistics-map-route-meta"></span></div><button type="button" class="logistics-map-fit" id="logistics-map-fit" title="Выровнять карту по маршруту" aria-label="Выровнять карту по маршруту"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/></svg></button><div id="tender-logistics-map" class="logistics-map"></div></div></section>`;
      content.innerHTML=logisticsCalculationHtml(item)+mapHtml;
      bindLogisticsCalculation(tenderId);
      try { await drawTenderMap(tenderId,item.map_region); }
      catch(mapError){
        const map=document.getElementById('tender-logistics-map');
        if(map)map.innerHTML='<div class="logistics-map-unavailable">Карта временно недоступна. Расчёт и выбранный склад сохранены выше.</div>';
        console.warn('Карта логистики недоступна',mapError);
      }
    } catch(err){content.innerHTML=`<section class="detail-section"><div class="empty-state" style="color:var(--status-red)">Не удалось загрузить логистику: ${e(err.message)}</div></section>`;}
  };

  async function drawTenderMap(tenderId,region){
    if(!window.maplibregl)throw new Error('Модуль карты не загружен');
    const route=await api(`/api/logistics/tenders/${encodeURIComponent(tenderId)}/route`);
    const coordinates=route.geometry.coordinates;
    if(!Array.isArray(coordinates)||coordinates.length<3)throw new Error('Маршрут не содержит дорожной линии');
    const routeLabel=document.querySelector('.logistics-map-route-label');
    if(routeLabel&&Number(route.distance_km)>0){
      const distance=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(route.distance_km));
      const duration=Number(route.duration_minutes)>0?` • около ${Math.round(Number(route.duration_minutes))} мин`:'';
      routeLabel.insertAdjacentHTML('beforeend',`<span class="logistics-map-route-meta">${distance} км${duration}</span>`);
    }
    if(state.map){try{state.map.remove();}catch(_){ }state.map=null;}
    const map=new maplibregl.Map({container:'tender-logistics-map',style:publicPath(`/map/style.json?region=${encodeURIComponent(region||route.map_region)}`),transformRequest:(url)=>({url:new URL(url,window.location.origin).href}),center:coordinates[0],zoom:7,attributionControl:false,maxZoom:17,dragRotate:false, pitchWithRotate:false, touchPitch:false});
    state.map=map;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({showCompass:false,showZoom:false}),'top-right');
    map.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}),'bottom-left');
    map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'© OpenStreetMap contributors'}));
    map.on('load',()=>{
      map.addSource('route',{type:'geojson',data:{type:'Feature',properties:{kind:'car'},geometry:route.geometry}});
      map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],7,8,14,12],'line-opacity':0.96}});
      map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ff5a00','line-width':['interpolate',['linear'],['zoom'],7,4.5,14,7.5],'line-opacity':0.98}});
      map.addLayer({id:'route-direction',type:'symbol',source:'route',layout:{'symbol-placement':'line','symbol-spacing':75,'text-field':'›','text-font':['Open Sans Semibold'],'text-size':20,'text-rotation-alignment':'map','text-keep-upright':false,'text-allow-overlap':true},paint:{'text-color':'#ffffff','text-halo-color':'#ff5a00','text-halo-width':0.8}});
      const marker=(text,type,title,point)=>{const element=document.createElement('div');element.className=`logistics-route-marker ${type}`;element.textContent=text;element.title=title;new maplibregl.Marker({element,anchor:'center'}).setLngLat(point).addTo(map);};
      marker('A','start','Склад',coordinates[0]);
      marker('Б','finish','Адрес заказчика',coordinates.at(-1));
      const bounds=coordinates.reduce((value,point)=>value.extend(point),new maplibregl.LngLatBounds(coordinates[0],coordinates[0]));
      const compact=window.matchMedia('(max-width:700px)').matches;
      const fitRoute=()=>map.fitBounds(bounds,{padding:compact?38:64,maxZoom:13,duration:350});
      document.getElementById('logistics-map-fit')?.addEventListener('click',fitRoute);
      fitRoute();
      requestAnimationFrame(()=>map.resize());
      setTimeout(()=>map.resize(),180);
    });
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const tenders=document.querySelector('.nav-section .nav-item.active');
    if(tenders){tenders.id='nav-tenders-btn';tenders.href='javascript:void(0)';tenders.onclick=window.openTenderWorkspace;}
    const management=[...document.querySelectorAll('.nav-head')].find(n=>n.textContent.trim()==='Управление')?.parentElement;
    const tenderNav=document.querySelector('.nav-section');
    if(tenderNav)tenderNav.insertAdjacentHTML('beforeend','<a class="nav-item" id="nav-logistics-btn" data-panel-view="logistics" href="javascript:void(0)" title="Перевозчики, ручные тарифы и API"><div style="display:flex;align-items:center;gap:8px"><span class="mark-sq mark-orange"></span><span class="nav-text">Панель логистики</span></div><span class="nav-counter" id="nav-logistics-count">—</span></a><div class="logistics-nav-note">Логисты, тарифы, звонки и состояние API</div>');
    // Navigation is delegated by search-settings.js so the same click path works on every panel route.
    api('/api/logistics/summary').then(summary => {
      const count=document.getElementById('nav-logistics-count');
      if(count)count.textContent=summary.carriers?.total ?? '0';
    }).catch(()=>{});
    api('/api/tenders').then(data => {
      const count=document.getElementById('nav-total-count');
      if(count)count.textContent=(data.tenders||[]).length;
    }).catch(()=>{});
    if(location.pathname===publicPath('/logistics'))setTimeout(window.showLogisticsWorkspace,0);
  });
})();
