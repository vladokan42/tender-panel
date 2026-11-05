'use strict';
(() => {
  const asset = new URL(document.currentScript.src, location.href);
  const prefix = asset.pathname.slice(0, asset.pathname.lastIndexOf('/static/'));
  const endpoint = suffix => `${prefix}/api/sourcing${suffix}`;
  const actionHeader = {'X-Tender-Sourcing-Action': 'sourcing-v1'};
  let open = false;
  async function api(suffix, options = {}) {
    const response = await fetch(endpoint(suffix), {credentials: 'same-origin', cache: 'no-store', ...options});
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Ошибка ${response.status}`);
    return body;
  }
  const post = (suffix, body) => api(suffix, {method: 'POST', headers: {...actionHeader, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const text = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  function node(tag, value, parent) {
    const element = document.createElement(tag);
    if (value != null) element.textContent = text(value);
    if (parent) parent.append(element);
    return element;
  }
  window.sourcingImportCandidate = async ({category_id, candidate_id}) => {
    if (open) throw new Error('Диалог импорта уже открыт');
    open = true;
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const dialog = node('dialog');
    dialog.setAttribute('aria-labelledby', 'sourcing-import-title');
    dialog.style.cssText = 'width: min(1050px, 94vw); max-height: 90vh; overflow: auto;';
    const title = node('h2', 'Импорт прайса поставщика', dialog);
    title.id = 'sourcing-import-title';
    node('p', 'Предпросмотр не меняет рабочую БД. Загрузка выполняется существующим загрузчиком только после отдельного подтверждения.', dialog);
    const form = node('form', null, dialog);
    const fields = node('fieldset', null, form);
    node('legend', 'Файл и параметры', fields);
    function field(name, label, type) {
      const wrap = node('label', label + ' ', fields);
      wrap.style.cssText = 'display: block; margin: 12px 0;';
      const input = node('input', null, wrap);
      Object.assign(input, {name, type, required: true});
      return input;
    }
    const file = field('file', 'Excel (XLS/XLSX/XLSM), до 50 МБ', 'file');
    file.accept = '.xls,.xlsx,.xlsm';
    const supplier = field('supplier', 'Поставщик (можно выбрать каноническое имя или указать новое)', 'text');
    supplier.maxLength = 200;
    supplier.setAttribute('list', 'sourcing-import-suppliers');
    const names = node('datalist', null, fields);
    names.id = 'sourcing-import-suppliers';
    const date = field('date', 'Дата прайса', 'date');
    const today = new Date();
    date.value = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
    const previewButton = node('button', 'Предпросмотр', form);
    previewButton.type = 'submit';
    const previewArea = node('section', null, dialog);
    previewArea.dataset.importPreview = '';
    const mapping = node('fieldset', null, dialog);
    mapping.hidden = true;
    const selectionButton = node('button', 'Подтвердить выбор листов и колонок', dialog);
    selectionButton.type = 'button';
    selectionButton.hidden = true;
    const loadButton = node('button', 'Загрузить в рабочую БД', dialog);
    loadButton.type = 'button';
    loadButton.disabled = true;
    const checkButton = node('button', 'Проверить статус (без повторной загрузки)', dialog);
    checkButton.type = 'button';
    checkButton.hidden = true;
    const status = node('p', 'Получаю данные кандидата…', dialog);
    status.dataset.importStatus = '';
    status.setAttribute('role', 'status');
    status.style.whiteSpace = 'pre-wrap';
    const closeButton = node('button', 'Закрыть', dialog);
    closeButton.type = 'button';
    let ref = '', preview = null, revision = 0, busy = false, submitted = false, closed = false, timer;
    const storageKey = `sourcing-import:${category_id}:${candidate_id}`;
    const remembered = () => { try { return sessionStorage.getItem(storageKey); } catch (_) { return null; } };
    const remember = value => { try { value ? sessionStorage.setItem(storageKey, value) : sessionStorage.removeItem(storageKey); } catch (_) { /* Private browsing may disable storage. */ } };
    const tell = message => { if (!closed) status.textContent = message; };
    const buttons = () => {
      previewButton.disabled = busy || submitted;
      selectionButton.disabled = busy || submitted;
      loadButton.disabled = busy || submitted || preview?.can_apply !== true || !preview?.summary?.accepted;
    };
    function invalidate() {
      if (submitted) return;
      revision += 1; ref = ''; preview = null;
      previewArea.replaceChildren(); mapping.replaceChildren(); mapping.hidden = true;
      selectionButton.hidden = true; buttons();
      tell('Параметры изменены. Повторите предпросмотр.');
    }
    fields.addEventListener('input', invalidate);
    file.addEventListener('change', invalidate);
    function renderPreview(body) {
      preview = body; ref = body.import_ref;
      previewArea.replaceChildren(); mapping.replaceChildren();
      const labels = {accepted: 'Принято', rejected: 'Отклонено', skipped: 'Служебные/пропущенные', not_selected: 'Не выбрано', total_source_rows: 'Всего исходных строк'};
      node('h3', 'Нормализованный предпросмотр загрузчика', previewArea);
      node('p', Object.entries(labels).map(([key, label]) => `${label}: ${body.summary?.[key] ?? '—'}`).join(' · '), previewArea);
      node('p', 'Показаны первые 100 нормализованных строк. Принятые строки не означают, что весь файл принят или что публикация уже выполнена.', previewArea);
      if (body.warnings?.length) node('p', 'Замечания: ' + body.warnings.join('; '), previewArea);
      const scroller = node('div', null, previewArea);
      scroller.style.cssText = 'overflow: auto; max-height: 360px;';
      const table = node('table', null, scroller);
      const heading = node('tr', null, node('thead', null, table));
      const columns = body.columns || [];
      ['Лист', 'Строка', ...columns.map(c => c.label || c.key), 'Дополнительные поля'].forEach(label => node('th', label, heading));
      const tbody = node('tbody', null, table);
      (body.rows || []).slice(0, 100).forEach(row => {
        const tr = node('tr', null, tbody);
        [row.source_sheet, row.source_row, ...columns.map(c => row.values?.[c.key]), row.extra_fields || {}].forEach(value => node('td', value, tr));
      });
      node('legend', 'Варианты, предложенные загрузчиком (без произвольного сопоставления)', mapping);
      for (const sheet of body.selection_options || []) {
        const label = node('label', `${sheet.name}: `, mapping);
        label.style.cssText = 'display: block; margin: 12px 0;';
        const select = node('select', null, label);
        select.dataset.sheetIndex = sheet.index;
        const placeholder = node('option', 'Выберите вариант или явно исключите лист', select);
        placeholder.value = ''; placeholder.disabled = true; placeholder.selected = true;
        const exclude = node('option', 'Исключить лист', select); exclude.value = 'exclude';
        if (sheet.state === 'visible') for (const option of sheet.options) {
          const label = `Шапка ${option.header_start_row_1based}–${option.header_end_row_1based}: ` + Object.entries(option.mapping || {}).map(([key, column]) => `${key} → ${option.columns?.[column] || column}`).join(', ');
          const item = node('option', label, select); item.value = option.option_index;
        }
        select.onchange = () => { preview.can_apply = false; buttons(); tell('Подтвердите выбор и проверьте новый предпросмотр.'); };
      }
      mapping.hidden = !body.selection_options?.length;
      selectionButton.hidden = mapping.hidden;
      tell(body.can_apply ? 'Предпросмотр готов. Проверьте строки, замечания и итоговые счётчики перед загрузкой.' : 'Загрузчик не разрешил импорт. Выберите его варианты или уточните файл.');
      buttons();
    }
    async function poll() {
      clearTimeout(timer);
      if (closed || !ref) return;
      checkButton.disabled = true;
      try {
        const job = await api(`/import/jobs/${encodeURIComponent(ref)}`);
        if (closed) return;
        tell(`${job.stage}${job.job_id ? ` · ${job.job_id}` : ''}` + (job.verified ? `\n${job.partial ? 'Публикация с замечаниями: не весь исходный файл принят.' : 'Публикация подтверждена. Это не подтверждение поставки или сопоставления.'}\nПринято: ${job.summary?.accepted ?? '—'} · отклонено: ${job.summary?.rejected ?? '—'} · не выбрано: ${job.summary?.not_selected ?? '—'}` : ''));
        checkButton.hidden = job.verified;
        if (job.verified) remember(null);
        else if (!job.done) timer = setTimeout(poll, 1500);
        else tell(status.textContent + '\nНужна ручная проверка загрузчика. Не запускайте повторный импорт.');
      } catch (error) { tell(`Статус не подтверждён: ${error.message}. Можно повторить только проверку статуса.`); }
      finally { checkButton.disabled = false; }
    }
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || submitted) return;
      const selectedFile = file.files[0];
      if (!selectedFile || selectedFile.size === 0 || selectedFile.size > 50 * 1024 * 1024 || !/\.(xls|xlsx|xlsm)$/i.test(selectedFile.name)) {
        tell('Выберите непустой Excel XLS/XLSX/XLSM размером до 50 МБ.'); return;
      }
      const version = revision;
      const data = new FormData(form);
      data.set('category_id', category_id); data.set('candidate_id', candidate_id);
      busy = true; buttons(); tell('Получаю предпросмотр существующего загрузчика…');
      try {
        const body = await api('/import/preview', {method: 'POST', headers: actionHeader, body: data});
        if (!closed && version === revision && selectedFile === file.files[0]) renderPreview(body);
      } catch (error) { if (version === revision) tell(error.message); }
      finally { busy = false; buttons(); }
    };
    selectionButton.onclick = async () => {
      if (busy || submitted || !ref) return;
      const selects = [...mapping.querySelectorAll('select')];
      if (selects.some(s => s.value === '')) { tell('Явно выберите вариант или исключение для каждого листа.'); return; }
      const choices = selects.map(s => ({index: Number(s.dataset.sheetIndex), option_index: s.value === 'exclude' ? null : Number(s.value)}));
      const version = revision;
      busy = true; buttons();
      try { const body = await post('/import/selection', {import_ref: ref, choices}); if (!closed && version === revision) renderPreview(body); }
      catch (error) { tell(error.message); }
      finally { busy = false; buttons(); }
    };
    loadButton.onclick = async () => {
      if (busy || submitted || !ref || preview?.can_apply !== true) return;
      submitted = true; busy = true; fields.disabled = true; mapping.disabled = true; buttons();
      remember(ref); checkButton.hidden = false;
      tell('Отправляю подтверждённый импорт. Не закрывайте страницу до получения статуса.');
      const request_id = 'import-' + [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
      try { await post('/import/start', {import_ref: ref, confirmed: true, request_id}); await poll(); }
      catch (error) { tell(`Отправка не подтверждена: ${error.message}. Повторная загрузка заблокирована; проверьте статус и загрузчик вручную.`); }
      finally { busy = false; buttons(); }
    };
    checkButton.onclick = poll;
    closeButton.onclick = () => dialog.close();
    dialog.addEventListener('close', () => { closed = true; revision += 1; clearTimeout(timer); dialog.remove(); open = false; finish(); }, {once: true});
    document.body.append(dialog); dialog.showModal();
    try {
      const [state, canonical] = await Promise.all([api(''), api('/import/suppliers')]);
      if (closed) return finished;
      const candidate = state.categories?.find(c => c.id === category_id)?.candidates.find(c => c.id === candidate_id);
      if (!candidate || candidate.stage !== 3 || candidate.stale || candidate.rejected) throw new Error('Нужен текущий кандидат на этапе «Ответ получен»');
      supplier.value = candidate.name;
      for (const name of canonical.suppliers || []) { const option = node('option', null, names); option.value = name; }
      const saved = await api('/import/active?' + new URLSearchParams({category_id,candidate_id}));
      ref = saved.import_ref || remembered() || '';
      if (ref) {
        submitted = true; fields.disabled = true; mapping.disabled = true; checkButton.hidden = false; buttons(); await poll();
      } else tell('Выберите файл и дату; название поставщика можно уточнить по справочнику.');
    } catch (error) { fields.disabled = true; previewButton.disabled = true; tell(error.message); }
    return finished;
  };
})();
