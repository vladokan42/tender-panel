const formatTenderDate = (value) => {
  if (value == null || value === '') return value;
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}${iso[4].replace(/^T/, ' ')}`;
  const ru = text.match(/^(\d{2})\.(\d{2})\.(\d{4})(.*)$/);
  return ru ? `${ru[1]}.${ru[2]}.${ru[3]}${ru[4].replace(/^T/, ' ')}` : text;
};
if (typeof window !== 'undefined') window.formatTenderDate = formatTenderDate;

function tenderHeaderNumber(tender) {
  const value = tender?.tender_id;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : '';
  return typeof value === 'string' && /^\d+$/.test(value) ? value : '';
}

    'use strict';
    
    let currentTenders = [];
    let filteredTenders = [];
    let currentPage = 1;
    const PAGE_SIZE = 10;
    const REGISTRY_STATE_KEY = 'okan_tender_panel_registry_state_v2';
    // Production shell keeps loading visible and non-blocking with embedded skeleton.
    const registryLoadingMarkup = `<style>@keyframes okan-pulse{0%,100%{opacity:1}50%{opacity:.5}}.okan-ske{background:rgba(255,255,255,0.06);animation:okan-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite}</style><article class="t-card" style="pointer-events: none; border: 1px solid var(--border-line) !important; border-radius: 8px !important; background: var(--bg-card) !important; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; margin-bottom: 6px;"><div style="display: flex; gap: 4px; align-items: center;"><div class="okan-ske" style="height: 14px; width: 44px; border-radius: 3px;"></div><div class="okan-ske" style="height: 14px; width: 72px; border-radius: 3px;"></div></div><div class="okan-ske" style="height: 14px; width: 80%; border-radius: 4px; margin-top: 2px;"></div><div class="okan-ske" style="height: 14px; width: 50%; border-radius: 4px;"></div><div class="t-foot" style="margin-top: 2px; border-top: 1px solid var(--border-line); padding-top: 6px; display: flex; justify-content: space-between; align-items: center;"><div class="okan-ske" style="height: 18px; width: 90px; border-radius: 4px;"></div><div class="okan-ske" style="height: 14px; width: 70px; border-radius: 4px;"></div></div></article>`;
    const detailLoadingMarkup = `<div style="width: 100%; display: flex; flex-direction: column; font-family: sans-serif;"><style>@keyframes okan-pulse{0%,100%{opacity:1}50%{opacity:.5}}.okan-ske{background:rgba(255,255,255,0.06);animation:okan-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite}</style><div style="display: flex; align-items: center; gap: 1rem; border-bottom: 1px solid var(--border-line); padding: 1rem 1.5rem;"><div class="okan-ske" style="height: 12px; width: 48px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 12px; flex: 1; border-radius: 4px;"></div><div class="okan-ske" style="height: 12px; width: 80px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 12px; width: 64px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 12px; width: 96px; flex-shrink: 0; border-radius: 4px;"></div></div><div style="display: flex; align-items: center; gap: 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-soft);"><div class="okan-ske" style="height: 14px; width: 48px; flex-shrink: 0; border-radius: 4px;"></div><div style="display: flex; flex: 1; align-items: center; gap: 0.75rem;"><div class="okan-ske" style="width: 24px; height: 24px; border-radius: 4px;"></div><div class="okan-ske" style="height: 14px; width: 60%; max-width: 400px; border-radius: 4px;"></div></div><div class="okan-ske" style="height: 14px; width: 80px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 14px; width: 64px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 24px; width: 96px; flex-shrink: 0; border-radius: 12px;"></div></div><div style="display: flex; align-items: center; gap: 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-soft);"><div class="okan-ske" style="height: 14px; width: 48px; flex-shrink: 0; border-radius: 4px;"></div><div style="display: flex; flex: 1; align-items: center; gap: 0.75rem;"><div class="okan-ske" style="width: 24px; height: 24px; border-radius: 4px;"></div><div class="okan-ske" style="height: 14px; width: 55%; max-width: 400px; border-radius: 4px;"></div></div><div class="okan-ske" style="height: 14px; width: 80px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 14px; width: 64px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 24px; width: 96px; flex-shrink: 0; border-radius: 12px;"></div></div><div style="display: flex; align-items: center; gap: 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-soft);"><div class="okan-ske" style="height: 14px; width: 48px; flex-shrink: 0; border-radius: 4px;"></div><div style="display: flex; flex: 1; align-items: center; gap: 0.75rem;"><div class="okan-ske" style="width: 24px; height: 24px; border-radius: 4px;"></div><div class="okan-ske" style="height: 14px; width: 50%; max-width: 400px; border-radius: 4px;"></div></div><div class="okan-ske" style="height: 14px; width: 80px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 14px; width: 64px; flex-shrink: 0; border-radius: 4px;"></div><div class="okan-ske" style="height: 24px; width: 96px; flex-shrink: 0; border-radius: 12px;"></div></div></div>`;
    let restoringRegistryState = false;
    const getDynamicPrefix = () => {
      const p = location.pathname;
      if (p.startsWith('/tender-v2')) return '/tender-v2';
      if (p === '/' || p.startsWith('/settings') || p.startsWith('/logistics') || p.startsWith('/documents') || p.startsWith('/sourcing') || p.startsWith('/tenders') || p.startsWith('/auth')) return '';
      const m = p.match(/^\/([^\/]+)/);
      return m ? `/${m[1]}` : '';
    };
    const API_PREFIX = getDynamicPrefix();
    let activeTenderId = null;
    let activeTender = null;
    let activeDocuments = [];
    let activeSectionWarnings = {documents: '', core: ''};
    let selectTenderRequest = 0;
    let activeTab = 'main';
    let activeFilter = 'live';
    let registryExtraFilters = {smp:false, region:'', oneTime:false, periodic:false};
    let lastDeadlineSnapshot = '';
    const tenderCache = new Map();
    const registryFilterCache = new Map();
    const documentCache = new Map();
    const coreCache = new Map();
    const candidateCache = new Map();
    const candidateSummaryCache = new Map();
    const sectionWarningCache = new Map();
    const sectionPending = new Map();
    let expandedLineId = null;
    const CORE_TABS = new Set(['technical', 'source', 'control', 'execution']);
    const offersRefresh = new Map();
    const refreshRunning = (job) => ['queued', 'running'].includes(job?.status);

    let activeEarnings = null;
    let activeEarningsTenderId = null;
    let earningsGeneration = 0;
    let earningsInFlight = false;
    const earningsInFlightMap = new Map();

    function clearEarningsUi() {
      const profitEl = document.getElementById('det-profit');
      const profitMarginEl = document.getElementById('det-profit-margin');
      if (profitEl) {
        profitEl.textContent = '—';
        profitEl.style.color = '';
        profitEl.removeAttribute('title');
      }
      if (profitMarginEl) {
        profitMarginEl.textContent = '';
        profitMarginEl.style.color = '';
        profitMarginEl.removeAttribute('title');
      }
      const profitCard = document.getElementById('det-profit-card');
      if (profitCard) profitCard.removeAttribute('title');
    }

    function renderEarningsHeader(earnings) {
      const profitEl = document.getElementById('det-profit');
      const profitMarginEl = document.getElementById('det-profit-margin');
      const profitCard = document.getElementById('det-profit-card');
      if (!profitEl || !profitMarginEl) return;

      if (!earnings || typeof earnings !== 'object') {
        profitEl.textContent = 'Не рассчитано';
        profitEl.style.color = '';
        profitEl.removeAttribute('title');
        profitMarginEl.textContent = 'Данные расчёта недоступны';
        profitMarginEl.style.color = '';
        profitMarginEl.removeAttribute('title');
        if (profitCard) profitCard.removeAttribute('title');
        return;
      }

      const parts = [];
      if (earnings.goods_spread != null) {
        parts.push(`Заработок до доставки: ${money(earnings.goods_spread)} ₽`);
      } else if (earnings.known_goods_spread != null) {
        parts.push(`Частичный заработок по строкам: ${money(earnings.known_goods_spread)} ₽`);
      } else {
        parts.push('Заработок до доставки: не определён');
      }

      if (earnings.logistics_total != null) {
        parts.push(`Доставка: ${money(earnings.logistics_total)} ₽`);
      } else {
        parts.push('Доставка: не определена');
      }

      if (earnings.delivery_count != null) {
        const note = earnings.delivery_note ? ` (${earnings.delivery_note})` : '';
        parts.push(`Число доставок: ${earnings.delivery_count}${note}`);
      } else if (earnings.delivery_note) {
        parts.push(`Число доставок: ${earnings.delivery_note}`);
      }

      if (earnings.preliminary_note) {
        parts.push(`Примечание: ${earnings.preliminary_note}`);
      }

      if (Array.isArray(earnings.blockers) && earnings.blockers.length > 0) {
        parts.push(`Причины: ${earnings.blockers.join('; ')}`);
      }

      const tooltipText = parts.join('\n');
      profitEl.title = tooltipText;
      profitMarginEl.title = tooltipText;
      if (profitCard) profitCard.title = tooltipText;

      if (earnings.state === 'CALCULATED' && earnings.profit != null) {
        const profitVal = Number(earnings.profit);
        profitEl.textContent = `${money(earnings.profit)} ₽`;
        const color = profitVal >= 0 ? 'var(--accent-green, #10b981)' : 'var(--accent-red, #ef4444)';
        profitEl.style.color = color;
        profitMarginEl.textContent = earnings.margin_percent != null
          ? `Маржа: ${percentageFixed(earnings.margin_percent)}`
          : 'Маржа: —';
        profitMarginEl.style.color = color;
      } else {
        profitEl.textContent = 'Не рассчитано';
        profitEl.style.color = '';
        const reason = earnings.blockers?.[0] || 'Полнота расчёта не передана.';
        profitMarginEl.textContent = reason;
        profitMarginEl.style.color = '';
      }
    }

    function fetchActiveEarnings(tenderId, options = {}) {
      const key = String(tenderId);
      if (!key) {
        activeEarnings = null;
        activeEarningsTenderId = null;
        clearEarningsUi();
        return Promise.resolve(null);
      }

      if (!options.force && activeEarnings && activeEarningsTenderId === key) {
        renderEarningsHeader(activeEarnings);
        return Promise.resolve(activeEarnings);
      }

      if (earningsInFlightMap.has(key)) {
        return earningsInFlightMap.get(key);
      }

      const generation = ++earningsGeneration;
      earningsInFlight = true;

      const profitEl = document.getElementById('det-profit');
      const profitMarginEl = document.getElementById('det-profit-margin');
      const profitCard = document.getElementById('det-profit-card');
      if (profitEl) {
        profitEl.textContent = 'Расчёт…';
        profitEl.style.color = '';
        profitEl.removeAttribute('title');
      }
      if (profitMarginEl) {
        profitMarginEl.textContent = 'Загрузка…';
        profitMarginEl.style.color = '';
        profitMarginEl.removeAttribute('title');
      }
      if (profitCard) profitCard.removeAttribute('title');

      const promise = (async () => {
        try {
          const data = await fetchJson(`${API_PREFIX}/api/tenders/${encodeURIComponent(key)}/earnings`);
          if (generation !== earningsGeneration || String(activeTenderId) !== key) {
            return null;
          }
          activeEarnings = data;
          activeEarningsTenderId = key;
          renderEarningsHeader(data);
          if (activeTab === 'products') {
            renderDetailTab();
          }
          return data;
        } catch (err) {
          if (generation !== earningsGeneration || String(activeTenderId) !== key) {
            return null;
          }
          activeEarnings = null;
          activeEarningsTenderId = key;
          if (profitEl) {
            profitEl.textContent = 'Не рассчитано';
            profitEl.style.color = '';
            profitEl.removeAttribute('title');
          }
          if (profitMarginEl) {
            profitMarginEl.textContent = err instanceof Error ? err.message : 'Не рассчитано';
            profitMarginEl.style.color = '';
            profitMarginEl.removeAttribute('title');
          }
          if (profitCard) profitCard.removeAttribute('title');
          return null;
        } finally {
          earningsInFlightMap.delete(key);
          if (earningsInFlightMap.size === 0) {
            earningsInFlight = false;
          }
        }
      })();

      earningsInFlightMap.set(key, promise);
      return promise;
    }
    window.fetchActiveEarnings = fetchActiveEarnings;
    if (typeof window !== 'undefined') window.renderEarningsHeader = renderEarningsHeader;

    function updateOffersRefreshUi() {
      const button = document.getElementById('offers-refresh-action');
      const status = document.getElementById('offers-refresh-status');
      if (!button || !status) return;
      const state = offersRefresh.get(String(activeTenderId));
      const job = state?.job;
      const visible = activeTab === 'products' && Boolean(activeTender);
      button.hidden = !visible;
      button.disabled = Boolean(state?.pending || refreshRunning(job));
      const spinnerSvg = `<svg class="boardui-btn-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
      const text = refreshRunning(job) ? `Обновление ${job.completed_lines || 0}/${job.total_lines || 0}` : state?.pending ? 'Проверка…' : 'Обновить товары';
      button.innerHTML = (state?.pending || refreshRunning(job)) ? `${spinnerSvg}<span>${text}</span>` : text;
      const messages = {
        queued: 'Обновление в очереди. Текущие товары остаются видимыми.',
        running: 'Обновление товаров. Текущие результаты остаются видимыми.',
        completed: `Товары обновлены. Найдено вариантов: ${job?.result_count || 0}.`,
        partial: `Обновление выполнено частично. Обработано ${job?.completed_lines || 0}/${job?.total_lines || 0} строк. Ошибок: ${job?.failed_lines || 0}. Прежние предложения для этих строк сохранены.${job?.line_errors?.some(item => item.error_code === 'QUERY_TOO_LONG') ? ' Есть название длиннее лимита штатного поиска (200 символов); оно не обрезано.' : ''}`,
        failed: 'Не удалось обновить товары. Предыдущие результаты сохранены. Можно повторить.',
        stale: 'Обновление прервано. Предыдущие результаты сохранены. Запусти снова.',
      };
      const reason = {INDEX_NOT_READY:'Поисковый индекс не готов. Data Agent должен обновить его после ручных изменений.', SEARCH_NOT_CONNECTED:'Штатный поиск не подключён к этой версии панели.', SOURCE_CHANGED:'Исходные данные изменились. Повтори поиск.'}[job?.error_code];
      status.textContent = state?.message || (reason && ['failed','partial','stale'].includes(job?.status) ? `${messages[job.status]} ${reason}` : messages[job?.status]) || '';
      status.hidden = !visible || !status.textContent;
    }

    async function acceptOffersRefreshJob(key, state, job) {
      state.job = job;
      state.message = '';
      state.requestId = null;
      updateOffersRefreshUi();
      if (!['completed', 'partial'].includes(job?.status) || state.appliedJob === job.job_id) return;
      state.appliedJob = job.job_id;
      await invalidateTenderOffers(key);
    }

    async function invalidateTenderOffers(key) {
      key = String(key);
      // Drain old section requests (and their callbacks) before deleting their caches.
      await Promise.all(['candidates', 'core'].map(section => sectionPending.get(`${section}:${key}`)));
      for (const cache of [tenderCache, candidateCache, candidateSummaryCache, coreCache, registryFilterCache]) cache.delete(key);
      const warnings = sectionWarningCache.get(key);
      if (warnings) sectionWarningCache.set(key, {...warnings, candidates: '', core: ''});
      if (activeTenderId === key) {
        fetchActiveEarnings(key, { force: true });
        if (document.querySelector('.detail-column')?.checkVisibility()) await selectTenderPrimary(key, false);
      }
    }
    window.invalidateTenderOffers = invalidateTenderOffers;

    async function requestOffersRefresh(key, post = false) {
      let state = offersRefresh.get(key);
      if (!state) { state = {job: null}; offersRefresh.set(key, state); }
      if (state.pending || (post && refreshRunning(state.job))) return;
      clearTimeout(state.timer);
      state.pending = true;
      state.message = '';
      updateOffersRefreshUi();
      const url = `${API_PREFIX}/api/tenders/${encodeURIComponent(key)}/offers-refresh`;
      const request = async (options = {}) => {
        const controller = new AbortController();
        state.controller = controller;
        const timeout = setTimeout(() => controller.abort(), 10000);
        try { return await fetchJson(url, {...options, signal: controller.signal}); }
        finally { clearTimeout(timeout); state.controller = null; }
      };
      try {
        let payload;
        if (post) {
          state.requestId ||= crypto.randomUUID();
          try {
            payload = await request({method: 'POST', headers: {'Content-Type': 'application/json', 'X-Tender-Refresh-Action': 'offers-refresh-v1', 'X-Request-ID': state.requestId}, body: '{}'});
          } catch (_) {
            // A lost POST response is not proof that the server did not queue it.
            payload = await request();
          }
        } else payload = await request();
        await acceptOffersRefreshJob(key, state, payload?.job || null);
        if (post && !payload?.job) state.message = 'Обновление не запущено. Можно повторить.';
      } catch (_) {
        state.message = 'Не удалось проверить обновление. Проверь соединение и повтори.';
      } finally {
        state.pending = false;
        updateOffersRefreshUi();
        if (refreshRunning(state.job) || state.requestId) state.timer = setTimeout(() => requestOffersRefresh(key), 1000);
      }
    }

    async function loadOptionalSection(tenderId, section) {
      const key = String(tenderId);
      const cache = section === 'documents' ? documentCache : section === 'candidates' ? candidateCache : coreCache;
      if (cache.has(key)) return cache.get(key);
      const pendingKey = `${section}:${key}`;
      if (!sectionPending.has(pendingKey)) {
        const query = section === 'candidates' ? '?view=screen' : '';
        const promise = fetchJson(`${API_PREFIX}/api/tenders/${encodeURIComponent(key)}/${section}${query}`)
          .then(payload => {
            const value = section === 'documents' ? (payload?.documents || []) : section === 'candidates' ? (payload?.supplier_offers || []) : payload;
            if (section === 'documents' && Array.isArray(payload?.warnings) && payload.warnings.length > 0) {
              const previous = sectionWarningCache.get(key) || {documents: '', candidates: '', core: ''};
              const docWarn = payload.warnings.map(w => w.message || w.code).join('; ');
              sectionWarningCache.set(key, {...previous, documents: docWarn});
              if (activeTenderId === key) activeSectionWarnings = sectionWarningCache.get(key);
            }
            if (section === 'candidates') candidateSummaryCache.set(key, {
              all_result_count: payload?.all_result_count,
              display_result_count: payload?.display_result_count,
              shown_result_count: payload?.shown_result_count,
              omitted_result_count: payload?.omitted_result_count,
              source_statuses: payload?.source_statuses,
              candidate_selection: payload?.candidate_selection,
            });
            cache.set(key, value);
            return value;
          })
          .catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            const previous = sectionWarningCache.get(key) || {documents: '', candidates: '', core: ''};
            const warning = `${section}: ${message}`;
            cache.set(key, null);
            sectionWarningCache.set(key, {...previous, [section]: warning});
            if (activeTenderId === key) activeSectionWarnings = sectionWarningCache.get(key);
            console.warn(`API: ошибка загрузки ${section} тендера:`, key, message);
            return null;
          })
          .finally(() => sectionPending.delete(pendingKey));
        sectionPending.set(pendingKey, promise);
      }
      return sectionPending.get(pendingKey);
    }
    const FIELD_GROUPS = {
      main: ["КПП заказчика","Организатор закупки","ИНН организатора закупки","КПП организатора закупки","Категория","Город","Email заказчика","Контактное лицо заказчика","Телефон заказчика","ИНН заказчика","Наименование заказчика","Дата окончания подачи заявок","Срок окончания подачи","Дата публикации","Реестровый номер ЕИС","Наименование ЭТП","Место поставки / выполнения","Способ размещения (процедура)","Категория размещения","Contract","Размер обеспечения заявки, ₽","Начальная цена (НМЦК)","Регион поставки","Закупка только для СМП / СОНО","Ссылка на источник"],
      dates: ["Срок подачи заявок","Дата публикации источника","Часовой пояс","Источник срока","Внутренний срок подачи","Резерв времени","Срок запроса разъяснений","Дата подведения итогов","Срок заключения контракта","Период исполнения контракта","Срок поставки партии","Плановая дата заказа поставщику","Плановая первая поставка","Плановая приёмка","Плановая дата оплаты","Дата начала поставки","Дата окончания поставки","График поставок","Этапы поставки","Срок действия контракта"],
      documents: ["Комплект документации","Документы закупки","Актуальная редакция","Количество редакций","ТЗ получено","Проект контракта получен","Обоснование НМЦК получено","Изменения и разъяснения проверены","Обязательные документы","Реестр требований","Реестр обязательств контракта"],
      eligibility: ["Требования к участнику","РНП","ПП РФ №2571 и опыт","ПП РФ № 2571 (поз. 33): Наличие опыта исполнения договора на оказание услуг общественного питания и (или) поставки пищевых продуктов","Лицензии и специальные требования","Полномочия подписанта","МЧД и УКЭП","Обеспечение и антидемпинг","Итог допуска","Применимость национального режима","Ограничения допуска в соответствии с пунктом 1 части 2 статьи 14 Закона № 44-ФЗ","Мера национального режима","Основание применения","Редакция акта и дата проверки","Код ОКПД2/КТРУ для вывода","Требуемые документы о происхождении","Результат по товарным строкам","Причина блокировки"],
      inspection: ["Полностью соответствуют","Частично соответствуют","Не соответствуют","Товар не найден","Характеристики не извлечены","Количество или единица не подтверждены","Происхождение не подтверждено","Срок годности не подтверждён","Упаковка и маркировка не подтверждены","Итог товарной проверки"],
      suppliers: ["Основной поставщик","Срок доставки поставщика","Условия оплаты поставщику","Срок отсрочки"],
      economics: ["Стоимость закупки","Прямые расходы","Общие расходы","НДС","Логистика и накладные","Резерв риска","Полная себестоимость","Предельная цена участия","Плановая цена заявки","Прибыль","Маржа","Демпинг","Кассовый разрыв","Потребность в финансировании","Аванс","Аванс, %","Сумма аванса","Срок и порядок оплаты","Срок оплаты","Вид дней срока оплаты","Этапы оплаты","Основание оплаты","Отсрочка оплаты","Срок поставки партии","Условия обеспечения заявки","Условия обеспечения исполнения контракта","Обеспечение гарантийных обязательств","Обеспечение заявки, %","База расчёта обеспечения заявки","Обеспечение исполнения, %","База расчёта обеспечения исполнения","Сумма повышенного антидемпингового обеспечения"],
      contract: ["Итог проверки контракта","Ключевой договорный риск","Комплект заявки","Независимая проверка","Готовность к подаче","Результат процедуры","Контракт заключён","Номер контракта","Цена контракта","Подтверждение гарантии или обеспечения","Срок действия контракта","Условия проекта контракта","Условия приёмки и замены","Обеспечение гарантийных обязательств","Специальные требования по документу","Условия обеспечения исполнения контракта","Штрафы заказчика","Штрафы поставщика","Пени","Основания одностороннего отказа заказчика","Основания одностороннего отказа поставщика","Порядок изменения контракта","Особые условия исполнения","Ограничения замены товара","Порядок и срок приёмки","Документы для приёмки","Срок устранения недостатков"],
      execution: ["Количество партий","Адреса приёмки","Окна доставки","Требования к транспорту","Транспорт назначен","Отгрузочные документы","Поставка выполнена","Приёмка","УПД или документ приёмки","Замечания и претензии","Срок устранения","Плановая оплата","Фактическая оплата","Получатель","Контакт приёмки","Телефон приёмки","Точный адрес","Режим работы","Пропускной режим","Ограничение по высоте","Ограничение по длине машины","Ограничение по полной массе","Доступный тип машины","Место разгрузки","Способ разгрузки","Условия разгрузки","Требуется ли гидроборт","Требуется ли пропуск на машину","Парковка и ожидание","Порядок приёмки","Условия приёмки и замены","Срок приёмки","Документы приёмки","Масса","Количество грузовых мест","Размеры грузовых мест","Паллеты","Температурный режим","Назначенная машина"],
      logistics: ["Адреса приёмки","Точный адрес конкретной точки приёмки","Получатель","Окна доставки","Разрешённые дни и часы доставки","Правила доступа на территорию приёмки","Пропускной режим","Требования к транспорту","Требуемая грузоподъёмность машины","Размеры кузова и дверей","Место разгрузки","Способ разгрузки","Условия разгрузки","Требуется ли гидроборт","Требуется ли пропуск на машину","Парковка и ожидание","Температурный режим","Ограничения погрузки и крепления","Количество грузовых мест","Размеры грузовых мест","Паллеты","Контактное лицо на приёмке","Телефон приёмки","Режим работы","Ограничение по высоте","Ограничение по длине машины","Ограничение по полной массе","Доступный тип машины","Назначенная машина","Срок поставки партии","График поставок товаров"],
      control: ["Внутренний контролёр","Контроль сроков","Риск отклонения","Контроль гарантийного обеспечения","Статус ЭДО","Финальное подтверждение"],
      technical: ["Номер закупки","Номер лота","Номер извещения","Официальный номер извещения ЕИС","Номер процедуры на ЭТП","Официальная ссылка ЕИС","Официальная ссылка ЭТП","Тип официального источника","Наименование ЭТП или портала","Ссылка на агрегатор","Дата публикации","Дата обновления источника"]
    };

    const TAB_TO_GROUP = {
      main: 'main', products: 'products', dates: 'dates', documents: 'documents',
      eligibility: 'eligibility', inspection: 'inspection', suppliers: 'suppliers',
      economics: 'economics', logistics: 'logistics', contract: 'contract',
      execution: 'execution', control: 'control', technical: 'technical'
    };
    const GROUP_TITLES = {
      main: 'Основные сведения', source: 'Источники и идентификаторы', deadlines: 'Сроки',
      documents: 'Состояние документов', eligibility: 'Допуск и национальный режим',
      products: 'Товарная проверка', suppliers: 'Поставщики', economics: 'Экономика',
      application: 'Заявка и контракт', execution: 'Исполнение', logistics: 'Логистика и приёмка', control: 'Контроль'
    };

    const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const readRegistryState = () => {
      try {
        const value = JSON.parse(localStorage.getItem(REGISTRY_STATE_KEY) || '{}');
        return value && typeof value === 'object' ? value : {};
      } catch (_) { return {}; }
    };
    const saveRegistryState = () => {
      if (restoringRegistryState) return;
      try {
        localStorage.setItem(REGISTRY_STATE_KEY, JSON.stringify({
          page: currentPage,
          filter: activeFilter,
          query: document.getElementById('search-input')?.value || '',
          extraFilters: registryExtraFilters,
        }));
      } catch (_) { /* localStorage can be unavailable in private browser modes */ }
    };
    
    const rawValue = (fieldData, seen = new Set()) => {
      const valueData = businessValue(fieldData);
      if (valueData !== fieldData) return rawValue(valueData, seen);
      if (fieldData == null) return fieldData;
      if (typeof fieldData !== 'object') {
        let str = cleanJSONValue(fieldData);
        if (/^[0-9]+(?:\.[0-9]+)?$/.test(str.replace(/\s/g, ''))) str = formatNumberSpaced(str);
        return str;
      }
      return businessPresentationText(fieldData, seen);
    };
    const FIELD_ENVELOPE_KEYS = new Set(['field_key', 'name', 'status', 'source', 'collection_state', 'verification_status', 'execution_status', 'field_definition', 'semantic_key', 'semantic_code']);
    const isFieldEnvelope = (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      if (!Object.keys(value).some((key) => FIELD_ENVELOPE_KEYS.has(key))) return false;
      return Object.prototype.hasOwnProperty.call(value, 'value') || Object.prototype.hasOwnProperty.call(value, 'text');
    };
    const businessValue = (fieldData) => {
      if (!isFieldEnvelope(fieldData)) return fieldData;
      if (Object.prototype.hasOwnProperty.call(fieldData, 'value') && fieldData.value !== undefined && fieldData.value !== null) return fieldData.value;
      if (Object.prototype.hasOwnProperty.call(fieldData, 'text')) return fieldData.text;
      return fieldData.value;
    };
    // This block intentionally follows rawValue: isolated DOM contracts extract
    // helpers beginning at rawValue, while normal browser execution initializes
    // all constants before any field is rendered.
    const isInnKpp = (s) => /^[0-9]{10,12}$/.test(s) || /^[0-9]{9}$/.test(s);
    const cleanJSONValue = (val) => {
      let parsed = val;
      if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
        try { parsed = JSON.parse(val); } catch (_) {}
      }
      if (Array.isArray(parsed)) return parsed.map((value, index) => `${index + 1}: ${cleanJSONValue(value)}`).filter(Boolean).join('; ');
      if (typeof parsed === 'object' && parsed !== null) return Object.entries(parsed).map(([key, value]) => `${key}: ${cleanJSONValue(value)}`).filter(Boolean).join('; ');
      return String(parsed);
    };
    const STRUCTURED_LABELS = {scope:'Область', subject:'Субъект', role:'Роль', recipient:'Получатель', condition:'Условие', exception:'Исключение', exceptions:'Исключения', alternatives:'Альтернативы', duration:'Срок', day_type:'Тип дней', calendar:'Календарь', working:'Рабочие дни', trigger:'Событие отсчёта', amount:'Сумма', currency:'Валюта', base:'База', evidence:'Подтверждение', source:'Источник', quote:'Цитата', location:'Место в источнике', edition:'Редакция', text:'Текст', title:'Название', value:'Значение', status:'Статус', term:'Срок действия', term_end:'Дата окончания', start:'Дата начала', end:'Дата окончания', date:'Дата', start_date:'Дата начала', end_date:'Дата окончания', created_at:'Создано', updated_at:'Обновлено', checked_at:'Проверено', expires:'Действует до', okpd2:'ОКПД2', ktru:'КТРУ', code:'Код', code_type:'Тип кода', koz:'КОЗ', koz2:'КОЗ2', line_number:'Строка', document_line:'Строка документа', purpose:'Назначение', execution:'Исполнение', modality:'Характер', duty:'Обязанность', permission:'Разрешение', prohibition:'Запрет', required:'Обязательность', availability:'Наличие', execution_status:'Статус выполнения', brand:'Бренд', product_type:'Тип товара', product_name:'Товар', product:'Товар', line_name:'Товар', region:'Регион', area:'Область', unit_mass_g:'Масса единицы, г', unit_volume_ml:'Объём единицы, мл', consumer_packaging:'Потребительская упаковка', consumer_units:'Потребительская фасовка, шт', units_per_box:'Штук в коробке', extraction_status:'Статус извлечения', flavor_composition:'Вкусовой состав', forms:'Формы', main_product:'Основной товар', primary_product:'Основной товар', price_basis:'База цены', purpose_products:'Назначение товара', transformations:'Технологические изменения', mass_g:'Масса', transport_packaging:'Транспортная упаковка'};
    const structuredKey = (key) => STRUCTURED_LABELS[key] || key;
    const calendarKeys = new Set(['date', 'term', 'term_end', 'start', 'end', 'start_date', 'end_date', 'created_at', 'updated_at', 'checked_at', 'expires']);
    const presentationScalar = (value) => value === true ? 'Да' : value === false ? 'Нет' : String(value);
    const presentationCalendar = (value) => {
      if (typeof formatTenderDate === 'function') return formatTenderDate(value);
      if (typeof window !== 'undefined' && window.formatTenderDate) return window.formatTenderDate(value);
      return String(value ?? '');
    };
    const structuredValueText = (value, seen = new Set(), key = '') => {
      if (value == null) return '';
      if (typeof value !== 'object') {
        if (value === false) return 'Нет';
        if (key === 'purpose') return ({admission:'Допуск', application:'Заявка', execution:'Исполнение'}[String(value)] || presentationScalar(value));
        if (key === 'modality') return ({duty:'Обязанность', prohibition:'Запрет', permission:'Разрешение'}[String(value)] || presentationScalar(value));
        if (key === 'execution_status') return humanStatus(value);
        return calendarKeys.has(String(key)) ? presentationCalendar(value) : presentationScalar(value);
      }
      if (seen.has(value)) return '[циклическая ссылка]';
      seen.add(value);
      if (Array.isArray(value)) return value.map((item, index) => `${index + 1}: ${structuredValueText(item, seen, key)}`).filter(Boolean).join('; ');
      return Object.entries(value).map(([key, item]) => {
        const text = structuredValueText(item, seen, key);
        return text ? (key === 'text' ? text : `${structuredKey(key)}: ${text}`) : '';
      }).filter(Boolean).join('; ');
    };
    const BUSINESS_PRESENTATION_KEYS = new Set([
      'evidence', 'provenance', 'source', 'quote', 'location', 'field_id', 'field_key', 'key', 'status', 'extraction_status', 'index', 'url',
      'collection_state', 'verification_status', 'source_observations', 'our_evidence',
      'own_evidence', 'api_value', 'document_value', 'conflicts', 'field_definition', 'semantic_key',
      'semantic_code', 'canonical_json', 'llm_raw_response', 'previous_projection', 'raw', 'parser',
      'algorithm', 'run', 'price_registry_id', 'line_id', 'document_line_id', 'registry_id'
    ]);
    const businessPresentationText = (value, seen = new Set()) => {
      if (value === null) return 'Не указано';
      if (value === undefined) return 'Не указано';
      if (typeof value !== 'object') return value === false ? 'Нет' : presentationScalar(value);
      if (seen.has(value)) return '[циклическая ссылка]';
      seen.add(value);
      if (Array.isArray(value)) return value.map((item) => businessPresentationText(item, seen)).join('; ');
      const entries = Object.entries(value).filter(([key]) => !BUSINESS_PRESENTATION_KEYS.has(String(key).toLowerCase()));
      if (entries.length === 1 && entries[0][0] === 'title') return businessPresentationText(entries[0][1]);
      const result = entries.map(([key, item]) => [key, key === 'execution_status' ? humanStatus(item) : key === 'purpose' ? ({admission:'Допуск', application:'Заявка', execution:'Исполнение'}[String(item)] || businessPresentationText(item)) : key === 'modality' ? ({duty:'Обязанность', prohibition:'Запрет', permission:'Разрешение'}[String(item)] || businessPresentationText(item)) : calendarKeys.has(String(key)) && item != null && typeof item !== 'object' ? presentationCalendar(item) : businessPresentationText(item)]).filter(([, text]) => text !== '').map(([key, text]) => key === 'text' ? text : `${structuredKey(key)}: ${text}`).join('; ');
      return result || 'Не указано';
    };
    const businessPresentationHtml = (value, label = '') => escapeHtml(fieldPresentationText(value, label));
    const humanStatus = (value) => {
      const raw = String(value ?? '').trim();
      const labels = {
        OPEN: 'Открыто', BLOCKED: 'Есть предупреждения', CONFLICT: 'Противоречие', REVIEW: 'Требует проверки',
        PARTIAL: 'Частично подтверждено', UNKNOWN: 'Неизвестно', NOT_CHECKED: 'Не проверено', MISSING: 'Не найдено',
        OBSERVED: 'Зафиксировано в источнике', VERIFIED: 'Подтверждено', CONFIRMED: 'Подтверждено',
        PRELIMINARY: 'Предварительный', STALE: 'Требует повторной проверки', NOT_AVAILABLE: 'Нет данных',
        PENDING: 'Ожидает проверки', CALCULATED: 'Рассчитано', MANUAL: 'Внесено вручную',
        NOT_APPLICABLE: 'Не применяется', PASS: 'Извлечено', FAIL: 'Ошибка извлечения'
      };
      if (!raw) return 'Требует проверки';
      return labels[raw.toUpperCase()] || (/[^A-Za-z0-9_:-]/.test(raw) ? raw : 'Требует проверки');
    };
    const humanSource = (value) => {
      const raw = typeof value === 'string' ? value.trim() : businessPresentationText(value);
      if (!raw || raw === 'Не указано' || /^(?:saved:|field[_-]|(?:canonical|llm|previous|raw)[.:_]|(?:parser|algorithm|run|registry)[.:_])/i.test(raw)) return '';
      return raw;
    };
    const humanPriceUnit = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw || /^(?:UNKNOWN|UNDEFINED|NULL|NONE)$/i.test(raw)) return 'Не определено';
      return offerUnit({price_unit: raw});
    };
    const comparisonValueText = (value) => {
      if (value && typeof value === 'object') return structuredValueText(value);
      let text = String(value ?? '');
      for (const [key, label] of Object.entries(STRUCTURED_LABELS)) {
        if (text === key) return label;
        if (text.startsWith(`${key} `)) {
          const colon = text.indexOf(':', key.length);
          if (colon >= 0) return `${label}${text.slice(colon)}`;
        }
      }
      for (const [key, label] of Object.entries(STRUCTURED_LABELS)) text = text.split(key).join(label);
      return text;
    };
    const fieldEvidenceText = (fieldData, key) => {
      const value = fieldData?.[key] ?? fieldData?.evidence?.[key];
      return value == null ? '' : structuredValueText(value);
    };
    const fieldEvidenceSummary = (fieldData) => {
      const evidence = fieldData?.evidence;
      return evidence && typeof evidence === 'object' ? structuredValueText(evidence) : '';
    };
    const structuredValueHtml = (value, seen = new Set()) => {
      if (value == null || value === '') return '—';
      if (typeof value !== 'object') return escapeHtml(value);
      if (seen.has(value)) return '<span>[циклическая ссылка]</span>';
      seen.add(value);
      if (Array.isArray(value)) return `<div class="structured-value-list">${value.map((item, index) => `<div><span class="structured-value-key">${index + 1}.</span> ${structuredValueHtml(item, seen)}</div>`).join('')}</div>`;
      return `<div class="structured-value-object">${Object.entries(value).map(([key, item]) => `<div><span class="structured-value-key">${escapeHtml(structuredKey(key))}:</span> ${structuredValueHtml(item, seen)}</div>`).join('')}</div>`;
    };
    const formatNumberSpaced = (val) => {
      if (isInnKpp(val)) return val;
      const num = Number(String(val).replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(num) && String(val).trim() !== '') {
        return new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2}).format(num);
      }
      return cleanJSONValue(val);
    };
    const formatCharacteristics = (obj) => {
      if (Array.isArray(obj)) return obj.join('; ');
      if (obj && typeof obj === 'object') {
        if (Array.isArray(obj.requirements)) return obj.requirements.join('; ');
        return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('; ');
      }
      return String(obj);
    };
    const textValue = (fieldData) => {
      let value = rawValue(fieldData);
      if (value && typeof value === 'object') value = formatCharacteristics(value);
      return value == null ? '' : String(value);
    };
    const fieldValueList = (fieldData, seen = new Set()) => {
      if (fieldData == null) return [];
      if (typeof fieldData !== 'object') {
        const value = String(fieldData).trim();
        return value ? [value] : [];
      }
      if (seen.has(fieldData)) return [];
      seen.add(fieldData);
      if (Array.isArray(fieldData)) return fieldData.flatMap((item) => fieldValueList(item, seen));
      for (const key of ['value', 'text']) {
        if (Object.prototype.hasOwnProperty.call(fieldData, key)) {
          const values = fieldValueList(fieldData[key], seen);
          if (values.length) return values;
        }
      }
      return typeof fieldData.url === 'string' && fieldData.url.trim() ? [fieldData.url.trim()] : [];
    };
    const codeValueList = (fieldData) => {
      const value = businessValue(fieldData);
      if (value == null || value === '') return [];
      const values = Array.isArray(value) ? value : [value];
      return values.map((item) => businessPresentationText(item));
    };
    const codeValueDetails = (fieldData) => {
      const value = businessValue(fieldData);
      if (value == null || value === '') return [];
      const values = Array.isArray(value) ? value : [value];
      return values.map((item) => {
        const ids = item && typeof item === 'object'
          ? [item.line_id, item.tender_line_id, item.line, item.line_number].filter(Boolean).map(String)
          : [];
        const relatedLine = (activeTender?.card?.tender_lines || []).find((line) => ids.includes(String(line?.line_id || line?.id || line?.line_number)));
        const relation = item && typeof item === 'object'
          ? [...new Set([item.product_name, item.product, item.line_name, relatedLine?.name, item.scope, item.area, item.region].filter(Boolean).map(String))].join(' · ')
          : '';
        return {text: businessPresentationText(item), relation};
      });
    };
    const multipleAddressField = (label) => label === 'Город' || label === 'Место поставки / выполнения';
    window.openFieldValuesDialog = (payload) => {
      const label = String(payload?.label || 'Значения');
      const values = Array.isArray(payload?.values) ? payload.values.map((item) => typeof item === 'object' ? {text: String(item?.text ?? 'Не указано'), relation: String(item?.relation ?? '')} : {text: String(item ?? 'Не указано'), relation: ''}) : [];
      if (values.length < 2) return;
      document.getElementById('multiple-values-dialog')?.remove();
      document.body.insertAdjacentHTML('beforeend', `<dialog class="field-values-dialog" id="multiple-values-dialog" aria-labelledby="multiple-values-title"><div class="field-values-dialog-head"><h2 id="multiple-values-title">${escapeHtml(label)}</h2><button type="button" class="btn-action btn-outline" data-multiple-values-close>Закрыть</button></div><div class="field-values-list"><div class="field-values-list-caption">Исходные значения</div><ol>${values.map((value) => `<li>${escapeHtml(value.text)}${value.relation ? `<small class="field-audit-meta">${escapeHtml(value.relation)}</small>` : ''}</li>`).join('')}</ol></div></dialog>`);
      const node = document.getElementById('multiple-values-dialog');
      const previousFocus = document.activeElement;
      const restoreFocus = () => {
        if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus({preventScroll:true});
      };
      node.addEventListener('close', restoreFocus, {once:true});
      const close = () => {
        if (node?.open && typeof node.close === 'function') node.close();
        else node?.removeAttribute('open');
        if (!node?.open) setTimeout(restoreFocus, 0);
      };
      node.querySelector('[data-multiple-values-close]').addEventListener('click', close);
      node.addEventListener('click', (event) => { if (event.target === node) close(); });
      node.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
      if (typeof node.showModal === 'function') node.showModal(); else node.setAttribute('open', '');
      node.querySelector('[data-multiple-values-close]')?.focus();
    };
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-multiple-field]');
      if (!button) return;
      try { window.openFieldValuesDialog(JSON.parse(button.dataset.multipleField)); } catch (_) { /* invalid field data stays non-interactive */ }
    });
    const scalarFieldValue = (fieldData) => {
      if (fieldData == null || typeof fieldData !== 'object') return fieldData;
      for (const key of ['value', 'text']) {
        const value = fieldData[key];
        if (value != null && typeof value !== 'object') return value;
      }
      return null;
    };
    const safeUrl = (value) => {
      try {
        const text = String(value || '').trim();
        if (!text) return '';
        const url = new URL(text);
        return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
      } catch (_) { return ''; }
    };
    const fieldLink = (fieldData) => {
      const seen = new Set(); let href = ''; let text = '';
      const linkedText = (value) => {
        const nested = value?.value;
        for (const candidate of [nested?.title, nested?.name, nested?.text, nested?.value, value?.title, value?.name, value?.text, value?.value]) {
          if (typeof candidate === 'string' || typeof candidate === 'number') return String(candidate);
        }
        return '';
      };
      const visit = (value) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) { value.forEach(visit); return; }
        const directHref = safeUrl(value.url || (typeof value.value === 'string' && value.value.startsWith('http') ? value.value : ''));
        if (!href && directHref) {
          href = directHref;
          // A legacy wrapper may carry a status text while its nested link carries
          // the procurement label.  Prefer the text paired with the actual URL.
          text = linkedText(value);
        }
        for (const key of ['value', 'text']) {
          const child = value[key];
          if (child && typeof child === 'object') visit(child);
          else if (!text && (typeof child === 'string' || typeof child === 'number')) text = String(child);
        }
      };
      visit(fieldData);
      return href ? {href, text: text || href} : null;
    };
    const sourceLinkItems = (fields) => {
      const aggregatorHref = fieldLink(fields['Ссылка на агрегатор'] || fields['Ссылка на закупку у агрегатора'])?.href
        || safeUrl(activeTender?.registry?.aggregator_url || '');
      const result = [];
      const add = (href, text, kind = 'official') => {
        const safeHref = safeUrl(href);
        if (!safeHref || (safeHref === aggregatorHref && kind === 'official') || result.some((item) => item.href === safeHref && item.kind === kind)) return;
        result.push({href: safeHref, kind, text: String(text || safeHref)});
      };
      for (const label of ['Ссылка на закупку в официальном источнике', 'Официальная ссылка ЕИС или другого портала', 'Официальная ссылка ЕИС', 'Ссылка на ЕИС или ЭТП']) {
        const link = fieldLink(fields[label]);
        if (link) add(link.href, link.text, 'official');
      }
      const platformFields = [fields['Наименование ЭТП'], activeTender?.registry].filter(Boolean);
      for (const fieldData of platformFields) {
        const numbers = Array.isArray(fieldData?.platform_numbers) ? fieldData.platform_numbers : [];
        numbers.forEach((number) => add(number?.url, `${number?.title || 'ЭТП'}${number?.number ? `: ${number.number}` : ''} · сведения API`, 'platform_api'));
      }
      return result;
    };
    const documentHref = (value) => {
      const text = String(value || '').trim();
      if (!text) return '';
      if (/^https?:\/\//i.test(text)) return safeUrl(text);
      if (text.startsWith('/')) return text.replace(/^\/tender\/panel/, API_PREFIX || '');
      return '';
    };
    const contractManifestList = (fieldData) => {
      let value = businessValue(fieldData);
      if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
        try { value = JSON.parse(value); } catch (_) { return []; }
      }
      return Array.isArray(value) ? value : [];
    };
    const contractDocumentTitle = (document, index) => String(
      document?.title || document?.stored_file_name || document?.name || document?.source_file_name || `Файл ${index + 1}`
    ).trim();
    const contractDocumentHref = (document, index) => {
      const title = contractDocumentTitle(document, index).replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
      const protectedDocument = activeDocuments.find((item) => {
        const candidate = String(item?.title || '').replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
        return candidate === title || (candidate && title && (candidate.includes(title) || title.includes(candidate)));
      });
      return documentHref(protectedDocument?.open_url) || documentHref(document?.open_url) || safeUrl(document?.url || document?.download_url || document?.preview_url);
    };
    const contractFieldHtml = (fieldData) => {
      const documents = contractManifestList(fieldData);
      if (!documents.length) return null;
      const links = documents.map((document, index) => {
        const title = contractDocumentTitle(document, index);
        const href = contractDocumentHref(document, index);
        return href
          ? `<a class="contract-document-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
          : `<span class="contract-document-name">${escapeHtml(title)}</span>`;
      }).join('');
      const received = documents.some((document) => document?.success === true || Number(document?.http_status) === 200);
      const failed = documents.some((document) => document?.success === false || (document?.http_status && Number(document.http_status) >= 400));
      const state = failed ? 'Есть ошибка получения' : received ? 'Получен' : 'Зафиксирован в источнике';
      return `<div class="contract-document-list"><div class="contract-document-state">${escapeHtml(state)} · ${documents.length} ${documents.length === 1 ? 'файл' : documents.length < 5 ? 'файла' : 'файлов'}</div>${links}</div>`;
    };
    const FIELD_ALIASES = {'КПП заказчика':['КПП'],'Организатор закупки':['Организатор'],'ИНН организатора закупки':['ИНН организатора'],'КПП организатора закупки':['КПП организатора'],'Дата публикации источника':['Дата публикации'],'Документы закупки':['Комплект документов'],'График поставок товаров':['График поставок'],'Окна доставки':['Разрешённые дни и часы доставки'],'Получатель':['Организация-получатель товара'],'Телефон приёмки':['Телефон приёмки товара'],'Точный адрес конкретной точки приёмки':['Точный адрес'],'Пропускной режим':['Правила доступа на территорию приёмки'],'Требования к транспорту':['Требования к машине для перевозки'],'Требуемая грузоподъёмность машины':['Грузоподъёмность'],'Размеры кузова и дверей':['Размеры кузова и дверей назначенной машины'],'Место разгрузки':['Место разгрузки на территории получателя'],'Требуется ли гидроборт':['Необходимость гидроборта для разгрузки'],'Требуется ли пропуск на машину':['Необходимость пропуска на машину'],'Парковка и ожидание':['Условия парковки и ожидания машины'],'Ограничение по высоте':['Максимальная высота машины для въезда'],'Ограничение по длине машины':['Максимальная длина машины для въезда'],'Ограничение по полной массе':['Максимальная полная масса машины для въезда'],'Доступный тип машины':['Допустимые типы машин для въезда'],'Назначенная машина':['Машина, назначенная на рейс'],'Количество грузовых мест':['Количество грузовых мест в поставке'],'Паллеты':['Паллеты в поставке'],'Температурный режим':['Требуемая температура перевозки товара'],'Ограничения погрузки и крепления':['Правила погрузки и крепления груза'],'НМЦК':['НМЦК, ₽'],'Срок подачи':['Срок подачи - дата и время'],'Часовой пояс':['Часовой пояс срока подачи'],'Обеспечение заявки':['Обеспечение заявки, ₽'],'Обеспечение исполнения':['Обеспечение исполнения, ₽'],'Этап работы':['Этап кейса'],'Наименование ЭТП или портала':['ЭТП'],'ОКПД2':['ОКПД2 - кратко'],'Официальная ссылка ЕИС':['Ссылка на ЕИС или ЭТП'],'Дата публикации':['Дата публикации источника'],'Обязательные документы, которых не хватает':['Неразобранные обязательные документы'],'МЧД и УКЭП':['МЧД и УКЭП для ЭТП'],'Применимость национального режима':['Статус национального режима'],'Код ОКПД2/КТРУ для вывода':['ОКПД2 - кратко'],'Результат по товарным строкам':['Итог товарной проверки'],'Причина блокировки':['Причина остановки'],'Поставщиков подтверждено':['Поставщиков подтверждено'],'Статус ценового подтверждения':['Статус ценового подтверждения'],'Статус упаковки и единиц':['Статус упаковки и единиц'],'Итог исполнения':['Статус исполнения'],'Ссылка на агрегатор':['Ссылка на закупку у агрегатора'], 'Категория':['Отрасль (основная)','Категория закупки','Отрасль'], 'Город':['Город заказчика','Город поставки','cities[0]'], 'Email заказчика':['Электронная почта заказчика','Email'], 'Наименование заказчика':['Заказчик','Наименование заказчика'], 'Дата окончания подачи заявок':['Срок подачи заявок','Срок подачи - дата и время'], 'Срок окончания подачи':['Срок подачи','Срок подачи - дата и время'], 'Реестровый номер ЕИС':['Номер закупки','Номер извещения','Официальный номер извещения ЕИС','Номер процедуры'], 'Наименование ЭТП':['ЭТП','Наименование ЭТП или портала'], 'Место поставки / выполнения':['Адреса поставки','Место поставки / выполнения'], 'Способ размещения (процедура)':['Вид процедуры'], 'Категория размещения':['Категория размещения','Вид закупки'], 'Contract':['Проект контракта получен','Contract'], 'Размер обеспечения заявки, ₽':['Обеспечение заявки','Обеспечение заявки, ₽'], 'Начальная цена (НМЦК)':['НМЦК','НМЦК, ₽'],'Закупка только для СМП / СОНО':['Ограничение СМП','Только для СМП','СМП/СОНО'],'Ссылка на источник':['Ссылка на закупку в официальном источнике','Ссылка на ЕИС или ЭТП','Официальная ссылка ЕИС'],'Срок и порядок оплаты':['Условия оплаты','Срок оплаты'], 'Аванс':['Аванс, %','Размер аванса'], 'Условия проекта контракта':['Проект контракта','Условия контракта'], 'Условия разгрузки':['Разгрузка'], 'Условия приёмки и замены':['Условия приёмки','Замена товара']};
    const FIELD_CODES = {'Требования к участнику':['field_055'], 'Код ОКПД2/КТРУ для вывода':['field_061'], 'Срок действия контракта': {dates:['field_042','field_077'], contract:['field_077','field_042']}};
    const UNSAFE_FIELD_ALIASES = {
      field_003: new Set(['ИНН заказчика']), field_008: new Set(['Наименование заказчика']),
      field_011: new Set(['Город']), field_016: new Set(['Способ размещения (процедура)']),
      field_018: new Set(['Категория', 'Категория размещения']), field_024: new Set(['Дата публикации']),
      field_026: new Set(['Наименование ЭТП']), field_027: new Set(['Дата окончания подачи заявок', 'Срок окончания подачи']),
      field_108: new Set(['Размер обеспечения заявки, ₽']),
    };
    const FIELD_PLACEHOLDERS = new Set(['не проверено', 'не указано', 'не найдено', 'нет данных', 'требует проверки']);
    const hasMeaningfulFieldValue = (fieldData, seen = new Set()) => {
      if (fieldData == null) return false;
      if (typeof fieldData !== 'object') return String(fieldData).trim() !== '';
      if (seen.has(fieldData)) return false;
      seen.add(fieldData);
      if (isFieldEnvelope(fieldData)) {
        if (fieldData.value != null && hasMeaningfulFieldValue(fieldData.value, seen)) return true;
        const text = fieldData.text;
        return text != null && !FIELD_PLACEHOLDERS.has(String(text).trim().toLocaleLowerCase('ru-RU')) && hasMeaningfulFieldValue(text, seen);
      }
      return Array.isArray(fieldData)
        ? fieldData.some((value) => hasMeaningfulFieldValue(value, seen))
        : Object.values(fieldData).some((value) => hasMeaningfulFieldValue(value, seen));
    };
    const field = (name, options = {}) => {
      const card = activeTender?.card || {};
      const fields = card.fields || {};
      const names = [name, ...(FIELD_ALIASES[name] || []), ...(name === 'Обязательные документы' ? ['Обязательные документы, которых не хватает'] : [])].map(String);
      const collections = [fields, card.semantic_fields, card.field_collection, card.technical_fields, card.main_fields];
      const observations = [card.code_observations, fields.code_observations].filter(Boolean);
      const findCoded = (codes) => {
        for (const code of codes) {
          for (const collection of [...collections, ...observations]) {
            const entries = Array.isArray(collection) ? collection.map((item) => ['', item]) : Object.entries(collection || {});
            const coded = entries.find(([key, item]) => code === key || code === String(item?.field_key || item?.semantic_key || item?.semantic_code || item?.code || ''));
            if (coded && hasMeaningfulFieldValue(coded[1])) return coded[1];
          }
        }
        return null;
      };
      const literalCode = names.find((item) => /^field_\d+$/.test(item));
      if (literalCode) {
        if (Object.prototype.hasOwnProperty.call(fields, literalCode) && hasMeaningfulFieldValue(fields[literalCode])) return fields[literalCode];
        for (const collection of [...collections, ...observations]) {
          const entries = Array.isArray(collection) ? collection.map((item) => ['', item]) : Object.entries(collection || {});
          const coded = entries.find(([key, item]) => (literalCode === key || literalCode === String(item?.field_key || item?.semantic_code || '')) && hasMeaningfulFieldValue(item));
          if (coded) return coded[1];
        }
      }
      const codeSpec = FIELD_CODES[name];
      const codes = (Array.isArray(codeSpec) ? codeSpec : codeSpec?.[options.group] || []).map(String);
      const coded = findCoded(codes);
      if (coded) return coded;
      const direct = names.find((item) => Object.prototype.hasOwnProperty.call(fields, item));
      if (direct) return fields[direct];
      for (const collection of collections) {
        const items = Array.isArray(collection) ? collection : Object.values(collection || {});
        const match = items.find((item) => {
          const code = String(item?.field_key || item?.semantic_code || '');
          const unsafeAliases = UNSAFE_FIELD_ALIASES[code] || new Set();
          const keys = [item?.name, item?.field_definition?.display_name, ...(item?.field_definition?.legacy_names || [])]
            .filter(Boolean).map(String).filter((key) => !unsafeAliases.has(key));
          return keys.some((key) => names.includes(key));
        });
        if (match) return match;
      }
      return {value:'', status:'Нет данных', source:'В проекции нет канонического ключа для этого поля'};
    };
    const display = (name) => {
      let val = textValue(field(name));
      if (!val) val = '—';
      if (name === 'Обеспечение заявки') {
        const str = String(val).trim().replace(',', '.');
        if (str === '—' || str === '0' || str === '0.0' || str === '0.00' || str === '0,00' || str === 'Нет') return 'Нет';
      }
      return val;
    };
    const displaySubmissionDeadline = () => activeTender?._ui_submission_deadline_label || display('Срок подачи');
    const money = (value) => {
      if (value === '' || value == null) return '—';
      const number = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(number) ? new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2}).format(number) : String(value);
    };
    const numericOfferPrice = (value) => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (value && typeof value === 'object') {
        const nested = value.unit_with_vat ?? value.normalized_with_vat ?? value.raw ?? value.value ?? value.price;
        return numericOfferPrice(nested);
      }
      if (typeof value !== 'string' || !/^-?\d[\d \u00a0]*(?:[.,]\d+)?$/.test(value.trim())) return null;
      const n = Number(value.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    const CANONICAL_TARGET_UNITS = {
      'кг': 'KILOGRAM', 'kg': 'KILOGRAM', 'килограмм': 'KILOGRAM', 'килограммы': 'KILOGRAM',
      'kilogram': 'KILOGRAM', 'kilograms': 'KILOGRAM',
      'л': 'LITER', 'l': 'LITER', 'литр': 'LITER', 'литры': 'LITER',
      'liter': 'LITER', 'liters': 'LITER', 'litre': 'LITER',
      'шт': 'ITEM', 'шт.': 'ITEM', 'pcs': 'ITEM', 'штука': 'ITEM', 'штуки': 'ITEM',
      'item': 'ITEM', 'items': 'ITEM', 'piece': 'ITEM', 'pieces': 'ITEM', 'pc': 'ITEM'
    };
    const targetUnitKey = (line) => {
      if (!line || !line.unit) return null;
      const raw = String(line.unit).trim().toLowerCase().replace(/\.$/, '');
      const first = raw.split(';')[0].trim();
      return CANONICAL_TARGET_UNITS[raw] || CANONICAL_TARGET_UNITS[first] || null;
    };
    const candidateEquivalentPrice = (price, targetKey) => {
      if (!targetKey || !price || typeof price !== 'object') return null;
      const equivalents = price.equivalents;
      if (!equivalents || typeof equivalents !== 'object') return null;
      const eq = equivalents[targetKey];
      if (!eq || typeof eq !== 'object') return null;
      if (eq.unit !== targetKey || eq.comparison_allowed !== true) return null;
      const raw = eq.amount_with_vat;
      if (typeof raw !== 'string' || !/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw.trim())) return null;
      const n = Number(raw.trim());
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const offerPriceNumber = (offer, line = null) => {
      const price = offer?.price_info && typeof offer.price_info === 'object' ? offer.price_info : (offer?.price && typeof offer.price === 'object' ? offer.price : {});
      const hasEquivalents = Boolean(price && typeof price === 'object' && Object.prototype.hasOwnProperty.call(price, 'equivalents'));
      if (hasEquivalents) {
        const key = targetUnitKey(line);
        return candidateEquivalentPrice(price, key);
      }
      for (const value of [offer?.source_price?.value, offer?.source_price, offer?.source_price_value, offer?.source_price_amount, offer?.price?.source_with_vat, offer?.price?.normalized_with_vat, offer?.price?.raw, offer?.price_info?.normalized_with_vat, offer?.purchase_price]) {
        const n = numericOfferPrice(value); if (n !== null) return n;
      }
      const match = String(offer?.source_price_display ?? '').trim().match(/^(-?\d[\d \u00a0]*(?:[.,]\d+)?)/);
      return match ? numericOfferPrice(match[1]) : null;
    };
    const formatOfferPrice = (value) => {
      const n = numericOfferPrice(value);
      return n === null ? '' : `${new Intl.NumberFormat('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}).format(n)} ₽`;
    };
    const offerDisplayPrice = (offer, line = null) => {
      const n = offerPriceNumber(offer, line);
      return n === null ? '—' : `${new Intl.NumberFormat('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2}).format(n)} ₽`;
    };
    // offerDisplayPrice(offer) compatibility
    const offerUnit = (offer, line = null) => {
      const p = offer?.price_info && typeof offer.price_info === 'object' ? offer.price_info : (offer?.price && typeof offer.price === 'object' ? offer.price : {});
      const hasEquivalents = Boolean(p && typeof p === 'object' && Object.prototype.hasOwnProperty.call(p, 'equivalents'));
      if (hasEquivalents) {
        const key = targetUnitKey(line);
        const eqPrice = candidateEquivalentPrice(p, key);
        if (eqPrice !== null) {
          const unitLabels = { KILOGRAM: 'кг', LITER: 'л', ITEM: 'шт.' };
          return unitLabels[key] || formatUnit(line?.unit || 'Н/Д');
        }
        return 'Н/Д';
      }
      const raw = offer?.price_unit || offer?.unit || p.source_basis || p.normalized_unit || offer?.source_price?.unit || '';
      const map = {
        KILOGRAM: 'кг', KG: 'кг', LITRE: 'л', LITER: 'л',
        PIECE: 'шт.', PCS: 'шт.', ITEM: 'шт.', UNIT: 'шт.',
        PACKAGE: 'упак.', BOX: 'кор.', CASE: 'кор.',
        'ЗА КГ': 'кг', 'ЗА Л': 'л', 'ЗА ШТ.': 'шт.', 'ЗА УПАКОВКУ': 'упак.', 'ЗА КОРОБ': 'кор.', 'ЗА ЕДИНИЦУ': 'ед.'
      };
      const normalized = String(raw).trim().toUpperCase();
      if (!normalized || /^(?:UNKNOWN|UNDEFINED|NULL|NONE|НЕ\s*ОПРЕДЕЛЕНО|НЕ\s*УКАЗАНО|Н\/?Д)$/i.test(normalized)) return 'Н/Д';
      const clean = map[normalized] || String(raw).replace(/^за\s+/i, '').trim();
      if (!clean || /^(?:UNKNOWN|UNDEFINED|NULL|NONE|НЕ\s*ОПРЕДЕЛЕНО|НЕ\s*УКАЗАНО|Н\/?Д)$/i.test(clean)) return 'Н/Д';
      return formatUnit(clean);
    };
    const formatMatchExplanation = (offer, line) => {
      const price = offer?.price_info && typeof offer.price_info === 'object' ? offer.price_info : (offer?.price && typeof offer.price === 'object' ? offer.price : {});
      const first = (...values) => values.find((value) => value !== '' && value != null);
      const lines = []; const add = (label, value) => { if (value !== '' && value != null) lines.push(`${label}: ${typeof value === 'object' ? businessPresentationText(value) : value}`); };
      const source = first(price.source_with_vat, price.raw, offer?.source_price?.value, offer?.source_price, offer?.source_price_value, offer?.source_price_amount, offer?.purchase_price);
      const normalized = first(price.normalized_with_vat, price.unit_with_vat, offer?.normalized_price);
      const priceDate = first(offer?.price_date, price.price_date, offer?.source_price?.price_date);
      const dateFormatter = (value) => {
        const formatter = typeof formatDateDdMmYyyy === 'function' ? formatDateDdMmYyyy : typeof formatTenderDate === 'function' ? formatTenderDate : typeof window !== 'undefined' ? window.formatTenderDate : null;
        return formatter ? formatter(value) : String(value ?? '');
      };
      add('Дата цены', priceDate == null || priceDate === '' ? '' : dateFormatter(priceDate));
      add('База / единица цены', humanPriceUnit(first(offer?.price_unit, price.source_basis, price.normalized_unit, offer?.source_price?.unit)));
      add('Исходная цена поставщика', formatOfferPrice(source));
      if (price?.equivalents && typeof price.equivalents === 'object') {
        const targetKey = targetUnitKey(line);
        if (targetKey && price.equivalents[targetKey]) {
          const eq = price.equivalents[targetKey];
          if (eq && typeof eq === 'object' && eq.comparison_allowed === true && eq.amount_with_vat != null) {
            add('Применённый денежный эквивалент', `${formatOfferPrice(eq.amount_with_vat)} / ${humanPriceUnit(eq.unit || targetKey)}`);
            add('Основание эквивалента', `price.equivalents.${targetKey}${eq.numerator && eq.denominator ? ` (${eq.numerator} / ${eq.denominator})` : ''}`);
          }
        }
        for (const [k, v] of Object.entries(price.equivalents)) {
          if (v && typeof v === 'object' && v.amount_with_vat != null && k !== targetKey) {
            add(`Эквивалент ${humanPriceUnit(k)}`, `${formatOfferPrice(v.amount_with_vat)} / ${humanPriceUnit(k)}${v.comparison_allowed === false ? ' (сравнение запрещено)' : ''}`);
          }
        }
      }
      add('Нормализованная цена с НДС', formatOfferPrice(normalized));
      add('Нормализованная единица', humanPriceUnit(first(price.normalized_unit, offer?.normalized_unit)));
      add('База исходной цены', humanPriceUnit(price.source_basis));
      add('Количество в базе', price.basis_quantity);
      add('Штук в коробке', first(price.units_per_box, offer?.units_per_box, offer?.features?.units_per_box));
      const customerPrice = line?.source && typeof line.source === 'object' ? line.source.unit_price : line?.unit_price;
      add('Цена заказчика', customerPrice == null || customerPrice === '' ? '' : `${money(customerPrice)} ₽`);
      add('Количество заказчика', line?.quantity == null || line?.quantity === '' ? '' : `${formatQuantity(line.quantity)} ${line?.unit || ''}`.trim());
      add('Поставщик', first(offer?.supplier_name, offer?.supplier));
      add('Единица кандидата', first(offer?.normalized_unit, price.normalized_unit, offer?.price_unit, offer?.unit));
      const comparisonDetails = offer?.attribute_comparison && typeof offer.attribute_comparison === 'object' ? offer.attribute_comparison : null;
      const comparisonValues = (value, emptyText) => Array.isArray(value) && value.length ? value.map(comparisonValueText).join('; ') : emptyText;
      add('Признаки совпали', comparisonDetails ? comparisonValues(comparisonDetails.matched, 'Не передано / Не проверено') : 'Не передано / Не проверено');
      add('Признаки расходятся', comparisonDetails ? comparisonValues(comparisonDetails.mismatched, 'Не передано / Не проверено') : 'Не передано / Не проверено');
      add('Признаки неизвестны', comparisonDetails ? comparisonValues(comparisonDetails.missing, 'Нет неизвестных признаков') : 'Не передано / Не проверено');
      if (offer?.features && typeof offer.features === 'object') add('Характеристики товара', offer.features);
      add('Статус сравнения', humanStatus(first(offer?.fit_status, offer?.match_level, offer?.normalization_status, price.normalization_status)));
      add('Причина сравнения', comparisonValueText(first(offer?.comparison_reason, offer?.fit_reason, offer?.match_reason, price.normalization_reason)));
      const warnings = [...(Array.isArray(offer?.warnings) ? offer.warnings : []), ...(Array.isArray(price.warnings) ? price.warnings : []), ...(Array.isArray(offer?.price_warnings) ? offer.price_warnings : []), ...(Array.isArray(offer?.calculation_blockers) ? offer.calculation_blockers : []), offer?.source_price_display_warning].filter(Boolean);
      if (warnings.length) add('Предупреждения цены', [...new Set(warnings.map(comparisonValueText))].join('; '));
      add('Причина проверки', comparisonValueText(offer?.block_reason || (Array.isArray(offer?.reasons) ? offer.reasons.map(comparisonValueText).join('; ') : '')));
      add('Повторная проверка', {CURRENT:'Проверено текущим поиском; соответствие ТЗ не подтверждено', NOT_RETURNED:'Сохранённый вариант не вернулся в последнем поиске', STALE:'Исходные данные изменились; требуется повторная проверка'}[offer?.refresh_status]);
      for (const [index, version] of (Array.isArray(offer?.previous_versions) ? offer.previous_versions : []).entries()) {
        const oldPrice = version?.price || {};
        add(`Сохранённый вариант ${index + 1}`, [version?.name || version?.product_name, oldPrice?.source_price ?? version?.source_price, humanStatus(version?.fit_status)].filter(v => v != null && v !== '').join(' · '));
      }
      return lines.join('\n') || 'Пояснение сопоставления не передано.';
    };
    
    const cleanStageStr = (val) => {
      let s = String(val || '').trim();
      s = s.replace(/Не подтверждён;\s*РосТендер:\s*/ig, '');
      s = s.replace(/РосТендер:\s*/ig, '');
      s = s.replace(/^PANEL_READY$/i, '');
      if (s.toLowerCase().includes('прием заявок') || s.toLowerCase().includes('приём заявок')) return 'Приём заявок';
      return s;
    };

    const valueHtml = (fieldData, label='') => {
      const valueData = businessValue(fieldData);
      const link = fieldLink(valueData);
      if (link) return `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.text)}</a>`;
      const value = rawValue(valueData);
      let finalVal = value == null || value === '' ? '—' : value;
      if (finalVal === '—' && label.toLowerCase().includes('обеспечение')) {
         finalVal = 'Нет';
      }
      return businessPresentationHtml(valueData, label);
    };

    
    async function fetchJson(url, options) {
      const prefix = getDynamicPrefix();
      // Ensure API URLs use the correct prefix
      const fullUrl = url.startsWith('/') && !url.startsWith(prefix) ? prefix + url : url;
      const response = await fetch(fullUrl, Object.assign({cache: 'no-store'}, options || {}));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      if (!text.trim()) return null;
      return JSON.parse(text);
    }


    async function loadRegistry() {
      const container = document.getElementById('cards-container');
      if (container && !currentTenders.length) container.innerHTML = registryLoadingMarkup;
      try {
        const data = await fetchJson(`${API_PREFIX}/api/tenders`);
        currentTenders = data.tenders || [];
        // Dedicated routes load their own workspace; don't overwrite it with a first tender.
        if (/\/(logistics|settings|documents|sourcing)\/?$/.test(location.pathname)) {
          document.getElementById('nav-total-count').textContent = currentTenders.length;
          return;
        }
        // [Optimization: background prefetch removed to save network/API load]
        populateRegistryRegions();
        document.getElementById('nav-total-count').textContent = currentTenders.length;
        updateBucketCounts();
        const savedState = readRegistryState();
        const savedPage = Number.isInteger(Number(savedState.page)) ? Math.max(1, Number(savedState.page)) : 1;
        const savedFilter = ['all', 'live', 'archive', 'my-archive'].includes(savedState.filter) && savedState.filter !== 'all' ? savedState.filter : 'live';
        const searchInput = document.getElementById('search-input');
        if (searchInput && typeof savedState.query === 'string') searchInput.value = savedState.query;
        updateSearchClear();
        if (savedState.extraFilters && typeof savedState.extraFilters === 'object') {
          registryExtraFilters = {
            smp: savedState.extraFilters.smp === true,
            region: typeof savedState.extraFilters.region === 'string' ? savedState.extraFilters.region : '',
            oneTime: savedState.extraFilters.oneTime === true,
            periodic: savedState.extraFilters.periodic === true,
          };
        }
        syncRegistryFilterForm();
        updateRegistryFilterSummary();
        restoringRegistryState = true;
        applyRegistryFilter(savedFilter);
        renderPage(savedPage);
        restoringRegistryState = false;
        const hashId = location.hash.startsWith('#tender-') ? decodeURIComponent(location.hash.replace('#tender-', '')) : '';
        const deepId = hashId || decodeURIComponent(location.pathname.split('/tenders/')[1] || '');
        if (deepId) {
          await selectTenderPrimary(deepId, false);
        } else if (filteredTenders.length > 0) {
          await selectTenderPrimary(String(filteredTenders[0].tender_id), false);
        } else {
          const detailContent = document.getElementById('det-detail-content');
          if (detailContent) {
            detailContent.innerHTML = '<div class="loading-detail">Выберите закупку из реестра слева для просмотра</div>';
          }
        }
      } catch (error) {
        restoringRegistryState = false;
        console.error('API error loading tenders:', error);
        const container = document.getElementById('cards-container');
        if (container) container.innerHTML = '<div style="padding:2rem;color:var(--accent-red,#ef4444);text-align:center">Ошибка загрузки тендеров. Обновите страницу или проверьте подключение.</div>';
      }
    }

    function canonicalMoscowDeadline(value, sourceLabel = 'РосТендер') {
      if (typeof value !== 'string') return null;
      const raw = value.trim();
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/);
      if (!match) return null;
      // Legacy UTC values have no zone; current registry values may carry an offset.
      const instant = match[7]
        ? new Date(raw.replace(' ', 'T'))
        : new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)));
      if (Number.isNaN(instant.getTime())) return null;
      const parts = new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).formatToParts(instant).reduce((result, part) => ({...result, [part.type]: part.value}), {});
      const display = `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second} МСК`;
      return {value: display, label: `${sourceLabel}: ${display}`};
    }

    function padDeadline(value) { return String(value).padStart(2, '0'); }

    function deadlineParts(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
      const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
      if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
          || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute
          || date.getUTCSeconds() !== second) return null;
      return {year, month, day, hour, minute, second, millisecond, date: `${year}-${padDeadline(month)}-${padDeadline(day)}`};
    }

    function deadlineTimezoneOffset(value) {
      const zone = String(value || '').trim().toUpperCase();
      if (!zone) return null;
      if (['Z', 'UTC', 'GMT', 'UTC+00:00', 'GMT+00:00'].includes(zone)) return 0;
      if (['MSK', 'МСК', 'EUROPE/MOSCOW', 'UTC+03:00', 'GMT+03:00'].includes(zone)) return 180;
      const match = zone.match(/^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
      if (!match) return null;
      const hours = Number(match[2]);
      const minutes = Number(match[3] || 0);
      if (hours > 23 || minutes > 59) return null;
      return (hours * 60 + minutes) * (match[1] === '-' ? -1 : 1);
    }

    function parseSubmissionDeadline(value, timezone = '') {
      if (typeof value !== 'string' || !value.trim()) return null;
      const raw = value.trim();
      let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        const parts = deadlineParts(Number(match[1]), Number(match[2]), Number(match[3]));
        return parts && {kind: 'date', ...parts, value: new Date(Date.UTC(parts.year, parts.month - 1, parts.day))};
      }
      match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/);
      if (!match) match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(МСК|MSK)?$/i);
      if (!match) {
        match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!match) return null;
        const parts = deadlineParts(Number(match[3]), Number(match[2]), Number(match[1]));
        return parts && {kind: 'date', ...parts, value: new Date(Date.UTC(parts.year, parts.month - 1, parts.day))};
      }
      const iso = raw.match(/^\d{4}/);
      const year = Number(iso ? match[1] : match[3]);
      const month = Number(iso ? match[2] : match[2]);
      const day = Number(iso ? match[3] : match[1]);
      const hour = Number(iso ? match[4] : match[4]);
      const minute = Number(iso ? match[5] : match[5]);
      const second = Number((iso ? match[6] : match[6]) || 0);
      const millisecond = Number(`${(iso ? match[7] : match[7]) || ''}`.padEnd(3, '0') || 0);
      const suffix = iso ? match[8] : match[8];
      const parts = deadlineParts(year, month, day, hour, minute, second, millisecond);
      if (!parts) return null;
      const hasExplicitSuffix = typeof suffix === 'string' && suffix.trim() !== '';
      const offset = hasExplicitSuffix ? deadlineTimezoneOffset(suffix) : deadlineTimezoneOffset(timezone);
      if (hasExplicitSuffix && offset == null) return null;
      if (offset == null) return {kind: 'unknown-timezone', ...parts, value: new Date(Date.UTC(year, month - 1, day))};
      const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offset * 60000);
      return {kind: 'exact', ...parts, offset, value: instant};
    }

    function formatDeadlineInfo(info) {
      if (!info) return '';
      if (info.kind === 'exact') {
        const parts = new Intl.DateTimeFormat('ru-RU', {timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'})
          .formatToParts(info.value).reduce((result, part) => ({...result, [part.type]: part.value}), {});
        return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second} МСК`;
      }
      const date = `${padDeadline(info.day)}.${padDeadline(info.month)}.${info.year}`;
      if (info.kind === 'date') return date;
      const time = `${padDeadline(info.hour)}:${padDeadline(info.minute)}${info.second ? `:${padDeadline(info.second)}` : ''}`;
      return `${date} ${time} (часовой пояс не указан)`;
    }

    function officialRegistryDeadline(registry) {
      if (!registry || String(registry.submission_deadline_verification || '').toUpperCase() !== 'CONFIRMED') return null;
      const provenance = registry.provenance?.submission_deadline;
      const sourceUrl = provenance?.source_url;
      if (provenance?.source_kind !== 'OFFICIAL_OBSERVATION' || provenance?.source !== 'OFFICIAL_ETP'
          || typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl)
          || !provenance.checked_at || !registry.submission_deadline) return null;
      const info = parseSubmissionDeadline(String(registry.submission_deadline), provenance.timezone || registry.timezone || '');
      return info ? {value: formatDeadlineInfo(info), label: `Официальная ЭТП: ${formatDeadlineInfo(info)}`, info} : null;
    }

    function submissionDeadlineCandidates(item) {
      const registry = item?.registry || {};
      const provenance = registry.provenance?.submission_deadline || {};
      const timezone = provenance.timezone || registry.timezone || item?.timezone || '';
      return [
        [item?._ui_submission_deadline, timezone],
        [item?.submission_deadline, timezone],
        [registry.submission_deadline, timezone],
        [item?.card?.deadlines?.application_end_date, item?.card?.deadlines?.timezone || timezone],
        [item?.card?.fields?.['Срок подачи']?.value, timezone],
        [item?.card?.fields?.['Дата окончания подачи заявок']?.value, timezone],
        [item?.deadline_at_raw, timezone],
        [item?.deadline, timezone],
      ].filter(([value]) => typeof value === 'string' && value.trim());
    }

    function submissionDeadlineValue(item) {
      return officialRegistryDeadline(item?.registry)?.value || submissionDeadlineCandidates(item)[0]?.[0] || '';
    }

    function submissionDeadlineInfo(item) {
      const official = officialRegistryDeadline(item?.registry);
      if (official?.info) return official.info;
      for (const [value, timezone] of submissionDeadlineCandidates(item)) {
        const info = parseSubmissionDeadline(value, timezone);
        if (info) return info;
      }
      return null;
    }

    function moscowDateKey(now) {
      const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'})
        .formatToParts(now).reduce((result, part) => ({...result, [part.type]: part.value}), {});
      return `${parts.year}-${parts.month}-${parts.day}`;
    }

    function deadlineExpired(info, now = new Date()) {
      if (!info) return false;
      if (info.kind === 'exact') return now.getTime() >= info.value.getTime();
      return info.date < moscowDateKey(now);
    }

    function isDeadlineExpired(item, now = new Date()) {
      return deadlineExpired(submissionDeadlineInfo(item), now);
    }

    function isArchivedByDeadline(item, now = new Date()) {
      const officialStatus = String(item?.registry?.official_status || item?.official_status || '').toLowerCase();
      const statusVerification = String(item?.registry?.official_status_verification || item?.official_status_verification || '').toUpperCase();
      const verifiedStatus = ['CONFIRMED', 'OFFICIAL_CONFIRMED'].includes(statusVerification);
      if (verifiedStatus && (officialStatus.includes('заверш') || officialStatus.includes('отмен') || officialStatus.includes('архив') || /^(completed|cancelled|closed|archived)$/.test(officialStatus))) return true;
      return deadlineExpired(submissionDeadlineInfo(item), now);
    }

    function deadlineLabel(item) {
      const official = officialRegistryDeadline(item?.registry);
      const info = submissionDeadlineInfo(item);
      if (!info) return 'Срок подачи: не подтверждён';
      if (deadlineExpired(info)) return `Срок подачи истёк · ${formatDeadlineInfo(info).split(' (часовой пояс')[0]}`;
      if (official) return official.label;
      return `Срок подачи: ${formatDeadlineInfo(info)}`;
    }

    function archiveLabel(item) {
      return isDeadlineExpired(item) ? deadlineLabel(item) : 'Архив по официальному статусу';
    }

    function formatNmck(value) {
      if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return 'НМЦК не указана';
      if (typeof value !== 'string' && typeof value !== 'number') return 'НМЦК не указана';
      const normalized = String(value).replace(/[\s\u00a0₽]/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
      const number = Number.parseFloat(normalized);
      if (!Number.isFinite(number)) return 'НМЦК не указана';
      return `${number.toLocaleString('ru-RU', {maximumFractionDigits: 0})} ₽`;
    }

    function formatActiveNmck(value) {
      if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return 'НМЦК не указана';
      if (typeof value !== 'string' && typeof value !== 'number') return 'НМЦК не указана';
      const normalized = String(value).replace(/[\s\u00a0₽A-Za-zА-Яа-я]/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
      const number = Number.parseFloat(normalized);
      if (!Number.isFinite(number)) return 'НМЦК не указана';
      return `₽ ${number.toLocaleString('ru-RU', {maximumFractionDigits: 0})}`;
    }

    function registryBucket(item, now = new Date()) {
      if (Boolean(item?.my_archive?.is_archived)) return 'my-archive';
      return isArchivedByDeadline(item, now) ? 'archive' : 'live';
    }

    function registryBucketState(items = currentTenders, now = new Date()) {
      const buckets = items.map((item) => registryBucket(item, now));
      const values = {all: items.length, live: 0, archive: 0, 'my-archive': 0};
      buckets.forEach((bucket) => { values[bucket] += 1; });
      return {buckets, values};
    }

    function updateBucketCounts() {
      const {buckets, values} = registryBucketState();
      lastDeadlineSnapshot = buckets.join('');
      Object.entries(values).forEach(([key, value]) => {
        const node = document.querySelector(`[data-filter-count="${key}"]`);
        if (node) node.textContent = value;
        const tabNode = document.querySelector(`[data-tab-count="${key}"]`);
        if (tabNode) tabNode.textContent = value;
      });
      const totalNode = document.getElementById('nav-total-count');
      if (totalNode) totalNode.textContent = values.all;
    }

    function refreshDeadlineState(force = false) {
      if (!currentTenders.length) return;
      const snapshot = registryBucketState().buckets.join('');
      if (!force && snapshot === lastDeadlineSnapshot) return;
      const page = currentPage;
      updateBucketCounts();
      const registryVisible = Boolean(document.getElementById('search-input')
        && document.getElementById('prev-page-btn') && document.getElementById('next-page-btn')
        && !document.querySelector('.app-workspace.documents-view')
        && !location.pathname.includes('/logistics'));
      if (registryVisible && activeFilter !== 'my-archive') {
        applyRegistryFilter(activeFilter);
        renderPage(page);
      }
      if (activeTender && document.getElementById('det-stage')) {
        const expired = isDeadlineExpired(activeTender);
        const stage = document.getElementById('det-stage');
        const risk = document.getElementById('det-risk-status');
        if (stage) stage.textContent = expired ? 'Архив по сроку подачи' : cleanStageStr(display('Этап работы'));
        if (risk) risk.textContent = isArchivedByDeadline(activeTender) ? 'Архив' : officialRegistryDeadline(activeTender.registry) ? 'Живая проверка' : 'Проверка не подтверждена';
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshDeadlineState(true);
        if (activeTenderId) fetchActiveEarnings(activeTenderId, { force: true });
      }
    });
    window.addEventListener('deadlinechange', () => refreshDeadlineState(true));
    window.addEventListener('pageshow', () => refreshDeadlineState(true));
    // In-page timer only re-renders when a deadline classification changes; it never fetches or writes.
    setInterval(() => {
      if (document.visibilityState === 'visible') refreshDeadlineState();
    }, 1000);

    function tenderSummary(item) {
      return tenderCache.get(String(item.tender_id)) || registryFilterCache.get(String(item.tender_id))?.detail || item;
    }

    const registryFilterText = (detail, names) => {
      const fields = detail?.card?.fields || detail?.registry?.filter_fields || {};
      return names.map((name) => textValue(fields[name])).filter(Boolean).join(' ');
    };
    function registryFilterMeta(item) {
      const cached = registryFilterCache.get(String(item.tender_id)) || {};
      const detail = cached.detail || tenderCache.get(String(item.tender_id)) || item;
      const fields = detail?.card?.fields || detail?.registry?.filter_fields || {};
      const registry = detail?.registry || {};
      let region = (registry.region || textValue(fields['Регион поставки']) || textValue(fields['Регион закупки']) || '').replace(/^Москва город$/, 'Москва').trim();
      const regionParts = region.split(';');
      if (regionParts.length > 1) {
        const count = regionParts.length;
        const pluralRules = (n) => {
          if (n % 10 === 1 && n % 100 !== 11) return 'адрес';
          if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'адреса';
          return 'адресов';
        };
        region = `${count} ${pluralRules(count)}`;
      }
      const delivery = registryFilterText(detail, ['График поставок', 'Количество партий поставки', 'Поставка', 'Период исполнения контракта', 'Особые условия исполнения']).toLocaleLowerCase('ru-RU');
      const periodic = /партиями|по заявкам|периодическ|ежеднев|еженедел|ежемесяч|плановых дней поставки/.test(delivery);
      const oneTime = !periodic && /разов|однократ|одной поставк|одна поставк/.test(delivery);
      const eligibility = [registryFilterText(detail, ['Требования к участнику', 'Ограничения участия', 'Преимущества участникам']), JSON.stringify(cached.core?.main_fields || [])].join(' ').toLocaleLowerCase('ru-RU');
      const smp = !/(ограничен|преимуществ)[^.;]{0,30}(смп|сонко)[^.;]{0,20}нет|нет[^.;]{0,20}(ограничен|преимуществ)[^.;]{0,30}(смп|сонко)/.test(eligibility) && /(только[^.;]{0,30}(смп|сонко)|(ограничен|преимуществ|участ)[^.;]{0,40}(смп|сонко))/.test(eligibility);
      return {region, periodic, oneTime, smp};
    }
    function matchesRegistryExtraFilters(item) {
      const meta = registryFilterMeta(item);
      if (registryExtraFilters.smp && !meta.smp) return false;
      if (registryExtraFilters.region && meta.region !== registryExtraFilters.region) return false;
      if ((registryExtraFilters.oneTime || registryExtraFilters.periodic) && !((registryExtraFilters.oneTime && meta.oneTime) || (registryExtraFilters.periodic && meta.periodic))) return false;
      return true;
    }
    function populateRegistryRegions() {
      const select = document.getElementById('registry-filter-region');
      if (!select) return;
      const selected = registryExtraFilters.region;
      const regions = [...new Set(currentTenders.map((item) => registryFilterMeta(item).region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
      select.innerHTML = '<option value="">Все регионы</option>' + regions.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join('');
      select.value = regions.includes(selected) ? selected : '';
      if (selected && !regions.includes(selected)) registryExtraFilters.region = '';
    }
    function syncRegistryFilterForm() {
      const smp = document.getElementById('registry-filter-smp');
      const region = document.getElementById('registry-filter-region');
      const oneTime = document.getElementById('registry-filter-one-time');
      const periodic = document.getElementById('registry-filter-periodic');
      if (smp) smp.checked = registryExtraFilters.smp;
      if (region) region.value = registryExtraFilters.region;
      if (oneTime) oneTime.checked = registryExtraFilters.oneTime;
      if (periodic) periodic.checked = registryExtraFilters.periodic;
    }
    function updateRegistryFilterSummary() {
      const summary = document.getElementById('registry-filter-summary');
      const toggle = document.getElementById('registry-filters-toggle');
      const labels = [];
      if (registryExtraFilters.smp) labels.push('СМП');
      if (registryExtraFilters.region) labels.push(registryExtraFilters.region);
      if (registryExtraFilters.oneTime) labels.push('разовая поставка');
      if (registryExtraFilters.periodic) labels.push('периодическая поставка');
      if (summary) summary.innerHTML = labels.length ? `Дополнительно: <strong>${labels.map(escapeHtml).join(' · ')}</strong>` : 'Дополнительные фильтры не выбраны';
      if (toggle) toggle.classList.toggle('is-applied', labels.length > 0);
    }
    function bindRegistryExtraFilters() {
      const toggle = document.getElementById('registry-filters-toggle');
      const popover = document.getElementById('registry-filter-popover');
      const reset = document.getElementById('registry-filters-reset');
      if (!toggle || !popover || !reset) return;
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        popover.hidden = !popover.hidden;
        toggle.setAttribute('aria-expanded', String(!popover.hidden));
        if (!popover.hidden) syncRegistryFilterForm();
      });
      popover.addEventListener('click', (event) => event.stopPropagation());
      popover.addEventListener('submit', (event) => {
        event.preventDefault();
        registryExtraFilters = {
          smp: document.getElementById('registry-filter-smp').checked,
          region: document.getElementById('registry-filter-region').value,
          oneTime: document.getElementById('registry-filter-one-time').checked,
          periodic: document.getElementById('registry-filter-periodic').checked,
        };
        popover.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        updateRegistryFilterSummary();
        applyRegistryFilter(activeFilter);
      });
      reset.addEventListener('click', () => {
        registryExtraFilters = {smp:false, region:'', oneTime:false, periodic:false};
        syncRegistryFilterForm();
        updateRegistryFilterSummary();
        applyRegistryFilter(activeFilter);
      });
      document.addEventListener('click', () => {
        if (!popover.hidden) {
          popover.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    function syncRegistryExtraFiltersFromControls() {
      const smp = document.getElementById('registry-filter-smp');
      const region = document.getElementById('registry-filter-region');
      const oneTime = document.getElementById('registry-filter-one-time');
      const periodic = document.getElementById('registry-filter-periodic');
      registryExtraFilters = {
        smp: Boolean(smp?.checked),
        region: String(region?.value || ''),
        oneTime: Boolean(oneTime?.checked),
        periodic: Boolean(periodic?.checked),
      };
    }

    function parseNmck(value) {
      const normalized = String(value || '')
        .replace(/[\s\u00a0]/g, '')
        .replace(',', '.')
        .replace(/[^0-9.]/g, '');
      return Number.parseFloat(normalized);
    }

    function registryNmck(item) {
      const registry = item?.registry || {};
      return registry.nmck_rub ?? registry.nmck;
    }

    function applyRegistryFilter(mode) {
      if (window.updateFilterResetBadges) setTimeout(window.updateFilterResetBadges, 0);
      activeFilter = mode;
      syncRegistryExtraFiltersFromControls();
      document.querySelectorAll('[data-registry-filter]').forEach((button) => button.classList.toggle('active', button.dataset.registryFilter === mode));
      const q = document.getElementById('search-input').value.toLowerCase().trim();
      const minPriceVal = Number.parseFloat(document.getElementById('MinPrice')?.value || '');
      const maxPriceVal = Number.parseFloat(document.getElementById('MaxPrice')?.value || '');

      filteredTenders = currentTenders.filter((item) => {
        const nmckRaw = parseNmck(registryNmck(item));
        if (!Number.isNaN(minPriceVal) && (Number.isNaN(nmckRaw) || nmckRaw < minPriceVal)) return false;
        if (!Number.isNaN(maxPriceVal) && (Number.isNaN(nmckRaw) || nmckRaw > maxPriceVal)) return false;

        const haystack = `${item.title || ''} ${item.tender_id || ''} ${item.number || ''} ${item.customer || ''}`.toLowerCase();
        if (q && !haystack.includes(q)) return false;
        if (!matchesRegistryExtraFilters(item)) return false;
        const bucket = registryBucket(item);
        const isManualArchive = bucket === 'my-archive';
        const isLive = bucket === 'live';
        return mode === 'all' || (mode === 'live' && isLive) || (mode === 'archive' && bucket === 'archive') || (mode === 'my-archive' && isManualArchive);
      });
      if (mode === 'archive') {
        filteredTenders.sort((a, b) => {
          const pa = parseSubmissionDeadline(submissionDeadlineValue(a));
          const pb = parseSubmissionDeadline(submissionDeadlineValue(b));
          return (pb?.value?.getTime() || 0) - (pa?.value?.getTime() || 0);
        });
      } else {
        filteredTenders.sort((a, b) => Number(b.tender_id || 0) - Number(a.tender_id || 0));
      }
      renderPage(1);
    }

    function filterCards() { applyRegistryFilter(activeFilter); }

    function updateSearchClear() {
      const input = document.getElementById('search-input');
      const btn = document.getElementById('search-clear-btn');
      if (!input || !btn) return;
      if (input.value.length > 0) { btn.classList.add('visible'); btn.hidden = false; }
      else { btn.classList.remove('visible'); btn.hidden = true; }
    }
    function clearSearch() {
      const input = document.getElementById('search-input');
      if (input) { input.value = ''; input.focus(); }
      updateSearchClear();
      filterCards();
    }
    window.updateSearchClear = updateSearchClear;
    window.clearSearch = clearSearch;

    function renderPage(page) {
      const totalItems = filteredTenders.length;
      const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
      currentPage = Math.max(1, Math.min(page, totalPages));
      const startIdx = (currentPage - 1) * PAGE_SIZE;
      const endIdx = Math.min(startIdx + PAGE_SIZE, totalItems);
      const items = filteredTenders.slice(startIdx, endIdx);
      const container = document.getElementById('cards-container');
      container.innerHTML = items.length ? items.map((item) => {
        const detail = tenderSummary(item);
        const fields = detail.card?.fields || {};
        const registry = detail.registry || {};
        const law = registry.law || textValue(fields['Закон']) || 'Без закона';
        const rawPrice = registryNmck(detail);
        const archived = isArchivedByDeadline(item);
        const price = archived ? formatNmck(rawPrice) : formatActiveNmck(rawPrice);
        const fullRegionRaw = (registry.region || textValue(fields['Регион закупки']) || textValue(fields['Регион поставки']) || 'Регион не указан').replace(/^Москва город$/, 'Москва');
        let region = fullRegionRaw;
        const regionParts = region.split(';');
        if (regionParts.length > 1) {
          const count = regionParts.length;
          const pluralRules = (n) => {
            if (n % 10 === 1 && n % 100 !== 11) return 'адрес';
            if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'адреса';
            return 'адресов';
          };
          region = `${count} ${pluralRules(count)}`;
        }
        const officialStatusRaw = registry.official_status || textValue(fields['Официальный статус']) || 'Приём заявок';
        const officialStatus = cleanStageStr(officialStatusRaw) || 'Приём заявок';
        const officialStatusVerified = Boolean(String(registry.official_status || '').trim()
          && String(registry.official_checked_at || '').trim()
          && ['CONFIRMED', 'OFFICIAL_CONFIRMED'].includes(String(registry.official_status_verification || '').toUpperCase()));
        const stage = isDeadlineExpired(item) ? 'Срок подачи истёк' : officialStatus;
        const parsedDeadline = parseSubmissionDeadline(submissionDeadlineValue(item));
        const topBadges = archived
          ? `<span class="shadcn-badge archive-deadline-badge">${escapeHtml(archiveLabel(item))}</span>`
          : `<span class="shadcn-badge shadcn-badge-law">${escapeHtml(law)}</span>
            <span class="shadcn-badge ${window.getOfficialBadgeClass(officialStatus)}">${escapeHtml(officialStatus)}</span>
            <span class="shadcn-badge ${officialStatusVerified ? 'shadcn-badge-verified' : 'tag-red-fill'}">${officialStatusVerified ? 'ПРОВЕРЕН' : 'Статус требует проверки'}</span>${parsedDeadline ? '' : '<span class="shadcn-badge tag-red-fill">Срок не подтверждён</span>'}`;
        return `<article onclick="window.selectTender('${escapeHtml(item.tender_id)}')" class="t-card ${String(item.tender_id) === String(activeTenderId) ? 'active' : ''}" id="card-${escapeHtml(item.tender_id)}" data-tender-id="${escapeHtml(item.tender_id)}" tabindex="0">
          <div class="t-tags" style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">${topBadges}</div>
          <div class="t-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="t-stage" title="${escapeHtml(stage)}">${escapeHtml(stage)}</div>
          <div class="t-foot"><div class="t-price">${escapeHtml(price)}</div><span class="t-region" title="${escapeHtml(fullRegionRaw)}">${escapeHtml(region)}</span></div>
        </article>`;
      }).join('') : '<div class="empty-state">Закупки не найдены</div>';
      container.scrollTop = 0;
      document.getElementById('prev-page-btn').disabled = currentPage <= 1;
      document.getElementById('next-page-btn').disabled = currentPage >= totalPages;

      // Render BoardUI Pagination numeric buttons (smart collapsed, strict 3-page limits)
      const numsContainer = document.getElementById('boardui-page-numbers');
      if (numsContainer) {
        function computePages(current, total) {
          const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
          if (total <= 5) return range(1, total);
          if (current <= 2) return [1, 2, 3, 'dots', total];
          if (current >= total - 1) return [1, 'dots', total - 2, total - 1, total];
          return [1, 'dots', current - 1, current, current + 1, 'dots', total];
        }
        
        const pages = computePages(currentPage, totalPages);
        numsContainer.innerHTML = pages.map((item) => {
          if (item === 'dots') {
            return `<span style="display:inline-flex; align-items:flex-end; justify-content:center; min-width:24px; height:28px; padding-bottom:4px; color:#7f93a6; font-size:13px;">&hellip;</span>`;
          }
          return `<button type="button" class="boardui-pag-num ${item === currentPage ? 'active' : ''}" onclick="renderPage(${item})" aria-label="Страница ${item}">${item}</button>`;
        }).join('');
      }

      if (document.getElementById('page-info')) document.getElementById('page-info').textContent = '';
      saveRegistryState(); if(window.updateFilterResetBadges) window.updateFilterResetBadges();
    }

    
    
    // Close filter dropdowns on click outside or opening another
    document.addEventListener('click', function(e) {
      function smoothClose(det) {
        if (det.classList.contains('closing')) return;
        det.classList.add('closing');
        setTimeout(() => {
          det.removeAttribute('open');
          det.classList.remove('closing');
        }, 150);
      }
      document.querySelectorAll('.boardui-details[open]').forEach(det => {
        const isInsideMenu = det.contains(e.target);
        if (!isInsideMenu) {
           smoothClose(det);
        }
      });
      const summary = e.target.closest('.boardui-details summary');
      if (summary) {
        const parent = summary.parentElement;
        if (parent.hasAttribute('open')) {
          e.preventDefault();
          smoothClose(parent);
        } else {
          document.querySelectorAll('.boardui-details[open]').forEach(det => {
            if (det !== parent) smoothClose(det);
          });
        }
      }
    });

    function setRegistryTab(filterVal) {
      activeFilter = filterVal;
      const radios = document.querySelectorAll('input[name="boardui-reg-tab"]');
      radios.forEach(r => {
        r.checked = (r.getAttribute('data-registry-filter') === filterVal);
      });
      document.querySelectorAll('[data-registry-tab]').forEach(tab => {
        const selected = tab.getAttribute('data-registry-tab') === filterVal;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
      });
      const summaryElem = document.getElementById('filter-summary-status');
      if (summaryElem) {
        summaryElem.textContent = 'Статусы';
      }
      filterCards(); if (window.updateFilterResetBadges) window.updateFilterResetBadges();
    }
    window.setRegistryTab = setRegistryTab;

    function resetPriceFilter() {
      const minInp = document.getElementById('MinPrice');
      const maxInp = document.getElementById('MaxPrice');
      if (minInp) minInp.value = '';
      if (maxInp) maxInp.value = '';
      filterCards(); if (window.updateFilterResetBadges) window.updateFilterResetBadges();
    }

    function resetParamFilters() {
      const regSel = document.getElementById('registry-filter-region');
      const smpInp = document.getElementById('registry-filter-smp');
      const oneInp = document.getElementById('registry-filter-one-time');
      const perInp = document.getElementById('registry-filter-periodic');
      if (regSel) regSel.value = '';
      if (smpInp) smpInp.checked = false;
      if (oneInp) oneInp.checked = false;
      if (perInp) perInp.checked = false;
      filterCards(); if (window.updateFilterResetBadges) window.updateFilterResetBadges();
    }

    function changePage(delta) { renderPage(currentPage + delta); }

    async function selectTenderPrimary(id, updateUrl = true) {
      // Late section/refresh callbacks must not navigate out of sourcing.
      if (!updateUrl && document.querySelector('.app-workspace')?.classList.contains('sourcing-view')) return;
      if (typeof window.openTenderWorkspace === 'function') {
        window.openTenderWorkspace();
      }
      const validTabs = ['main','products','dates','documents','eligibility','inspection','suppliers','economics','logistics','contract','execution','control','technical'];
      if (!validTabs.includes(activeTab)) {
        activeTab = 'main';
      }
      const key = String(id);
      const requestId = ++selectTenderRequest;
      const initialSelection = activeTenderId === null;
      const changedTender = activeTenderId !== key;
      activeTenderId = key;
      activeTender = null;
      updateOffersRefreshUi();
      activeDocuments = [];
      activeSectionWarnings = {documents: '', candidates: '', core: ''};
      ['det-id','det-title','det-price','det-law','det-stage','det-end-date','det-assurance','det-etp','det-risk-status','det-card-counts','det-profit','det-profit-margin'].forEach((elementId) => {
        const node = document.getElementById(elementId);
        if (node) node.textContent = '';
      });
      const detailContent = document.getElementById('det-detail-content');
      if (detailContent) detailContent.innerHTML = detailLoadingMarkup;
      if (!tenderCache.has(key)) {
        let detail;
        try {
          detail = await fetchJson(`${API_PREFIX}/api/tenders/${encodeURIComponent(key)}?view=summary`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn('API: отклонён неизвестный идентификатор тендера:', key, message);
          if (detailContent) detailContent.innerHTML = sectionWarningHtml('Карточка', message, 'Выберите другую закупку.');
          return;
        }
        if (requestId !== selectTenderRequest) return;
        if (detail && detail.card) {
          const adapted = typeof adaptTenderDetail === 'function' ? adaptTenderDetail(detail, null) : detail;
          if (adapted._ui_submission_deadline) {
            const registryItem = currentTenders.find((item) => String(item?.tender_id) === key);
            if (registryItem) registryItem._ui_submission_deadline = adapted._ui_submission_deadline;
          }
          tenderCache.set(key, adapted);
        } else {
          console.warn('Detail card unavailable for tender:', key);
          if (detailContent) detailContent.innerHTML = sectionWarningHtml('Карточка', 'Детальные данные тендера недоступны.', 'Выберите другую закупку.');
          return;
        }
      }
      if (requestId !== selectTenderRequest) return;
      activeTenderId = key;
      activeTender = tenderCache.get(key);
      activeSectionWarnings = sectionWarningCache.get(key) || {documents: '', candidates: '', core: ''};
      if (activeTender?._ui_submission_deadline) {
        document.querySelector(`[data-tender-id="${CSS.escape(key)}"] .tag-red-fill`)?.remove();
      }
      activeDocuments = documentCache.has(key) ? (documentCache.get(key) || []) : [];
      for (const [tab, count] of [['products', groupedTenderLines(activeTender.card?.tender_lines || []).length], ['documents',activeDocuments.length]]) {
        const badge = document.querySelector(`[data-detail-tab="${tab}"] .tab-badge, [data-detail-tab="${tab}"] .detail-tab-badge`);
        if (badge) badge.textContent = String(count);
      }
      document.querySelectorAll('.t-card').forEach((card) => card.classList.toggle('active', card.dataset.tenderId === key));
      if (updateUrl) history.replaceState(null, '', `#tender-${encodeURIComponent(key)}`);
      const headerNumber = tenderHeaderNumber(activeTender);
      document.getElementById('det-id').textContent = headerNumber ? `№ ${headerNumber}` : 'Номер не указан';
      document.getElementById('det-title').textContent = activeTender.title || 'Тендер';
      
      const fields = activeTender?.card?.fields || {};
      const pickHref = (labels) => {
        for (const label of labels) {
          const f = fields[label];
          if (!f) continue;
          const direct = safeUrl(f.url || f.value || f.text || '');
          if (direct) return direct;
          const lk = fieldLink(f);
          if (lk?.href) return lk.href;
        }
        return '';
      };
      const eisNumber = String(activeTender.registry?.eis_number || activeTender.card?.fields?.['Реестровый номер ЕИС']?.value || '').trim();
      const eisUrl = pickHref(['Ссылка на закупку в официальном источнике', 'Ссылка на ЕИС или ЭТП', 'Официальная ссылка ЕИС'])
        || safeUrl((activeTender.card?.official_links || [])[0]?.url || '')
        || (eisNumber ? `https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=${encodeURIComponent(eisNumber)}` : '');
      const aggUrl = pickHref(['Ссылка на закупку у агрегатора', 'Ссылка на агрегатор'])
        || safeUrl(activeTender.registry?.aggregator_url || '');
      const sourceLinks = sourceLinkItems(fields);
      const officialLinks = sourceLinks.filter((item) => item.kind === 'official');
      const platformLinks = sourceLinks.filter((item) => item.kind === 'platform_api');
      if (eisUrl && !officialLinks.some((item) => item.href === eisUrl)) officialLinks.unshift({href: eisUrl, kind: 'official', text: eisNumber ? 'ЕИС' : 'Официальный источник'});
      
      const eisLink = document.getElementById('det-link-eis');
      const officialExtra = document.getElementById('det-link-official-extra');
      const aggLink = document.getElementById('det-link-agg');
      const dropdownBtn = document.getElementById('source-dropdown-btn');
      
      if (eisLink && aggLink) {
        let hasLinks = false;
        const firstOfficial = officialLinks[0];
        if (firstOfficial) { eisLink.href = firstOfficial.href; eisLink.querySelector('span').textContent = firstOfficial.text; eisLink.style.display = 'flex'; hasLinks = true; } else { eisLink.style.display = 'none'; }
        const extraLinks = [...officialLinks.slice(1), ...platformLinks];
        if (officialExtra) officialExtra.innerHTML = extraLinks.map((item) => `<a class="source-dropdown-item" href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(item.text)}</span></a>`).join('');
        if (extraLinks.length) hasLinks = true;
        if (aggUrl) {
          aggLink.href = aggUrl;
          aggLink.querySelector('span').textContent = `Агрегатор (${new URL(aggUrl).hostname.replace(/^www\./i, '')})`;
          aggLink.style.display = 'flex';
          hasLinks = true;
        } else { aggLink.style.display = 'none'; }
        
        const noMsg = document.getElementById('no-links-msg');
        if (noMsg) noMsg.style.display = hasLinks ? 'none' : 'block';
        // We do NOT hide dropdownWrap itself, because the button is always visible
        
      }

      document.getElementById('det-price').textContent = formatNmck(registryNmck(activeTender) ?? display('НМЦК'));
      document.getElementById('det-law').textContent = `Закон: ${display('Закон')}`;
      const deadlineExpiredNow = isDeadlineExpired(activeTender);
      document.getElementById('det-stage').textContent = deadlineExpiredNow ? 'Архив по сроку подачи' : cleanStageStr(display('Этап работы'));
      const rostenderDate = activeTender._ui_submission_deadline_label || activeTender.card?.deadlines?.application_end_date || activeTender.card?.deadline_at_raw || display('Срок подачи');
      const cleanDate = String(rostenderDate || '').replace(/^РосТендер:\s*/, '').trim();
      const formattedDate = formatDateDdMmYyyy(cleanDate) || cleanDate || 'Срок не указан';
      document.getElementById('det-end-date').textContent = `Срок: ${formattedDate}`;

      document.getElementById('det-assurance').textContent = display('Обеспечение заявки');
      document.getElementById('det-etp').textContent = `Источник: ${display('Наименование ЭТП или портала')}`;
      const officialDeadline = officialRegistryDeadline(activeTender.registry);
      const archivedByOfficialDeadline = isArchivedByDeadline(activeTender);
      document.getElementById('det-risk-status').textContent = archivedByOfficialDeadline ? 'Архив' : officialDeadline ? 'Живая проверка' : 'Проверка не подтверждена';
      const lineCount = groupedTenderLines(activeTender.card?.tender_lines || []).length;
      const documentCount = documentCache.has(key) ? activeDocuments.length : '—';
      document.getElementById('det-card-counts').textContent = `${lineCount} строк · ${documentCount} документов`;
      
      fetchActiveEarnings(key, { force: true });

      updateWarningAction();
      updateContradictionAction();
      if (core()) renderWarningDialog();
      const demoParams = new URLSearchParams(location.search);
      const requestedTab = demoParams.get('tab');
      if (initialSelection && requestedTab && document.querySelector(`[data-detail-tab="${CSS.escape(requestedTab)}"]`)) {
        activeTab = requestedTab;
      }
      document.querySelectorAll('[data-detail-tab], [data-tab]').forEach((button) => {
        const isSel = (button.dataset.detailTab || button.dataset.tab) === activeTab;
        button.setAttribute('aria-selected', isSel ? 'true' : 'false');
        button.classList.toggle('active', isSel);
      });
      renderDetailTab();
      if (changedTender || !offersRefresh.has(key)) requestOffersRefresh(key);
      const expandLine = demoParams.get('expand');
      if (activeTab === 'products' && expandLine) {
        const expandButton = document.querySelector(`[data-line-toggle="${CSS.escape(expandLine)}"]`);
        if (expandButton && expandButton.getAttribute('aria-expanded') !== 'true') expandButton.click();
      }
      if (window.matchMedia('(max-width: 700px)').matches) {
        document.querySelector('.app-workspace').classList.add('mobile-detail');
        document.getElementById('det-title').focus({preventScroll:true});
      }
    }

    function approvedFieldLabel(legacyLabel) {
      const coreFields = [
        ...(Array.isArray(core()?.main_fields) ? core().main_fields : []),
        ...(Array.isArray(core()?.technical_fields) ? core().technical_fields : [])
      ];
      const names = [...new Set(coreFields.filter((item) => {
        const definition = item?.field_definition;
        return Array.isArray(definition?.legacy_names) && definition.legacy_names.includes(legacyLabel);
      }).map((item) => String(item?.name || '')).filter(Boolean))];
      return names.length === 1 ? names[0] : legacyLabel;
    }


    const MAIN_DISPLAY_LABELS = {
      'Категория':'Категория','Город':'Город','Email заказчика':'Email заказчика',
      'Контактное лицо заказчика':'Контактное лицо заказчика','Телефон заказчика':'Телефон заказчика',
      'ИНН заказчика':'ИНН заказчика','Наименование заказчика':'Наименование заказчика',
      'Дата окончания подачи заявок':'Дата окончания подачи заявок','Срок окончания подачи':'Срок окончания подачи',
      'Дата публикации':'Дата публикации','Реестровый номер ЕИС':'Реестровый номер ЕИС',
      'Наименование ЭТП':'Наименование ЭТП','Место поставки / выполнения':'Место поставки / выполнения',
      'Способ размещения (процедура)':'Способ размещения (процедура)','Категория размещения':'Категория размещения',
      'Contract':'Проект контракта','Размер обеспечения заявки, ₽':'Размер обеспечения заявки, ₽',
      'Начальная цена (НМЦК)':'Начальная цена (НМЦК)','Регион поставки':'Регион поставки',
      'Закупка только для СМП / СОНО':'Закупка только для СМП / СОНО','Ссылка на источник':'Ссылка на источник'
    };
    const FIELD_FORMAT = {
      'Телефон заказчика': 'phone','Дата окончания подачи заявок': 'dateWithDays','Срок окончания подачи': 'date',
      'Дата публикации': 'date','Реестровый номер ЕИС': 'strip','Наименование ЭТП': 'strip',
      'Начальная цена (НМЦК)': 'nmck','Размер обеспечения заявки, ₽': 'nmck','Ссылка на источник': 'sourceLink'
    };
    const DATE_FIELD_LABELS = new Set([
      'Срок подачи заявок', 'Дата окончания подачи заявок', 'Срок окончания подачи', 'Дата публикации',
      'Дата публикации источника', 'Внутренний срок подачи', 'Резерв времени', 'Срок запроса разъяснений',
      'Дата подведения итогов', 'Срок заключения контракта', 'Период исполнения контракта',
      'Срок поставки партии', 'Плановая дата заказа поставщику', 'Плановая первая поставка',
      'Плановая приёмка', 'Плановая дата оплаты', 'Дата начала поставки', 'Дата окончания поставки',
      'Срок действия контракта', 'Срок доставки поставщика', 'Срок отсрочки', 'Дата обновления источника',
      'Срок оплаты', 'Срок приёмки'
    ]);
    const SYSTEM_NOISE_KEYS = new Set(['commentsAvailable','is_plans','inFavorites','isFavorite','is_favorite','hasBids','hasResults','isActive','isArchived','isCancelled','isElectronic','isJoint','isMultiLot','isSmp','lotCount','planNumber','procedureType','publishDate','sourceId','sourceType','tenderType','updateDate','notes']);
    const cleanSystemNoise = (val) => {
      if (val == null || val === '') return val;
      let str = String(val);
      if (str.startsWith('{') || str.startsWith('[')) {
        try {
          const parsed = JSON.parse(str);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const cleaned = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => !SYSTEM_NOISE_KEYS.has(k) && v !== null && v !== '' && v !== false));
            if (Object.keys(cleaned).length === 0) return '—';
            str = Object.values(cleaned).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).filter(Boolean).join('; ');
          }
        } catch(_) {}
      }
      return str;
    };
    const formatPhone = (val) => {
      if (!val) return val;
      const digits = String(val).replace(/[^0-9]/g, '');
      if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return `+7 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7,9)}-${digits.slice(9,11)}`;
      if (digits.length === 10) return `+7 (${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6,8)}-${digits.slice(8,10)}`;
      return String(val);
    };
    const formatDateDdMmYyyy = (value) => {
      const formatter = typeof formatTenderDate === 'function' ? formatTenderDate : typeof window !== 'undefined' ? window.formatTenderDate : null;
      return formatter ? formatter(value) : String(value ?? '');
    };
    function fieldPresentationText(value, label = '') {
      const text = businessPresentationText(value);
      if (!DATE_FIELD_LABELS.has(label) || value == null || typeof value === 'object') return text;
      return formatDateDdMmYyyy(text);
    }
    const formatDateWithDaysLeft = (val) => {
      const formatted = formatDateDdMmYyyy(val);
      if (!formatted || formatted === '—') return formatted;
      try {
        const str = String(val).trim();
        const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) {
          const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
          const now = new Date();
          now.setHours(0,0,0,0);
          const diff = Math.ceil((target - now) / 86400000);
          if (diff >= 0) {
            const plural = (n) => { const a = Math.abs(n) % 100; const b = a % 10; if (a > 10 && a < 20) return 'дней'; if (b === 1) return 'день'; if (b >= 2 && b <= 4) return 'дня'; return 'дней'; };
            return `${formatted} (${diff} ${plural(diff)})`;
          }
        }
      } catch(_) {}
      return formatted;
    };
    const stripSpaces = (val) => val ? String(val).replace(/\s+/g, '') : val;

    const issueSourceText = (value) => {
      if (Array.isArray(value)) return value.map(issueSourceText).filter(Boolean).join('; ');
      if (!value || typeof value !== 'object') return String(value ?? '');
      return structuredValueText(value);
    };
    const issueEvidenceText = (issue, key) => {
      if (issue?.[key] != null && issue?.[key] !== '') return issue[key];
      const evidence = Array.isArray(issue?.evidence) ? issue.evidence : [issue?.evidence];
      return issueSourceText(evidence.map((item) => item?.[key]).filter((value) => value != null && value !== ''));
    };
    const cardIssueFields = (issue) => ({
      rawOriginal: issue,
      issueId: String(issue?.issue_id ?? ''), kind: String(issue?.kind ?? issue?.type ?? ''),
      exactField: String(issue?.field ?? issue?.field_key ?? issue?.exact_field ?? issue?.exactfield ?? ''),
      semanticCode: String(issue?.semantic_code ?? issue?.semanticCode ?? issue?.field_key ?? ''),
      line: String(issue?.line ?? issue?.line_id ?? issue?.tender_line_id ?? ''), doc: String(issue?.doc ?? issue?.document ?? issue?.document_id ?? ''),
      reason: String(issue?.reason ?? ''), checkedSources: issueSourceText(issue?.sources_checked ?? issue?.checked_sources ?? issue?.checkedSources),
      sourceEvidence: issueEvidenceText(issue, 'source'), quote: issueEvidenceText(issue, 'quote'),
      location: issue?.location ?? issue?.evidence?.location ?? '', edition: issue?.edition ?? issue?.evidence?.edition ?? '',
      date: String(issue?.checked_at ?? issue?.checked_at_utc ?? issue?.date ?? ''), nextAction: String(issue?.next_action ?? issue?.nextAction ?? ''),
      effect: String(issue?.participation_effect ?? issue?.participation_impact ?? issue?.effect ?? ''),
      collectionState: String(issue?.collection_state ?? ''), notes: String(issue?.notes ?? ''),
      verificationStatus: String(issue?.verification_status ?? ''), executionStatus: String(issue?.execution_status ?? ''),
      ourEvidence: issue?.our_evidence ?? issue?.own_evidence ?? null, values: issue?.values ?? null,
      apiValue: issue?.api_value ?? null, documentValue: issue?.document_value ?? null,
      conflicts: issue?.conflicts ?? null,
    });
    const currentCardIssues = () => Array.isArray(activeTender?.card?.issues)
      ? activeTender.card.issues.filter((item) => item && typeof item === 'object') : [];
    const issueMatchesField = (issue, label, item) => {
      const values = [issue.exactField, issue.semanticCode].filter(Boolean).map(String);
      const candidates = [label, item?.field_key, item?.semantic_code, item?.semanticKey, ...(FIELD_ALIASES[label] || [])].filter(Boolean).map(String);
      return values.some((value) => candidates.includes(value));
    };
    const fieldAuditSources = (item) => {
      const observations = Array.isArray(item?.source_observations) ? item.source_observations : [];
      return observations.map((observation) => observation?.source || observation?.evidence?.source).filter(Boolean).map(String).slice(0, 3);
    };

    function fieldSection(group) {
      const labels = FIELD_GROUPS[group] || [];
      const fields = activeTender?.card?.fields || {};
      
      const gridItems = labels.map((label) => {
        const item = field(label, {group});
        const isContractField = group === 'main' && label === 'Contract';
        const contractDocuments = isContractField ? contractManifestList(item) : [];
        
        let rawVal = rawValue(item);
        const isError = rawVal === '' || rawVal == null;
        
        let valHtml = '';
        let fullValStr = '';
        const fmt = group === 'main' ? FIELD_FORMAT[label] : undefined;
        const multipleValues = multipleAddressField(label) ? fieldValueList(item) : [];
        const codeDetails = label === 'Код ОКПД2/КТРУ для вывода' ? codeValueDetails(item) : [];
        const codeValues = codeDetails.map((entry) => entry.text);
        const deliveryValues = fieldValueList(fields['Место поставки / выполнения']);
        const displayMultipleValues = codeValues.length > 1 ? codeValues : (multipleAddressField(label) && deliveryValues.length > 1 ? deliveryValues : multipleValues);
        const sourceLinks = fmt === 'sourceLink' ? sourceLinkItems(fields) : [];
        
        if (isContractField && contractDocuments.length) {
          fullValStr = `${contractDocuments.length} ${contractDocuments.length === 1 ? 'файл' : 'файла'} проекта контракта`;
          valHtml = contractFieldHtml(item);
        } else if (displayMultipleValues.length > 1) {
          fullValStr = displayMultipleValues.map((entry) => typeof entry === 'object' ? entry.text : entry).join('; ');
          const payload = escapeHtml(JSON.stringify({label, values: codeValues.length > 1 ? codeDetails : displayMultipleValues}));
          const multipleLabel = codeValues.length > 1 ? `Несколько кодов (${codeValues.length})` : 'Несколько адресов';
          valHtml = `<button type="button" class="multiple-values-button" data-multiple-field="${payload}" aria-haspopup="dialog" aria-label="${multipleLabel}">${multipleLabel}</button>`;
        } else if (fmt === 'sourceLink') {
          if (sourceLinks.length) {
            fullValStr = sourceLinks.map((link) => link.text).join('; ');
            valHtml = `<div class="field-source-links">${sourceLinks.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.text)}</a>`).join('')}</div>`;
          } else {
            fullValStr = '—';
            valHtml = '—';
          }
        } else if (isError) {
          fullValStr = '—';
          valHtml = `<span style="opacity:0.5">—</span>`;
        } else {
          let valText = String(rawVal);
          if (group === 'main') valText = cleanSystemNoise(valText);
          
          if (fmt === 'phone') valText = formatPhone(valText);
          else if (fmt === 'dateWithDays') valText = formatDateWithDaysLeft(valText);
          else if (fmt === 'date') valText = formatDateDdMmYyyy(valText);
          else if (fmt === 'strip') valText = stripSpaces(valText);
          else if (fmt === 'nmck') valText = formatNmck(valText);
          
          fullValStr = valText;
          if (group !== 'main') {
            valHtml = valueHtml(item, label);
          } else {
            valHtml = escapeHtml(valText);
          }

          if (label === 'Заказчик' || label === 'Наименование заказчика' || approvedFieldLabel(label) === 'Наименование заказчика') {
            const customers = valText.split(/;\s*|\n+/).map((s) => s.trim()).filter(Boolean);
            if (customers.length > 2) {
              valHtml = `<div class="multiple-customers-box" style="display:flex; flex-direction:column; gap:6px; width:100%;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-weight:600; font-size:13px;">Несколько заказчиков</span>
                  <span class="badge" style="font-size:11px; padding:1px 6px; border-radius:10px; background:rgba(255,255,255,0.08);">${customers.length}</span>
                </div>
                <details class="boardui-collapsible" style="margin-top:2px;">
                  <summary class="boardui-btn-xs" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:11px; padding:3px 8px; border-radius:4px; background:var(--bg-muted, rgba(255,255,255,0.08)); border:1px solid var(--border-line, rgba(255,255,255,0.12)); color:var(--text-main, #e5e7eb); outline:none; user-select:none;">
                    <span>Развернуть список заказчиков</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </summary>
                  <div style="margin-top:6px; padding:8px 10px; background:var(--bg-card, #1e293b); border:1px solid var(--border-line, rgba(255,255,255,0.12)); border-radius:6px; max-height:220px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; font-size:11px; line-height:1.4;">
                    ${customers.map((c, i) => `<div style="display:flex; gap:6px;"><span style="opacity:0.5; flex-shrink:0;">${i + 1}.</span><span>${escapeHtml(c)}</span></div>`).join('')}
                  </div>
                </details>
              </div>`;
            }
          }
        }

        if (label === 'Обязательные документы' && !isError) {
          valHtml = `<div class="required-documents-state"><span>Наличие не проверено</span></div>${valHtml}`;
        }
        const displayLabel = (group === 'main' && MAIN_DISPLAY_LABELS[label]) ? MAIN_DISPLAY_LABELS[label] : approvedFieldLabel(label);
        const issueMarkers = currentCardIssues().map(cardIssueFields).filter((issue) => issueMatchesField(issue, label, item));
        const markerHtml = issueMarkers.length ? `<span class="field-issue-marker" title="Есть предупреждение по полю" aria-label="Есть предупреждение по полю">!</span>` : '';
        return `<div class="vercel-overview-label" title="${escapeHtml(displayLabel)}">${escapeHtml(displayLabel)}${markerHtml}</div><div class="vercel-overview-value" title="${escapeHtml(fullValStr)}">${valHtml}</div>`;
      }).join('');

      const downloadFooter = group === 'technical' ? `<div class="technical-tab-footer"><button type="button" class="shadcn-btn-default" onclick="window.downloadTechnicalData()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>Скачать тех. данные</span></button></div>` : '';

      return `<section class="detail-section vercel-overview-wrap"><div class="vercel-overview-grid">${gridItems}</div></section>${downloadFooter}`;
    }


    const ECONOMIC_FACTORS = [
      'Стоимость закупки', 'Прямые расходы', 'Общие расходы', 'НДС',
      'Логистика и накладные', 'Резерв риска', 'Полная себестоимость',
      'Предельная цена участия', 'Плановая цена заявки', 'Прибыль', 'Маржа',
      'Демпинг', 'Кассовый разрыв', 'Потребность в финансировании', 'Аванс', 'Аванс, %',
      'Сумма аванса', 'Срок и порядок оплаты', 'Срок оплаты', 'Вид дней срока оплаты', 'Этапы оплаты',
      'Основание оплаты', 'Отсрочка оплаты', 'Обеспечение заявки, %',
      'База расчёта обеспечения заявки', 'Обеспечение исполнения, %',
      'База расчёта обеспечения исполнения', 'Сумма повышенного антидемпингового обеспечения'
    ];
    const EXPENSE_FACTORS = new Set(['Прямые расходы', 'Общие расходы', 'НДС', 'Логистика и накладные', 'Резерв риска']);
    const parseNumber = (value) => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value !== 'string') return null;
      const normalized = value.replace(/\s/g, '').replace(/₽|руб\.?/gi, '').replace(',', '.');
      if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
      const number = Number(normalized);
      return Number.isFinite(number) ? number : null;
    };
    const moneyFixed = (value) => value == null ? 'Не рассчитано' : new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(value);
    const percentageFixed = (value) => value == null ? 'Не рассчитано' : `${moneyFixed(value)} %`;
    const marginClass = (value) => typeof value === 'number' && Number.isFinite(value) && value < 0 ? ' margin-negative' : '';
    const positivePrice = (offer) => {
      const value = offerPriceNumber(offer);
      return value != null && value > 0 ? value : null;
    };
    const formatPriceDate = (value) => formatDateDdMmYyyy(value || '');
    function orderedOffersForLine(line, offers, options = {}) {
      const targetIds = new Set((line?.source_line_ids || [line?.line_id || line?.id]).filter(Boolean).map(String));
      const targetGroup = String(line?.product_group_id || '').trim();
      const fitRank = (offer) => /^(CONFIRMED|COMPATIBLE|СООТВЕТСТВУЕТ|ПОДТВЕРЖДЕН)/i.test(String(offer?.fit_status || offer?.volume_status || '')) ? 0 : 1;
      const stableRank = (offer) => Number(offer?.stable_rank ?? offer?.candidate_rank ?? offer?.rank);
      const ordered = (offers || []).map((offer, index) => ({offer, index})).filter(({offer}) => {
        return targetIds.has(String(offer?.line_id || offer?.tender_line_id || '')) || (targetGroup && String(offer?.product_group_id || '') === targetGroup);
      }).sort((left, right) => {
        const leftRank = stableRank(left.offer), rightRank = stableRank(right.offer);
        if (Number.isFinite(leftRank) && Number.isFinite(rightRank) && leftRank !== rightRank) return leftRank - rightRank;
        if (Number.isFinite(leftRank) !== Number.isFinite(rightRank)) return Number.isFinite(leftRank) ? -1 : 1;
        const rightScore = Number(right.offer?.match_score ?? right.offer?.score);
        const leftScore = Number(left.offer?.match_score ?? left.offer?.score);
        const score = (Number.isFinite(rightScore) ? rightScore : Number.NEGATIVE_INFINITY)
          - (Number.isFinite(leftScore) ? leftScore : Number.NEGATIVE_INFINITY);
        if (score) return score;
        const leftPrice = offerPriceNumber(left.offer);
        const rightPrice = offerPriceNumber(right.offer);
        const leftHasPrice = leftPrice != null && Number.isFinite(leftPrice) && leftPrice > 0;
        const rightHasPrice = rightPrice != null && Number.isFinite(rightPrice) && rightPrice > 0;
        if (leftHasPrice && rightHasPrice && leftPrice !== rightPrice) {
          return leftPrice - rightPrice;
        }
        if (leftHasPrice !== rightHasPrice) return leftHasPrice ? -1 : 1;
        return left.index - right.index;
      });
      if (!options.uniqueByRegistry) return ordered;
      const seenRegistryIds = new Set();
      return ordered.filter(({offer}) => {
        const registryId = offer?.price_registry_id;
        if (registryId == null || String(registryId).trim() === '') return true;
        const key = String(registryId);
        if (seenRegistryIds.has(key)) return false;
        seenRegistryIds.add(key);
        return true;
      });
    }
    const candidateIdentity = (value) => value && typeof value === 'object'
      ? (value.offer_id ?? value.candidate_id ?? value.price_registry_id ?? value.supplier_offer_id ?? value.product_id ?? value.id)
      : value;
    function selectOfferForLine(line, offers) {
      const ordered = orderedOffersForLine(line, offers);
      const selection = line?.candidate_selection || line?.selection || {};
      const calculationComparable = (offer) => {
        return priceComparisonConfirmed(offer)
          && packageComparable(offer) && unitComparable(line, offer);
      };
      const offerById = (ids) => {
        const wanted = ids.map(candidateIdentity).filter((value) => value != null).map(String);
        return ordered.find(({offer}) => wanted.includes(String(offer?.offer_id ?? offer?.candidate_id ?? offer?.price_registry_id ?? offer?.supplier_offer_id ?? offer?.product_id ?? offer?.id ?? '')));
      };
      const manual = offerById([
        line?.selected_offer_id, line?.selected_candidate_id,
        selection?.selected_offer_id, selection?.selected_candidate_id, selection?.selected_price_registry_id,
      ]);
      if (manual?.offer) return manual.offer;
      const cheapest = offerById([
        selection?.cheapest_price_registry_id, selection?.cheapest_id, selection?.cheapest,
      ]);
      if (cheapest?.offer && positivePrice(cheapest.offer) != null && calculationComparable(cheapest.offer)) return cheapest.offer;
      const mostSimilar = offerById([
        selection?.most_similar_price_registry_id, selection?.most_similar_id, selection?.most_similar,
      ]);
      if (mostSimilar?.offer && positivePrice(mostSimilar.offer) != null && calculationComparable(mostSimilar.offer)) return mostSimilar.offer;
      const flagged = ordered.find(({offer}) => offer?.selected === true || offer?.is_selected === true || offer?.selection_role === 'selected');
      const comparable = ordered.find(({offer}) => positivePrice(offer) != null && calculationComparable(offer));
      if (flagged?.offer && positivePrice(flagged.offer) != null && calculationComparable(flagged.offer)) return flagged.offer;
      if (comparable?.offer) return comparable.offer;
      return cheapest?.offer && positivePrice(cheapest.offer) != null ? cheapest.offer : (ordered[0]?.offer && positivePrice(ordered[0].offer) != null ? ordered[0].offer : (mostSimilar?.offer && positivePrice(mostSimilar.offer) != null ? mostSimilar.offer : (flagged?.offer && positivePrice(flagged.offer) != null ? flagged.offer : ordered.find(({offer}) => positivePrice(offer) != null)?.offer || null)));
    }
    function packageComparable(offer) {
      const status = String(offer?.volume_status || '').trim().toLocaleLowerCase('ru-RU');
      return /^(подтвержден[аоы]?|соответствует|confirmed|compatible)$/.test(status);
    }
    function unitComparable(line, offer) {
      const price = offer?.price_info && typeof offer.price_info === 'object' ? offer.price_info : (offer?.price && typeof offer.price === 'object' ? offer.price : {});
      const tenderUnit = String(line?.unit || '').trim().toLocaleLowerCase('ru-RU');
      const offerUnitValue = String(price.normalized_unit || price.unit || offer?.unit || offer?.unit_name || '').trim().toLocaleLowerCase('ru-RU');
      return Boolean(tenderUnit && offerUnitValue && tenderUnit === offerUnitValue);
    }
    function priceComparisonConfirmed(offer) {
      const price = offer?.price_info && typeof offer.price_info === 'object' ? offer.price_info : (offer?.price && typeof offer.price === 'object' ? offer.price : {});
      const conflictFlags = [offer?.has_explicit_conflict, price.has_explicit_conflict, price.conflict, offer?.conflict];
      return price.comparison_allowed === true
        && conflictFlags.some((value) => value === false)
        && !conflictFlags.some((value) => value === true);
    }
    function lineCalculation(line, offers) {
      const selected = selectOfferForLine(line, offers);
      const customerPrice = parseNumber(line?.unit_price);
      const purchasePrice = positivePrice(selected);
      const quantity = parseNumber(line?.quantity);
      const unit = String(line?.unit || '').trim();
      const unitMargin = customerPrice != null && purchasePrice != null ? customerPrice - purchasePrice : null;
      const marginPercent = unitMargin != null && customerPrice !== 0 ? unitMargin / customerPrice * 100 : null;
      const missing = [];
      if (purchasePrice == null) missing.push('выбранное сопоставление с ценой');
      if (quantity == null) missing.push('количество');
      if (!unit) missing.push('единица измерения');
      if (!packageComparable(selected)) missing.push('сопоставимость фасовки');
      const comparisonAllowed = priceComparisonConfirmed(selected) && unitComparable(line, selected);
      if (!comparisonAllowed) missing.push('подтверждённое сравнение цены');
      return {selected, customerPrice, purchasePrice, quantity, unit, unitMargin: comparisonAllowed ? unitMargin : null, marginPercent: comparisonAllowed ? marginPercent : null, comparisonAllowed, costReady: !missing.length, missing};
    }
    function economicsCalculation(card) {
      const lines = groupedTenderLines(card?.tender_lines || []);
      const offers = card?.supplier_offers || [];
      const calculations = lines.map((line) => ({line, ...lineCalculation(line, offers)}));
      const goodsReady = calculations.length > 0 && calculations.every((item) => item.costReady);
      const goodsCost = goodsReady ? calculations.reduce((sum, item) => sum + item.quantity * item.purchasePrice, 0) : null;
      const expenses = {};
      for (const label of EXPENSE_FACTORS) {
        const source = field(label);
        const value = parseNumber(scalarFieldValue(source));
        expenses[label] = value == null ? {value: 0, included: false, source} : {value, included: true, source};
      }
      const expenseTotal = Object.values(expenses).reduce((sum, item) => sum + item.value, 0);
      const fullCost = goodsCost == null ? null : goodsCost + expenseTotal;
      const revenueReady = calculations.length > 0 && calculations.every((item) => item.quantity != null && item.quantity > 0 && item.customerPrice != null);
      const revenue = revenueReady ? calculations.reduce((sum, item) => sum + item.quantity * item.customerPrice, 0) : null;
      const profit = fullCost != null && revenue != null ? revenue - fullCost : null;
      const marginPercent = profit != null && revenue !== 0 ? profit / revenue * 100 : null;
      return {calculations, goodsCost, expenses, fullCost, revenue, profit, marginPercent};
    }
    function economicsHtml() {
      const card = activeTender?.card || {};
      const economics = card.economics || {state:'NOT_CALCULATED', calculation_blockers:['Серверный расчёт не передан.']};
      const fields = card.fields || {};
      const rows = ECONOMIC_FACTORS.map((label) => {
        const item = field(label);
        const isPurchase = label === 'Стоимость закупки';
        const value = isPurchase ? 'Не рассчитано' : valueHtml(item, label).replace(/^—$/, 'Не рассчитано');
        const statusRaw = isPurchase ? (economics.state === 'NOT_CALCULATED' ? 'Не рассчитано' : economics.state) : (item.status || 'Нет подтверждения');
        const status = coreStatus(statusRaw);
        const source = isPurchase ? (economics.calculation_blockers?.[0] || '') : humanSource(item.source);
        const isNum = /[0-9₽%]/.test(String(value)) && !String(value).includes('<a');
        return `<tr><td style="font-weight:500;color:#f4f4f5;">${escapeHtml(label)}</td><td class="cell-number ${isNum ? 'tabular-nums' : ''}">${value}</td><td class="cell-status">${escapeHtml(status)}</td><td class="cell-source" title="${escapeHtml(source)}">${escapeHtml(source)}</td></tr>`;
      }).join('');
      const selectionRows = groupedTenderLines(card.tender_lines || []).map((line, index) => {
        const details = candidateSelectionHtml(line);
        return details ? `<div class="economics-selection-row"><strong>${escapeHtml(line?.name || `Строка ${index + 1}`)}</strong>${details}</div>` : '';
      }).filter(Boolean).join('');
      const selectionSection = selectionRows ? `<section class="detail-section"><div class="section-heading"><h3>Роли сохранённого отбора</h3></div>${selectionRows}</section>` : '';
      const paymentCaption = '<div class="economics-added-caption"><span>Условия оплаты и цена</span></div>';
      return `${paymentCaption}${selectionSection}<section class="detail-section"><div class="table-wrap"><table class="data-table economics-factors-table"><colgroup><col style="width:30%"><col style="width:160px"><col style="width:170px"><col></colgroup><thead><tr><th>Фактор</th><th class="cell-number">Значение</th><th>Статус</th><th>Источник</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }

    function formatQuantity(value) {
      const raw = String(value ?? '').trim();
      if (!raw) return '—';
      const number = Number(raw.replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(number)) return raw || '—';
      return new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 3}).format(number);
    }
    function formatUnit(value) {
      const raw = String(value ?? '').trim();
      return raw.replace(/^м\s*\[\s*3\\?\s*\*\s*\]$/i, 'м³*').replace(/^м\s*\[\s*2\\?\s*\]$/i, 'м²');
    }

    function groupedTenderLines(lines) {
      const result = [];
      const groups = new Map();
      (Array.isArray(lines) ? lines : []).forEach((line) => {
        if (!line || typeof line !== 'object') return;
        const groupId = String(line.product_group_id || '').trim();
        if (!groupId) { result.push(line); return; }
        let group = groups.get(groupId);
        if (!group) {
          group = {...line, line_id: groupId, source_line_ids: [], _group_lines: []};
          groups.set(groupId, group);
          result.push(group);
        }
        group.source_line_ids.push(line.line_id ?? line.id ?? groupId);
        group._group_lines.push(line);
      });
      for (const group of result.filter((line) => Array.isArray(line._group_lines))) {
        const source = group._group_lines;
        const quantities = source.map((line) => parseNumber(line.quantity));
        if (quantities.every((value) => value != null)) group.quantity = quantities.reduce((sum, value) => sum + value, 0);
        const prices = source.map((line) => line.unit_price).filter((value) => parseNumber(value) != null);
        const distinctPrices = [...new Set(prices.map((value) => String(value).replace(/\s/g, '').replace(',', '.')))];
        group.unit_price = distinctPrices.length <= 1 ? (prices[0] ?? null) : null;
        const amounts = source.map((line) => parseNumber(line.amount));
        if (amounts.every((value) => value != null)) group.amount = amounts.reduce((sum, value) => sum + value, 0);
        const priceSources = source.map((line) => ({
          line_id: line.line_id ?? line.id,
          source: line?.field_sources?.unit_price,
        })).filter((item) => item.source != null && item.source !== '');
        if (priceSources.length) {
          const distinctSources = [...new Set(priceSources.map((item) => JSON.stringify(item.source)))];
          group.field_sources = {
            ...(group.field_sources || {}),
            unit_price: distinctSources.length === 1 ? priceSources[0].source : priceSources,
          };
        }
        group.name = group.product_group_name || source[0].name || 'Товар';
        delete group._group_lines;
      }
      return result;
    }

    function normalizedRequirementQuote(value) {
      if (value == null || value === '') return '';
      const clean = (item) => String(item ?? '')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/\*\*(.*?)\*\*/gs, '$1')
        .replace(/<\/?(?:strong|b)>/gi, '')
        .replace(/\\\|/g, '|')
        .replace(/[ \t]+/g, ' ')
        .trim();
      const splitRow = (row) => {
        const cells = []; let cell = '';
        for (let i = 0; i < row.length; i += 1) {
          if (row[i] === '\\' && row[i + 1] === '|') { cell += '|'; i += 1; }
          else if (row[i] === '|') { cells.push(clean(cell)); cell = ''; }
          else cell += row[i];
        }
        cells.push(clean(cell));
        if (row.trim().startsWith('|')) cells.shift();
        if (row.trim().endsWith('|') && cells.length) cells.pop();
        return cells;
      };
      const hasPipe = (row) => /(^|[^\\])\|/.test(row);
      const isEmpty = (cells) => !cells.some(Boolean);
      const isSeparator = (cells) => cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      const isServiceRow = (cells) => cells.filter(Boolean).every((cell) => /^(?:№|п\/?п)$/i.test(cell));
      const lines = String(typeof value === 'object' ? businessPresentationText(value) : value)
        .replace(/\r\n?/g, '\n').split('\n');
      const isHeaderCandidate = (index) => {
        const row = splitRow(lines[index] || '');
        const previous = index > 0 ? splitRow(lines[index - 1]) : [];
        const next = index + 1 < lines.length ? splitRow(lines[index + 1]) : [];
        return row.length > 1 && row.filter(Boolean).length > 1 && (isSeparator(previous) || isSeparator(next));
      };
      const output = [];
      for (let i = 0; i < lines.length;) {
        const row = lines[i];
        const cells = splitRow(row);
        if (isHeaderCandidate(i)) {
          const headers = cells;
          const serviceColumns = new Set(headers.map((header, index) => /^(?:№|п\/?п)$/i.test(header) ? index : -1).filter((index) => index >= 0));
          let j = i + 1;
          if (isSeparator(splitRow(lines[j] || ''))) j += 1;
          while (j < lines.length && (!lines[j].trim() || isServiceRow(splitRow(lines[j])) || isSeparator(splitRow(lines[j])))) j += 1;
          let dataRows = 0;
          for (; j < lines.length; j += 1) {
            if (!lines[j].trim() || isEmpty(splitRow(lines[j])) || isSeparator(splitRow(lines[j]))) continue;
            if (!hasPipe(lines[j])) break;
            if (j > i + 1 && isSeparator(splitRow(lines[j + 1] || ''))) break;
            const data = splitRow(lines[j]);
            if (data.length < 2) break;
            const pairs = data.map((item, index) => {
              if (!item || serviceColumns.has(index)) return '';
              const header = clean(headers[index] || '');
              return header ? `${header}: ${item}` : item;
            }).filter(Boolean);
            if (pairs.length) { output.push(pairs.join('\n\n')); dataRows += 1; }
          }
          if (!dataRows) output.push(headers.filter((header, index) => header && !serviceColumns.has(index)).join(' · '));
          i = j;
          continue;
        }
        if (isSeparator(cells) || isEmpty(cells) || isServiceRow(cells)) { i += 1; continue; }
        const pipeCount = (row.match(/(^|[^\\])\|/g) || []).length;
        const edgePipes = row.trim().startsWith('|') || row.trim().endsWith('|');
        const legacyPipeRow = /^\s*\d+(?:[.)])?\s*\|/.test(row);
        output.push(pipeCount >= 2 && (edgePipes || legacyPipeRow) ? cells.filter(Boolean).join(' · ') : clean(row));
        i += 1;
      }
      return output.filter(Boolean).join('\n');
    }

    function lineRequirementsDialogText(line) {
      const characteristics = line?.characteristics ?? line?.search_features;
      const hasCharacteristics = characteristics != null && characteristics !== '' && (!Array.isArray(characteristics) || characteristics.length > 0);
      const requirement = line?.search_name || line?.name || '';
      const conditions = line?.conditions ?? line?.requirements ?? line?.acceptance_conditions ?? line?.delivery_conditions ?? '';
      const quote = line?.quote || '';
      const note = line?.ambiguity_reason || (Array.isArray(line?._issues) ? line._issues.map((item) => item?.reason).filter(Boolean).join('; ') : '');
      return [
        `Сохранённое требование: ${requirement || 'Не передано'}`,
        `Единица / количество: ${formatUnit(line?.unit)} · ${formatQuantity(line?.quantity)}${formatUnit(line?.unit) !== String(line?.unit || '') ? ` (исходно: ${line?.unit})` : ''}`,
        `Характеристики: ${hasCharacteristics ? normalizedRequirementQuote(characteristics) : 'Не переданы в сохранённой строке'}`,
        conditions ? `Условия: ${normalizedRequirementQuote(conditions)}` : '',
        quote ? `Требования из документа: ${normalizedRequirementQuote(quote)}` : '',
        note ? `Замечание: ${normalizedRequirementQuote(note)}` : '',
      ].filter(Boolean).join('\n');
    }
    function lineRequirementsHtml(line) {
      const text = lineRequirementsDialogText(line);
      return `<button class="product-detail-btn product-requirements-btn" type="button" data-match-title="Подробности требований" data-match-explanation="${escapeHtml(text)}" title="Подробности требований" aria-label="Подробности требований" aria-haspopup="dialog">?</button>`;
    }

    function selectionEntriesForLine(line, directSelection) {
      const selectionMap = activeTender?.card?.candidate_selection || {};
      const ids = [...new Set([...(Array.isArray(line?.source_line_ids) ? line.source_line_ids : []), line?.line_id, line?.id].filter(Boolean).map(String))];
      const entries = ids.map(lineId => ({lineId, selection: selectionMap[lineId]})).filter(item => item.selection && typeof item.selection === 'object' && Object.keys(item.selection).length);
      if (entries.length) return entries;
      return directSelection && typeof directSelection === 'object' && Object.keys(directSelection).length
        ? [{lineId: String(line?.line_id || line?.id || 'Строка'), selection: directSelection}]
        : [];
    }

    function candidateSelectionDialogText(line, directSelection) {
      const entries = selectionEntriesForLine(line, directSelection);
      if (!entries.length) return 'Отбор не сохранён\nСохранённый выбор кандидата в карточке не передан.';
      const value = (item) => item == null || item === '' ? 'Не определён' : String(item);
      const status = (item) => humanStatus(item);
      const sourceLines = Array.isArray(activeTender?.card?.tender_lines) ? activeTender.card.tender_lines : [];
      const sourceLineName = (lineId) => sourceLines.find((sourceLine) => [sourceLine?.line_id, sourceLine?.id].filter(Boolean).map(String).includes(String(lineId)))?.name || 'Исходная строка';
      const offers = Array.isArray(activeTender?.card?.supplier_offers) ? activeTender.card.supplier_offers : [];
      const candidateName = (selection, keys) => {
        const id = keys.map((key) => selection?.[key]).find((item) => item != null && item !== '');
        if (id == null) return 'Не определён';
        const match = orderedOffersForLine(line, offers).find(({offer}) => String(candidateIdentity(offer)) === String(candidateIdentity(id)))?.offer;
        return match ? [match.product_name || match.name, match.supplier || match.supplier_name].filter(Boolean).join(' · ') || 'Не определён' : 'Не определён';
      };
      const sameFacts = entries.length > 1 && entries.every(item => JSON.stringify(item.selection) === JSON.stringify(entries[0].selection));
      const renderRows = (selection) => [
        ['Наиболее похожий кандидат', candidateName(selection, ['most_similar_price_registry_id', 'most_similar_id', 'most_similar'])],
        ['Минимальная сопоставимая цена среди лучших 20', candidateName(selection, ['cheapest_price_registry_id', 'cheapest_id', 'cheapest'])],
        ['Минимальная цена с НДС', selection.cheapest_price_with_vat ? `${money(selection.cheapest_price_with_vat)} ₽` : null],
        ['Основание минимальной цены', selection.cheapest_price_source],
        ['Единица сравнения', selection.comparison_unit],
        ['Сопоставимых цен', selection.price_comparable_count],
        ['Цен без подтверждённого сравнения', selection.price_uncompared_count],
        ['Предварительный статус', status(selection.status)],
        ['Основание', selection.reason],
      ].filter(([, item]) => item !== '' && item != null).map(([label, item]) => `${label}: ${value(item)}`).join('\n');
      const renderScope = (entry) => `Строка ТЗ: ${sourceLineName(entry.lineId)}\n${renderRows(entry.selection)}`;
      const content = sameFacts
        ? `Область отбора: ${entries.length} исходные строки\n${renderRows(entries[0].selection)}`
        : entries.map(renderScope).join('\n');
      return content;
    }
    function candidateSelectionHtml(line, directSelection) {
      const text = candidateSelectionDialogText(line, directSelection);
      return `<button class="product-detail-btn" type="button" data-match-title="Отбор кандидата" data-match-explanation="${escapeHtml(text)}" title="Отбор кандидата" aria-label="Отбор кандидата" aria-haspopup="dialog">!</button>`;
    }

    function productsHtml() {
      const sourceLines = activeTender?.card?.tender_lines || [];
      const lines = groupedTenderLines(sourceLines);
      const offers = activeTender?.card?.supplier_offers || [];
      if (!lines.length) return '<section class="detail-section"><div class="empty-state">Строки технического задания не переданы</div></section>';
      const visibleMatches = lines.map((line) => orderedOffersForLine(line, offers, {uniqueByRegistry: true}).slice(0, 20));
      
      const rows = lines.map((line, index) => {
        const currentLineId = String(line.line_id || line.id || ('line-' + (index + 1)));
        line.line_id = currentLineId;
        
        const matched = visibleMatches[index];
        const calc = lineCalculation(line, offers);
        const toggle = matched.length ? `<button class="line-toggle" type="button" data-line-toggle="${escapeHtml(currentLineId)}" onclick="window.toggleLineMatchesRow(this, event)" aria-expanded="${expandedLineId === currentLineId ? 'true' : 'false'}"><svg class="icon-collapsed" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><svg class="icon-expanded" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>` : '<button class="line-toggle" type="button" disabled><svg class="icon-collapsed" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>';
        const lineActions = `<div class="product-line-actions">${toggle}</div>`;
        const bestScore = matched.length ? Math.max(...matched.map(({offer}) => Number(offer.match_score)).filter(Number.isFinite)) : null;

        const offerRow = ({offer}, offerIndex, hidden = false) => {
          const isBest = offerIndex === 0;
          const lineContext = [
            line?.unit_price == null || line?.unit_price === '' ? '' : `Цена заказчика: ${money(line.unit_price)} ₽`,
            line?.quantity == null || line?.quantity === '' ? '' : `Количество заказчика: ${formatQuantity(line.quantity)} ${line?.unit || ''}`.trim(),
          ].filter(Boolean).join('\n');
          const explText = [formatMatchExplanation(offer, line), lineContext].filter(Boolean).join('\n');
          const infoSvg = `<button class="match-info-btn" type="button" data-match-explanation="${escapeHtml(explText)}" title="Показать пояснение сопоставления" aria-label="Показать пояснение сопоставления" aria-haspopup="dialog"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>`;
          const dot = isBest ? '<div style="width:8px;height:8px;border-radius:50%;background:#10b981;margin:0 auto;" title="Лучшее сопоставление (Топ-1)"></div>' : '';
          const supplierOkpd2 = String(offer?.okpd2_code || offer?.okpd2 || '').trim();
          const okpd2Text = (!supplierOkpd2 || /^(?:не\s*определено|не\s*указано|н\/?д|null|none|undefined)$/i.test(supplierOkpd2)) ? 'Н/Д' : supplierOkpd2;
          const rawArticle = String(offer?.article ?? '').trim();
          const isArticleUnknown = !rawArticle || /^(?:не\s*определено|не\s*указано|н\/?д|null|none|undefined)$/i.test(rawArticle);
          const articleText = isArticleUnknown ? 'Н/Д' : rawArticle;
          return `<tr class="${isBest ? 'best-score' : ''}${hidden ? ' match-extra' : ''}"${hidden ? ' hidden' : ''}><td class="cell-center">${dot}</td><td class="cell-center" title="Стабильный ранг кандидата">${offerIndex + 1}</td><td title="${escapeHtml(offer.product_name)}"><div style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(offer.product_name || '—')}</div><div style="font-size:10px;color:var(--text-muted,#8d9ba8);overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(offer.supplier)}">${escapeHtml(offer.supplier || '')}</div></td><td title="${escapeHtml(formatUnit(offerUnit(offer, line)))}">${escapeHtml(formatUnit(offerUnit(offer, line)))}</td><td title="${escapeHtml(okpd2Text)}">${escapeHtml(okpd2Text)}</td><td style="text-align:left;" title="${escapeHtml(articleText)}">${escapeHtml(articleText)}</td><td class="cell-number">${escapeHtml(offerDisplayPrice(offer, line))}</td><td></td><td class="cell-number">${escapeHtml(offer.match_score || '—')}</td><td class="cell-center">${infoSvg}</td></tr>`;
        };

        let matches = '';
        if (matched.length && expandedLineId === currentLineId) {
          const visibleOffers = matched.slice(0, 5).map((item, offerIndex) => offerRow(item, offerIndex)).join('');
          const extraOffers = matched.slice(5).map((item, offerIndex) => offerRow(item, offerIndex + 5, true)).join('');
          const moreButton = matched.length > 5 ? `<tr class="match-more-row"><td colspan="10"><button type="button" class="matches-more" data-show-more="${escapeHtml(currentLineId)}" aria-expanded="false">Показать еще...</button></td></tr>` : '';
          matches = `<tr class="matches-row" data-matches-row="${escapeHtml(currentLineId)}"><td class="matches-cell" colspan="10"><table class="nested-table"><colgroup><col style="width:5%"><col style="width:3.8%"><col style="width:calc(41.2% - 120px)"><col style="width:5%"><col style="width:9%"><col style="width:6%"><col style="width:120px"><col style="width:8%"><col style="width:11%"><col style="width:11%"></colgroup><thead><tr><th></th><th>Ранг</th><th>Номенклатура</th><th>ед. изм.</th><th>ОКПД2</th><th style="text-align:left;">Артикул</th><th>Цена, ₽</th><th></th><th>Оценка</th><th>Пояснение</th></tr></thead><tbody>${visibleOffers}${extraOffers}${moreButton}</tbody></table></td></tr>`;
        }

        const sourceLineIds = Array.isArray(line.source_line_ids) && line.source_line_ids.length
          ? line.source_line_ids.map(id => String(id))
          : [currentLineId];

        const hasEarnings = Boolean(
          activeEarnings &&
          String(activeEarnings.tender_id) === String(activeTenderId) &&
          Array.isArray(activeEarnings.lines)
        );

        let unitMarginNum = null;
        let marginPctNum = null;
        let marginTitle = '';

        if (hasEarnings) {
          const matchedMargins = [];
          let allKnown = true;

          for (const sid of sourceLineIds) {
            const el = activeEarnings.lines.find(l => String(l.line_id) === sid);
            if (!el || el.unit_margin == null || el.unit_margin === '') {
              allKnown = false;
              break;
            }
            const val = Number(el.unit_margin);
            if (!Number.isFinite(val)) {
              allKnown = false;
              break;
            }
            matchedMargins.push(val);
          }

          if (!allKnown) {
            if (sourceLineIds.length > 1) {
              marginTitle = 'Маржа не рассчитана: не для всех исходных строк группы известны серверные данные';
            }
          } else {
            const distinctMargins = [...new Set(matchedMargins)];
            if (distinctMargins.length === 1) {
              unitMarginNum = distinctMargins[0];
              if (line.unit_price != null && Number(line.unit_price)) {
                marginPctNum = unitMarginNum / Number(line.unit_price) * 100;
              }
            } else {
              marginTitle = `Разная маржа в исходных строках группы (${distinctMargins.map(m => money(m) + ' ₽').join(', ')})`;
            }
          }
        }

        const marginRubVal = unitMarginNum != null ? escapeHtml(money(unitMarginNum)) : '—';
        const marginPctVal = marginPctNum != null ? escapeHtml(percentageFixed(marginPctNum)) : '—';
        const marginRubText = unitMarginNum != null && unitMarginNum < 0 ? `<span style="color:var(--accent-red,#ef4444);font-weight:600;">${marginRubVal}</span>` : marginRubVal;
        const marginPctText = marginPctNum != null && marginPctNum < 0 ? `<span style="color:var(--accent-red,#ef4444);font-weight:600;">${marginPctVal}</span>` : marginPctVal;
        const marginTitleAttr = marginTitle ? ` title="${escapeHtml(marginTitle)}"` : '';

        return `<tr class="${matched.length ? '' : 'unmatched-line'}"><td class="cell-center">${lineActions}</td><td class="cell-center">${escapeHtml(line.line_number || index + 1)}</td><td title="${escapeHtml(line.name)}">${escapeHtml(line.name || '—')}</td><td>${escapeHtml(formatUnit(line.unit || '—'))}</td><td title="${escapeHtml(line.okpd2 || '')}">${escapeHtml(line.okpd2 || '—')}</td><td class="cell-number">${escapeHtml(formatQuantity(line.quantity))}</td><td class="cell-number">${escapeHtml(money(line.unit_price))}</td><td class="cell-number"${marginTitleAttr}>${marginRubText}</td><td class="cell-number"${marginTitleAttr}>${marginPctText}</td><td class="cell-center product-requirements-cell">${lineRequirementsHtml(line)}</td></tr>${matches}`;
      }).join('');

      return `<section class="detail-section products-section"><div class="table-wrap products-table-wrap"><table class="data-table products-table"><colgroup><col style="width:5%"><col style="width:3.8%"><col style="width:calc(41.2% - 120px)"><col style="width:5%"><col style="width:9%"><col style="width:6%"><col style="width:120px"><col style="width:8%"><col style="width:11%"><col style="width:11%"></colgroup><thead><tr><th class="cell-center">+</th><th class="cell-center">№</th><th>Наименование</th><th>ед. изм.</th><th>ОКПД2</th><th class="cell-number">Кол-во</th><th class="cell-number customer-price-header">Цена заказчика, ₽</th><th class="cell-number">Маржа, ₽</th><th class="cell-number">Маржа, %</th><th class="product-requirements-header">Требования</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }

    function suppliersHtml() {
      const lines = activeTender?.card?.tender_lines || [];
      const offers = Array.isArray(activeTender?.card?.supplier_offers) ? activeTender.card.supplier_offers : [];
      
      const supplierMap = new Map();
      lines.forEach((line) => {
        const matched = orderedOffersForLine(line, offers);
        if (matched.length && matched[0]?.offer) {
          const best = matched[0].offer;
          const sup = String(best?.supplier || '').trim();
          if (sup && !supplierMap.has(sup)) {
            supplierMap.set(sup, best);
          }
        }
      });

      if (supplierMap.size === 0) {
        const supName = display('Основной поставщик');
        if (supName && supName !== '—') {
          supplierMap.set(supName, null);
        }
      }

      if (supplierMap.size === 0) {
        return '<section class="detail-section vercel-overview-wrap"><div class="empty-state" style="padding: 1rem; color: #71717a;">Нет данных о поставщиках по выбранным товарам</div></section>';
      }

      const tablesHtml = Array.from(supplierMap.entries()).map(([rawSupplier, sampleOffer]) => {
        const delayMatch = rawSupplier.match(/\(([^)]*(?:к\.?д|дн|раб|календ)[^)]*)\)/i);
        const delayStr = delayMatch ? delayMatch[1].trim() : (display('Срок отсрочки') !== '—' ? display('Срок отсрочки') : '—');
        const cleanName = rawSupplier.replace(/\s*\([^)]*\)\s*$/, '').trim() || rawSupplier;
        const deliveryStr = sampleOffer?.delivery_period || sampleOffer?.features?.delivery_days || (display('Срок доставки поставщика') !== '—' ? display('Срок доставки поставщика') : '—');
        const paymentStr = delayMatch ? `Отсрочка платежа (${delayStr})` : (display('Условия оплаты поставщику') !== '—' ? display('Условия оплаты поставщику') : '—');
        
        return `<section class="detail-section vercel-overview-wrap" style="margin-bottom: 1rem;">
          <div class="vercel-overview-grid">
            <div class="vercel-overview-label" title="Основной поставщик">Основной поставщик</div>
            <div class="vercel-overview-value" style="font-weight: 500;">${escapeHtml(cleanName)}</div>
            <div class="vercel-overview-label" title="Срок доставки поставщика">Срок доставки поставщика</div>
            <div class="vercel-overview-value">${escapeHtml(deliveryStr)}</div>
            <div class="vercel-overview-label" title="Условия оплаты поставщику">Условия оплаты поставщику</div>
            <div class="vercel-overview-value">${escapeHtml(paymentStr)}</div>
            <div class="vercel-overview-label" title="Срок отсрочки">Срок отсрочки</div>
            <div class="vercel-overview-value">${escapeHtml(delayStr)}</div>
          </div>
        </section>`;
      }).join('');

      return `<div class="suppliers-section">${tablesHtml}</div>`;
    }

    const CORE_STATUS_LABELS = {
      CONFLICT: 'Противоречие', NOT_AVAILABLE: 'Нет данных', PENDING: 'Ожидает проверки',
      PARTIAL: 'Частично подтверждено', EXTRACTED: 'Извлечено из документа',
      OBSERVED: 'Зафиксировано в источнике', VERIFIED: 'Подтверждено',
      CALCULATED: 'Рассчитано', MANUAL: 'Внесено вручную', NOT_APPLICABLE: 'Не применяется',
      PASS: 'Извлечено', FAIL: 'Ошибка извлечения'
    };
    const core = () => coreCache.get(activeTenderId) || null;
    const coreValue = (value) => {
      value = businessValue(value);
      if (value === null || value === undefined || value === '') return '';
      if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
      
      let str = typeof value === 'object' ? businessPresentationText(value) : cleanJSONValue(value);
      if (/^[0-9]+(?:\.[0-9]+)?$/.test(str.replace(/\s/g, ''))) str = formatNumberSpaced(str);
      return str;
    };
    const coreValueHtml = (value) => {
      const valueData = businessValue(value);
      const link = fieldLink(valueData);
      return link ? `<a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.text)}</a>` : businessPresentationHtml(valueData);
    };
    const coreStatus = (status) => CORE_STATUS_LABELS[String(status || '')] || humanStatus(status);
    const coreFieldGrid = (fields, layer) => {
      let items = (Array.isArray(fields) ? fields : []).filter((item) => coreValue(item?.value) || item?.notes);
      // We filter items where either value or notes exist because we might swap "Не подтверждено" for notes
      
      if (!items.length) return '<div class="empty-state">Заполненных реквизитов пока нет</div>';
      return `<div class="field-grid">${items.map((item) => {
        const conflict = item.status === 'CONFLICT';
        
        let valRaw = String(coreValue(item.value) || '').trim();
        let displayVal = coreValueHtml(item.value);
        let colorStyle = '';
        
        if (/не\s*подтвержден/i.test(valRaw)) {
            displayVal = 'Не подтверждено';
            colorStyle = 'color: #f97316; font-weight: 500;';
        }
        
        const statusMeta = coreStatus(item.status);
        return `<div class="field-item core-field ${conflict ? 'conflict' : ''}"><span class="field-label">${escapeHtml(item.name || 'Реквизит')}</span><div class="field-value" style="${colorStyle}">${displayVal}</div><small class="core-status ${conflict ? 'conflict' : ''}">${escapeHtml(statusMeta)}</small>${(item.notes && !/не\s*подтвержден/i.test(valRaw)) ? `<small class="field-meta">${escapeHtml(item.notes)}</small>` : ''}</div>`;
      }).join('')}</div>`;
    };
    const coreLayerHtml = (layer) => {
      const sections = core()?.sections?.[layer] || {};
      const entries = Object.entries(sections);
      if (!entries.length) return '<div class="empty-state">Заполненных реквизитов пока нет. Это не ошибка.</div>';
      return entries.map(([title, fields]) => `<section class="detail-section"><h2 class="section-heading">${escapeHtml(title)}</h2>${coreFieldGrid(fields, layer)}</section>`).join('');
    };
    const warningStatus = (value) => ({OPEN: 'Открыто', BLOCKED: 'Есть предупреждения', CONFLICT: 'Противоречие'}[String(value || '')] || humanStatus(value));
    const coreFieldsByKey = () => {
      const fields = [];
      Object.values(core()?.sections?.CORE || {}).forEach((items) => {
        if (Array.isArray(items)) fields.push(...items.filter((item) => item && typeof item === 'object'));
      });
      const mainFields = core()?.main_fields;
      if (Array.isArray(mainFields)) fields.push(...mainFields.filter((item) => item && typeof item === 'object'));
      return new Map(fields.filter((item) => item.field_key).map((item) => [String(item.field_key), item]));
    };
    const warningTitleForBlocker = (blocker) => {
      const text = String(blocker || '');
      if (/точн(?:ый|ого) товар/i.test(text)) return 'Предупреждение: точный товар по требованиям ТЗ не подтверждён';
      if (/цен[аы].*(объ[её]м|срок)|объ[её]м.*срок/i.test(text)) return 'Предупреждение: цена, объём и срок действия предложения не подтверждены';
      if (/полн(?:ая|ой) прибыл/i.test(text)) return 'Предупреждение: расчёт полной прибыли не завершён';
      return 'Предупреждение по карточке';
    };
    const warningKindLabel = (kind) => ({
      CONFLICT: 'Противоречие', NOT_CHECKED: 'Требует проверки', REVIEW: 'Требует проверки',
      MISSING: 'Данные не получены', UNAVAILABLE: 'Данные не получены', CHECKED_NONE: 'Значение не указано',
      SEPARATE_REVIEW: 'Требует проверки', AMBIGUOUS: 'Неоднозначность', AMBIGUOUS_API_LINK: 'Неоднозначная связь',
      UNSUPPORTED_MODEL_VALUE: 'Неподтверждённый вывод', UNSUPPORTED_MODEL_COMPONENT: 'Неподтверждённый компонент'
    }[String(kind || '').toUpperCase()] || 'Требует проверки');
    const humanWarningTitle = (title) => {
      const match = String(title || '').match(/^Проблема данных:\s*([A-Z0-9_:-]+)$/);
      return match ? `Проблема данных: ${warningKindLabel(match[1])}` : String(title || 'Предупреждение');
    };
    const buildTenderWarnings = () => {
      const warnings = [];
      const seen = new Set();
      const seenIssueIds = new Set();
      const add = (item) => {
        const warning = {
          title: humanWarningTitle(item.title), detail: String(item.detail || ''), status: humanStatus(item.status),
          source: String(item.source || ''), fieldKey: String(item.fieldKey || ''), relation: String(item.relation || ''),
          rawOriginal: item.rawOriginal ?? null,
          issueId: String(item.issueId || ''), kind: String(item.kind || ''), exactField: String(item.exactField || ''),
          line: String(item.line || ''), doc: String(item.doc || ''), reason: String(item.reason || ''),
          checkedSources: String(item.checkedSources || ''), date: String(item.date || ''),
          nextAction: String(item.nextAction || ''), effect: String(item.effect || ''),
          collectionState: String(item.collectionState || ''), notes: String(item.notes || ''),
          verificationStatus: String(item.verificationStatus || ''), executionStatus: String(item.executionStatus || ''),
          sourceEvidence: item.sourceEvidence ?? '', quote: item.quote ?? '', location: item.location ?? '', edition: item.edition ?? '',
          ourEvidence: item.ourEvidence ?? null, values: item.values ?? null,
          apiValue: item.apiValue ?? null, documentValue: item.documentValue ?? null, conflicts: item.conflicts ?? null
        };
        if (warning.issueId) { if (seenIssueIds.has(warning.issueId)) return; seenIssueIds.add(warning.issueId); warnings.push(warning); return; }
        const fingerprint = JSON.stringify(warning);
        if (!seen.has(fingerprint)) { seen.add(fingerprint); warnings.push(warning); }
      };
      const coreData = core();
      currentCardIssues().forEach((rawIssue) => {
        const issue = cardIssueFields(rawIssue);
        add({
          title: `Проблема данных${issue.kind ? `: ${issue.kind}` : ''}`,
          detail: issue.reason || 'Проблема сохранена в карточке без классификации.', status: 'Есть предупреждения',
          source: issue.checkedSources, fieldKey: issue.exactField, relation: 'Карточка: issues', ...issue
        });
      });
      for (const item of [...(activeFullBundle?.warnings || []), ...(activeTender?.visibility_warnings || [])]) {
        add({title:'Предупреждение о данных',detail:item.message || item.code || String(item),status:'Есть предупреждения',relation:item.code || ''});
      }
      if (activeFullBundle?.coverage?.completeness !== 'COMPLETE') {
        add({title:'Полнота данных не подтверждена',detail:'Показаны все доступные сведения. Недостающие данные и предупреждения не запрещают просмотр.',status:activeFullBundle?.coverage?.completeness || 'UNKNOWN'});
      }
      const fields = coreFieldsByKey();
      const conflicts = Array.isArray(coreData?.conflicts) ? coreData.conflicts : [];
      conflicts.filter((item) => String(item?.status || '') === 'OPEN').forEach((conflict) => {
        const fieldKey = String(conflict.field_key || '');
        const field = fields.get(fieldKey) || {};
        const detail = [coreValue(field.value), field.notes].filter(Boolean).join('\n');
        add({
          title: `Противоречие по реквизиту «${field.name || fieldKey || 'не указан'}»`,
          detail: detail || 'Открытое противоречие сохранено в карточке.', status: warningStatus(conflict.status),
          source: field.source || '', fieldKey, relation: 'Проверка противоречий основной карточки', rawOriginal: field,
          sourceEvidence: fieldEvidenceText(field, 'source'), quote: fieldEvidenceText(field, 'quote'), location: fieldEvidenceText(field, 'location'), edition: fieldEvidenceText(field, 'edition'),
          collectionState: field.collection_state, verificationStatus: field.verification_status,
          executionStatus: field.execution_status, notes: field.notes, ourEvidence: field.our_evidence,
          values: conflict.values ?? field.values, apiValue: conflict.api_value ?? field.api_value, documentValue: conflict.document_value ?? field.document_value, conflicts: conflict.conflicts ?? field.conflicts
        });
      });
      Object.values(coreData?.sections?.CORE || {}).flat().filter((item) => item?.status === 'CONFLICT').forEach((field) => {
        const fieldKey = String(field.field_key || '');
        if (conflicts.some((conflict) => String(conflict?.field_key || '') === fieldKey && String(conflict?.status || '') === 'OPEN')) return;
        add({
          title: `Противоречие по реквизиту «${field.name || fieldKey || 'не указан'}»`,
          detail: [coreValue(field.value), field.notes].filter(Boolean).join('\n') || 'Противоречие сохранено в карточке.', status: warningStatus(field.status),
          source: field.source || '', fieldKey, relation: 'Реквизит основной карточки', rawOriginal: field,
          sourceEvidence: fieldEvidenceText(field, 'source'), quote: fieldEvidenceText(field, 'quote'), location: fieldEvidenceText(field, 'location'), edition: fieldEvidenceText(field, 'edition'),
          collectionState: field.collection_state, verificationStatus: field.verification_status,
          executionStatus: field.execution_status, notes: field.notes, ourEvidence: field.our_evidence,
          values: field.values, apiValue: field.api_value, documentValue: field.document_value, conflicts: field.conflicts
        });
      });
      const caseData = coreData?.case || {};
      const caseBlockers = Array.isArray(caseData.blocker) ? caseData.blocker : String(caseData.blocker || '').split(';');
      const economicsBlockers = activeTender?.card?.economics?.calculation_blockers;
      caseBlockers.map((item) => String(item || '').trim()).filter(Boolean).forEach((blocker) => {
        const profitDetails = /полн(?:ая|ой) прибыл/i.test(blocker) && Array.isArray(economicsBlockers) && economicsBlockers.length
          ? `\nНезавершённые части расчёта: ${economicsBlockers.join('; ')}` : '';
        add({title: warningTitleForBlocker(blocker), detail: `${blocker}${profitDetails}`, status: warningStatus(caseData.work_state), source: '', fieldKey: '', relation: 'Основная карточка: case.blocker'});
      });
      const card = activeTender?.card || {};
      if (card.required_parties_block_reason && !caseBlockers.length) {
        add({title: 'Предупреждение по участию', detail: card.required_parties_block_reason, status: 'Есть предупреждения', source: '', fieldKey: '', relation: 'Карточка закупки: required_parties_block_reason'});
      }
      const lineNames = new Map((Array.isArray(card.tender_lines) ? card.tender_lines : []).map((line) => [String(line?.line_id || ''), line?.name || line?.line_number || '']));
      (Array.isArray(card.supplier_offers) ? card.supplier_offers : []).forEach((offer) => {
        const status = String(offer?.refresh_status || offer?.normalization_status || offer?.fit_status || '').toUpperCase();
        const offerWarnings = [
          ...(Array.isArray(offer?.warnings) ? offer.warnings : []),
          ...(Array.isArray(offer?.price_warnings) ? offer.price_warnings : []),
          ...(Array.isArray(offer?.calculation_blockers) ? offer.calculation_blockers : []),
          offer?.fit_reason, offer?.match_reason,
        ].filter(Boolean).map(comparisonValueText);
        const needsReview = ['BLOCKED', 'REVIEW', 'STALE', 'PARTIAL', 'CONFLICT'].includes(status) || offerWarnings.length > 0;
        if (!needsReview) return;
        const line = String(offer?.line_id || offer?.tender_line_id || '');
        const detail = [
          offer?.product_name || offer?.name || 'Кандидат без названия',
          offer?.supplier,
          status && `Статус: ${humanStatus(status)}`,
          offer?.source_price_display || offer?.purchase_price || offer?.source_price,
          ...new Set(offerWarnings),
        ].filter(Boolean).join(' · ');
        add({
          title: 'Кандидат требует проверки', detail,
          status: humanStatus(status || 'REVIEW'), source: '',
          fieldKey: offer?.field_key || '', line: lineNames.get(line) || line,
          relation: 'Сопоставление товара с прайсом', rawOriginal: offer,
        });
      });
      Object.entries(card.fields || {}).forEach(([name, item]) => {
        const status = String(item?.status || '');
        if (!/(окно поставки|размер(?:ы)? парти|размер партий)/i.test(name) || !/BLOCK|CONFLICT|FAIL/i.test(status)) return;
        const detail = [textValue(item), item?.notes].filter(Boolean).join('\n');
        if (!detail) return;
        add({title: `Предупреждение: ${name}`, detail, status: warningStatus(status), source: item?.source || '', fieldKey: item?.field_key || '', relation: 'Сохранённый реквизит карточки'});
      });
      return warnings;
    };
    function renderWarningDialog() {
      const list = document.getElementById('warning-list');
      const count = document.getElementById('warning-dialog-count');
      const warnings = buildTenderWarnings();
      if (count) count.textContent = warnings.length ? `Всего: ${warnings.length}` : 'Предупреждений нет';
      const warningItemHtml = (item) => {
        const details = [
          item.nextAction && `Следующее действие: ${item.nextAction}`,
          item.effect && `Эффект: ${item.effect}`,
          item.notes && `Заметки: ${item.notes}`,
          item.conflicts && `Конфликт: ${businessPresentationText(item.conflicts)}`,
        ].filter(Boolean).join(' · ');
        return `<li class="warning-item"><div class="warning-item-title">${escapeHtml(item.title)}</div><div class="warning-item-detail">${escapeHtml(item.detail)}</div><div class="warning-item-meta"><span class="warning-item-status">Статус: ${escapeHtml(item.status)}</span>${details ? `<span>${escapeHtml(details)}</span>` : ''}</div></li>`;
      };
      if (list) list.innerHTML = warnings.map(warningItemHtml).join('');
      return warnings;
    }
    function openWarningDialog() {
      const button = document.getElementById('warning-action');
      const dialog = document.getElementById('warning-dialog');
      if (!button || !dialog || button.disabled) return false;
      const warnings = renderWarningDialog();
      if (!warnings.length) return false;
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      button.setAttribute('aria-expanded', dialog.open ? 'true' : 'false');
      return dialog.open;
    }
    function closeWarningDialog() {
      const dialog = document.getElementById('warning-dialog');
      const button = document.getElementById('warning-action');
      if (button) button.setAttribute('aria-expanded', 'false');
      if (!dialog) return;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    function bindWarningDialog() {
      const button = document.getElementById('warning-action');
      const warningDialog = document.getElementById('warning-dialog');
      const close = document.getElementById('warning-close');
      if (!button || !warningDialog || !close || button.dataset.warningBound === 'true') return;
      button.addEventListener('click', openWarningDialog);
      close.addEventListener('click', closeWarningDialog);
      warningDialog.addEventListener('click', (event) => { if (event.target === warningDialog) closeWarningDialog(); });
      warningDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeWarningDialog(); });
      warningDialog.addEventListener('close', () => {
        button.setAttribute('aria-expanded', 'false');
        if (!button.hidden) button.focus();
      });
      button.dataset.warningBound = 'true';
    }
    const updateWarningAction = () => {
      const button = document.getElementById('warning-action');
      if (!button) return;
      const warnings = buildTenderWarnings();
      button.hidden = warnings.length === 0;
      button.disabled = warnings.length === 0;
      button.setAttribute('aria-expanded', 'false');
    };
    const fieldItemsByKey = (fieldKey) => {
      const items = Object.values(activeTender?.card?.fields || {})
        .filter((item) => String(item?.field_key || '') === fieldKey);
      const coreFields = [
        ...(Array.isArray(core()?.main_fields) ? core().main_fields : []),
        ...(Array.isArray(core()?.technical_fields) ? core().technical_fields : []),
        ...Object.values(core()?.sections || {}).flatMap((section) => Object.values(section || {}).flatMap((fields) => Array.isArray(fields) ? fields : [])),
      ].filter((item) => String(item?.field_key || '') === fieldKey);
      const seen = new Set();
      return [...items, ...coreFields].filter((item) => {
        const fingerprint = JSON.stringify([item?.field_key, item?.value, item?.status, item?.source]);
        if (seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
      });
    };
    const documentValueItems = (field) => {
      const hasValue = Object.prototype.hasOwnProperty.call(field || {}, 'value');
      const value = hasValue ? field.value : (field?.text ?? field?.values);
      if (Array.isArray(value)) return value.filter((item) => item != null);
      return value == null || value === '' ? [] : [value];
    };
    const documentFieldUnknown = (field) => {
      if (!field || documentValueItems(field).length) return '';
      const state = String(field.status ?? field.verification_status ?? field.collection_state ?? '').trim().toUpperCase();
      const reason = String(field.unknown_reason ?? field.reason ?? field.notes ?? field.collection_state ?? '').trim();
      return ['UNKNOWN', 'MISSING', 'MODEL_FAILED'].includes(state) && reason ? reason : '';
    };
    const documentEvidenceItems = (value, field) => {
      const evidence = value?.evidence ?? field?.evidence ?? [];
      return (Array.isArray(evidence) ? evidence : [evidence]).filter((item) => item && typeof item === 'object');
    };
    const documentContradictionUnknown = () => fieldItemsByKey('field_072').map(documentFieldUnknown).find(Boolean) || '';
    const documentContradictionItems = () => {
      const field = fieldItemsByKey('field_072').find((item) => documentValueItems(item).length);
      const values = documentValueItems(field);
      if (values.length) return values.map((value, index) => ({field, value, index, evidence: documentEvidenceItems(value, field)}));
      const historicIssueIds = new Set((Array.isArray(activeTender?.card?.issue_history) ? activeTender.card.issue_history : [])
        .map((item) => String(item?.issue_id || item?.id || '')).filter(Boolean));
      return currentCardIssues().map((rawIssue) => cardIssueFields(rawIssue)).filter((issue) => {
        const key = String(issue.exactField || issue.semanticCode || '');
        const issueId = String(issue.rawOriginal?.issue_id || '').toLowerCase();
        const kind = String(issue.kind || '').toUpperCase();
        const technical = /:(catalog|model):/.test(issueId) || /^(MODEL|MISSING|UNAVAILABLE|CONTENT_|UNSUPPORTED_|AMBIGUOUS|FORMAT)/.test(kind);
        return key === 'field_072' && !technical && !historicIssueIds.has(issue.issueId) && (issue.reason || issue.quote || issue.sourceEvidence);
      }).map((issue, index) => ({field: issue, value: {text: issue.reason}, index, evidence: [{source: issue.sourceEvidence, quote: issue.quote, location: issue.location}]}));
    };
    const documentRelatedTerms = () => {
      const field = fieldItemsByKey('field_081').find((item) => documentValueItems(item).length);
      return field ? {field, values: documentValueItems(field)} : null;
    };
    const evidenceText = (item, key) => String(item?.[key] ?? '').trim();
    const contradictionEvidenceHtml = (entry) => entry.evidence.map((evidence, index) => {
      const source = evidenceText(evidence, 'source') || 'Источник не указан';
      const quote = evidenceText(evidence, 'quote');
      const location = evidenceText(evidence, 'location');
      const href = safeUrl(evidence?.url || evidence?.source_url || '');
      const sourceHtml = href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>` : escapeHtml(source);
      return `<div class="contradiction-evidence-item"><div><span class="contradiction-evidence-label">${sourceHtml}</span>${location ? ` · ${escapeHtml(location)}` : ''}</div>${quote ? `<div>${escapeHtml(quote)}</div>` : '<div class="document-unavailable">Цитата не передана.</div>'}</div>`;
    }).join('');
    const renderContradictionDialog = () => {
      const list = document.getElementById('contradiction-list');
      const count = document.getElementById('contradiction-dialog-count');
      const entries = documentContradictionItems();
      const unknown = documentContradictionUnknown();
      if (count) count.textContent = entries.length ? `Записей анализа: ${entries.length}` : unknown ? 'Неизвестность: нужна проверка' : 'Сохранённого анализа нет';
      if (list) list.innerHTML = `${entries.map((entry, index) => {
        const value = entry.value && typeof entry.value === 'object' ? entry.value : {text: entry.value};
        const field = entry.field || {};
        const detail = String(value.text ?? value.value ?? '').trim() || 'Описание условия не передано.';
        const scope = String(value.scope ?? '').trim();
        const impact = String(value.effect ?? value.participation_effect ?? value.impact ?? value.uncertainty ?? field.notes ?? '').trim();
        return `<li class="warning-item contradiction-item"><div class="warning-item-title contradiction-item-title">Сохранённый анализ ${index + 1}${scope ? ` · ${escapeHtml(scope)}` : ''}</div><div class="warning-item-detail">${escapeHtml(detail)}</div>${entry.evidence.length ? `<div class="contradiction-evidence">${contradictionEvidenceHtml(entry)}</div>` : ''}<div class="warning-item-meta">${field.status ? `<span class="warning-item-status">Статус: ${escapeHtml(coreStatus(field.status))}</span>` : ''}${impact ? `<span>Влияние / неопределённость: ${escapeHtml(impact)}</span>` : ''}${field.checked_at ? `<span>Проверено: ${escapeHtml(formatTenderDate(field.checked_at))}</span>` : ''}</div></li>`;
      }).join('')}${unknown ? `<li class="warning-item contradiction-unknown"><div class="warning-item-title">Документный анализ не сформирован</div><div class="warning-item-detail">Неизвестность: ${escapeHtml(unknown)}</div></li>` : ''}` || '<li class="empty-state">Для этой карточки документные условия не переданы.</li>';
      const related = document.getElementById('contradiction-related-terms');
      const terms = documentRelatedTerms();
      if (related) related.innerHTML = terms ? `<section class="contradiction-related"><h3>Связанные условия замены</h3><ul class="warning-list">${terms.values.map((value, index) => { const item = value && typeof value === 'object' ? value : {text: value}; const evidence = documentEvidenceItems(value, terms.field); const detail = String(item.text ?? item.value ?? '').trim() || 'Связанное условие не передано.'; return `<li class="warning-item"><div class="warning-item-title">Связанное условие ${index + 1}${item.scope ? ` · ${escapeHtml(String(item.scope))}` : ''}</div><div class="warning-item-detail">${escapeHtml(detail)}</div>${evidence.length ? `<div class="contradiction-evidence">${contradictionEvidenceHtml({field: terms.field, evidence})}</div>` : ''}</li>`; }).join('')}</ul></section>` : '';
      return entries;
    };
    const openContradictionDialog = () => {
      const button = document.getElementById('contradiction-action');
      const dialog = document.getElementById('contradiction-dialog');
      if (!button || !dialog || button.disabled) return false;
      const entries = renderContradictionDialog();
      if (!entries.length && !documentContradictionUnknown()) return false;
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      button.setAttribute('aria-expanded', dialog.open ? 'true' : 'false');
      return dialog.open;
    };
    const closeContradictionDialog = () => {
      const dialog = document.getElementById('contradiction-dialog');
      const button = document.getElementById('contradiction-action');
      if (button) button.setAttribute('aria-expanded', 'false');
      if (!dialog) return;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      if (button && !button.hidden) button.focus();
    };
    const bindContradictionDialog = () => {
      const button = document.getElementById('contradiction-action');
      const dialog = document.getElementById('contradiction-dialog');
      const close = document.getElementById('contradiction-close');
      if (!button || !dialog || !close || button.dataset.contradictionBound === 'true') return;
      button.addEventListener('click', openContradictionDialog);
      close.addEventListener('click', closeContradictionDialog);
      dialog.addEventListener('click', (event) => { if (event.target === dialog) closeContradictionDialog(); });
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeContradictionDialog(); });
      dialog.addEventListener('close', () => { button.setAttribute('aria-expanded', 'false'); if (!button.hidden) button.focus(); });
      button.dataset.contradictionBound = 'true';
    };
    const updateContradictionAction = () => {
      const button = document.getElementById('contradiction-action');
      if (!button) return;
      const entries = documentContradictionItems();
      const unknown = documentContradictionUnknown();
      button.hidden = entries.length === 0 && !unknown;
      button.disabled = entries.length === 0 && !unknown;
      button.textContent = entries.length ? `Противоречия · анализ ${entries.length}` : unknown ? 'Противоречия · нужна проверка' : 'Противоречия';
      button.setAttribute('aria-expanded', 'false');
    };
    const coreSourceSummaryHtml = () => {
      const coverage = Array.isArray(core()?.source_coverage) ? core().source_coverage : [];
      const objects = coverage.reduce((sum, item) => sum + Number(item.count || 0), 0);
      const bytes = coverage.reduce((sum, item) => sum + Number(item.total_bytes || 0), 0);
      const latestRaw = coverage.map((item) => String(item.latest_at || '')).filter(Boolean).sort().at(-1) || '';
      const latest = latestRaw ? formatTenderDate(latestRaw) : 'не указана';
      const sources = [...new Set(coverage.map((item) => item.source_system).filter(Boolean))].join(', ') || 'не указан';
      return `<section class="detail-section"><h2 class="section-heading">Исходные данные</h2><div class="core-summary"><div class="core-summary-item"><span>Источники</span><strong>${escapeHtml(sources)}</strong></div><div class="core-summary-item"><span>Объекты</span><strong>${escapeHtml(String(objects))}</strong></div><div class="core-summary-item"><span>Объём</span><strong>${escapeHtml(new Intl.NumberFormat('ru-RU').format(bytes))} байт</strong></div><div class="core-summary-item"><span>Последний сбор</span><strong>${escapeHtml(latest)}</strong></div></div></section>`;
    };
    const coreOverviewHtml = () => {
      const summary = core()?.summary || {};
      const incomplete = core()?.core_status === 'INCOMPLETE';
      const summaryBlock = `<section class="detail-section"><div class="core-summary"><div class="core-summary-item"><span>Закупка</span><strong>${escapeHtml(summary.title || '—')}</strong></div><div class="core-summary-item"><span>Закон</span><strong>${escapeHtml(summary.law ? `${summary.law}-ФЗ` : '—')}</strong></div><div class="core-summary-item"><span>Состояние</span><strong>${escapeHtml(core()?.case?.work_state || '—')}</strong></div></div>${incomplete ? '<p class="field-meta">Полная Core-проекция не передана. Карточка показывает только первично собранные данные и не подтверждает готовность к участию.</p>' : ''}</section>`;
      return `${summaryBlock}${coreLayerHtml('CORE')}${coreSourceSummaryHtml()}<details class="core-collapsible"><summary>Проверки и подтверждения</summary><div class="core-collapsible-content">${coreLayerHtml('CONTROL')}</div></details><details class="core-collapsible"><summary>Исполнение после победы</summary><div class="core-collapsible-content">${coreLayerHtml('EXECUTION')}</div></details><details class="core-collapsible"><summary>Технические исходные поля</summary><div class="core-collapsible-content">${coreLayerHtml('SOURCE')}</div></details>`;
    };

    const cardSourceLinksHtml = () => {
      const fields = activeTender?.card?.fields || {};
      const pick = (labels) => labels.map((label) => fieldLink(fields[label])).find(Boolean);
      const official = pick(['Ссылка на закупку в официальном источнике', 'Ссылка на ЕИС или ЭТП', 'Официальная ссылка ЕИС']) || fieldLink((activeTender?.card?.official_links || [])[0]);
      const aggregator = pick(['Ссылка на закупку у агрегатора', 'Ссылка на агрегатор']);
      const aggregatorLabel = aggregator ? `Агрегатор (${new URL(aggregator.href).hostname.replace(/^www\./i, '')})` : '';
      const links = [['Официальный источник (ЕИС/ЭТП)', official], [aggregatorLabel, aggregator]].filter(([label, link]) => Boolean(label && link));
      if (!links.length) return '';
      return `<section class="detail-section"><h2 class="section-heading">Ссылки на закупку</h2><div class="field-grid">${links.map(([label, link]) => `<div class="field-item"><span class="field-label">${escapeHtml(label)}</span><div class="field-value"><a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.text)}</a></div></div>`).join('')}</div></section>`;
    };
    const coreMainFieldsHtml = () => {
      const mainFields = Array.isArray(core()?.main_fields) ? core().main_fields : [];
      const coreFields = Object.values(core()?.sections?.CORE || {}).flatMap((items) => Array.isArray(items) ? items : []);
      const fields = [...new Map([...mainFields, ...coreFields].filter((item) => item && item.field_key).map((item) => [String(item.field_key), item])).values()];
      if (!fields.length) return coreOverviewHtml();
      return `<section class="detail-section vercel-overview-wrap"><div class="vercel-overview-grid">${fields.map((item) => {
        const value = coreValue(item?.value) || '—';
        const isNum = /[0-9₽%]/.test(value);
        return `<div class="vercel-overview-label" title="${escapeHtml(item?.name || 'Реквизит')}">${escapeHtml(item?.name || 'Реквизит')}</div><div class="vercel-overview-value ${isNum ? 'tabular-nums' : ''}">${coreValueHtml(item?.value)}</div>`;
      }).join('')}</div></section>`;
    };
    const technicalDataRows = () => {
      const technical = Array.isArray(core()?.technical_fields) ? core().technical_fields.slice().sort((left, right) => Number(left?.sort_order || 0) - Number(right?.sort_order || 0)) : [];
      const sources = Object.values(core()?.sections?.SOURCE || {}).flatMap((items) => Array.isArray(items) ? items : []);
      return [...technical, ...sources].filter((item) => item && typeof item === 'object');
    };
    const technicalFieldsHtml = () => {
      const rows = technicalDataRows().map((item) => {
        const value = item?.value != null && item?.value !== '' ? coreValueHtml(item.value) : 'НЕ ПРОВЕРЕНО';
        const definition = item?.field_definition || {};
        const code = item?.field_key || item?.semantic_code || definition?.code || '—';
        const semantic = item?.semantic_key || definition?.semantic_key || definition?.display_name || '—';
        const section = item?.section || item?.layer || item?.group || 'TECHNICAL';
        const meta = [coreStatus(item?.status), item?.source ? `Источник: ${item.source}` : '', item?.collection_state ? `Сбор: ${item.collection_state}` : '', item?.verification_status ? `Подтверждение: ${item.verification_status}` : '', item?.execution_status ? `Проверка нашей компании: ${item.execution_status}` : ''].filter(Boolean).join(' · ');
        return `<tr title="${escapeHtml(meta)}"><td class="cell-name">${escapeHtml(item?.name || definition?.display_name || 'Реквизит')}</td><td class="cell-code">${escapeHtml(code)}</td><td class="cell-semantic">${escapeHtml(semantic)}</td><td class="cell-section">${escapeHtml(section)}</td><td class="cell-val">${value}${fieldEvidenceSummary(item) ? `<small class="field-audit-meta">Подтверждение источника: ${escapeHtml(fieldEvidenceSummary(item))}</small>` : ''}${item?.our_evidence ? `<small class="field-audit-meta">Наше подтверждение: ${escapeHtml(structuredValueText(item.our_evidence))}</small>` : ''}</td><td class="cell-status">${escapeHtml(meta)}</td></tr>`;
      }).join('');
      const href = `${API_PREFIX}/api/tenders/${encodeURIComponent(activeTenderId)}/technical-fields.xlsx`;
      return `<section class="detail-section"><div style="display:flex; justify-content:flex-end; margin-bottom:12px;"><a class="technical-export" href="${escapeHtml(href)}"><svg width="14" height="14" viewBox="0 0 24 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>Скачать все технические данные в Excel</span></a></div><div class="table-wrap"><table class="data-table technical-table"><colgroup><col style="width:22%"><col style="width:14%"><col style="width:20%"><col style="width:12%"><col><col style="width:22%"></colgroup><thead><tr><th>Название реквизита</th><th>Код</th><th>Семантический ключ</th><th>Раздел</th><th>Данные</th><th>Статус / источник</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty-state">Тех. данные не переданы</td></tr>'}</tbody></table></div></section>`;
    };
    const coreDocumentsHtml = () => {
      const rows = activeDocuments.map((document, index) => {
        const href = String(document.open_url || '').replace(/^\/tender\/panel/, API_PREFIX);
        const state = document.warning ? `<span class="document-warning" title="${escapeHtml(document.warning)}">${escapeHtml(document.warning)}</span>` : escapeHtml(coreStatus(document.extraction_status));
        const action = href ? `<a class="doc-download" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Скачать</a>` : '<span class="document-unavailable">Недоступен</span>';
        return `<tr><td class="cell-center">${index + 1}</td><td title="${escapeHtml(document.title)}">${escapeHtml(document.title || '—')}${document.role ? `<small class="field-audit-meta">Роль: ${escapeHtml(document.role)}</small>` : ''}</td><td title="${escapeHtml(document.source)}">${escapeHtml(document.source || '—')}</td><td class="cell-number">${escapeHtml(new Intl.NumberFormat('ru-RU').format(Number(document.size_bytes || 0)))}</td><td class="cell-center">${escapeHtml(document.revision || '—')}</td><td style="${document.extraction_status === 'PASS' ? 'color:#10b981;font-weight:500;' : ''}">${state}</td><td class="cell-center">${action}</td></tr>`;
      }).join('');
      return rows ? `<section class="detail-section"><h2 class="section-heading">Документы</h2><div class="table-wrap"><table class="data-table"><colgroup><col style="width:42px"><col><col style="width:130px"><col style="width:80px"><col style="width:65px"><col style="width:135px"><col style="width:82px"></colgroup><thead><tr><th class="cell-center">№</th><th>Название</th><th>Источник</th><th class="cell-number">Размер, Б</th><th class="cell-center">Редакция</th><th>Извлечение</th><th class="cell-center">Файл</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : '<section class="detail-section"><div class="empty-state">Документы в основной БД отсутствуют</div></section>';
    };

    function documentsHtml() {
      if (activeSectionWarnings.documents) return sectionWarningHtml('Документы', activeSectionWarnings.documents, 'Документы не загружены; карточка открыта по доступным данным.');
      if (core() || (Array.isArray(activeDocuments) && activeDocuments.length && (activeDocuments[0].original_file_name || activeDocuments[0].size_bytes !== undefined || activeDocuments[0].source))) return coreDocumentsHtml() + fieldSection('documents');
      const rows = activeDocuments.map((document, index) => {
        const href = document.open_url ? String(document.open_url).replace(/^\/tender\/panel/, API_PREFIX) : '';
        const link = href
          ? `<a class="doc-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.title || 'Документ')}</a>`
          : `<span>${escapeHtml(document.title || 'Документ')}</span> <span class="document-unavailable" title="${escapeHtml(document.warning || 'Недоступен для скачивания')}">Недоступен</span>`;
        return `<tr><td class="cell-center">${index + 1}</td><td title="${escapeHtml(document.title || '')}">${link}</td></tr>`;
      }).join('');
      const table = rows ? `<section class="detail-section"><h2 class="section-heading">Документы</h2><div class="table-wrap"><table class="data-table"><colgroup><col style="width:42px"><col></colgroup><thead><tr><th class="cell-center">№</th><th>Наименование файла</th></tr></thead><tbody>${rows}</tbody></table></div></section>` : '<section class="detail-section"><div class="empty-state">Документы в переданном выпуске отсутствуют</div></section>';
      return table + fieldSection('documents');
    }

    function sectionWarningHtml(title, detail, fallback) {
      return `<section class="detail-section"><div class="empty-state" style="color:var(--accent-red,#ef4444)"><strong>Предупреждение: ${escapeHtml(title)}</strong><br>${escapeHtml(detail)}<br><span style="color:var(--text-muted,#888)">${escapeHtml(fallback)}</span></div></section>`;
    }

    function controlHtml() {
      const analysis = activeTender?.card?.analysis || {};
      const items = [
        ['Полнота подтверждений', analysis.evidence_completeness],
        ['Извлечение', analysis.extraction],
        ['Сверка документов', analysis.document_reconciliation],
        ['Готовность к участию', analysis.participation_readiness]
      ];
      return `<details class="core-collapsible"><summary>Проверки и подтверждения</summary><div class="core-collapsible-content"><section class="detail-section"><h2 class="section-heading">Итоги автоматической проверки</h2><div class="audit-grid">${items.map(([label, value]) => `<div class="audit-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Не оценено')}</strong></div>`).join('')}</div></section>${fieldSection('control')}</div></details>`;
    }

    function renderDetailTab() {
      updateOffersRefreshUi();
      const content = document.getElementById('det-detail-content');
      if (activeTab !== 'logistics') window.cancelTenderLogisticsMap?.();
      if (!activeTender) { content.innerHTML = '<div class="loading-detail">Выберите закупку</div>'; return; }
      const key = String(activeTenderId);
      if (activeTab === 'documents' && !documentCache.has(activeTenderId) && !activeSectionWarnings.documents) {
        content.innerHTML = detailLoadingMarkup;
        loadOptionalSection(activeTenderId, 'documents').then(() => {
          if (activeTenderId === key) selectTenderPrimary(key, false);
        });
        return;
      }
      if (['products', 'suppliers', 'economics'].includes(activeTab) && activeSectionWarnings.candidates) {
        content.innerHTML = sectionWarningHtml('Сопоставления', activeSectionWarnings.candidates, 'Основная карточка и доступные данные остаются открыты.');
        return;
      }
      if (['products', 'suppliers', 'economics'].includes(activeTab) && !candidateCache.has(activeTenderId)) {
        content.innerHTML = detailLoadingMarkup;
        loadOptionalSection(activeTenderId, 'candidates').then((offers) => {
          if (activeTenderId === key) {
            const normalized = adaptTenderDetail(activeTender, {
              product_candidates: {display_results: Array.isArray(offers) ? offers : []},
            });
            activeTender = normalized;
            tenderCache.set(key, normalized);
            selectTenderPrimary(key, false);
          }
        });
        return;
      }
      if (CORE_TABS.has(activeTab) && !coreCache.has(activeTenderId) && !activeSectionWarnings.core) {
        content.innerHTML = detailLoadingMarkup;
        loadOptionalSection(activeTenderId, 'core').then(() => {
          if (activeTenderId === key) renderDetailTab();
        });
        return;
      }
      if (activeTab === 'main') content.innerHTML = fieldSection('main');
      else if (activeSectionWarnings.core && ['technical','source','control','execution'].includes(activeTab)) content.innerHTML = sectionWarningHtml('Core', activeSectionWarnings.core, 'Основная карточка и доступные данные остаются открыты.');
      else if (core() && activeTab === 'technical') content.innerHTML = technicalFieldsHtml();
      else if (core() && activeTab === 'source') content.innerHTML = `<details class="core-collapsible" open><summary>Технические исходные поля</summary><div class="core-collapsible-content">${coreLayerHtml('SOURCE')}</div></details>`;
      else if (core() && activeTab === 'control') content.innerHTML = `<details class="core-collapsible"><summary>Проверки и подтверждения</summary><div class="core-collapsible-content">${coreLayerHtml('CONTROL')}</div></details>`;
      else if (core() && activeTab === 'execution') content.innerHTML = `<details class="core-collapsible"><summary>Исполнение после победы</summary><div class="core-collapsible-content">${coreLayerHtml('EXECUTION')}</div></details>`;
      else if (activeTab === 'products') content.innerHTML = productsHtml();
      else if (activeTab === 'documents') content.innerHTML = documentsHtml();
      else if (activeTab === 'suppliers') content.innerHTML = suppliersHtml();
      else if (activeTab === 'economics') content.innerHTML = economicsHtml();
      else if (activeTab === 'execution') content.innerHTML = `<details class="core-collapsible"><summary>Исполнение после победы</summary><div class="core-collapsible-content">${fieldSection('execution')}</div></details>`;
      else if (activeTab === 'logistics') { content.innerHTML = detailLoadingMarkup; window.renderTenderLogistics?.(activeTenderId); }
      else if (activeTab === 'control') content.innerHTML = controlHtml();
      else content.innerHTML = fieldSection(TAB_TO_GROUP[activeTab] || 'main');
      content.scrollTop = 0;
    }

    function copyLink() {
      if (!activeTenderId) return;
      const url = `${window.location.origin}${API_PREFIX}/tenders/${encodeURIComponent(activeTenderId)}`;
      navigator.clipboard.writeText(url).then(() => alert('Ссылка на закупку скопирована'));
    }

    function exportTenderCsv() {
      if (!activeTender) return;
      const rows = [['Раздел','Поле','Значение','Статус','Источник']];
      Object.entries(activeTender.card?.fields || {}).forEach(([label, item]) => rows.push(['Карточка', approvedFieldLabel(label), textValue(item), item.status || '', item.source || '']));
      (activeTender.card?.tender_lines || []).forEach((line) => rows.push(['Товары', `Строка ${line.line_number || ''}`, line.name || '', line.verification_status || '', line.source || '']));
      (activeTender.card?.supplier_offers || []).forEach((offer) => rows.push(['Поставщики', offer.product_name || '', String(offer.purchase_price ?? ''), offer.fit_status || offer.match_level || '', offer.supplier || '']));
      const csv = '\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `tender-${activeTenderId}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    }

    function toggleSidebar() {
      const app = document.querySelector('.app-workspace');
      const collapsed = app.classList.toggle('sidebar-collapsed');
      localStorage.setItem('okan_sidebar_collapsed', collapsed ? '1' : '0');
    }

    window.showMatchExplanation = (info) => {
      const dialog = document.getElementById('match-explanation-dialog');
      const body = document.getElementById('match-explanation-body');
      const heading = document.getElementById('match-explanation-title');
      if (!dialog || !body) return;
      const displayText = value => escapeHtml(String(value == null ? '' : value).replace(/\\n/g, '\n'));
      const previousFocus = info && typeof info.focus === 'function' ? info : document.activeElement;
      const restoreFocus = () => {
        if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus();
      };
      dialog.addEventListener('close', restoreFocus, {once: true});
      const present = () => {
        if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
        else if (!dialog.open) dialog.setAttribute('open', '');
        document.getElementById('match-explanation-close')?.focus();
      };
      if (heading) heading.textContent = info?.dataset?.matchTitle || 'Пояснение сопоставления';
      if (info?.dataset?.documentLinks) {
        if (heading) heading.textContent = 'Связанные файлы';
        let files = [];
        try { files = JSON.parse(info.dataset.documentLinks); } catch (_) { files = []; }
        const safeUrl = value => {
          try {
            const url = new URL(String(value || ''), location.origin);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
          } catch (_) { return ''; }
        };
        body.innerHTML = files.map(file => {
          const name = escapeHtml(file.name || `Paperless ID ${file.id || '—'}`);
          const preview = safeUrl(file.preview_url);
          const download = safeUrl(file.download_url);
          const links = [
            preview && `<a class="documents-link" href="${escapeHtml(preview)}" target="_blank" rel="noopener noreferrer">Оригинал</a>`,
            download && `<a class="documents-link" href="${escapeHtml(download)}" target="_blank" rel="noopener noreferrer">Скачать</a>`,
          ].filter(Boolean).join(' · ');
          const tags = [...(Array.isArray(file.tags) ? file.tags : []), ...(Array.isArray(file.status_tags) ? file.status_tags : [])]
            .map(tag => typeof tag === 'string' ? tag : tag?.name)
            .filter(Boolean).join(', ');
          const meta = [
            file.id && `Paperless ID ${file.id}`,
            file.format && `Формат: ${file.format}`,
            file.created && `Создан: ${formatTenderDate(file.created)}`,
            file.expires && `Действует до: ${formatTenderDate(file.expires)}`,
            file.status && `Статус: ${file.status}`,
            tags && `Метки: ${tags}`,
            file.issues && `Замечания: ${file.issues}`,
          ].filter(Boolean).map(escapeHtml).join(' · ');
          return `<div style="padding:5px 0;"><strong style="color:var(--text-main,#f4f4f5);font-weight:500;">${name}</strong><div style="padding-top:2px;color:var(--text-muted,#8d9ba8);">${meta || 'Метаданные не указаны'}${links ? ` · ${links}` : ''}</div></div>`;
        }).join('') || '<div style="padding:3px 0;color:var(--text-main,#f4f4f5);">Связанные файлы не найдены.</div>';
        present();
        return;
      }
      if (info?.dataset?.documentHelp) {
        if (heading) heading.textContent = 'Помощь по документу';
        let help = {};
        try { help = JSON.parse(info.dataset.documentHelp) || {}; } catch (_) { help = {}; }
        const files = Array.isArray(help.files) ? help.files : [];
        const safePublicUrl = value => {
          try {
            const url = new URL(String(value || ''), location.origin);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
          } catch (_) { return ''; }
        };
        const renderValue = value => displayText(value || '—');
        const renderFile = (file, index) => {
          const tags = Array.isArray(file?.tags) ? file.tags.filter(Boolean).join(', ') : (file?.tags || '—');
          const preview = safePublicUrl(file?.preview_url);
          const download = safePublicUrl(file?.download_url);
          const links = [
            preview && `<a class="documents-link" href="${escapeHtml(preview)}" target="_blank" rel="noopener noreferrer">Предпросмотр</a>`,
            download && `<a class="documents-link" href="${escapeHtml(download)}" target="_blank" rel="noopener noreferrer">Скачать</a>`,
          ].filter(Boolean).join(' · ');
          return `<div class="document-help-file"><strong class="document-help-file-name">${renderValue(file?.name || '—')}</strong><dl class="document-help-meta"><div><dt>ID</dt><dd>${renderValue(file?.id || '—')}</dd></div><div><dt>Формат</dt><dd>${renderValue(file?.format)}</dd></div><div><dt>Создан</dt><dd>${renderValue(file?.created == null ? file?.created : formatTenderDate(file.created))}</dd></div><div><dt>Действует до</dt><dd>${renderValue(file?.expires == null ? file?.expires : formatTenderDate(file.expires))}</dd></div><div><dt>Статус</dt><dd>${renderValue(file?.status)}</dd></div><div><dt>Метки</dt><dd>${renderValue(tags)}</dd></div><div><dt>Замечания</dt><dd>${renderValue(file?.issues)}</dd></div></dl>${links ? `<div class="document-help-links">${links}</div>` : ''}</div>`;
        };
        body.innerHTML = `<div class="document-help"><div class="document-help-name">${renderValue(help.name || 'Не указано')}</div><section class="document-help-action"><h3>Что сделать</h3><p>${displayText(help.next_action || 'Не указано')}</p></section><details class="document-help-details"><summary>Замечания</summary><div class="document-help-text">${displayText(help.issues || 'Не указано')}</div></details>${files.length ? `<details class="document-help-details"><summary>Связанные файлы (${files.length})</summary><div class="document-help-files">${files.map(renderFile).join('')}</div></details>` : ''}</div>`;
        present();
        return;
      }
      const raw = info?.dataset?.matchExplanation || 'Пояснение не передано.';
      body.innerHTML = raw.split('\n').filter(Boolean).map((line) => {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const k = escapeHtml(line.slice(0, idx).trim());
          const v = escapeHtml(line.slice(idx + 1).trim());
          return `<div style="padding:3px 0;"><span style="color:var(--text-muted,#8d9ba8);">${k}:</span> <strong style="color:var(--text-main,#f4f4f5);font-weight:500;">${v}</strong></div>`;
        }
        return `<div style="padding:3px 0;color:var(--text-main,#f4f4f5);">${escapeHtml(line)}</div>`;
      }).join('');
      present();
    };

    document.addEventListener('click', (event) => {
      const info = event.target.closest('[data-document-help], [data-match-explanation]');
      if (info) {
        window.showMatchExplanation(info);
        return;
      }
      if (event.target.closest('#offers-refresh-action') && activeTender && activeTab === 'products') requestOffersRefresh(String(activeTenderId), true);
      const card = event.target.closest('[data-tender-id]');
      if (card) selectTenderPrimary(card.dataset.tenderId);
      const filter = event.target.closest('[data-registry-filter]');
      if (filter) applyRegistryFilter(filter.dataset.registryFilter);
      const tab = event.target.closest('[data-detail-tab], [data-tab]');
      if (tab) {
        activeTab = tab.dataset.detailTab || tab.dataset.tab;
        document.querySelectorAll('[data-detail-tab], [data-tab]').forEach((button) => {
          const isSel = (button.dataset.detailTab || button.dataset.tab) === activeTab;
          button.setAttribute('aria-selected', isSel ? 'true' : 'false');
          button.classList.toggle('active', isSel);
        });
        renderDetailTab();
      }
      const toggle = event.target.closest('[data-line-toggle]');
      if (toggle) {
        const row = document.querySelector(`[data-matches-row="${CSS.escape(toggle.dataset.lineToggle)}"]`);
        if (row) {
          const open = row.hidden;
          row.hidden = !open;
          toggle.textContent = open ? '−' : '+';
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
      }
      const more = event.target.closest('[data-show-more]');
      if (more) {
        const row = more.closest('.matches-row');
        const expanded = more.getAttribute('aria-expanded') === 'true';
        row?.querySelectorAll('.match-extra').forEach((extra) => { extra.hidden = expanded; });
        more.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        more.textContent = expanded ? 'Показать еще...' : 'Скрыть товары...';
      }
    });

    document.addEventListener('keydown', (event) => {
      const card = event.target.closest?.('[data-tender-id]');
      if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectTenderPrimary(card.dataset.tenderId); }
    });

    document.addEventListener('DOMContentLoaded', () => {
      // Unblock CSS transitions exactly after the first paint
      setTimeout(() => document.body.classList.remove('preload'), 10);
      bindWarningDialog();
      bindContradictionDialog();
      bindRegistryExtraFilters();
      const back = document.createElement('button');
      back.type = 'button'; back.id = 'mobile-registry-back'; back.textContent = '← Реестр';
      back.addEventListener('click', () => { document.querySelector('.app-workspace').classList.remove('mobile-detail'); history.replaceState(null, '', `${API_PREFIX || '/'}`); });
      document.querySelector('.detail-column').prepend(back);
      const explanationDialog = document.getElementById('match-explanation-dialog');
      const explanationClose = document.getElementById('match-explanation-close');
      if (explanationDialog) {
        if (explanationClose) explanationClose.addEventListener('click', () => explanationDialog.close ? explanationDialog.close() : explanationDialog.removeAttribute('open'));
        explanationDialog.addEventListener('click', (e) => { if (e.target === explanationDialog) explanationDialog.close ? explanationDialog.close() : explanationDialog.removeAttribute('open'); });
      }
      loadRegistry();
    });





  window.getOfficialBadgeClass = function(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('приём') || s.includes('прием') || s.includes('подача')) {
      return 'shadcn-badge-official-open';
    }
    if (s.includes('комисси') || s.includes('протокол') || s.includes('рассмотр')) {
      return 'shadcn-badge-official-commission';
    }
    if (s.includes('завершено') || s.includes('определен') || s.includes('заключен')) {
      return 'shadcn-badge-official-completed';
    }
    if (s.includes('отмен')) {
      return 'shadcn-badge-official-cancelled';
    }
    return 'shadcn-badge-secondary';
  };

  window.getVerificationBadgeClass = function(item, ready, blocked) {
    if (blocked) return 'shadcn-badge-verified-blocked';
    const v = String(item.verification_status || item.status || '').toUpperCase();
    if (v === 'CONFIRMED' || v === 'ПРОВЕРЕН' || ready) return 'shadcn-badge-verified-confirmed';
    if (v === 'ACTION_REQUIRED' || v.includes('ТРЕБУЕТ')) return 'shadcn-badge-verified-action';
    if (v === 'CONFLICT' || v.includes('ПРОТИВОРЕЧИЕ')) return 'shadcn-badge-verified-conflict';
    if (v === 'BLOCKED' || v.includes('ЗАБЛОКИРОВАН')) return 'shadcn-badge-verified-blocked';
    return 'shadcn-badge-verified-unchecked';
  };

/* MANUAL_ARCHIVE_V2_START */
(() => {
  // The primary functions are lexical declarations in this script, not window
  // properties at this point. Capture those functions directly before exposing
  // the compatibility wrappers used by inline controls.
  const baseSelectTender = selectTenderPrimary;
  const baseApplyFilter = applyRegistryFilter;
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const isArchived = (item) => Boolean(item?.my_archive?.is_archived);
  let pendingAction = null;
  let actionInFlight = false;
  const notice = (message = '', kind = '') => { const node = document.getElementById('archive-notice'); if (node) { node.textContent = message; node.dataset.kind = kind; } };
  const updateArchiveUi = () => {
    const archived = currentTenders.filter(isArchived).length;
    const counter = document.querySelector('[data-filter-count="my-archive"]');
    if (counter) counter.textContent = archived;
    const button = document.getElementById('archive-action-button');
    const status = document.getElementById('archive-status');
    if (!activeTender || !button || !status) return;
    const archivedNow = isArchived(activeTender);
    button.hidden = false;
    const textNode = document.getElementById('archive-button-text');
    if (textNode) {
      textNode.textContent = archivedNow ? 'Вернуть из архива' : 'В архив';
    } else {
      button.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg><span id="archive-button-text">${archivedNow ? 'Вернуть из архива' : 'В архив'}</span>`;
    }
    status.hidden = !archivedNow; status.textContent = archivedNow ? `МОЙ АРХИВ: ${activeTender.my_archive.reason_code || 'причина указана'}` : '';
  };
  window.applyFilter = (mode) => baseApplyFilter(mode);
  window.selectTender = async (id, updateUrl = true) => { await baseSelectTender(id, updateUrl); updateArchiveUi(); };
  async function submitArchiveAction() {
    if (actionInFlight || !pendingAction) return;
    const action = pendingAction;
    const reason = document.getElementById('archive-reason').value;
    const reasonText = document.getElementById('archive-reason-text').value.trim();
    if (reason === 'OTHER' && !reasonText) { notice('Для причины «Другое» добавь пояснение.', 'error'); document.getElementById('archive-reason-text').focus(); return; }
    actionInFlight = true;
    const confirm = document.getElementById('archive-confirm'); confirm.disabled = true;
    notice('Сохраняем…');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${API_PREFIX}/api/tenders/${encodeURIComponent(activeTenderId)}/${action}`, {method:'POST', credentials:'same-origin', signal:controller.signal, headers:{'Content-Type':'application/json','X-Tender-Archive-Action':'manual-archive-v1'}, body:JSON.stringify({request_id:uuid(),reason_code:reason,reason_text:reasonText})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || `Не удалось сохранить: ${response.status}`);
      activeTender.my_archive = result.archive; tenderCache.set(String(activeTenderId), activeTender);
      const registry = currentTenders.find((item) => String(item.tender_id) === String(activeTenderId)); if (registry) registry.my_archive = result.archive;
      updateArchiveUi(); updateBucketCounts();
      notice(action === 'archive' ? 'Карточка отправлена в «Мой архив».' : 'Карточка возвращена в обычный список.', 'success');
      document.getElementById('archive-dialog').close();
      applyRegistryFilter(activeFilter);
    } catch (error) {
      console.error(error); notice(error.name === 'AbortError' ? 'Нет ответа за 12 секунд. Архив не изменён.' : `Архив не изменён: ${error.message}`, 'error');
    } finally { clearTimeout(timer); confirm.disabled = false; actionInFlight = false; }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const actions = document.querySelector('.top-actions');
    
    document.querySelector('.detail-title-row').insertAdjacentHTML('beforeend', '<span class="archive-status" id="archive-status" hidden></span>');
    document.body.insertAdjacentHTML('beforeend', document.getElementById('manual-archive-template').innerHTML);
    const dialog = document.getElementById('archive-dialog');
    document.getElementById('archive-action-button').addEventListener('click', () => {
      pendingAction = isArchived(activeTender) ? 'restore' : 'archive';
      document.getElementById('archive-dialog-title').textContent = pendingAction === 'restore' ? 'Вернуть из архива' : 'Отправить в архив';
      document.getElementById('archive-confirm').textContent = pendingAction === 'restore' ? 'Вернуть' : 'В архив';
      notice(); dialog.showModal();
    });
    document.getElementById('archive-cancel').addEventListener('click', () => dialog.close());
    document.getElementById('archive-reason').addEventListener('change', (event) => { document.getElementById('archive-reason-required').hidden = event.target.value !== 'OTHER'; });
    document.getElementById('archive-form').addEventListener('submit', (event) => { event.preventDefault(); submitArchiveAction(); });
  });
})();
/* MANUAL_ARCHIVE_V2_END */

(() => {
  'use strict';
  const state = {items: [], selected: '', tab: 'main', filter: 'all', map: null};
  const getDynamicPrefix = () => {
    const p = location.pathname;
    if (p.startsWith('/tender-v2')) return '/tender-v2';
      if (p === '/' || p.startsWith('/settings') || p.startsWith('/logistics') || p.startsWith('/documents') || p.startsWith('/sourcing') || p.startsWith('/tenders') || p.startsWith('/auth')) return '';
    const m = p.match(/^\/([^\/]+)/);
    return m ? `/${m[1]}` : '';
  };
  const publicPrefix = getDynamicPrefix();
  const publicPath = path => path === '/' ? (publicPrefix ? `${publicPrefix}/` : '/') : `${publicPrefix}${path}`;
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
  const escapeHtml = e;
  const statusText = {ACTIVE:'Работает',PAUSED:'Приостановлен',DRAFT:'Черновик',MANUAL:'Ручной',API:'API',HYBRID:'Ручной + API',NOT_CONNECTED:'Не подключено',READY:'Работает',ERROR:'Ошибка',NOT_APPLICABLE:'Не применяется',AVAILABLE:'Доступен',LIMITED:'Ограниченно',UNAVAILABLE:'Недоступен',UNKNOWN:'Нужно уточнить',PHONE:'Телефон',EMAIL:'Эл. почта',CONTRACT:'Договор',OTHER:'Другое'};
  const badge = (text, type='neutral') => `<span class="logistics-badge ${type}">${e(text)}</span>`;
  const money = value => value === '' || value == null ? '—' : `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.ceil(Number(value)))} ₽`;
  const moneyCeil = value => value === '' || value == null ? '—' : `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.ceil(Number(value)))} ₽`;
  const dateTimeText = value => { const text = window.formatTenderDate ? window.formatTenderDate(value) : String(value || '').trim(); return text || '—'; };
  const dateTime = value => dateTimeText(value);
  const dateTimeMinute = value => dateTimeText(value);
  const setActiveNav = (mode) => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(mode === 'logistics' ? 'nav-logistics-btn' : mode === 'documents' ? 'nav-documents-btn' : 'nav-tenders-btn')?.classList.add('active');
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
    if (panelDom.mode === 'documents') mountRegistryWorkspace();
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
    if (panelDom.mode === 'documents') {
      const list = listColumn();
      const detail = detailColumn();
      list.replaceChildren(panelDom.registryList);
      detail.replaceChildren(panelDom.registryDetail);
      panelDom.registryList = null;
      panelDom.registryDetail = null;
      panelDom.mode = 'registry';
      workspace()?.classList.remove('documents-view');
      return;
    }
    if (panelDom.mode !== 'logistics') return;
    const list = listColumn();
    const detail = detailColumn();
    list.replaceChildren(panelDom.registryList);
    detail.replaceChildren(panelDom.registryDetail);
    panelDom.registryList = null;
    panelDom.registryDetail = null;
    panelDom.mode = 'registry';
    workspace()?.classList.remove('documents-view');
  };

  window.openTenderWorkspace = () => {
    const fromOtherSection = panelDom.mode !== 'registry' ||
      Boolean(workspace()?.classList.contains('view-search-settings')) ||
      Boolean(document.querySelector('.app-workspace')?.classList.contains('sourcing-view'));
    window.closeSourcingWorkspace?.();
    mountRegistryWorkspace();
    if (fromOtherSection && activeTenderId) {
      if (typeof renderEarningsHeader === 'function' && activeEarnings && String(activeEarningsTenderId) === String(activeTenderId)) {
        renderEarningsHeader(activeEarnings);
      }
      if (typeof window.fetchActiveEarnings === 'function') {
        window.fetchActiveEarnings(activeTenderId, { force: true });
      }
    }
    const tabs = document.querySelector('.detail-tabs');
    if (tabs) {
      tabs.style.display = 'flex';
      document.querySelectorAll('.detail-tabs [data-detail-tab]').forEach((b) => {
        const isSel = b.dataset.detailTab === (typeof activeTab !== 'undefined' ? activeTab : 'main');
        b.setAttribute('aria-selected', isSel ? 'true' : 'false');
        b.classList.toggle('active', isSel);
      });

      document.querySelectorAll('[data-detail-tab], [data-tab]').forEach((button) => {
        button.onclick = (event) => {
          event.stopPropagation();
          activeTab = button.dataset.detailTab || button.dataset.tab;
          document.querySelectorAll('[data-detail-tab], [data-tab]').forEach((b) => {
            const isSel = (b.dataset.detailTab || b.dataset.tab) === activeTab;
            b.setAttribute('aria-selected', isSel ? 'true' : 'false');
            b.classList.toggle('active', isSel);
          });
          renderDetailTab();
        };
      });
    }
    workspace()?.classList.remove('view-search-settings', 'mobile-detail', 'documents-view');
    setActiveNav('registry');
    try { localStorage.setItem('okan_tender_panel_view_v1', 'registry'); } catch (_) { }
    if (location.pathname !== publicPath('/') && !location.pathname.includes('/tenders/')) history.replaceState(null, '', publicPath('/'));
    if (!document.querySelector('[data-tender-id]') && typeof window.loadTenderRegistry === 'function') {
      window.loadTenderRegistry().catch(error => console.error(error));
    }
  };
  window.showLogisticsWorkspace = async () => {
    window.closeSourcingWorkspace?.();
    workspace()?.classList.remove('view-search-settings', 'mobile-detail', 'documents-view');
    mountLogisticsWorkspace();
    setActiveNav('logistics');
    try { localStorage.setItem('okan_tender_panel_view_v1', 'logistics'); } catch (_) { }
    if (location.pathname !== publicPath('/logistics')) history.replaceState(null, '', publicPath('/logistics'));
    document.querySelector('.list-toolbar').innerHTML = `
      <div class="logistics-demo-banner">Расчёт сравнивает тарифы логистов за километр и предложение Деловых Линий.</div>
      <div class="search-input-wrap"><input id="logistics-search" placeholder="Поиск по названию, региону или виду услуг" autocomplete="off" aria-autocomplete="none" spellcheck="false" autocorrect="off" autocapitalize="off" oninput="updateLogisticsSearchClear()"><button type="button" class="search-clear-btn" id="logistics-search-clear" onclick="clearLogisticsSearch()" aria-label="Очистить поиск" hidden><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button></div>
      <div class="boardui-filters-wrap" role="group" aria-label="Фильтры логистики">
          <details class="group relative boardui-details" id="log-details-channel">
            <summary>
              <span id="log-summary-channel">Подключение</span>
              <span class="filter-reset-btn" id="log-reset-channel" title="Сбросить канал" onclick="event.preventDefault(); document.querySelectorAll('[name=log_channel]').forEach(r=>r.checked=(r.value==='all')); if(window._logisticsFilterSelect) window._logisticsFilterSelect();" hidden>✕</span>
              <svg class="chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
            </summary>
            <div class="boardui-popover">
              <div class="boardui-pop-body">
                <label class="boardui-check-label">
                  <div><input type="radio" name="log_channel" value="all" checked onclick="if(window._logisticsFilterSelect) window._logisticsFilterSelect()">Все</div>
                </label>
                <label class="boardui-check-label">
                  <div><input type="radio" name="log_channel" value="api" onclick="if(window._logisticsFilterSelect) window._logisticsFilterSelect()">Интеграция по API</div>
                </label>
                <label class="boardui-check-label">
                  <div><input type="radio" name="log_channel" value="manual" onclick="if(window._logisticsFilterSelect) window._logisticsFilterSelect()">Ручные тарифы</div>
                </label>
              </div>
            </div>
          </details>

          <details class="group relative boardui-details" id="log-details-status">
            <summary>
              <span id="log-summary-status">Статус</span>
              <span class="filter-reset-btn" id="log-reset-status" title="Сбросить статус" onclick="event.preventDefault(); document.querySelectorAll('[name=log_status]').forEach(r=>r.checked=(r.value==='all')); if(window._logisticsFilterSelect) window._logisticsFilterSelect();" hidden>✕</span>
              <svg class="chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
            </summary>
            <div class="boardui-popover">
              <div class="boardui-pop-body">
                <label class="boardui-check-label">
                  <div><input type="radio" name="log_status" value="all" checked onclick="if(window._logisticsFilterSelect) window._logisticsFilterSelect()">Все статусы</div>
                </label>
                <label class="boardui-check-label">
                  <div><input type="radio" name="log_status" value="ACTIVE" onclick="if(window._logisticsFilterSelect) window._logisticsFilterSelect()">Работают</div>
                </label>
                <label class="boardui-check-label">
                  <div><input type="radio" name="log_status" value="INACTIVE" onclick="if(window._logisticsFilterSelect) window._logisticsFilterSelect()">Отключены</div>
                </label>
              </div>
            </div>
          </details>
      </div>
      <div class="logistics-list-actions"><button class="btn-action btn-orange" id="add-carrier-btn" type="button">+ Добавить логиста</button></div>`;
    
    window._renderLogisticsListBound = renderCarrierList;
    window._logisticsFilterSelect = function() {
      const ch = document.querySelector('input[name="log_channel"]:checked')?.value || 'all';
      const st = document.querySelector('input[name="log_status"]:checked')?.value || 'all';
      
      const rCh = document.getElementById('log-reset-channel');
      if (rCh) rCh.hidden = (ch === 'all');
      const dCh = document.getElementById('log-summary-channel');
      if (dCh) {
         if (ch === 'api') dCh.innerHTML = 'Канал: <strong style="color:var(--accent-orange)">Инт. API</strong>';
         else if (ch === 'manual') dCh.innerHTML = 'Канал: <strong style="color:var(--accent-orange)">Ручные</strong>';
         else dCh.textContent = 'Подключение';
      }

      const rSt = document.getElementById('log-reset-status');
      if (rSt) rSt.hidden = (st === 'all');
      const dSt = document.getElementById('log-summary-status');
      if (dSt) {
         if (st === 'ACTIVE') dSt.innerHTML = 'Статус: <strong style="color:var(--accent-orange)">Работают</strong>';
         else if (st === 'INACTIVE') dSt.innerHTML = 'Статус: <strong style="color:var(--accent-orange)">Отключены</strong>';
         else dSt.textContent = 'Статус';
      }
      if (window._renderLogisticsListBound) window._renderLogisticsListBound();
    };

    window.updateLogisticsSearchClear = function() {
      const input = document.getElementById('logistics-search');
      const btn = document.getElementById('logistics-search-clear');
      if (!input || !btn) return;
      if (input.value.length > 0) { btn.classList.add('visible'); btn.hidden = false; }
      else { btn.classList.remove('visible'); btn.hidden = true; }
    };
    window.clearLogisticsSearch = function() {
      const input = document.getElementById('logistics-search');
      if (input) { input.value = ''; input.focus(); }
      window.updateLogisticsSearchClear();
      if (window._renderLogisticsListBound) window._renderLogisticsListBound();
    };

    document.getElementById('add-carrier-btn').addEventListener('click', () => openCarrierForm());
    document.getElementById('logistics-search').addEventListener('input', renderCarrierList);
    await loadCarriers();
  };
  window.showDocumentsWorkspace = async () => {
    window.closeSourcingWorkspace?.();
    if (window._documentsResizeHandler) {
      window.removeEventListener('resize', window._documentsResizeHandler);
      window._documentsResizeHandler = null;
    }
    if (panelDom.mode === 'logistics') mountRegistryWorkspace();
    const list = listColumn();
    const detail = detailColumn();
    if (panelDom.mode !== 'documents') {
      panelDom.registryList = detachChildren(list);
      panelDom.registryDetail = detachChildren(detail);
      panelDom.mode = 'documents';
    }
    workspace()?.classList.remove('view-search-settings', 'mobile-detail');
    workspace()?.classList.add('documents-view');
    setActiveNav('documents');
    try { localStorage.setItem('okan_tender_panel_view_v1', 'documents'); } catch (_) { }
    if (location.pathname !== publicPath('/documents')) history.replaceState(null, '', publicPath('/documents'));
    list.innerHTML = `<div class="documents-content" aria-labelledby="documents-heading">
      <h2 class="documents-page-title sr-only" id="documents-heading">Документы</h2>
      <section class="documents-table-card">
        <div class="documents-table-toolbar">
          <div class="documents-result"><span>Всего документов</span><strong id="documents-total">—</strong></div>
          <div class="documents-controls" aria-label="Фильтры документов">
            <details class="group relative boardui-details documents-details" id="documents-package-filter">
              <summary class="documents-control"><span class="value-text">Все пакеты</span><svg class="chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg></summary>
              <div class="boardui-popover"><div class="boardui-pop-body" id="documents-package-options">
                <button type="button" class="documents-pop-item is-selected" data-val="">Все пакеты</button>
              </div></div>
            </details>
            <details class="group relative boardui-details documents-details" id="documents-status-filter">
              <summary class="documents-control"><span class="value-text">Все статусы</span><svg class="chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg></summary>
              <div class="boardui-popover"><div class="boardui-pop-body" id="documents-status-options">
                <button type="button" class="documents-pop-item is-selected" data-val="">Все статусы</button>
              </div></div>
            </details>
            <label class="documents-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m16 16 4 4"></path></svg><input id="documents-search" type="search" placeholder="Поиск документов" aria-label="Поиск документов"></label>
          </div>
        </div>
        <div class="documents-grid-wrap">
          <table class="documents-table" role="grid" aria-label="Документы">
            <thead role="rowgroup"><tr role="row">
              <th role="columnheader" scope="col"></th>
              <th role="columnheader" scope="col">Категория</th><th role="columnheader" scope="col">Документ</th><th role="columnheader" scope="col">Завершённость</th><th role="columnheader" scope="col">Файл</th><th role="columnheader" scope="col"></th>
            </tr></thead>
              <tbody id="documents-rows" role="rowgroup"><tr role="row"><td colspan="6" class="table-loading" role="gridcell">Загрузка…</td></tr></tbody>
          </table>
        </div>
        <footer class="documents-table-footer">
          <span id="documents-range" class="documents-range">—</span>
          <nav class="documents-pagination" aria-label="Страницы документов"><button type="button" data-page-prev disabled>← Предыдущая</button><button type="button" data-page="1" aria-current="page">1</button><button type="button" data-page-next disabled>Следующая →</button></nav>
        </footer>
      </section>
    </div>`;
    const rows = document.getElementById('documents-rows');
    const data = await api('/api/documents/checklist');
    const packageFilter = document.getElementById('documents-package-filter');
    const packageOptions = document.getElementById('documents-package-options');
    const statusFilter = document.getElementById('documents-status-filter');
    const statusOptions = document.getElementById('documents-status-options');
    const searchFilter = document.getElementById('documents-search');
    const pagination = document.querySelector('.documents-pagination');
    
    let currentPackage = '';
    let currentStatus = '';

    const positiveDocumentId = file => {
      const value = file?.document_id;
      return (Number.isInteger(value) && value > 0) || (/^\d+$/.test(String(value || '')) && Number(value) > 0) ? String(value) : '';
    };
    const fileById = new Map((data.files || []).map(file => [positiveDocumentId(file), file]).filter(([id]) => id));
    const packages = [...new Set((data.items || []).map(item => item.package).filter(Boolean))];
    packageOptions.insertAdjacentHTML('beforeend', packages.map(value => `<button type="button" class="documents-pop-item" data-val="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join(''));
    const completionOptions = [['', 'Все статусы'], ['complete', 'Завершён'], ['incomplete', 'Не завершён']];
    statusOptions.innerHTML = completionOptions.map(([value, label]) => `<button type="button" class="documents-pop-item${value ? '' : ' is-selected'}" data-val="${value}">${label}</button>`).join('');

    const categoryName = value => String(value || '').trim() === 'Переменные' ? 'Временные' : String(value || '').trim();
    const categoryBadge = value => {
      const name = categoryName(value);
      if (!name) return '<span class="text-subtle">—</span>';
      const variant = name === 'Постоянные' ? 'badge-category-permanent' : name === 'Временные' ? 'badge-category-temporary' : 'badge-category-neutral';
      return `<span class="bui-badge badge-category ${variant}">${escapeHtml(name)}</span>`;
    };

    const formatMime = value => {
      const mime = String(value || '').trim();
      if (!mime) return '—';
      if (mime.toLowerCase() === 'application/pdf') return 'PDF';
      return (mime.split('/', 2)[1] || '').split(';', 1)[0].trim().toUpperCase() || '—';
    };
    const formatDate = value => formatDateDdMmYyyy(value || '') || '—';
    
    const bindDropdown = (container, onSelect) => {
      const summaryText = container.querySelector('.value-text');
      const items = container.querySelectorAll('.documents-pop-item');
      items.forEach(btn => {
        btn.addEventListener('click', (e) => {
          items.forEach(b => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          summaryText.textContent = btn.textContent;
          container.removeAttribute('open');
          onSelect(btn.dataset.val);
        });
      });
    };

    const fileTags = files => files.flatMap(file => [
      ...(Array.isArray(file.tags) ? file.tags : []),
      ...(Array.isArray(file.status_tags) ? file.status_tags : []),
    ]);
    const itemFiles = item => {
      const ids = Array.isArray(item.document_ids) ? item.document_ids : [];
      const resolved = ids.map(id => fileById.get(String(id))).filter(file => positiveDocumentId(file));
      if (resolved.length || ids.length) return resolved;
      return (Array.isArray(item.file_metadata) ? item.file_metadata : []).filter(file => positiveDocumentId(file));
    };
    const itemRows = (data.items || []).map(item => ({item, files: itemFiles(item)}));
    const safePublicUrl = value => {
      try {
        const url = new URL(String(value || ''), location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
      } catch (_) { return ''; }
    };
    const matches = ({item, files}) => {
      const tagText = fileTags(files).map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean).join(' ');
      const itemText = [item.id, item.name, item.section, item.package, item.applicability, item.issues, item.next_action];
      const haystack = [...itemText, ...files.map(file => `${file.document_id} ${file.name} ${file.issues}`), tagText].filter(Boolean).join(' ').toLocaleLowerCase('ru');
      const completion = files.length ? 'complete' : 'incomplete';
      return (!searchFilter.value.trim() || haystack.includes(searchFilter.value.trim().toLocaleLowerCase('ru')))
        && (!currentPackage || item.package === currentPackage)
        && (!currentStatus || completion === currentStatus);
    };

    const flatRows = itemRows;
    let currentPage = 1;
    let pageLayoutKey = '';
    let pageRanges = [];

    const rowMarkup = ({item, files}) => {
        const hasFiles = files.length > 0;
        const name = item.name || 'Документ';
        const category = categoryBadge(item.package);
        const file = files[0];
        const titleText = escapeHtml(name);
        const previewUrl = safePublicUrl(file?.preview_url);
        const title = hasFiles && previewUrl ? `<a class="documents-link doc-title" href="${escapeHtml(previewUrl)}" target="_blank" rel="noopener noreferrer">${titleText}</a>` : `<strong class="doc-title">${titleText}</strong>`;
        const downloadUrl = safePublicUrl(file?.download_url);
        const download = hasFiles && downloadUrl ? `<a class="bui-action-btn" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Скачать документ</a>` : '<span class="text-subtle">Нет ссылки</span>';
        const moreFiles = files.slice(1).map(related => ({
          id: positiveDocumentId(related), name: related.name, preview_url: related.preview_url, download_url: related.download_url,
          format: related.format || formatMime(related.mime_type), created: formatDate(related.created), expires: formatDate(related.expires),
          tags: related.tags, status: related.status, status_tags: related.status_tags, issues: related.issues,
        }));
        const more = moreFiles.length ? `<button type="button" class="documents-more-files" data-document-links="${escapeHtml(JSON.stringify(moreFiles))}" onclick="window.showMatchExplanation(this)" title="Показать ещё ${moreFiles.length} связанных файла">+${moreFiles.length}</button>` : '';
        const fileCell = hasFiles ? `<div class="documents-file-actions">${download}${more}</div>` : '<span class="text-subtle">—</span>';
        const documentIds = files.map(related => positiveDocumentId(related)).filter(Boolean);
        const conditionText = item.applicability || '—';
        const documentHelp = {
          name,
          next_action: item.next_action || 'Не указано',
          issues: item.issues || 'Не указано',
          files: files.map(related => ({
            id: positiveDocumentId(related) ? String(positiveDocumentId(related)) : '—', name: related.name || '—',
            format: related.format || formatMime(related.mime_type) || '—', created: formatDate(related.created), expires: formatDate(related.expires),
            status: related.status || '—', tags: [...(Array.isArray(related.tags) ? related.tags : []), ...(Array.isArray(related.status_tags) ? related.status_tags : [])].map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean),
            issues: related.issues || '—', preview_url: related.preview_url || '', download_url: related.download_url || '',
          })),
        };
        const conditionInfoSvg = `<button class="match-info-btn i-btn-doc" type="button" data-match-explanation="${escapeHtml(conditionText)}" title="Показать условия применения" aria-label="Показать условия применения" aria-haspopup="dialog"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>`;
        const acquisitionInfoSvg = `<button class="match-info-btn i-btn-doc" type="button" data-document-help="${escapeHtml(JSON.stringify(documentHelp))}" title="Показать способ получения" aria-label="Показать способ получения" aria-haspopup="dialog"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.5 9a2.5 2.5 0 1 1 4.15 1.87c-.83.69-1.65 1.04-1.65 2.63"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></button>`;
        const isComplete = hasFiles;
        const completion = isComplete ? 'Завершён' : 'Не завершён';
        const completionVariant = isComplete ? 'badge-status-complete' : 'badge-status-incomplete';
        const rowAttrs = `data-item-id="${escapeHtml(item.id)}" data-document-ids="${escapeHtml(JSON.stringify(documentIds))}"`;
        return `<tr role="row" ${rowAttrs}>
          <td role="gridcell" style="text-align: center; vertical-align: middle;"><label class="bui-checkbox"><input type="checkbox" aria-label="Выбрать ${escapeHtml(name)}"></label></td>
          <th role="rowheader" scope="row">${category}</th>
          <td role="gridcell">${title}</td>
          <td role="gridcell" class="documents-status" title="Документ собран; не означает юридическую проверку"><span class="bui-badge badge-status ${completionVariant}">${completion}</span></td>
          <td role="gridcell">${fileCell}</td>
          <td role="gridcell" style="text-align: center; vertical-align: middle;"><span style="display:inline-flex; align-items:center; gap:6px;">${conditionInfoSvg}${acquisitionInfoSvg}</span></td>
        </tr>`;
    };

    const layoutRows = visibleRows => {
      const wrap = document.querySelector('.documents-grid-wrap');
      const key = [searchFilter.value.trim().toLocaleLowerCase('ru'), currentPackage, currentStatus, wrap?.clientWidth || 0, wrap?.clientHeight || 0].join('\u0000');
      if (key === pageLayoutKey && pageRanges.length) return pageRanges;
      rows.innerHTML = visibleRows.map(rowMarkup).join('') || '<tr role="row"><td colspan="6" class="table-loading" role="gridcell">По заданным условиям документов нет</td></tr>';
      const table = rows.closest('table');
      const availableHeight = Math.max(1, (wrap?.clientHeight || 480) - (table?.tHead?.getBoundingClientRect().height || 0));
      const heights = [...rows.querySelectorAll('tr')].map(row => row.getBoundingClientRect().height);
      pageRanges = [];
      let start = 0;
      let used = 0;
      visibleRows.forEach((_, index) => {
        const height = heights[index] || 1;
        if (index > start && used + height > availableHeight) {
          pageRanges.push([start, index]);
          start = index;
          used = 0;
        }
        used += height;
      });
      if (visibleRows.length) pageRanges.push([start, visibleRows.length]);
      else pageRanges = [[0, 0]];
      pageLayoutKey = key;
      return pageRanges;
    };

    const pageSlot = page => `<button type="button" class="documents-page-slot${page ? '' : ' is-empty'}"${page ? ` data-page="${page}"${page === currentPage ? ' aria-current="page"' : ''}` : ' aria-hidden="true" tabindex="-1" disabled'}>${page || 0}</button>`;
    const pageGap = visible => `<span class="documents-page-gap${visible ? '' : ' is-empty'}" aria-hidden="true">…</span>`;
    const renderPagination = (pageCount) => {
      const middle = pageCount <= 5
        ? Array.from({length: Math.max(0, pageCount - 2)}, (_, index) => index + 2)
        : currentPage <= 3 ? [2, 3, 4] : currentPage >= pageCount - 2 ? [pageCount - 3, pageCount - 2, pageCount - 1] : [currentPage - 1, currentPage, currentPage + 1];
      const slots = [middle[0] || 0, middle[1] || 0, middle[2] || 0];
      pagination.innerHTML = `<button type="button" data-page-prev aria-label="Предыдущая страница">← Предыдущая</button>${pageSlot(1)}${pageGap(Boolean(slots[0] && slots[0] > 2))}${pageSlot(slots[0])}${pageSlot(slots[1])}${pageSlot(slots[2])}${pageGap(Boolean(slots[2] && slots[2] < pageCount - 1))}${pageSlot(pageCount > 1 ? pageCount : 0)}<button type="button" data-page-next aria-label="Следующая страница">Следующая →</button>`;
      const previous = pagination.querySelector('[data-page-prev]');
      const next = pagination.querySelector('[data-page-next]');
      previous.disabled = currentPage === 1;
      next.disabled = currentPage === pageCount;
      pagination.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
        currentPage = Number(button.dataset.page);
        render();
      }));
      previous.addEventListener('click', () => { currentPage -= 1; render(); });
      next.addEventListener('click', () => { currentPage += 1; render(); });
    };

    const render = () => {
      const visibleRows = flatRows.filter(matches);
      const ranges = layoutRows(visibleRows);
      const pages = ranges.length;
      currentPage = Math.max(1, Math.min(currentPage, pages));
      const [start, end] = ranges[currentPage - 1] || [0, 0];
      const pageRows = visibleRows.slice(start, end);
      document.getElementById('documents-total').textContent = `${visibleRows.length} ${visibleRows.length === 1 ? 'документ' : visibleRows.length < 5 ? 'документа' : 'документов'}`;
      document.getElementById('documents-range').textContent = visibleRows.length ? `${start + 1}–${end} из ${visibleRows.length}` : 'Нет документов';
      renderPagination(pages);
      rows.innerHTML = pageRows.map(rowMarkup).join('') || '<tr role="row"><td colspan="6" class="table-loading" role="gridcell">По заданным условиям документов нет</td></tr>';
    };
    bindDropdown(packageFilter, val => { currentPackage = val; currentPage = 1; render(); });
    bindDropdown(statusFilter, val => { currentStatus = val; currentPage = 1; render(); });
    searchFilter.addEventListener('input', () => { currentPage = 1; render(); });
    window._documentsResizeHandler = () => {
      pageLayoutKey = '';
      render();
    };
    window.addEventListener('resize', window._documentsResizeHandler, {passive: true});
    
    // Close dropdowns on outside click
    document.addEventListener('click', e => {
      document.querySelectorAll('.documents-details[open]').forEach(d => {
        if (!d.contains(e.target)) d.removeAttribute('open');
      });
    });

    render();
  };

  async function loadCarriers(selectId = '') {
    const container = document.getElementById('cards-container');
    if (container && (!state.items || !state.items.length)) container.innerHTML = registryLoadingMarkup;
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
    const ch = document.querySelector('input[name="log_channel"]:checked')?.value || 'all';
    const st = document.querySelector('input[name="log_status"]:checked')?.value || 'all';

    return state.items.filter(item => {
      if (q && !`${item.name} ${item.regions} ${item.service_type}`.toLowerCase().includes(q)) return false;
      if (st === 'ACTIVE' && item.status !== 'ACTIVE') return false;
      if (st === 'INACTIVE' && item.status === 'ACTIVE') return false;
      if (ch === 'manual' && item.channel !== 'MANUAL') return false;
      if (ch === 'api' && item.channel === 'MANUAL') return false;
      return true;
    });
  }

  function renderCarrierList() {
    const items = filteredCarriers();
    document.getElementById('cards-container').innerHTML = items.map(item => {
      const apiState = item.channel === 'MANUAL' ? badge('Без API','neutral') : badge(item.api_status === 'READY' ? 'API работает' : 'API не подключено', item.api_status === 'READY' ? 'ok' : 'off');
      const status = badge(label(item.status,statusText), item.status === 'ACTIVE' ? 'ok' : item.status === 'PAUSED' ? 'warn' : 'neutral');
      return `<article class="t-card ${item.id===state.selected?'active':''}" data-carrier-id="${e(item.id)}" tabindex="0">
        <div class="t-tags">${apiState}</div><div class="t-title" title="${e(item.name)}">${e(item.name)}</div>
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
      <div class="top-command-bar"><div class="bread-crumbs">Справочники / <strong>Панель логистики</strong> / ${e(carrier.name)}</div><div class="top-actions">
          <button class="btn-action warning-action" id="warning-action" type="button" aria-expanded="false" aria-controls="warning-dialog" hidden disabled>Предупреждение</button>
          <div class="boardui-button-group" role="group" aria-label="Действия с закупкой">
            <a class="boardui-group-item" id="det-source-link" href="#" target="_blank" rel="noopener noreferrer" hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>Источник</span>
            </a>
            <button class="boardui-group-item archive-action" id="archive-action-button" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"></polyline>
                <rect x="1" y="3" width="22" height="5"></rect>
                <line x1="10" y1="12" x2="14" y2="12"></line>
              </svg>
              <span id="archive-button-text">В архив</span>
            </button>
          </div>
        </div>
      </div>
      <div class="logistics-detail-head"><div><h1 class="detail-title">${e(carrier.name)}</h1><div class="t-tags">${apiState}</div></div>
      <div class="logistics-detail-actions"><button class="btn-action btn-outline" id="edit-carrier">Изменить карточку</button><button class="btn-action btn-orange" id="add-tariff">+ Добавить тариф</button></div></div>
      <div class="logistics-kpis">
        <div class="kpi-box"><div class="kpi-lbl">Тарифы</div><div class="kpi-num">${carrier.tariffs.length}</div><div class="kpi-sub">Включено: ${carrier.tariffs.filter(t=>t.enabled).length}</div></div>
        <div class="kpi-box"><div class="kpi-lbl">Рабочий канал</div><div class="kpi-num">${e(label(carrier.channel,statusText))}</div><div class="kpi-sub">${e(carrier.manager_name || 'Контакт не указан')}</div></div>
        <div class="kpi-box"><div class="kpi-lbl">Регионы</div><div class="kpi-num">${e(carrier.regions ? 'Заданы' : 'Не заданы')}</div><div class="kpi-sub">${e(carrier.regions || 'Нужно заполнить')}</div></div>
        <div class="kpi-box"><div class="kpi-lbl">API</div><div class="kpi-num">${e(label(carrier.api_status,statusText))}</div><div class="kpi-sub">${e(carrier.api_message || 'Состояние не указано')}</div></div>
      </div>
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
      const rows = carrier.communications.map(c => `<tr><td>${e(dateTime(c.contacted_at))}</td><td>${e(c.contact_name||'—')}</td><td>${e(c.channel)}</td><td>${e(c.subject)}</td><td title="${e(c.result)}">${e(c.result)}</td><td>${e(dateTime(c.next_check_at))}</td></tr>`).join('');
      return `<section class="detail-section"><h2 class="section-heading">Звонки и договорённости</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Когда</th><th>Контакт</th><th>Канал</th><th>Тема</th><th>Результат</th><th>Проверить снова</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty-state">Договорённости ещё не записаны</td></tr>'}</tbody></table></div></section>`;
    }
    if (state.tab === 'integration') {
      const used = carrier.channel !== 'MANUAL';
      return `<section class="detail-section"><h2 class="section-heading">Состояние интеграции</h2><div class="field-grid"><div class="field-item"><span class="field-label">Способ работы</span><div class="field-value">${e(label(carrier.channel,statusText))}</div></div><div class="field-item"><span class="field-label">Провайдер API</span><div class="field-value">${e(carrier.api_provider||'Не применяется')}</div></div><div class="field-item"><span class="field-label">Состояние API</span><div class="field-value">${e(label(carrier.api_status,statusText))}</div></div><div class="field-item"><span class="field-label">Последняя проверка</span><div class="field-value">${e(dateTime(carrier.api_last_check))}</div></div><div class="field-item" style="grid-column:1/-1"><span class="field-label">Пояснение</span><div class="field-value">${e(carrier.api_message||'—')}</div></div></div>${used?'<div class="logistics-note"><button class="btn-action btn-blue" id="edit-integration" type="button">Изменить состояние подключения</button></div>':''}</section><div class="logistics-demo-banner">${used?'Внешние запросы из панели отключены. Значения ключей и токенов в панели не хранятся и не показываются.':'Для этого логиста API не нужен. Тарифы, доступность и договорённости фиксируются вручную после звонка или письма.'}</div>`;
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
    const form=node.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>node.close();form.onsubmit=async event=>{event.preventDefault();formStatus(form,'Сохраняем…');const body=Object.fromEntries(new FormData(form));const url=tariff.id?`/api/logistics/carriers/${encodeURIComponent(carrier.id)}/tariffs/${encodeURIComponent(tariff.id)}`:`/api/logistics/carriers/${encodeURIComponent(carrier.id)}/tariffs`;try{await write(url,tariff.id?'PUT':'POST',body);node.close();state.tab='tariffs';await loadCarriers(carrier.id);if(window.fetchActiveEarnings&&activeTenderId)window.fetchActiveEarnings(activeTenderId,{force:true});}catch(err){formStatus(form,err.message,'error');}};
  }

  function openIntegrationForm(carrier) {
    const node=dialog(`Состояние подключения - ${carrier.name}`,`<form class="logistics-form" id="integration-form" autocomplete="off"><div class="logistics-form-fields">${input('api_provider','Провайдер API',carrier.api_provider,true)}${select('api_status','Состояние',[['NOT_CONNECTED','Не подключено'],['READY','Работает'],['ERROR','Ошибка']],carrier.api_status||'NOT_CONNECTED')}${input('api_last_check','Последняя проверка',carrier.api_last_check||new Date().toISOString().slice(0,16),'','datetime-local')}${textarea('api_message','Результат проверки',carrier.api_message,true)}<div class="logistics-demo-banner wide">Ключи и токены здесь не вводятся. Панель хранит только состояние подключения и пояснение.</div><div class="logistics-form-status"></div></div><div class="logistics-form-actions"><button class="btn-action btn-outline" type="button" data-cancel>Отмена</button><button class="btn-action btn-orange" type="submit">Сохранить состояние</button></div></form>`);
    const form=node.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>node.close();form.onsubmit=async event=>{event.preventDefault();formStatus(form,'Сохраняем…');const body={...carrier,...Object.fromEntries(new FormData(form))};delete body.tariffs;delete body.communications;try{const saved=await write(`/api/logistics/carriers/${encodeURIComponent(carrier.id)}`,'PUT',body);node.close();state.tab='integration';await loadCarriers(saved.id);}catch(err){formStatus(form,err.message,'error');}};
  }

  function openCallForm(carrier) {
    const node=dialog(`Записать договорённость - ${carrier.name}`,`<form class="logistics-form" id="call-form" autocomplete="off"><div class="logistics-form-fields">${input('contacted_at','Дата и время',new Date().toISOString().slice(0,16),true,'datetime-local')}${input('contact_name','С кем говорили',carrier.manager_name)}${select('channel','Канал',[['PHONE','Телефон'],['EMAIL','Эл. почта'],['MESSENGER','Мессенджер'],['MEETING','Встреча']],'PHONE')}${input('subject','Тема','Тариф и доступность',true)}${textarea('result','Что подтвердили','',true)}${input('next_check_at','Проверить снова','','','date')}<div class="logistics-form-status"></div></div><div class="logistics-form-actions"><button class="btn-action btn-outline" type="button" data-cancel>Отмена</button><button class="btn-action btn-orange" type="submit">Сохранить запись</button></div></form>`);
    const form=node.querySelector('form');form.querySelector('[data-cancel]').onclick=()=>node.close();form.onsubmit=async event=>{event.preventDefault();formStatus(form,'Сохраняем…');try{await write(`/api/logistics/carriers/${encodeURIComponent(carrier.id)}/communications`,'POST',Object.fromEntries(new FormData(form)));node.close();state.tab='contacts';await selectCarrier(carrier.id);}catch(err){formStatus(form,err.message,'error');}};
  }

  function displayDeliveryAddress(value='') {
  return String(value || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  }

  function input(name,title,value='',required=false,type='text',unit='',needsReview=false) {
    const isWide=name==='delivery_address'?'wide':'';
    const displayValue=name==='delivery_address'?displayDeliveryAddress(value):value;
    const unitHtml=unit?`<span class="input-unit ${name==='stated_value'?'currency':''}">${e(unit)}</span>`:'';
    if(name==='delivery_address'){
      const reviewStar=needsReview?'<span class="address-review-star" title="Адрес требует проверки перед расчётом" aria-label="Адрес требует проверки">*</span>':'';
      const tagHtml=`<button type="button" class="btn-manual-address-tag" title="Адрес можно вбить руками или выбрать из карт"><svg class="icon-pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span>Ввод руками</span></button>`;
      return `<div class="logistics-timeline-content"><span class="logistics-timeline-label label-orange">${e(title)}${reviewStar}</span><div class="input-unit-wrap"><input name="${e(name)}" type="${e(type)}" value="${e(displayValue??'')}" ${required?'required':''} role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="delivery-address-suggestions" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off">${tagHtml}</div></div>`;
    }
    return `<label class="${isWide}"><span>${e(title)}</span><div class="input-unit-wrap"><input name="${e(name)}" type="${e(type)}" value="${e(value??'')}" ${required?'required':''} ${type==='number'?'min="0" step="0.01"':''} autocomplete="off" aria-autocomplete="none" spellcheck="false" autocorrect="off" autocapitalize="off">${unitHtml}</div></label>`;
  }
  function textarea(name,title,value='',required=false){return `<label class="wide">${e(title)}<textarea name="${e(name)}" ${required?'required':''}>${e(value??'')}</textarea></label>`;}
  function select(name,title,items,value){return `<label>${e(title)}<select name="${e(name)}">${items.map(([v,t])=>`<option value="${e(v)}" ${v===value?'selected':''}>${e(t)}</option>`).join('')}</select></label>`;}

  function logisticsCalculationHtml(item) {
    const bestValue=item.best_offer ? e(item.best_offer.carrier_name) : '';
    const sourcePoints=(item.source_delivery_addresses||[]).map((point,index)=>({...point,source_index:point.source_index??index}));
    const sourceByIndex=new Map(sourcePoints.map(point=>[String(point.source_index),point]));
    const savedPoints=item.delivery_stops?.length ? item.delivery_stops : null;
    const deliveryPoints=(item.delivery_source_status==='STALE' ? (sourcePoints.length ? sourcePoints : (item.delivery_addresses?.length ? item.delivery_addresses : (savedPoints || [{delivery_address:item.delivery_address||'',registry_id:''}]))) : (savedPoints || (item.delivery_addresses?.length ? item.delivery_addresses : sourcePoints)) || [{delivery_address:item.delivery_address||'',registry_id:''}]).map((point,index)=>typeof point==='string'?{delivery_address:point,registry_id:'',source_index:index}:{...point,source_index:point.source_index??index});
    const isMulti=deliveryPoints.length>1;
    const missingValue=value=>value==null||String(value).trim()==='';
    const cargoFields=['cargo_places','weight_kg','stated_value','length_m','width_m','height_m'];
    const preliminary=item.preliminary_cargo?.enabled===true||cargoFields.some(field=>missingValue(item[field]));
    const placesValue=missingValue(item.cargo_places)?'10':item.cargo_places, weightValue=missingValue(item.weight_kg)?'100':item.weight_kg, statedValue=missingValue(item.stated_value)?'10000':item.stated_value;
    const dimensions={length_m:missingValue(item.length_m)?'0.283':item.length_m,width_m:missingValue(item.width_m)?'0.159':item.width_m,height_m:missingValue(item.height_m)?'0.237':item.height_m};
    const splitMissing=split=>!split||typeof split!=='object'||Object.values(split).every(value=>missingValue(value));
    const generatedSplit=(!item.dellin_split?.length||item.dellin_split.every(split=>splitMissing(split)))&&isMulti&&Number(placesValue)>=deliveryPoints.length?(()=>{const places=Number(placesValue),weight=Number(weightValue),value=Number(statedValue),base=Math.floor(places/deliveryPoints.length),remainder=places%deliveryPoints.length;let usedWeight=0,usedValue=0;return deliveryPoints.map((_,index)=>{const count=base+(index<remainder?1:0),partWeight=index===deliveryPoints.length-1?weight-usedWeight:Number((weight*count/places).toFixed(3)),partValue=index===deliveryPoints.length-1?value-usedValue:Number((value*count/places).toFixed(2));usedWeight+=partWeight;usedValue+=partValue;return {places:count,weight_kg:partWeight.toFixed(3),stated_value:partValue.toFixed(2)};});})():null;
    const displayDeliveryPointAddress=point=>{const manual=String(point.delivery_address||'').trim(),source=String(point.source_delivery_address||'').trim();const manuallyChosen=String(point.registry_id||'').trim()||(manual&&manual!==source);return manuallyChosen?(manual||source):(source||manual);};
    const addressRows=deliveryPoints.map((point,index)=>{const sourceIndex=point.source_index??index;const sourcePoint=sourceByIndex.get(String(sourceIndex));const manualSplit=item.dellin_split?.[index];const split=generatedSplit?.[index]||manualSplit||{};const needsReview=Boolean(point.needs_review||sourcePoint?.needs_review||(deliveryPoints.length===1&&item.delivery_address_needs_review));const reviewStar=needsReview?'<span class="address-review-star" title="Адрес требует проверки перед расчётом" aria-label="Адрес требует проверки">*</span>':'';const splitHtml=isMulti?`<div class="dellin-split-fields" aria-label="Распределение груза для точки ${index+1}"><label><span>Места</span><div class="input-unit-wrap"><input name="dellin_split_places" data-split-index="${index}" type="number" min="1" step="1" value="${e(split.places??'')}" inputmode="numeric"></div></label><label><span>Вес, кг</span><div class="input-unit-wrap"><input name="dellin_split_weight" data-split-index="${index}" type="number" min="0.001" step="0.001" value="${e(split.weight_kg??'')}"></div></label><label><span>Стоимость, ₽</span><div class="input-unit-wrap"><input name="dellin_split_value" data-split-index="${index}" type="number" min="0" step="0.01" value="${e(split.stated_value??'')}"></div></label></div>`:'';return `<div class="logistics-timeline-point point-b delivery-stop-row" data-stop-index="${index}"><div class="logistics-timeline-dot dot-orange"></div><div class="logistics-timeline-content"><span class="logistics-timeline-label label-orange">${deliveryPoints.length>2?`Точка ${index+1}`:'ТОЧКА Б (АДРЕС ОБЪЕКТА)'}${reviewStar}</span><div class="input-unit-wrap"><input id="delivery-address-${index}" name="delivery_addresses" value="${e(displayDeliveryPointAddress(point))}" required type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="delivery-address-suggestions-${index}" data-address-index="${index}" class="delivery-address-input" autocomplete="off" spellcheck="false"><input type="hidden" name="source_indexes" value="${e(sourceIndex)}"><input type="hidden" name="address_registry_ids" value="${e(point.registry_id||'')}"></div>${splitHtml}</div></div>`;}).join('');

    const offers=(item.offers||[]).map(offer=>`<article class="logistics-offer ${offer.carrier_id===item.best_offer?.carrier_id?'best':''}"><div><strong>${e(offer.carrier_name)}</strong></div><div class="logistics-offer-price">${money(offer.amount)}</div>${offer.vat_note?`<div class="logistics-offer-note">НДС: ${e(offer.vat_note)}</div>`:''}${offer.basis?`<div class="logistics-offer-note">${e(offer.basis)}</div>`:''}${offer.note?`<div class="logistics-offer-note">${e(offer.note)}</div>`:''}${offer.breakdown?.length?`<details><summary>Разбивка по адресам</summary>${offer.breakdown.map(part=>`<div>${e(part.address)} — ${money(part.price)}</div>`).join('')}</details>`:''}</article>`).join('');
    const statedValueInt=statedValue;

    const cargoParamsHtml = `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 8px;">
        ${input('cargo_places','Места',placesValue,true,'number','мест')}
        ${input('weight_kg','Общий вес',weightValue,true,'number','кг')}
        <label><span>Общий объём</span><div class="input-unit-wrap"><input name="volume_m3" type="number" value="${e(item.volume_m3??'')}" readonly autocomplete="off" aria-autocomplete="none"><span class="input-unit">м³</span></div></label>
        ${input('stated_value','Стоимость',statedValueInt,true,'number','₽')}
      </div>
      <div class="logistics-dimensions-grid wide" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        ${input('length_m','Длина 1 места',dimensions.length_m,true,'number','м')}
        ${input('width_m','Ширина 1 места',dimensions.width_m,true,'number','м')}
        ${input('height_m','Высота 1 места',dimensions.height_m,true,'number','м')}
        <button type="button" class="btn-action btn-outline preliminary-cargo-button">Подставить предварительные</button>
      </div>`;

    return `<div class="logistics-split-row"><section class="detail-section logistics-calculation">
      <form class="logistics-form" id="logistics-calculation-form" data-preliminary="${preliminary?'1':'0'}" autocomplete="off"><input type="hidden" name="source_fingerprint" value="${e(item.source_fingerprint||'')}">

        
        <div class="logistics-best-command wide" style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div style="flex:1; min-width:0;">
            <div class="logistics-best-value">${bestValue||'Требуется расчёт'}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-shrink:0; margin-left:auto;">
            <button class="btn-action btn-orange" type="submit" style="white-space:nowrap; flex-shrink:0;">Рассчитать логистику</button>
            <details class="logistics-settings-dropdown" style="position:relative;">
              <summary title="Параметры и габариты груза" aria-label="Параметры и габариты груза">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
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
          ${deliveryPoints.length>2?`<details class="delivery-addresses-list"><summary>Развернуть список адресов</summary>${addressRows}</details>`:addressRows}
        </div>

        <div class="logistics-form-status">${preliminary?`<div class="logistics-warning preliminary-cargo-note">Предварительный груз — не из документов. Распределение по адресам условное${item.preliminary_cargo?.warning?` ${e(item.preliminary_cargo.warning)}`:''}</div>`:''}${item.delivery_source_status==='STALE'?'<div class="logistics-warning">Источник адресов изменился. Сохранённый маршрут устарел — требуется полный пересчёт.</div>':''}${item.delivery_address_warning?`<div class="logistics-warning">${e(item.delivery_address_warning)}</div>`:''}</div>
      </form>
    </section>
    <section class="detail-section logistics-offers-section">
      <h2 class="section-heading">Предложения логистов</h2>
      <div class="logistics-offers">${preliminary?'<div class="logistics-warning preliminary-cargo-note">Предварительный груз — не из документов. Распределение по адресам условное</div>':''}${offers||'<div class="logistics-empty-action"><strong>Подходящих предложений нет</strong><div>Проверьте применимость активного тарифа и параметры груза.</div></div>'}${item.dellin_quote?.status==='provider_issue'?`<div class="logistics-empty-action"><strong>Деловые Линии: цена неизвестна</strong><div>${e(item.dellin_quote.reason||'Провайдер не вернул расчёт')}</div></div>`:''}</div>
    </section>
  </div>`;
  }

  let logisticsListeners = null;
  function bindLogisticsCalculation(tenderId) {
    logisticsListeners?.abort();
    logisticsListeners = new AbortController();
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
    const markStale=()=>{calculateVolume();const stale='Требуется пересчёт';const best=form.querySelector('.logistics-best-value');if(best)best.textContent=stale;const offers=form.closest('.logistics-split-row')?.querySelector('.logistics-offers');if(offers&&!offers.querySelector('.logistics-stale-warning')){const note=document.createElement('div');note.className='logistics-warning logistics-stale-warning';note.textContent=stale;offers.prepend(note);}};
    ['cargo_places','weight_kg','length_m','width_m','height_m','stated_value'].forEach(name=>form.elements[name]?.addEventListener('input',markStale));
    ['dellin_split_places','dellin_split_weight','dellin_split_value'].forEach(name=>form.querySelectorAll(`[name="${name}"]`).forEach(input=>input.addEventListener('input',markStale)));
    form.elements.cargo_places.min='1'; form.elements.cargo_places.max='10000'; form.elements.cargo_places.step='1';
    form.elements.weight_kg.step='0.001';
    form.elements.length_m.step='0.001'; form.elements.width_m.step='0.001'; form.elements.height_m.step='0.001';
    form.elements.stated_value.step='0.01';
    form.querySelector('.preliminary-cargo-button')?.addEventListener('click',()=>{
      const defaults={cargo_places:'10',weight_kg:'100',stated_value:'10000',length_m:'0.283',width_m:'0.159',height_m:'0.237'};
      ['cargo_places','weight_kg','stated_value'].forEach(name=>{form.elements[name].value=defaults[name];});
      ['length_m','width_m','height_m'].forEach(name=>{if(!form.elements[name].value.trim())form.elements[name].value=defaults[name];});
      form.dataset.preliminary='1';
      const note='Предварительный груз — не из документов. Распределение по адресам условное';
      if(!form.querySelector('.preliminary-cargo-note')){const node=document.createElement('div');node.className='logistics-warning preliminary-cargo-note';node.textContent=note;form.querySelector('.logistics-form-status')?.prepend(node);}
      document.querySelector('.logistics-offers')?.querySelector('.preliminary-cargo-note')||(()=>{const node=document.createElement('div');node.className='logistics-warning preliminary-cargo-note';node.textContent=note;document.querySelector('.logistics-offers')?.prepend(node);})();
      const rows=[...form.querySelectorAll('.delivery-stop-row')];
      if(rows.length>10){form.dataset.preliminaryWarning='Мест меньше адресов: отправки не созданы, укажи больше мест';formStatus(form,form.dataset.preliminaryWarning,'error');}
      else if(rows.length>1){const [places,weight,value]=[10,100,10000]; const base=Math.floor(places/rows.length), remainder=places%rows.length; let usedWeight=0,usedValue=0; rows.forEach((row,index)=>{const count=base+(index<remainder?1:0);const partWeight=index===rows.length-1?weight-usedWeight:Number((weight*count/places).toFixed(3));const partValue=index===rows.length-1?value-usedValue:Number((value*count/places).toFixed(2));row.querySelector('[name="dellin_split_places"]').value=count;row.querySelector('[name="dellin_split_weight"]').value=partWeight.toFixed(3);row.querySelector('[name="dellin_split_value"]').value=partValue.toFixed(2);usedWeight+=partWeight;usedValue+=partValue;});}
      markStale();
    });
    const addressInputs=[...form.querySelectorAll('.delivery-address-input')];
    addressInputs.forEach(addressInput=>addressInput.addEventListener('input',markStale));
    addressInputs.forEach((addressInput,addressIndex)=>{
      const recentKey='okan.logistics.recent-addresses.v1';
      const wrap=addressInput.closest('.input-unit-wrap')||addressInput.parentElement;
      const manualButton=wrap.querySelector('.btn-manual-address-tag');
      const registryInput=form.querySelector(`[data-registry-index="${addressIndex}"]`);
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

      }
      const listboxId=`delivery-address-suggestions-${addressIndex}`;
      const showItems=(nextItems,title='')=>{
        closeBox();
        items=nextItems.filter(item=>item&&item.display_name).slice(0,7);
        if(!items.length)return;
        box=document.createElement('div');
        box.id=listboxId;
        box.className='logistics-suggestions-dropdown';
        box.setAttribute('role','listbox');
        box.innerHTML=`${title?`<div class="logistics-suggestions-title">${e(title)}</div>`:''}${items.map((item,idx)=>`<button type="button" id="${listboxId}-option-${idx}" class="logistics-suggestion-item" role="option" data-idx="${idx}"><svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg><span>${e(item.display_name)}</span></button>`).join('')}`;
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
      document.addEventListener('click',event=>{if(box&&!wrap.contains(event.target))closeBox();},{signal:logisticsListeners.signal});
    });
    form.onsubmit=async event=>{
      event.preventDefault();
      const submissionGeneration=mapRenderGeneration;
      const controls=[...form.elements];
      const disabledState=controls.map(control=>control.disabled);
      const isSubmissionCurrent=()=>mapRenderGeneration===submissionGeneration&&String(activeTenderId)===String(tenderId)&&activeTab==='logistics'&&form.isConnected;
      calculateVolume();
      try {
        const formData=new FormData(form);
        const body=Object.fromEntries(formData);
        body.delivery_addresses=formData.getAll('delivery_addresses');
        body.address_registry_ids=formData.getAll('address_registry_ids');
        body.source_indexes=formData.getAll('source_indexes');
        body.preliminary_cargo={enabled:form.dataset.preliminary==='1',warning:form.dataset.preliminaryWarning||''};
        const splitPlaces=formData.getAll('dellin_split_places');
        const splitWeight=formData.getAll('dellin_split_weight');
        const splitValue=formData.getAll('dellin_split_value');
        if(splitPlaces.length){body.dellin_split=splitPlaces.map((places,index)=>({places,weight_kg:splitWeight[index]||'',stated_value:splitValue[index]||''}));}
        if(!isSubmissionCurrent())return;
        controls.forEach(control=>{control.disabled=true;});
        formStatus(form,'Считаем все доступные варианты…');
        await write(`/api/logistics/tenders/${encodeURIComponent(tenderId)}/calculate`,'POST',body);
        if(isSubmissionCurrent()){
          await window.renderTenderLogistics(tenderId);
          if (window.fetchActiveEarnings && activeTenderId === tenderId) window.fetchActiveEarnings(tenderId, { force: true });
        }else{
          controls.forEach((control,index)=>{control.disabled=disabledState[index];});
        }
      } catch(err) {
        controls.forEach((control,index)=>{control.disabled=disabledState[index];});
        if(form.isConnected)formStatus(form,err.message,'error');
      }
    };
  }

  let mapRenderGeneration = 0;
  let cancelActiveMapRender = null;
  let mapOverlay = null;
  const scrollableAncestor = element => {
    for (let node=element?.parentElement; node && node!==document.body; node=node.parentElement) {
      const overflow=getComputedStyle(node).overflowY;
      if (overflow==='auto'||overflow==='scroll') return node;
    }
    return document.scrollingElement;
  };
  const resizeTenderMap = () => {
    if (!state.map) return;
    requestAnimationFrame(() => { state.map?.resize(); setTimeout(() => state.map?.resize(), 180); });
  };
  const setMapToggleState = (button, expanded) => {
    if (!button) return;
    const label = expanded ? 'Свернуть карту' : 'Развернуть карту';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(expanded));
    button.innerHTML = expanded
      ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6"/></svg>';
  };
  const restoreMapShell = () => {
    const overlay = mapOverlay;
    if (!overlay) return;
    mapOverlay = null;
    if (overlay.shell?.isConnected && overlay.placeholder?.isConnected) overlay.placeholder.before(overlay.shell);
    if (overlay.placeholder?.isConnected) {
      overlay.placeholder.hidden=true;
      overlay.placeholder.style.height='';
      overlay.placeholder.style.minHeight='';
      overlay.placeholder.style.visibility='';
    }
    document.body.style.overflow=overlay.bodyOverflow;
    setMapToggleState(overlay.expand, false);
    if (overlay.dialog?.open) overlay.dialog.close();
    resizeTenderMap();
    if (overlay.scrollContainer) requestAnimationFrame(()=>{overlay.scrollContainer.scrollTop=overlay.scrollTop;});
    overlay.returnFocus?.focus?.({preventScroll:true});
  };
  const openMapOverlay = () => {
    const shell = document.querySelector('.logistics-map-shell');
    const dialog = document.getElementById('logistics-map-dialog');
    const body = dialog?.querySelector('.logistics-map-dialog-body');
    const placeholder = document.querySelector('.logistics-map-placeholder');
    const expand = document.getElementById('logistics-map-expand');
    if (!state.map || !shell || !dialog || !body || !placeholder || dialog.open) return;
    const scrollContainer=scrollableAncestor(shell);
    placeholder.hidden=false;
    placeholder.style.height=`${shell.getBoundingClientRect().height}px`;
    placeholder.style.minHeight=placeholder.style.height;
    placeholder.style.visibility='hidden';
    mapOverlay = {dialog, body, shell, placeholder, expand, returnFocus: document.activeElement, bodyOverflow: document.body.style.overflow, scrollContainer, scrollTop: scrollContainer?.scrollTop||0};
    body.replaceChildren(shell);
    document.body.style.overflow='hidden';
    setMapToggleState(expand, true);
    dialog.showModal();
    resizeTenderMap();
    expand?.focus({preventScroll:true});
  };
  const closeMapOverlay = () => restoreMapShell();
  const toggleMapOverlay = () => {
    const dialog = document.getElementById('logistics-map-dialog');
    if (dialog?.open) closeMapOverlay(); else openMapOverlay();
  };
  window.cancelTenderLogisticsMap = () => {
    mapRenderGeneration += 1;
    cancelActiveMapRender?.();
    restoreMapShell();
    if(state.map){try{state.map.remove();}catch(_){ }state.map=null;}
  };

  window.renderTenderLogistics = async tenderId => {
    const generation=++mapRenderGeneration;
    cancelActiveMapRender?.();
    const content = document.getElementById('det-detail-content');
    const isCurrent=()=>generation===mapRenderGeneration&&String(activeTenderId)===String(tenderId)&&activeTab==='logistics';
    if (!content||!isCurrent()) return;
    restoreMapShell();
    try {
      let item=await api(`/api/logistics/tenders/${encodeURIComponent(tenderId)}`);
      if(!isCurrent())return;
      const hasAddress = item.delivery_address_status !== 'MISSING' && [item.delivery_address, ...(item.delivery_addresses || []), ...(item.source_delivery_addresses || [])].some((point) => String(typeof point === 'string' ? point : point?.delivery_address || '').trim());
      let routePromise = hasAddress ? api(`/api/logistics/tenders/${encodeURIComponent(tenderId)}/route`).catch(() => null) : Promise.resolve(null);
      let route = await routePromise;
      if(!isCurrent())return;
      if(!route && hasAddress){
        try {
          if(!isCurrent())return;
          const savedPoints=item.delivery_stops?.length ? item.delivery_stops : null;
          const sourcePoints=item.source_delivery_addresses?.length ? item.source_delivery_addresses : item.delivery_addresses;
          const points=item.delivery_source_status==='STALE' ? (sourcePoints || [{delivery_address:item.delivery_address}]) : (savedPoints || sourcePoints || [{delivery_address:item.delivery_address}]);
          await write(`/api/logistics/tenders/${encodeURIComponent(tenderId)}/calculate`,'POST',{
            cargo_places: item.cargo_places ?? '',
            weight_kg: item.weight_kg ?? '',
            volume_m3: item.volume_m3 ?? '',
            stated_value: item.stated_value ?? '',
            length_m: item.length_m ?? '',
            width_m: item.width_m ?? '',
            height_m: item.height_m ?? '',
            preliminary_cargo: {enabled: true},
            dellin_split: item.dellin_split ?? [],
            delivery_addresses: points.map(point=>typeof point==='string'?point:point.delivery_address),
            address_registry_ids: points.map(point=>typeof point==='string'?'':point.registry_id||''),
            source_indexes: points.map((point,index)=>typeof point==='string'?index:point.source_index??index),
            source_fingerprint: item.source_fingerprint||''
          });
          if(!isCurrent())return;
          item=await api(`/api/logistics/tenders/${encodeURIComponent(tenderId)}`);
          if(!isCurrent())return;
          route=await api(`/api/logistics/tenders/${encodeURIComponent(tenderId)}/route`).catch(() => null);
          if(!isCurrent())return;
          if (window.fetchActiveEarnings && activeTenderId === tenderId) window.fetchActiveEarnings(tenderId, { force: true });
        } catch(calcErr){
          console.warn('Auto logistics calculation failed:', calcErr);
        }
      }
      if(!hasAddress){
        if(!isCurrent())return;
        content.innerHTML=logisticsCalculationHtml(item)+`<section class="detail-section"><div class="logistics-map-unavailable">Адрес поставки не указан; карта и маршрут недоступны.</div></section>`;
        content.insertAdjacentHTML('afterbegin', fieldSection('logistics'));
        bindLogisticsCalculation(tenderId);
        return;
      }
      routePromise = Promise.resolve(route);
      if(!isCurrent())return;
      const mapHtml=`<div class="logistics-map-shell"><button type="button" class="logistics-map-fit" id="logistics-map-fit" title="Центровать маршрут от точки А до точки Б" aria-label="Центровать маршрут от точки А до точки Б"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/></svg></button><button type="button" class="logistics-map-fit logistics-map-expand" id="logistics-map-expand" title="Развернуть карту" aria-label="Развернуть карту" aria-expanded="false" disabled><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6"/></svg></button><div id="tender-logistics-map" class="logistics-map" aria-label="Карта маршрута"></div></div><div class="logistics-map-placeholder" hidden></div><dialog id="logistics-map-dialog" class="logistics-map-dialog" aria-label="Карта маршрута"><div class="logistics-map-dialog-body"></div></dialog>`;
      if(!isCurrent())return;
      content.innerHTML=logisticsCalculationHtml(item)+mapHtml;
      content.insertAdjacentHTML('afterbegin', fieldSection('logistics'));
      bindLogisticsCalculation(tenderId);
      document.getElementById('logistics-map-expand')?.addEventListener('click', toggleMapOverlay);
      const mapDialog=document.getElementById('logistics-map-dialog');
      mapDialog?.addEventListener('cancel', event => { event.preventDefault(); closeMapOverlay(); });
      mapDialog?.addEventListener('close', closeMapOverlay);
      try { await drawTenderMap(tenderId,item.map_region,routePromise,generation); }
      catch(mapError){
        if(!isCurrent())return;
        const map=document.getElementById('tender-logistics-map');
        document.getElementById('logistics-map-expand')?.setAttribute('disabled','');
        if(map)map.innerHTML=`<div class="logistics-map-unavailable">${!route ? 'Адрес поставки сохранён, но координаты не установлены; карта и маршрут недоступны.' : 'Карта временно недоступна. Расчёт и выбранный склад сохранены выше.'}</div>`;
        console.warn('Карта логистики недоступна',mapError);
      }
    } catch(err){if(isCurrent())content.innerHTML=`<section class="detail-section"><div class="empty-state" style="color:var(--status-red)">Не удалось загрузить логистику: ${e(err.message)}</div></section>`;}
  };

  let mapLibraryPromise = null;
  function loadMapLibrary() {
    if (window.maplibregl) return Promise.resolve();
    if (!mapLibraryPromise) mapLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = publicPath('/static/map/maplibre-gl.js');
      script.onload = resolve; script.onerror = () => {mapLibraryPromise = null; reject(new Error('Карта не загружена'));};
      document.head.append(script);
    });
    return mapLibraryPromise;
  }
  async function drawTenderMap(tenderId,region,routePromise,generation){
    const assertCurrent=()=>{if(generation!==mapRenderGeneration||String(activeTenderId)!==String(tenderId)||activeTab!=='logistics')throw new DOMException('Map render superseded','AbortError');};
    await loadMapLibrary();
    assertCurrent();
    if(!window.maplibregl)throw new Error('Модуль карты не загружен');
    let route = routePromise ? await routePromise : null;
    if (!route) route = await api(`/api/logistics/tenders/${encodeURIComponent(tenderId)}/route`);
    assertCurrent();
    const coordinates=route.geometry.coordinates;
    if(!Array.isArray(coordinates)||coordinates.length<3)throw new Error('Маршрут не содержит дорожной линии');

    if(typeof maplibregl.prewarm==='function') maplibregl.prewarm();
    let lastMapError=null;
    for(let attempt=0;attempt<4;attempt+=1){
      assertCurrent();
      if(state.map){try{state.map.remove();}catch(_){ }state.map=null;}
      const container=document.getElementById('tender-logistics-map');
      if(container)container.replaceChildren();
      try{
        await new Promise((resolve,reject)=>{
          const map=new maplibregl.Map({container:'tender-logistics-map',style:publicPath(`/map/style.json?region=${encodeURIComponent(region||route.map_region)}`),transformRequest:(url)=>({url:new URL(url,window.location.origin).href}),center:coordinates[0],zoom:7,attributionControl:false,maxZoom:17,dragRotate:false,pitchWithRotate:false,touchPitch:false});
          state.map=map;
          let settled=false;
          const finish=(error)=>{
            if(settled)return;
            settled=true;
            clearTimeout(timer);
            window.removeEventListener('error',onWindowError,true);
            container?.removeEventListener('webglcontextlost',onContextLost,true);
            if(cancelActiveMapRender===cancelThis)cancelActiveMapRender=null;
            if(error)reject(error);
            else if(generation!==mapRenderGeneration)reject(new DOMException('Map render superseded','AbortError'));
            else resolve();
          };
          const fail=(message)=>{
            if(settled)return;
            finish(new Error(message));
            try{map.remove();}catch(_){ }
            if(state.map===map)state.map=null;
          };
          const cancelThis=()=>fail('Map render superseded');
          const onWindowError=(event)=>{
            const message=String(event?.error?.message||event?.message||'');
            if(message.includes('imageManager')){event.preventDefault();fail(message);}
          };
          const onContextLost=(event)=>{event.preventDefault();fail('WebGL context lost');};
          const timer=setTimeout(()=>fail('Карта не завершила загрузку'),15000);
          window.addEventListener('error',onWindowError,true);
          container?.addEventListener('webglcontextlost',onContextLost,true);
          cancelActiveMapRender=cancelThis;
          map.dragRotate.disable();
          map.touchZoomRotate.disableRotation();
          map.addControl(new maplibregl.NavigationControl({showCompass:false,showZoom:false}),'top-right');
          map.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}),'bottom-left');
          map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'© OpenStreetMap contributors'}));
          map.on('error',event=>{console.warn('MapLibre warning:',event?.error?.message||event);});
          map.once('load',()=>{
            try{
              assertCurrent();
              map.addSource('route',{type:'geojson',data:{type:'Feature',properties:{kind:'car'},geometry:route.geometry}});
              map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],7,8,14,12],'line-opacity':0.96}});
              map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ff5a00','line-width':['interpolate',['linear'],['zoom'],7,4.5,14,7.5],'line-opacity':0.98}});
              const marker=(text,type,title,point)=>{const element=document.createElement('div');element.className=`logistics-route-marker ${type}`;element.textContent=text;element.title=title;new maplibregl.Marker({element,anchor:'center'}).setLngLat(point).addTo(map);};
              marker('A','start','Склад',coordinates[0]);
              if(Array.isArray(route.stops)&&route.stops.length){route.stops.slice().sort((a,b)=>(a.route_order||0)-(b.route_order||0)).forEach((stop,index)=>marker(String(index+1),'finish',`Точка ${index+1}`, [Number(stop.delivery_lon),Number(stop.delivery_lat)]));}
              else marker('Б','finish','Адрес заказчика',coordinates.at(-1));
              const bounds=coordinates.reduce((value,point)=>value.extend(point),new maplibregl.LngLatBounds(coordinates[0],coordinates[0]));
              const compact=window.matchMedia('(max-width:700px)').matches;
              const fitRoute=()=>map.fitBounds(bounds,{padding:compact?38:64,maxZoom:13,duration:350});
              document.getElementById('logistics-map-fit')?.addEventListener('click',fitRoute);
              document.getElementById('logistics-map-expand')?.removeAttribute('disabled');
              fitRoute();
              requestAnimationFrame(()=>map.resize());
              setTimeout(()=>map.resize(),180);
              if(window.ResizeObserver){new ResizeObserver(()=>map.resize()).observe(container);}
              finish();
            }catch(error){fail(error.message||'Ошибка отрисовки карты');}
          });
        });
        return;
      }catch(error){
        assertCurrent();
        lastMapError=error;
        if(attempt<3)await new Promise(resolve=>setTimeout(resolve,200));
      }
    }
    throw lastMapError||new Error('Карта не загрузилась');
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const tenders=document.querySelector('.nav-section .nav-item.active');
    if(tenders){tenders.id='nav-tenders-btn';tenders.href='javascript:void(0)';tenders.onclick=window.openTenderWorkspace;}
    const management=[...document.querySelectorAll('.nav-head')].find(n=>n.textContent.trim()==='Управление')?.parentElement;
    const tenderNav=document.querySelector('.nav-section');
    if(tenderNav)tenderNav.insertAdjacentHTML('beforeend',`<a class="nav-item" href="javascript:void(0)" onclick="window.openLogisticsWorkspace(); return false;" id="nav-logistics-btn" title="Перевозчики, ручные тарифы и API" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between;"><div style="display:flex; align-items:center; gap:8px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg><span class="nav-text">Панель логистики</span></div><span class="nav-counter" id="nav-logistics-count">4</span></a><a class="nav-item" href="javascript:void(0)" onclick="window.showDocumentsWorkspace(); return false;" id="nav-documents-btn" title="Документы" style="cursor:pointer; display:flex; align-items:center; justify-content:flex-start; gap:8px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg><span class="nav-text">Документы</span></a>`);
    // Navigation is delegated by search-settings.js so the same click path works on every panel route.
    api('/api/logistics/summary').then(summary => {
      const count=document.getElementById('nav-logistics-count');
      if(count)count.textContent=summary.carriers?.total ?? '0';
    }).catch(()=>{});
    if(location.pathname===publicPath('/logistics'))setTimeout(window.showLogisticsWorkspace,0);
    if ([publicPath('/documents'), `${publicPath('/documents')}/`].includes(location.pathname)) setTimeout(window.showDocumentsWorkspace,0);
  });
})();


  window.openBoardUISettingsModal = function() {
    const pane = document.getElementById('search-settings-pane');
    if (pane) pane.classList.add('open');
    if (window.showSearchSettings) window.showSearchSettings(true);
  };
  window.closeBoardUISettingsModal = function() {
    const pane = document.getElementById('search-settings-pane');
    if (pane?.classList.contains('open')) {
      pane.classList.add('closing');
      setTimeout(() => {
        pane.classList.remove('open', 'closing');
        window.openTenderWorkspace?.();
      }, 150);
    }
  };
  window.switchSettingsTab = function(tabKey, btn) {
    document.querySelectorAll('.boardui-modal-nav-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.settings-page').forEach(p => p.style.display = 'none');
    const target = document.getElementById('set-page-' + tabKey);
    if (target) target.style.display = 'block';
  };

  document.addEventListener('input', function(e) {
    if (e.target && e.target.matches('[data-search-price]')) {
      let rawVal = e.target.value.replace(/\D/g, '');
      if (rawVal) {
        e.target.value = new Intl.NumberFormat('ru-RU').format(parseInt(rawVal, 10));
      } else {
        e.target.value = '';
      }
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') window.closeBoardUISettingsModal();
  });
  document.addEventListener('click', function(e) {
    const pane = document.getElementById('search-settings-pane');
    if (pane && pane.classList.contains('open') && e.target === pane) window.closeBoardUISettingsModal();
  });


'use strict';

(() => {
  const getDynamicPrefix = () => {
    const p = location.pathname;
    if (p.startsWith('/tender-v2')) return '/tender-v2';
      if (p === '/' || p.startsWith('/settings') || p.startsWith('/logistics') || p.startsWith('/documents') || p.startsWith('/sourcing') || p.startsWith('/tenders') || p.startsWith('/auth')) return '';
    const m = p.match(/^\/([^\/]+)/);
    return m ? `/${m[1]}` : '';
  };
  const API_PREFIX = getDynamicPrefix();
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
    if (pane().querySelector('.boardui-modal-card')) {
      const add = (page, key, title, control='') => {
        if (!pane().querySelector(`[data-search-switch="${key}"]`)) {
          pane().querySelector('#set-page-'+page).insertAdjacentHTML('beforeend', `<div class="boardui-list-item"><div class="boardui-list-title">${title}</div><div style="display:flex; align-items:center; gap:8px;">${control}<label class="search-switch"><input type="checkbox" data-search-switch="${key}"><span class="search-slider"></span></label></div></div>`);
        }
      };
      add('types','types.proposals','Запрос предложений');
            add('price','lots.shareEnabled','Минимальная доля подходящих строк','<input id="search-share" type="number" min="0" max="100" class="search-number-input" placeholder="%" style="width:50px; height:28px; font-size:12px; ">');
                  
            pane().querySelector('#set-page-history').insertAdjacentHTML('beforeend','<p>Фильтры: <span id="search-stat-enabled"></span> · Версия: <span id="search-stat-version"></span> · Изменения: <span id="search-stat-changed"></span></p><div id="search-settings-history"></div>');
      pane().querySelector('.boardui-modal-footer').insertAdjacentHTML('beforebegin','<div style="padding:8px 20px;font-size:12px"><div id="search-settings-status" role="status"></div><div id="search-settings-notice"></div></div>');
      updateUi(); return;
    }
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
          <section class="search-settings-card"><h2>Правила для смешанных лотов <span>Сопоставление товаров</span></h2><div class="search-settings-card-body"><div class="search-setting-title">Режим обработки лотов</div><div class="search-mode-grid"><button data-search-mode="ONLY_OUR" type="button">Только наши товары</button><button data-search-mode="ALLOW_MIXED" type="button">Разрешать смешанные</button><button data-search-mode="EXCLUDE_MIXED" type="button">Исключать смешанные</button><button data-search-mode="MANUAL_REVIEW" type="button">Ручная проверка</button></div>${switchRow('lots.shareEnabled', 'Минимальная доля подходящих строк', '<input id="search-share" type="number" min="0" max="100" class="search-number-input" placeholder="%" style="width:50px; height:28px; font-size:12px; ">')}${switchRow('lots.excludeUnsuitable', 'Исключать при неподходящей обязательной строке')}</div></section>
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
    const lotsModeBtn = pane().querySelector('#search-lots-mode');
    if (lotsModeBtn) {
      lotsModeBtn.value = current.settings.lots.mode;
      const r = lotsModeBtn.previousElementSibling;
      if (r && r.classList.contains('custom-select')) {
        const btn = r.querySelector(`.select-item[data-value="${current.settings.lots.mode}"]`);
        if (btn) {
           r.querySelector('.value-text').textContent = btn.textContent;
           r.querySelectorAll('.select-item').forEach(b => b.classList.remove('active'));
           btn.classList.add('active');
        }
      }
    }
    
    pane().querySelectorAll('[data-search-mode]').forEach(button => button.classList.toggle('active', button.dataset.searchMode === current.settings.lots.mode));
    ['min', 'max'].forEach(name => {
      const input = pane().querySelector(`[data-search-price="${name}"]`);
      if (input && (!preservePriceFocus || document.activeElement !== input)) {
        let val = current.settings.price[name];
        input.value = val ? new Intl.NumberFormat('ru-RU').format(val) : '';
      }
    });
    const missing = pane().querySelector('#search-missing-action');
    if (missing) {
      missing.value = current.settings.price.missingAction;
      const root = missing.previousElementSibling; // it's details
      if (root && root.classList.contains('custom-select')) {
        const btn = root.querySelector(`.select-item[data-value="${current.settings.price.missingAction}"]`);
        if (btn) {
           root.querySelector('.value-text').textContent = btn.textContent;
           root.querySelectorAll('.select-item').forEach(b => b.classList.remove('active'));
           btn.classList.add('active');
        }
      }
    }
    const share = pane().querySelector('#search-share');
    if (share && document.activeElement !== share) share.value = String(current.settings.lots.share);
    
    pane().querySelector('#search-stat-enabled').textContent = String(enabledCount());
    pane().querySelector('#search-stat-version').textContent = `v${current.version}`;
    pane().querySelector('#search-stat-changed').textContent = changed() ? 'Есть' : 'Нет';
    const status = pane().querySelector('#search-settings-status');
    status.textContent = '';
    const notice = pane().querySelector('#search-settings-notice');
    if (!valid()) notice.textContent = 'Нужно указать корректные границы НМЦК: минимальная сумма не может превышать максимальную.';
    else if (!enabledCount()) notice.textContent = 'Все фильтры выключены — по умолчанию собираются все тендеры.';
    else notice.textContent = '';
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
  window.showSearchSettings = async (isModalModal) => {
    window.closeSourcingWorkspace?.();
    const show = window.showSearchSettings;
    if (!isModalModal) workspace().classList.add('view-search-settings');
    if (!isModalModal) { setActivePanel('settings');
    localStorage.setItem('okan_tender_panel_view_v1', 'settings');
    if (location.pathname !== publicPath('/settings')) history.replaceState(null, '', publicPath('/settings')); }
    if (!pane().dataset.ready) { render(); pane().dataset.ready = '1'; }
    pane().classList.add('open');
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
    if (!event.target.closest('#search-settings-pane')) return;
    const mode = event.target.closest('[data-search-mode]');
    if (mode) { current.settings.lots.mode = current.settings.lots.mode === mode.dataset.searchMode ? null : mode.dataset.searchMode; updateUi(); return; }
    const restoreButton = event.target.closest('[data-search-restore]');
    if (restoreButton) { restore(Number(restoreButton.dataset.searchRestore)); return; }
    if (event.target.id === 'search-settings-save') { save(); return; }
    if (event.target.id === 'search-settings-cancel') { current.settings = clone(savedSettings); updateUi(); return; }
    if (event.target.id === 'search-settings-reset') { reset(); }
  });
  document.addEventListener('change', event => {
    if (!event.target.closest('#search-settings-pane')) return;
    if (event.target.matches('[data-search-switch]')) { setPath(event.target.dataset.searchSwitch, event.target.checked); updateUi(); }
    if (event.target.id === 'search-missing-action') { current.settings.price.missingAction = event.target.value; updateUi(); }
    if (event.target.id === 'search-lots-mode') { current.settings.lots.mode = event.target.value; updateUi(); }
  });
  document.addEventListener('input', event => {
    if (!event.target.closest('#search-settings-pane')) return;
    if (event.target.matches('[data-search-price]')) { current.settings.price[event.target.dataset.searchPrice] = amount(event.target.value); updateUi({preservePriceFocus: true}); }
    if (event.target.id === 'search-share') { current.settings.lots.share = Math.max(0, Math.min(100, Number(event.target.value) || 0)); updateUi(); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    if (location.pathname === publicPath('/settings')) window.showSearchSettings();
    else if (location.pathname === publicPath('/') || location.pathname === API_PREFIX) registry();
  });
  window.addEventListener('hashchange', () => {
    const hashId = location.hash.startsWith('#tender-') ? decodeURIComponent(location.hash.replace('#tender-', '')) : '';
    if (hashId && String(activeTenderId) !== hashId) {
      selectTenderPrimary(hashId, false);
    }
  });
  window.addEventListener('popstate', () => {
    if (location.pathname === publicPath('/settings')) window.showSearchSettings();
    else if (location.pathname === publicPath('/') || location.pathname === API_PREFIX) registry();
  });
})();


  // Filter Reset & Badge Toggle Engine
  window.resetSingleFilter = function(e, type) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (type === 'status') {
      window.setRegistryTab('all');
    } else if (type === 'price') {
      const minInput = document.getElementById('MinPrice');
      const maxInput = document.getElementById('MaxPrice');
      if (minInput) minInput.value = '';
      if (maxInput) maxInput.value = '';
      window.filterCards(); if (window.updateFilterResetBadges) window.updateFilterResetBadges();
    } else if (type === 'extra') {
      const regSelect = document.getElementById('registry-region-select');
      const chkMargin = document.getElementById('chk-has-margin');
      const chkDocs = document.getElementById('chk-has-docs');
      const chkRnp = document.getElementById('chk-no-rnp');
      if (regSelect) regSelect.value = '';
      if (chkMargin) chkMargin.checked = false;
      if (chkDocs) chkDocs.checked = false;
      if (chkRnp) chkRnp.checked = false;
      window.filterCards(); if (window.updateFilterResetBadges) window.updateFilterResetBadges();
    }
  };

  // Update reset button state in JS
  window.updateFilterResetBadges = function() {
    const btnStatus = document.getElementById('reset-btn-status');
    const btnPrice = document.getElementById('reset-btn-price');
    const btnExtra = document.getElementById('reset-btn-extra');

    const statusVal = (typeof activeFilter !== 'undefined') ? activeFilter : 'all';
    const minVal = document.getElementById('MinPrice')?.value;
    const maxVal = document.getElementById('MaxPrice')?.value;
    const regVal = document.getElementById('registry-region-select')?.value;
    const chkMargin = document.getElementById('chk-has-margin')?.checked;
    const chkDocs = document.getElementById('chk-has-docs')?.checked;
    const chkRnp = document.getElementById('chk-no-rnp')?.checked;

    if (btnStatus) btnStatus.hidden = (!statusVal || statusVal === 'all');
    if (btnPrice) btnPrice.hidden = (!minVal && !maxVal);
    if (btnExtra) btnExtra.hidden = (!regVal && !chkMargin && !chkDocs && !chkRnp);
  };
// Single Bulletproof 1-Click Toggle for 1C Matches Sub-table
  window.toggleLineMatchesRow = function(btn, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!btn) return;
    const lineId = String(btn.getAttribute('data-line-toggle') || '').trim();
    if (!lineId) return;

    let targetRow = null;
    const rows = document.querySelectorAll('[data-matches-row]');
    rows.forEach(r => {
      if (String(r.getAttribute('data-matches-row') || '').trim() === lineId) {
        targetRow = r;
      }
    });

    if (targetRow) {
      const isCurrentlyHidden = targetRow.hidden || targetRow.hasAttribute('hidden') || (targetRow.style.display === 'none');
      if (isCurrentlyHidden) {
        expandedLineId = lineId;
        targetRow.hidden = false;
        targetRow.removeAttribute('hidden');
        targetRow.style.display = 'table-row';
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        btn.setAttribute('aria-expanded', 'true');
      } else {
        expandedLineId = null;
        targetRow.hidden = true;
        targetRow.setAttribute('hidden', '');
        targetRow.style.display = 'none';
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        btn.setAttribute('aria-expanded', 'false');
      }
    } else if (typeof renderDetailTab === 'function') {
      expandedLineId = lineId;
      renderDetailTab();
    }
  };

    function visibilityLeafRows(value, path = '') {
      if (value && typeof value === 'object' && Object.keys(value).length) {
        return Object.entries(value).flatMap(([key,child]) => visibilityLeafRows(child, `${path}/${key.replace(/~/g,'~0').replace(/\//g,'~1')}`));
      }
      return [{path:path || '/',value}];
    }
    const hasFieldValue = (v) => v !== null && v !== undefined && v !== '';
    function adaptTenderDetail(detail, projection) {
      const result = structuredClone(detail);
      const card = result.card ||= {};
      const fields = card.fields ||= {};
      const canonicalDeadline = officialRegistryDeadline(result.registry);
      if (canonicalDeadline) {
        result._ui_submission_deadline = canonicalDeadline.value;
        result._ui_submission_deadline_label = canonicalDeadline.label;
      }
      const all = [...(projection?.main_fields || []), ...(projection?.technical_fields || []),
        ...Object.values(projection?.sections || {}).flatMap(section => Object.values(section).flat())];
      for (const field of all) {
        if (!field || !field.name) continue;
        const unsafeAliases = UNSAFE_FIELD_ALIASES[String(field.field_key || '')] || new Set();
        const names = [field.name, ...(field.field_definition?.legacy_names || [])].filter((name) => name && !unsafeAliases.has(String(name)));
        for (const name of names) {
          // Existing explicit values (including zero/false and user values) win.
          if (!hasFieldValue(fields[name]?.value) && hasFieldValue(field.value)) fields[name] = {...field};
        }
      }
      // Core and legacy payloads can use different stable identifiers for the same TZ row.
      // Rebind offers to the actual card line ID before the renderer groups them.
      // Never invent a line: unmatched offers remain ungrouped and are not shown as a fit.
      card.tender_lines = Array.isArray(card.tender_lines) ? card.tender_lines : [];
      const lineByKey = new Map();
      const groupByLineId = new Map();
      const addLineKey = (key, id) => {
        if (lineByKey.has(key) && lineByKey.get(key) !== id) lineByKey.set(key, null);
        else if (!lineByKey.has(key)) lineByKey.set(key, id);
      };
      card.tender_lines.forEach(line => {
        const groupId = String(line?.product_group_id || '').trim();
        for (const key of [line?.line_id, line?.tender_line_id, line?.id]) {
          if (key != null && String(key).trim()) {
            addLineKey(String(key), line.line_id);
            if (groupId) groupByLineId.set(String(key), groupId);
          }
        }
        if (line?.line_number != null) {
          addLineKey(`number:${line.line_number}`, line.line_id);
          if (groupId) groupByLineId.set(`number:${line.line_number}`, groupId);
        }
        const legacy = String(line?.line_id || '').match(/^(.*)-line-0*([1-9]\d*)$/);
        if (legacy) addLineKey(`${legacy[1]}-${Number(legacy[2])}`, line.line_id);
      });
      const resolveOfferLineId = offer => {
        for (const value of [offer?.line_id, offer?.tender_line_id]) {
          if (value != null && lineByKey.get(String(value)) != null) return lineByKey.get(String(value));
        }
        if (offer?.line_number != null && lineByKey.get(`number:${offer.line_number}`) != null) return lineByKey.get(`number:${offer.line_number}`);
        return offer?.line_id;
      };
      const supplied = projection?.product_candidates?.display_results;
      const offers = [];
      const priceBasisLabel = (value) => ({
        PACKAGE: 'за упаковку', BOX: 'за короб', UNIT: 'за единицу',
        KILOGRAM: 'за кг', LITRE: 'за л', PIECE: 'за шт.',
      })[String(value || '').toUpperCase()] || '';
      const offerKey = o => JSON.stringify([o.line_id, o.price_registry_id ?? o.product_id, o.supplier, o.article, o.product_name]);
      const seen = new Map();
      for (const offer of [...(Array.isArray(card.supplier_offers) ? card.supplier_offers : []), ...(Array.isArray(supplied) ? supplied : [])]) {
        if (!offer || typeof offer !== 'object') continue;
        const lineId = resolveOfferLineId(offer);
        const tenderLine = card.tender_lines.find(line => String(line?.line_id || '') === String(lineId));
        const productGroupId = String(offer.product_group_id || groupByLineId.get(String(offer.line_id || offer.tender_line_id || lineId)) || tenderLine?.product_group_id || '').trim();
        const price = offer.price && typeof offer.price === 'object' ? offer.price : {};
        const sourcePrice = hasFieldValue(offer.purchase_price) ? offer.purchase_price
          : (hasFieldValue(price.source_with_vat) ? price.source_with_vat : price.raw);
        const reasons = Array.isArray(offer.reasons) ? offer.reasons.filter(Boolean).join('; ') : '';
        const normalized = {
          ...offer,
          line_id: lineId,
          source_line_ids: [lineId].filter(Boolean),
          product_group_id: productGroupId || undefined,
          tender_product_name: offer.tender_product_name || tenderLine?.name || offer.query_raw || '',
          product_name: offer.product_name || offer.name || '',
          match_score: hasFieldValue(offer.match_score) ? offer.match_score : offer.score,
          purchase_price: sourcePrice,
          price_unit: offer.price_unit || priceBasisLabel(price.source_basis),
          price_date: offer.price_date || price.price_date || price.loaded_at || offer.loaded_at || '',
          match_reason: offer.match_reason || reasons,
          source_price_display_warning: offer.source_price_display_warning || price.normalization_reason || '',
        };
        normalized.link_status = card.tender_lines.some(line => line.line_id != null && String(line.line_id) === String(normalized.line_id)) ? 'LINKED' : 'UNLINKED';
        const key = offerKey(normalized);
        if (seen.has(key)) {
          const previous = seen.get(key);
          previous.source_line_ids = [...new Set([...(previous.source_line_ids || []), ...(normalized.source_line_ids || [])])];
          for (const [field,value] of Object.entries(normalized)) if (!hasFieldValue(previous[field])) previous[field] = value;
        } else { seen.set(key, normalized); offers.push(normalized); }
      }
      card.supplier_offers = offers;
      // Only actual, explicitly supplied TZ rows belong to tender_lines.
      return result;
    }
    let tenderSelectionRequest = 0;
    let activeFullBundle = null;


// Opening a card must use the lightweight detail/documents/core calls declared above.
// `/full-data.json` is reserved for explicit download: it contains the complete
// audit bundle and is intentionally too large for first-screen rendering.
window.downloadTechnicalData = () => {
  if(activeTenderId) location.href = `${API_PREFIX}/api/tenders/${encodeURIComponent(activeTenderId)}/full-data.xlsx`;
};
if (window.showLogisticsWorkspace) window.openLogisticsWorkspace = window.showLogisticsWorkspace;


const loadRegistryOnce = loadRegistry;
let registryPending = null;
loadRegistry = function() {
  if (!registryPending) registryPending = loadRegistryOnce().finally(() => {registryPending = null;});
  return registryPending;
};
window.loadTenderRegistry = loadRegistry;


document.addEventListener('click', function(event) {
  const btn = document.getElementById('source-dropdown-btn');
  const menu = document.getElementById('source-dropdown-menu');
  if (menu && menu.style.display !== 'none') {
    if (!menu.contains(event.target) && !btn.contains(event.target)) {
      menu.style.display = 'none';
    }
  }
});

window.toggleSourceMenu = function(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('source-dropdown-menu');
  if (!menu) return;
  const opening = menu.style.display === 'none' || !menu.style.display;
  menu.style.display = opening ? 'block' : 'none';
  if (opening) {
    const button = document.getElementById('source-dropdown-btn');
    const rect = button.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  }
};
