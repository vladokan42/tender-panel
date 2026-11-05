'use strict';

(() => {
  // Derive the proxy prefix from this asset, not from an application route.
  const assetPath = new URL(document.currentScript.src, location.href).pathname;
  const prefix = assetPath.slice(0, assetPath.lastIndexOf('/static/'));
  const path = value => `${prefix}${value}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] % 16) + 64;
    bytes[8] = (bytes[8] % 64) + 128;
    const hex = [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  const stages = ['Кандидаты', 'Запрос подготовлен', 'Ждём ответ', 'Ответ получен', 'Сопоставлено'];
  const tabs = {pipeline:'Пайплайн', products:'Товары', coverage:'Покрытие тендеров', log:'Журнал'};
  const labels = {NEEDS_SEARCH:'В поиске · оценка <50', NO_OFFERS:'Поиск завершён · предложений нет', HAS_CANDIDATE:'Есть кандидат · нужна проверка', UNCHECKED:'Не проверено'};
  let root, state = null, categoryId = '', tab = 'pipeline', active = false, busy = false;
  let generation = 0, timer = null, controller = null, previousClasses = [], settingsWasOpen = false;
  let pending = null, task = null, selectedCard = '', message = '', loadError = '';
  const refreshedTasks = new Set();
  const category = () => state?.categories.find(c => c.id === categoryId);
  const candidate = id => category()?.candidates.find(c => c.id === id);
  const needs = c => c.lines.filter(l => ['NEEDS_SEARCH', 'NO_OFFERS'].includes(l.state));
  const $ = selector => root.querySelector(selector);
  const button = (action, text, id = '', disabled = false) => `<button type="button" data-sourcing-action="${action}" data-id="${esc(id)}" ${disabled || busy ? 'disabled' : ''}>${esc(text)}</button>`;
  const tenderLink = l => `<a href="${esc(path(`/tenders/${encodeURIComponent(l.tender_id)}`))}">${esc(l.tender_id)}</a>`;
  const empty = text => `<div class="sc-empty">${esc(text)}</div>`;
  const when = value => value ? esc(formatDateTime(value)) : '—';
  const formatDateTime = value => window.formatTenderDate ? window.formatTenderDate(value) : String(value || '').trim();
  const count = (c, status) => c.lines.filter(l => l.state === status).length;
  function sourceLink(url, text) {
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      return `<a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(text || url)}</a>`;
    } catch (_) { return esc(text || url || 'Источник не указан'); }
  }
  function tell(text, error = false) {
    message = text;
    if (!root) return;
    $('#sourcing-status').textContent = text;
    $('#sourcing-status').classList.toggle('sc-error', error);
    const note = $('#sourcing-dialog-message');
    if (note) note.textContent = text;
  }
  async function api(url, options = {}) {
    const response = await fetch(path(url), {credentials:'same-origin', cache:'no-store', ...options});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(typeof body.detail === 'string' ? body.detail : `Ошибка ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function apply(next) {
    if (!next || !Number.isInteger(next.revision) || !Array.isArray(next.categories)) throw new Error('Неверный ответ сервера');
    if (state && next.revision < state.revision) return;
    state = next;
    if (next.task && (!task || task.id === next.task.id || !isRunning())) task = {...(task?.id === next.task.id ? task : {}), ...next.task};
    if (!category()) categoryId = next.categories[0]?.id || '';
  }
  async function reload() {
    const current = generation;
    controller?.abort();
    controller = new AbortController();
    try {
      await completeTask();
      if (!active || current !== generation) return;
      const next = await api('/api/sourcing', {signal:controller.signal});
      if (!active || current !== generation) return;
      apply(next); await completeTask();
      if (!active || current !== generation) return;
      loadError = ''; render(); schedulePoll(current);
    } catch (error) {
      if (error.name === 'AbortError' || !active || current !== generation) return;
      loadError = `Не удалось обновить данные: ${error.message}. Прежние данные сохранены.`;
      render(); tell(loadError, true);
    }
  }
  function renderList() {
    const filter = $('#sourcing-search').value.toLocaleLowerCase('ru');
    $('#sourcing-category-count').textContent = state?.categories.length ?? '—';
    $('#sourcing-categories').innerHTML = state ? state.categories.filter(c => c.name.toLocaleLowerCase('ru').includes(filter)).map(c =>
      `<button type="button" class="sc-category ${c.id === categoryId ? 'sc-selected' : ''}" data-sourcing-category="${esc(c.id)}" aria-pressed="${c.id === categoryId}"><div class="sc-row sc-muted"><span>${new Set(c.lines.map(l => l.tender_id)).size} тендеров · ${c.lines.length} строк</span><span>${needs(c).length} в поиске</span></div><b>${esc(c.name)}</b><div class="sc-muted">Не проверено: ${count(c, 'UNCHECKED')} · кандидатов: ${c.candidates.length}</div></button>`).join('') || empty('Категории не найдены') : empty('Загрузка категорий…');
    $('#sourcing-total').textContent = state ? `Категорий: ${state.categories.length} · строк: ${state.categories.reduce((n, c) => n + c.lines.length, 0)}. Состояние хранится на сервере.` : 'Состояние загружается с сервера.';
  }
  function importReceipt(s) {
    const r = s.import_receipt;
    if (!r) return '';
    const partial = r.partial === true || r.owner_status === 'REVIEW';
    const id = /^[A-Za-z0-9_-]+$/.test(r.receipt_id || '') ? r.receipt_id : 'не указан';
    const counts = [['accepted','Принято'],['rejected','Отклонено'],['skipped','Пропущено'],['not_selected','Не выбрано']]
      .map(([key, label]) => `${label}: ${Number.isInteger(r.source_summary?.[key]) && r.source_summary[key] >= 0 ? r.source_summary[key] : '—'}`).join(' · ');
    return `<div class="sc-notice" data-import-receipt><b>${partial ? 'Частичный импорт · нужна проверка' : 'Импорт сохранён'}</b><p>Статус владельца: ${['PASS','REVIEW'].includes(r.owner_status) ? r.owner_status : 'не указан'}</p><p>${counts}</p><p>${r.publication_verified === true ? 'Квитанция проверена' : 'Квитанция не проверена'} · import job: ${esc(id)}</p><p>Поставка не подтверждена.</p></div>`;
  }
  function card(s) {
    const blocked = s.stale || s.rejected || !!loadError;
    let actions = '';
    if (s.stage <= 1) actions += button('prepare', s.stage ? 'Редактировать запрос' : 'Подготовить запрос', s.id, blocked || !(s.email || s.phone));
    if (s.stage === 1) actions += button('sent', 'Я отправил вне панели', s.id, blocked);
    if (s.stage === 2) actions += button('response', 'Записать ответ', s.id, blocked);
    if (s.stage === 3) actions += button('import', 'Передать прайс на импорт', s.id, blocked || !state.capabilities?.import || typeof window.sourcingImportCandidate !== 'function') + button('refresh', 'Повторить сопоставление', s.id, blocked || !s.import_receipt);
    if (s.stage === 4) actions += '<p class="sc-muted">Сопоставление подтверждено сервером. Поставка не подтверждена.</p>';
    return `<article class="sc-card ${selectedCard === s.id ? 'sc-highlight' : ''}" data-sourcing-card="${esc(s.id)}"><button type="button" class="sc-name" data-sourcing-action="profile" data-id="${esc(s.id)}">${esc(s.name)}</button><div class="sc-muted">${sourceLink(s.site, s.site)}</div><p class="sc-muted">Связанных строк: ${s.line_keys.length} · источников: ${s.sources.length}</p><div class="sc-muted">Доставка: ${esc(Array.isArray(s.delivery) ? s.delivery.join(', ') : s.delivery || 'не подтверждена')}</div>${!(s.email || s.phone) ? '<p class="sc-badge">Контактов нет · подготовка недоступна</p>' : ''}${s.stale ? '<p class="sc-badge sc-error">Устарело · изменились исходные строки</p>' : ''}${s.stage === 3 && !s.import_receipt && (!state.capabilities?.import || typeof window.sourcingImportCandidate !== 'function') ? '<p class="sc-muted">Импорт ещё не подключён. Ответ сохранён; сопоставление недоступно до подтверждённого импорта.</p>' : ''}${importReceipt(s)}<div class="sc-card-actions">${actions}${button('reject', 'Отклонить с причиной', s.id, !!loadError)}</div></article>`;
  }
  function pipeline(c) {
    const rejected = c.candidates.filter(s => s.rejected);
    return `<p class="sc-muted">Каталог сайта — предположение об ассортименте, не подтверждение цены, объёма или соответствия. Пять этапов · прокрутка вправо →</p><div class="sc-board" role="region" aria-label="Пять этапов поиска поставщиков" tabindex="0">${stages.map((title, stage) => {
      const cards = c.candidates.filter(s => !s.rejected && s.stage === stage);
      return `<section class="sc-stage" data-stage="${stage}"><header class="sc-row"><b>${title}</b><span>${cards.length}</span></header><div class="sc-cards">${cards.map(card).join('') || empty('Нет карточек на этом этапе')}</div></section>`;
    }).join('')}</div>${rejected.length ? `<details class="sc-rejected"><summary>Отклонённые кандидаты: ${rejected.length} · история сохранена</summary>${rejected.map(s => `<div class="sc-notice"><b>${esc(s.name)}</b><p>${esc(s.reason)}</p>${button('profile', 'История', s.id)} ${button('restore', 'Восстановить', s.id, !!loadError)}</div>`).join('')}</details>` : ''}`;
  }
  function products(c) {
    return `<div class="sc-notice">Каждый объём относится к отдельной строке тендера. Оценка строго &lt;50 и подтверждённый успешный пустой поиск требуют поиска поставщика. Неизвестные результаты — отдельно. Оценка не подтверждает поставку.</div><div class="sc-table"><table><thead><tr><th>Товар / характеристики</th><th>Объём</th><th>Тендер / строка</th><th>Регион / срок</th><th>Лучшая оценка</th><th>Состояние</th></tr></thead><tbody>${c.lines.map(l => `<tr><td><b>${esc(l.name)}</b><p class="sc-muted">${esc(l.characteristics)}</p></td><td>${esc(l.quantity)} ${esc(l.unit)}</td><td>${tenderLink(l)}<p class="sc-muted">${esc(l.line_id)}</p><small>Редакция: ${esc(l.source_revision)}</small></td><td>${esc(l.region)}<p>${when(l.deadline)}</p></td><td>${typeof l.best_score === 'number' && Number.isFinite(l.best_score) ? esc(l.best_score) : '—'}</td><td>${esc(labels[l.state] || l.state)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function coverage(c) {
    const tenders = [...new Set(c.lines.map(l => l.tender_id))];
    return `<div class="sc-notice">Покрытие только по результату поиска. Соответствие, наличие, объём и готовность к участию не подтверждены.</div><div class="sc-table"><table><thead><tr><th>Тендер</th><th>Строк</th><th>Есть кандидат</th><th>В поиске</th><th>Не проверено</th></tr></thead><tbody>${tenders.map(id => {
      const group = {lines:c.lines.filter(l => l.tender_id === id)};
      return `<tr><td>${tenderLink(group.lines[0])}</td><td>${group.lines.length}</td><td>${count(group, 'HAS_CANDIDATE')}</td><td>${needs(group).length}</td><td>${count(group, 'UNCHECKED')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function journal(c) {
    const rows = (state.journal || []).filter(e => !e.category_id || e.category_id === c.id || e.target_category_id === c.id);
    const actions = {add_candidate:'Кандидат добавлен', prepare:'Запрос подготовлен', sent:'Подтверждена отправка вне панели', response:'Ответ сохранён', reject:'Кандидат отклонён', restore:'Кандидат восстановлен', import_receipt:'Импорт подтверждён сервером', rematched:'Сопоставление подтверждено сервером', research_results:'Результаты исследования сохранены'};
    return rows.slice().reverse().map(e => `<article class="sc-notice"><small class="sc-muted">${when(e.at || e.created_at)} · ${esc(e.actor)}</small><p>${esc(e.text || e.message || actions[e.action] || e.action)}</p>${e.candidate_id ? `<small>${esc(e.candidate_id)}</small>` : ''}</article>`).join('') || empty('Событий ещё нет');
  }
  function renderTask() {
    $('#sourcing-task').textContent = task ? `Задача ${task.id || task.task_id || ''}: ${{queued:'В очереди', running:'Выполняется', completed:'Завершена', partial:'Частично выполнена', failed:'Ошибка', stale:'Устарела'}[task.status] || task.status || 'статус не получен'}${task.message ? ` · ${task.message}` : ''}` : '';
  }
  function render() {
    if (!root || !active) return;
    renderList();
    const c = category();
    $('#sourcing-revision').textContent = state ? `Серверная версия ${state.revision}` : 'Загрузка…';
    $('#sourcing-context').innerHTML = c ? `<h1>${esc(c.name)}</h1><div class="sc-stats">${[[needs(c).length,'В поиске'],[count(c,'HAS_CANDIDATE'),'Есть кандидат'],[count(c,'UNCHECKED'),'Не проверено'],[c.candidates.filter(s => !s.rejected).length,'Поставщики-кандидаты']].map(([n, label]) => `<div><small>${label}</small><strong>${n}</strong></div>`).join('')}</div>` : empty(loadError || 'Категорий для поиска нет');
    $('#sourcing-toolbar').innerHTML = button('refresh','Повторить поиск по прайсам','',!c || !!loadError || isRunning()) + button('research','Исследовать сайты','',!c || !state?.capabilities?.research || !needs(c).length || !!loadError || isRunning()) + button('assign_category','Разнести по категориям','',!c?.lines.length || !!loadError) + button('add_candidate','Добавить кандидата','',!c || !!loadError) + button('reload','Обновить данные');
    $('#sourcing-research-note').textContent = state?.capabilities?.research ? 'Исследование доступно только после успешного внутреннего поиска текущих строк. Сервер проверяет условия; наружу передаются только товар, характеристики и регион.' : 'Исследование сайтов недоступно: провайдер не подключён или условия запуска не выполнены.';
    if (state && !state.capabilities?.import) $('#sourcing-research-note').textContent += ' Загрузка прайса временно недоступна. Кандидатов, запросы и ответы можно сохранять; импорт не выполняется.';
    root.querySelectorAll('[data-sourcing-tab]').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.sourcingTab === tab)); b.tabIndex = b.dataset.sourcingTab === tab ? 0 : -1; });
    $('#sourcing-content').innerHTML = c ? ({pipeline, products, coverage, log:journal}[tab])(c) : empty(loadError || 'Нет данных');
    $('#sourcing-content').setAttribute('aria-labelledby', `sourcing-tab-${tab}`);
    renderTask();
    if (selectedCard && tab === 'pipeline') [...root.querySelectorAll('[data-sourcing-card]')].find(n => n.dataset.sourcingCard === selectedCard)?.scrollIntoView({block:'nearest', inline:'nearest', behavior:'instant'});
    tell(message || loadError || 'Состояние хранится на сервере. Панель не отправляет письма.', !!loadError);
  }
  function openDialog(title, body, submit, onSubmit) {
    const dialog = $('#sourcing-dialog');
    if (dialog.open) dialog.close();
    dialog.innerHTML = `<form><header class="sc-row"><h2 id="sourcing-dialog-title">${esc(title)}</h2>${button('close','Закрыть · Esc')}</header><div class="sc-dialog-body">${body}</div><footer><div id="sourcing-dialog-message" role="status"></div>${submit ? `<button type="submit">${esc(submit)}</button>` : button('close','Понятно')}</footer></form>`;
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      try { if (await onSubmit(new FormData(event.currentTarget))) dialog.close(); }
      catch (error) { tell(error.message, true); }
    };
    dialog.showModal();
  }
  const field = (name, label, type = 'text', value = '', required = false) => `<label class="sc-field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" maxlength="2000" ${required ? 'required' : ''}></label>`;
  const textArea = (name, label, value = '', limit = 20000) => `<label class="sc-field"><span>${esc(label)}</span><textarea name="${name}" required maxlength="${limit}">${esc(value)}</textarea></label>`;
  function lineChoices(lines, selected) {
    return `<fieldset><legend>Точные строки</legend>${lines.map(l => `<label class="sc-check"><input type="checkbox" name="line_keys" value="${esc(l.key)}" ${selected.includes(l.key) ? 'checked' : ''}><span>${esc(l.name)} · ${esc(l.region)}<small class="sc-muted">${esc(l.tender_id)} / ${esc(l.line_id)} · ${esc(l.source_revision)}</small></span></label>`).join('')}</fieldset>`;
  }
  function profile(id) {
    const s = candidate(id); if (!s) return;
    openDialog(s.name, `<div class="sc-notice">${s.rejected ? `Отклонён: ${esc(s.reason)}` : esc(stages[s.stage])}${s.stale ? ' · Устарело' : ''}</div>${importReceipt(s)}<p>Сайт: ${sourceLink(s.site)}</p><p>Эл. почта: ${esc(s.email || 'не указана')} · телефон: ${esc(s.phone || 'не указан')}</p><p>Доставка: ${esc(Array.isArray(s.delivery) ? s.delivery.join(', ') : s.delivery || 'не подтверждена')}</p><h3>Источники</h3>${s.sources.map(v => `<div class="sc-notice">${sourceLink(v.url, v.text)}<small class="sc-muted">Проверено: ${when(v.checked_at)}</small></div>`).join('') || empty('Источников нет')}<h3>Связанные строки</h3>${category().lines.filter(l => s.line_keys.includes(l.key)).map(l => `<p>${esc(l.name)} · ${tenderLink(l)} / ${esc(l.line_id)}</p>`).join('')}${s.request ? `<details><summary>Сохранённый запрос · ${s.request.sent ? 'отправка подтверждена вручную' : 'не отправлен'}</summary><pre>${esc(s.request.text)}</pre></details>` : ''}${s.response ? `<details open><summary>Ответ · ${when(s.response.received_at)}</summary><pre>${esc(s.response.text)}</pre></details>` : ''}${s.reason ? `<p>Сохранённая причина отклонения: ${esc(s.reason)}</p>` : ''}`, '', null);
  }
  function dialogFor(action, id) {
    const c = category(), s = candidate(id);
    if (action === 'assign_category') {
      const revision = state.revision;
      openDialog('Разнести по категориям', '<p>Выбранные строки перейдут в указанную категорию только здесь. ТЗ, объёмы и исходные данные не меняются. Связанные старые кандидаты останутся в истории как устаревшие.</p>' + field('name','Название категории','text','',true) + lineChoices(c.lines, needs(c).map(l => l.key)), 'Сохранить категорию', data => {
        const line_keys = data.getAll('line_keys');
        const source_revisions = Object.fromEntries(c.lines.filter(l => line_keys.includes(l.key)).map(l => [l.key,l.source_revision]));
        return command({action, category_id:c.id, revision, name:data.get('name').trim(), line_keys, source_revisions});
      });
      $('#sourcing-dialog [name=name]').maxLength = 300;
    } else if (action === 'add_candidate') {
      openDialog('Добавить кандидата', field('name','Название','text','',true) + field('site','Сайт · только https','url','',true) + field('email','Эл. почта','email') + field('phone','Телефон') + field('delivery','Условия доставки') + lineChoices(c.lines, needs(c).map(l => l.key)), 'Добавить', data => {
        const site = new URL(data.get('site'));
        if (site.protocol !== 'https:' || site.username || site.password) throw new Error('Нужен сайт https без логина и пароля в адресе.');
        const line_keys = data.getAll('line_keys');
        const source_revisions = Object.fromEntries(c.lines.filter(l => line_keys.includes(l.key)).map(l => [l.key,l.source_revision]));
        return command({action, name:data.get('name').trim(), site:data.get('site').trim(), email:data.get('email').trim(), phone:data.get('phone').trim(), delivery:data.get('delivery').trim(), line_keys, source_revisions});
      });
    } else if (action === 'prepare' && s) {
      const lines = c.lines.filter(l => s.line_keys.includes(l.key));
      // Only product, necessary characteristics and region enter the default outbound text.
      const text = s.request?.text || `Просим сообщить актуальный ассортимент, цены и условия поставки:\n\n${lines.map(l => `${l.name}; ${l.characteristics || ''}; регион доставки: ${l.region || 'уточняется'}`).join('\n')}\n\nПросим указать наличие, срок поставки, минимальный заказ и условия оплаты. Это запрос информации, не заказ.`;
      openDialog('Запрос поставщику · без отправки', '<p class="sc-notice">Ничего не отправляется автоматически. Проверьте текст перед передачей вне панели. Выбранные строки связаны с запросом на сервере.</p><label class="sc-field"><span>Тип запроса</span><select name="kind"><option value="quote">Коммерческое предложение</option><option value="price">Актуальный прайс</option></select></label>' + lineChoices(lines, s.request?.line_keys || s.line_keys) + textArea('text','Текст запроса',text), 'Сохранить запрос', data => command({action, candidate_id:id, kind:data.get('kind'), text:data.get('text'), line_keys:data.getAll('line_keys')}));
      $('#sourcing-dialog select').value = s.request?.kind || 'quote';
    } else if (action === 'sent' && s?.request) {
      openDialog('Подтвердить отправку вне панели', `<p>Подтверждается только сохранённый запрос. Панель не отправляет email.</p><pre>${esc(s.request.text)}</pre><label class="sc-check"><input type="checkbox" name="confirmed" required><span>Я отправил этот сохранённый запрос вне панели.</span></label>`, 'Подтвердить отправку', () => command({action, candidate_id:id, confirmed:true}));
    } else if (action === 'response' && s) {
      openDialog('Записать ответ поставщика', '<p>Ответ сохранится на сервере. Это ещё не импорт прайса и не подтверждение поставки.</p>' + textArea('text','Полученный ответ'), 'Сохранить ответ', data => command({action, candidate_id:id, text:data.get('text')}));
    } else if (action === 'reject' && s) {
      openDialog('Отклонить кандидата', '<p>Кандидат и история останутся на сервере.</p>' + textArea('reason','Причина отклонения','',1000), 'Отклонить', data => command({action, candidate_id:id, reason:data.get('reason')}));
    } else if (action === 'restore' && s) {
      openDialog('Восстановить кандидата', `<p>Восстановить ${esc(s.name)}? Предыдущая причина и история сохранятся.</p>`, 'Восстановить', () => command({action, candidate_id:id}));
    }
  }
  async function post(url, data) {
    const signature = JSON.stringify({url, category_id:categoryId, data});
    if (!pending || pending.signature !== signature) pending = {signature, payload:{request_id:uuid(), revision:state.revision, category_id:categoryId, ...data}};
    return api(url, {method:'POST', headers:{'Content-Type':'application/json','X-Tender-Sourcing-Action':'sourcing-v1'}, body:JSON.stringify(pending.payload)});
  }
  async function command(data) {
    if (busy || loadError) return false;
    if (data.line_keys && !data.line_keys.length) throw new Error('Выберите хотя бы одну строку.');
    const current = generation;
    busy = true; render();
    $('#sourcing-dialog')?.querySelectorAll('button[type="submit"]').forEach(b => { b.disabled = true; });
    try {
      const result = await post('/api/sourcing/commands', data);
      if (!active || current !== generation) return false;
      apply(result.state);
      pending = null;
      selectedCard = data.candidate_id || category()?.candidates.at(-1)?.id || '';
      tell(result.message || 'Сохранено на сервере.');
      return true;
    } catch (error) {
      if (!active || current !== generation) return false;
      if (error.status && error.status < 500) pending = null;
      await reload();
      tell(error.status === 409 ? (data.action === 'assign_category' ? 'Данные изменились. Закройте форму и откройте заново, чтобы проверить текущие строки и редакции.' : 'Данные изменились. Загружена текущая версия; проверьте форму и повторите.') : `Результат команды не подтверждён: ${error.message}. Проверьте состояние.${pending ? ' Повтор того же действия использует тот же запрос.' : ''}`, true);
      return false;
    } finally {
      busy = false;
      if (active) {
        if (current !== generation) await reload();
        render();
        $('#sourcing-dialog')?.querySelectorAll('button[type="submit"]').forEach(b => { b.disabled = false; });
      }
    }
  }
  const isRunning = () => ['queued','running'].includes(task?.status);
  function schedulePoll(current) {
    clearTimeout(timer);
    if (active && current === generation && isRunning()) timer = setTimeout(() => pollTask(current), 500);
  }
  async function completeTask() {
    const id = task?.id || task?.task_id;
    if (!id || task.kind !== 'refresh' || isRunning() || refreshedTasks.has(id)) return;
    // A failed multi-tender task can still have published earlier tender results.
    const ids = task.tender_ids || state.categories.flatMap(c => c.lines.map(l => l.tender_id));
    await Promise.all([...new Set(ids)].map(key => window.invalidateTenderOffers?.(key)));
    refreshedTasks.add(id);
  }
  async function pollTask(current) {
    if (!active || current !== generation || !isRunning()) return;
    try {
      const result = await api(`/api/sourcing/tasks/${encodeURIComponent(task.id || task.task_id)}`);
      if (!active || current !== generation) return;
      task = {...task, ...(result.task || result)};
      renderTask();
      if (!isRunning()) { await reload(); return; }
    } catch (error) {
      if (!active || current !== generation) return;
      tell(`Статус задачи не получен: ${error.message}. Проверка будет повторена.`, true);
    }
    timer = setTimeout(() => pollTask(current), 1500);
  }
  async function startTask(kind, id, selectedKeys = null) {
    if (busy || isRunning() || !category()) return;
    const current = generation;
    const line_keys = selectedKeys || (id ? candidate(id).line_keys : kind === 'research' ? needs(category()).map(l => l.key) : category().lines.map(l => l.key));
    busy = true; render();
    try {
      const source_revisions = Object.fromEntries(category().lines.filter(l => line_keys.includes(l.key)).map(l => [l.key,l.source_revision]));
      const tender_ids = [...new Set(category().lines.filter(l => line_keys.includes(l.key)).map(l => l.tender_id))];
      const result = await post(`/api/sourcing/${kind}`, {line_keys, source_revisions, ...(id ? {candidate_id:id} : {})});
      if (!active || current !== generation) return;
      task = result.task && {...result.task, kind, tender_ids};
      if (!task || !(task.id || task.task_id) || !task.status) throw new Error('Сервер не вернул идентификатор и статус задачи');
      pending = null;
      tell(result.message || 'Задача принята сервером.');
      if (isRunning()) schedulePoll(current);
      else await reload();
    } catch (error) {
      if (error.status && error.status < 500) pending = null;
      if (error.status === 409 && active && current === generation) await reload();
      if (active && current === generation) tell(`Запуск не подтверждён: ${error.message}.${pending ? ' Повтор использует тот же запрос.' : ' Проверьте данные и повторите.'}`, true);
    } finally {
      busy = false;
      if (active) {
        if (current !== generation) await reload();
        render();
      }
    }
  }
  function mount() {
    root = document.getElementById('sourcing-workspace');
    if (root?.dataset.mounted) return;
    if (!root) { root = document.createElement('section'); root.id = 'sourcing-workspace'; document.querySelector('.app-workspace').append(root); }
    root.dataset.mounted = '1';
    root.hidden = true;
    root.innerHTML = `<aside class="sc-list" aria-label="Категории"><header><div class="sc-row"><b>Категории поиска</b><span id="sourcing-category-count">—</span></div><input type="search" id="sourcing-search" aria-label="Найти категорию" placeholder="Найти категорию"></header><div id="sourcing-categories"></div><footer id="sourcing-total" class="sc-muted"></footer></aside><main class="sc-main"><header class="sc-topbar"><b>Поиск поставщиков · DEMO</b><small id="sourcing-revision" class="sc-muted"></small></header><section id="sourcing-context"></section><div id="sourcing-toolbar" class="sc-toolbar"></div><p id="sourcing-research-note" class="sc-muted"></p><div id="sourcing-task" role="status"></div><div class="sc-tabs" role="tablist" aria-label="Категория">${Object.entries(tabs).map(([key,label]) => `<button type="button" role="tab" id="sourcing-tab-${key}" aria-controls="sourcing-content" data-sourcing-tab="${key}">${label}</button>`).join('')}</div><section id="sourcing-content" role="tabpanel" tabindex="0"></section><footer id="sourcing-status" role="status"></footer></main><dialog id="sourcing-dialog" aria-labelledby="sourcing-dialog-title"></dialog>`;
    $('#sourcing-search').addEventListener('input', renderList);
    root.addEventListener('keydown', event => {
      if (!event.target.matches('[data-sourcing-tab]') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const buttons = [...root.querySelectorAll('[data-sourcing-tab]')], i = buttons.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault(); tab = buttons[next].dataset.sourcingTab; render(); buttons[next].focus();
    });
    root.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.sourcingCategory) { categoryId = b.dataset.sourcingCategory; selectedCard = ''; render(); return; }
      if (b.dataset.sourcingTab) { tab = b.dataset.sourcingTab; render(); return; }
      const action = b.dataset.sourcingAction, id = b.dataset.id;
      if (action === 'close') $('#sourcing-dialog').close();
      else if (action === 'reload') reload();
      else if (action === 'research') {
        openDialog('Исследовать сайты · выбрать до 10 строк', '<p>Сначала повтори поиск по своим прайсам. Наружу передаются только название, характеристики и регион доставки.</p>' + lineChoices(needs(category()), needs(category()).slice(0,10).map(l => l.key)), 'Начать исследование', async data => {
          const keys = data.getAll('line_keys');
          if (!keys.length || keys.length > 10) throw new Error('Выбери от 1 до 10 строк.');
          $('#sourcing-dialog').close(); await startTask('research', '', keys); return false;
        });
      }
      else if (action === 'refresh') startTask(action, id);
      else if (action === 'profile') profile(id);
      else if (action === 'import') {
        if (state.capabilities?.import && typeof window.sourcingImportCandidate === 'function') {
          Promise.resolve().then(() => window.sourcingImportCandidate({category_id:categoryId, candidate_id:id})).then(reload).catch(error => tell(`Импорт не подтверждён: ${error.message}`, true));
        }
      } else dialogFor(action, id);
    });
  }
  window.openSourcingWorkspace = async () => {
    mount();
    if (active) { await reload(); return; }
    const app = document.querySelector('.app-workspace');
    previousClasses = ['view-search-settings','mobile-detail','documents-view'].filter(c => app.classList.contains(c));
    settingsWasOpen = !!document.getElementById('search-settings-pane')?.classList.contains('open');
    document.getElementById('search-settings-pane')?.classList.remove('open');
    app.classList.remove(...previousClasses);
    app.classList.add('sourcing-view'); active = true; generation += 1;
    root.hidden = false;
    document.querySelectorAll('.sidebar .nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('nav-sourcing-btn')?.classList.add('active');
    if (location.pathname.replace(/\/$/,'') !== path('/sourcing')) history.pushState(null, '', path('/sourcing'));
    render(); await reload();
  };
  window.closeSourcingWorkspace = () => {
    if (!active) return;
    active = false; generation += 1; clearTimeout(timer); controller?.abort();
    $('#sourcing-dialog').close(); root.hidden = true;
    const app = document.querySelector('.app-workspace');
    app.classList.remove('sourcing-view'); app.classList.add(...previousClasses);
    if (settingsWasOpen) document.getElementById('search-settings-pane')?.classList.add('open');
    document.getElementById('nav-sourcing-btn')?.classList.remove('active');
  };
  // Capture is necessary: the legacy delegated [data-panel-view] router defaults unknown sections to registry.
  document.addEventListener('click', event => {
    if (!event.target.closest('#nav-sourcing-btn')) return;
    event.preventDefault(); event.stopPropagation(); window.openSourcingWorkspace();
  }, true);
  const route = () => {
    if (location.pathname.replace(/\/$/,'') === path('/sourcing')) window.openSourcingWorkspace();
    else window.closeSourcingWorkspace();
  };
  window.addEventListener('popstate', route);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route); else route();
})();
