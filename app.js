import { config } from './config.js';
import { newState, id, people, settlement, won, deadline, notice } from './model.mjs';

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const dialog = $('#members');
const paymentDialog = $('#payment-checks');
const completionDialog = $('#completion');
const status = (message) => { $('#status').textContent = message; };
const escape = (value = '') => String(value).replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const local = !config.supabaseUrl || !config.publishableKey;
const storageKey = 'club-treasurer-v1';
let state = newState();
let client, club, session;
let saving = false;
let selection = new Set();
let eventDraft = null;

// iOS Safari changes the visual viewport when its software keyboard opens.
// Keep the focused field inside that visible area after focus and viewport changes.
function revealFocusedField() {
  const target = document.activeElement;
  if (!target?.matches('input:not([type="checkbox"]), textarea, select')) return;

  const viewport = window.visualViewport;
  const visibleTop = viewport?.offsetTop ?? 0;
  const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
  const rect = target.getBoundingClientRect();
  const margin = 16;
  let shift = 0;
  if (rect.bottom > visibleBottom - margin) shift = rect.bottom - visibleBottom + margin;
  else if (rect.top < visibleTop + margin) shift = rect.top - visibleTop - margin;
  if (!shift) return;

  const dialogScroller = target.closest('dialog[open]');
  if (dialogScroller) dialogScroller.scrollBy({ top: shift, behavior: 'smooth' });
  else window.scrollBy({ top: shift, behavior: 'smooth' });
}

function scheduleFocusedFieldReveal() {
  requestAnimationFrame(revealFocusedField);
  // Safari reports the keyboard's final visual viewport after focus dispatch.
  window.setTimeout(revealFocusedField, 280);
}

document.addEventListener('focusin', scheduleFocusedFieldReveal);
window.visualViewport?.addEventListener('resize', scheduleFocusedFieldReveal);
window.visualViewport?.addEventListener('scroll', scheduleFocusedFieldReveal);

async function save(next) {
  if (local) localStorage.setItem(storageKey, JSON.stringify(next));
  else {
    const { data, error } = await client.rpc('save_club', {
      club_id: club.id, expected_revision: club.revision, next_state: next,
    });
    if (error) throw error;
    club.revision = data;
  }
  state = next;
}

async function change(edit, refresh = render, successMessage = '수정이 완료되었습니다.') {
  if (saving) return;
  saving = true;
  try {
    const next = structuredClone(state);
    edit(next);
    await save(next);
    refresh();
    status('저장했어요.');
    $('#completion-message').textContent = successMessage;
    if (!completionDialog.open) completionDialog.showModal();
  } catch (error) {
    status(error.message || '저장에 실패했어요.');
    if (dialog.open) drawMembers();
    if (paymentDialog.open && currentEvent()) drawPaymentDialog(currentEvent());
  } finally { saving = false; }
}

const eventPage = (event) => '#event/' + event.id;
const eventEditPage = (event) => eventPage(event) + '/edit';
const eventNoticePage = (event) => eventPage(event) + '/notice';
const currentEvent = () => {
  const match = location.hash.match(/^#event\/([^/]+)/);
  return match ? state.events.find((event) => event.id === match[1]) : undefined;
};
const roster = (event) => state.semesters.find(({ id }) => id === event.semester)?.members ?? [];
function attendeeRows(event) {
  const members = roster(event).filter((member) => event.selected.includes(member.id))
    .map((member) => ({ key: 'member:' + member.id, name: member.name, count: 1 }));
  const extras = (event.extras ?? []).map((extra) => ({
    key: 'extra:' + extra.id, name: extra.name, count: Number(extra.count) || 1,
  }));
  return [...members, ...extras];
}
const paidKeys = (event) => new Set(Array.isArray(event.paid) ? event.paid : []);
const paidCount = (event) => {
  const paid = paidKeys(event);
  return attendeeRows(event).reduce((count, attendee) => count + (paid.has(attendee.key) ? attendee.count : 0), 0);
};
const paymentRows = (event) => {
  const paid = paidKeys(event);
  return attendeeRows(event).sort((a, b) => Number(paid.has(a.key)) - Number(paid.has(b.key)));
};
const participantNames = (event) => attendeeRows(event).map(({ name, count }) =>
  count > 1 ? `${name} (${count}명)` : name);
function prunePaid(event) {
  const activeKeys = new Set(attendeeRows(event).map(({ key }) => key));
  event.paid = (Array.isArray(event.paid) ? event.paid : []).filter((key) => activeKeys.has(key));
}
const field = (label, name, extra = '', value = '') =>
  `<label>${label}<input name="${name}" ${extra} value="${escape(value)}"></label>`;
const eventKind = (event) => event.kind === 'settlement' ? 'settlement' : 'event';
const eventKindLabel = (event) => eventKind(event) === 'settlement' ? '정산 체크용' : '행사';
const eventSortDate = (event) => event.date || event.deadline || '';

function render() {
  if (!location.hash.endsWith('/edit')) eventDraft = null;
  $('#nav').hidden = false;
  const event = currentEvent();
  if (event) {
    if (location.hash.endsWith('/edit')) return renderEventEdit(event);
    if (location.hash.endsWith('/notice')) return renderEventNotice(event);
    return renderEventView(event);
  }
  if (location.hash === '#new-event') return renderNewEvent();
  if (location.hash === '#pending') return renderPending();
  if (location.hash === '#roster') return renderRoster();
  if (location.hash === '#settings/edit') return renderSettingsEdit();
  if (location.hash === '#settings') return renderSettingsView();
  app.innerHTML = `<div class="event-actions"><h1>행사·정산</h1><a class="button-link" href="#new-event">+ 항목 추가</a></div>
    ${[...state.events].sort((a, b) => eventSortDate(b).localeCompare(eventSortDate(a))).map((item) =>
      `<a class="card between" href="${eventPage(item)}"><strong>${escape(item.name)}</strong>
        <small><span class="kind-label">${eventKindLabel(item)}</span> · ${eventKind(item) === 'settlement' ? '입금 마감 ' + escape(deadline(item) || '미정') : escape(item.date)} · ${people(item)}명 ${settlement(item) ? '· ' + won(settlement(item).amount) : '· 정산 금액 미입력'}
          ${people(item) ? '· 입금 ' + paidCount(item) + '/' + people(item) + '명' : ''}</small></a>`).join('')
      || '<p>등록한 항목이 없어요.</p>'}`;
}

function renderNewEvent() {
  app.innerHTML = `<div class="event-actions"><a href="#events">‹ 행사·정산 목록</a></div>
    <h1>새 항목</h1><form id="new-event">
      ${field('이름', 'name', 'required maxlength="100"')}
      <label>종류<select name="kind" id="new-kind"><option value="event">행사</option><option value="settlement">정산 체크용</option></select></label>
      <div id="new-event-date">${field('시행일', 'date', 'type="date" required')}</div>
      <div id="new-event-deadline" hidden>${field('입금 마감일', 'deadline', 'type="date"')}${field('마감 시간 (선택, 한국 시간)', 'time', 'type="time"')}</div>
      <label>학기<select name="semester" required>${[...state.semesters].reverse().map((term) =>
        `<option value="${escape(term.id)}">${escape(term.name)}</option>`).join('')}</select></label>
      <button ${state.semesters.length ? '' : 'disabled'}>항목 만들기</button>
      ${state.semesters.length ? '' : '<p><a href="#roster">학기 명단을 먼저 등록해 주세요.</a></p>'}
    </form>`;
  const syncKind = () => {
    const settlementOnly = $('#new-kind').value === 'settlement';
    $('#new-event-date').hidden = settlementOnly;
    $('#new-event-deadline').hidden = !settlementOnly;
    $('#new-event-date [name="date"]').required = !settlementOnly;
    $('#new-event-deadline [name="deadline"]').required = settlementOnly;
  };
  $('#new-kind').onchange = syncKind;
  syncKind();
  bind('#new-event', (data) => {
    const name = data.get('name').trim();
    if (!name) return status('이벤트명을 입력해 주세요.');
    const kind = data.get('kind');
    const date = data.get('date');
    const deadlineDate = data.get('deadline');
    if (kind === 'event' && !date) return status('행사 시행일을 입력해 주세요.');
    if (kind === 'settlement' && !deadlineDate) return status('입금 마감일을 입력해 주세요.');
    if (data.get('time') && !deadlineDate) return status('마감 날짜도 입력해 주세요.');
    const item = { id: id(), name, kind, date: kind === 'event' ? date : '', semester: data.get('semester'),
      selected: [], extras: [], paid: [], expense: '', deadline: deadlineDate || '', time: data.get('time') || '' };
    change((next) => next.events.push(item), () => { location.hash = eventPage(item); }, '새 항목이 등록되었습니다.');
  });
}

function bind(selector, action) {
  const form = $(selector);
  form.onsubmit = (event) => {
    event.preventDefault();
    action(new FormData(form));
  };
}

function renderRoster() {
  app.innerHTML = `<h1>학기 명단</h1><form id="new-roster">
    ${field('학기 이름', 'name', 'required placeholder="2026년 2학기" maxlength="50"')}
    <label>이름 (한 줄에 한 명)<textarea required name="members"></textarea></label>
    <button>학기 명단 등록</button></form>
    ${[...state.semesters].reverse().map((term) => `<section><details><summary>${escape(term.name)}
      · ${term.members.length}명</summary><p>${term.members.map((member) => escape(member.name)).join(' · ')}</p>
      <label>새 회원 이름<input maxlength="80" data-name="${term.id}"></label>
      <button data-add="${term.id}">회원 추가</button></details></section>`).join('')}`;
  bind('#new-roster', (data) => {
    const name = data.get('name').trim();
    const names = data.get('members').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
    if (!name || !names.length) return status('학기와 명단을 입력해 주세요.');
    if (state.semesters.some((term) => term.name === name)) return status('이미 등록된 학기예요.');
    change((next) => next.semesters.push({ id: id(), name, members: names.map((name) => ({ id: id(), name })) }));
  });
  app.querySelectorAll('[data-add]').forEach((button) => {
    button.onclick = () => {
      const name = $(`[data-name="${button.dataset.add}"]`).value.trim();
      if (!name) return status('이름을 입력해 주세요.');
      change((next) => next.semesters.find((term) => term.id === button.dataset.add).members.push({ id: id(), name }));
    };
  });
}

function drawSummary(event) {
  const result = settlement(event);
  const isSettlementCheck = eventKind(event) === 'settlement';
  $('#summary-title').textContent = isSettlementCheck ? '총 납부액' : '인당 납부액';
  $('#amount').textContent = result ? won(isSettlementCheck ? result.total : result.amount) : '—';
  $('#remainder').textContent = result
    ? isSettlementCheck
      ? `인당 ${won(result.amount)}`
      : `총 납부액 ${won(result.total)}${result.remainder ? ' · 버림 차액 ' + won(result.remainder) : ''}`
    : people(event) ? isSettlementCheck ? '인당 납부액을 입력해 주세요.' : '총 납부액을 입력해 주세요.' : '참여자를 먼저 선택해 주세요.';
}

function renderPending() {
  const pending = [...state.events]
    .filter((event) => people(event) > 0 && paidCount(event) < people(event))
    .sort((a, b) => eventSortDate(b).localeCompare(eventSortDate(a)));
  app.innerHTML = `<h1>미완료 정산</h1><p>입금 확인이 끝나지 않은 항목이에요.</p>
    ${pending.map((event) => `<a class="card" href="${eventPage(event)}">
      <strong>${escape(event.name)}</strong>
      <small>${eventKindLabel(event)} · ${eventKind(event) === 'settlement' ? '입금 마감 ' + escape(deadline(event) || '미정') : escape(event.date)} · ${settlement(event) ? won(settlement(event).amount) + ' / 1인' : '정산 금액 미입력'}</small>
      <span class="progress-label">입금 ${paidCount(event)} / ${people(event)}명</span>
    </a>`).join('') || '<section><p>미완료된 정산이 없어요.</p></section>'}`;
}

function renderEventView(event) {
  const attendees = paymentRows(event);
  const paid = paidKeys(event);
  app.innerHTML = `<div class="event-actions"><a href="#events">‹ 행사·정산 목록</a>
      <a class="button-link" href="${eventEditPage(event)}">이벤트 수정</a></div>
    <h1>${escape(event.name)}</h1>
    <section class="summary" aria-live="polite"><span id="summary-title"></span><strong id="amount"></strong><small id="remainder"></small></section>
    <section class="between"><span class="kind-label">${eventKindLabel(event)}</span>${eventKind(event) === 'event' ? `<span>시행일 ${escape(event.date)}</span>` : ''}<strong>총 참여 ${people(event)}명</strong></section>
    <section><h2>참여자</h2>
      <p class="attendee-inline">${participantNames(event).map(escape).join(', ') || '참여자를 선택하지 않았어요.'}</p>
      <p><small>입금 ${paidCount(event)} / ${people(event)}명 완료</small></p>
    </section>
    <section><h2>입금 현황</h2>
      ${attendees.length ? `<ul class="payment-status-list">${attendees.map((attendee) =>
        `<li><span>${escape(attendee.name)}${attendee.count > 1 ? ` · ${attendee.count}명` : ''}</span>
          <strong class="${paid.has(attendee.key) ? 'paid-status' : 'unpaid-status'}">${paid.has(attendee.key) ? '입금 완료' : '미입금'}</strong></li>`).join('')}</ul>` : '<p>참여자를 먼저 등록해 주세요.</p>'}
      <button id="payment-open" type="button" ${attendees.length ? '' : 'disabled'}>입금 확인</button>
    </section>
    <section><h2>정산과 입금 마감</h2>
      <p>총 납부액: ${settlement(event) ? won(settlement(event).total) : '미입력'}</p>
      <p>${deadline(event) ? '입금 마감 ' + escape(deadline(event)) : '입금 마감 미정'}</p>
    </section>
    <section><h2>입금 공지</h2><p>공지 확인과 복사는 별도 화면에서 할 수 있어요.</p>
      <a class="button-link" href="${eventNoticePage(event)}">입금 공지 열기</a></section>`;
  drawSummary(event);
  $('#payment-open').onclick = () => {
    drawPaymentDialog(event);
    paymentDialog.showModal();
  };
}

function renderEventNotice(event) {
  app.innerHTML = `<div class="event-actions"><a href="${eventPage(event)}">‹ 이벤트 보기</a>
      <a class="button-link" href="${eventEditPage(event)}">이벤트 수정</a></div>
    <h1>${escape(event.name)} 입금 공지</h1>
    ${state.templates.length ? `<section>
      <label>템플릿<select id="template">${state.templates.map((template) =>
        `<option value="${escape(template.id)}">${escape(template.name)}</option>`).join('')}</select></label>
      <label for="notice">공지 미리보기</label><textarea id="notice" readonly rows="12" aria-label="공지 미리보기"></textarea>
      <button id="copy" ${settlement(event) ? '' : 'disabled'}>공지 복사</button>
    </section>` : '<section><p>공지 템플릿이 없어요.</p><a href="#settings">설정에서 템플릿 등록</a></section>'}`;
  if ($('#template')) {
    const preview = () => {
      const template = state.templates.find(({ id }) => id === $('#template').value);
      $('#notice').value = notice(template.body, event, state.profile, participantNames(event));
    };
    $('#template').onchange = preview;
    preview();
    $('#copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText($('#notice').value);
        status('공지를 복사했어요.');
      } catch {
        $('#notice').select();
        status('자동 복사에 실패했어요. 선택된 공지문을 복사해 주세요.');
      }
    };
  }
}

function drawPaymentDialog(event) {
  const attendees = paymentRows(event);
  const paid = paidKeys(event);
  $('#payment-rows').innerHTML = attendees.map((attendee) =>
    `<label class="payment-check-row ${paid.has(attendee.key) ? 'is-paid' : ''}">
      <input type="checkbox" name="paid" value="${escape(attendee.key)}" data-count="${attendee.count}" ${paid.has(attendee.key) ? 'checked' : ''}>
      <span>${escape(attendee.name)}${attendee.count > 1 ? ` · ${attendee.count}명 전원` : ''}</span>
      <strong>${paid.has(attendee.key) ? '입금 완료' : '미입금'}</strong>
    </label>`).join('') || '<p>확인할 참여자가 없어요.</p>';
  updatePaymentDialogSummary();
  $('#payment-rows').onchange = (event) => {
    if (event.target.name !== 'paid') return;
    const row = event.target.closest('.payment-check-row');
    row.classList.toggle('is-paid', event.target.checked);
    row.querySelector('strong').textContent = event.target.checked ? '입금 완료' : '미입금';
    const rows = [...$('#payment-rows').querySelectorAll('.payment-check-row')]
      .sort((a, b) => Number(a.querySelector('[name="paid"]').checked) - Number(b.querySelector('[name="paid"]').checked));
    rows.forEach((item) => $('#payment-rows').append(item));
    updatePaymentDialogSummary();
  };
}

function updatePaymentDialogSummary() {
  const checkedCount = [...$('#payment-rows').querySelectorAll('[name="paid"]:checked')]
    .reduce((total, checkbox) => total + Number(checkbox.dataset.count), 0);
  const totalCount = [...$('#payment-rows').querySelectorAll('[name="paid"]')]
    .reduce((total, checkbox) => total + Number(checkbox.dataset.count), 0);
  $('#payment-total').textContent = `입금 ${checkedCount} / ${totalCount}명 완료`;
}

function renderEventEdit(event) {
  if (!eventDraft || eventDraft.id !== event.id) eventDraft = structuredClone(event);
  const draft = eventDraft;
  if (eventKind(draft) === 'settlement' && draft.amountPerPerson === undefined)
    draft.amountPerPerson = settlement(draft)?.amount ?? '';
  app.innerHTML = `<div class="event-actions"><a href="${eventPage(event)}">‹ 항목 보기</a></div>
    <h1>${escape(draft.name)} 수정</h1>
    <form id="event-editor">
      <section><h2>항목 정보</h2>
        ${field('이름', 'name', 'required maxlength="100"', draft.name)}
        <p>종류: <strong>${eventKindLabel(draft)}</strong></p>
        ${eventKind(draft) === 'event' ? field('시행일', 'date', 'type="date" required', draft.date || '') : ''}
      </section>
      <section><h2>참여자</h2>
        <button id="choose" type="button">참여자 선택</button>
        <p class="attendee-inline">${participantNames(draft).map(escape).join(', ') || '선택한 참여자가 없어요.'}</p>
        ${draft.extras.map((extra) => `<p class="between"><span>${escape(extra.name)} · ${extra.count}명</span>
          <button class="secondary" type="button" data-remove="${escape(extra.id)}">제외</button></p>`).join('')}
        <details><summary>추가 참여자 등록</summary>
          <label>등록 방식<select id="extra-kind"><option value="person">이름</option><option value="group">단체명과 인원</option></select></label>
          ${field('이름 또는 단체명', 'extra-name', 'maxlength="80"')}
          <div id="group-size" hidden>${field('단체 인원', 'extra-count', 'type="number" min="1" max="100000" step="1"', '1')}</div>
          <button id="extra-add" type="button">참여자 추가</button>
        </details>
      </section>
      <section><h2>정산과 입금 마감</h2>
        <div class="summary" aria-live="polite"><span id="summary-title"></span><strong id="amount"></strong><small id="remainder"></small></div>
        ${eventKind(draft) === 'settlement'
          ? field('인당 납부액 (원)', 'amountPerPerson', 'type="number" inputmode="numeric" min="0" max="999999999999" step="1" required', draft.amountPerPerson)
          : field('총 납부액 (원)', 'expense', 'type="number" inputmode="numeric" min="0" max="999999999999" step="1" required', draft.expense)}
        ${field('입금 마감 날짜', 'deadline', `type="date" ${eventKind(draft) === 'settlement' ? 'required' : ''}`, draft.deadline)}
        ${field('마감 시간 (선택, 한국 시간)', 'time', 'type="time"', draft.time)}
        <p>${deadline(draft) ? '입금 마감 ' + escape(deadline(draft)) : '입금 마감 미정'}</p>
      </section>
      <button class="save-all">전체 내용 저장</button>
    </form>`;
  drawSummary(draft);
  const syncDraftFromForm = () => {
    const data = new FormData($('#event-editor'));
    draft.name = data.get('name') ?? draft.name;
    if (eventKind(draft) === 'event') draft.date = data.get('date') ?? draft.date;
    draft.deadline = data.get('deadline') ?? draft.deadline;
    draft.time = data.get('time') ?? draft.time;
    if (eventKind(draft) === 'settlement') {
      const amount = data.get('amountPerPerson');
      draft.amountPerPerson = amount === '' ? '' : Number(amount);
    } else {
      draft.expense = data.get('expense') ?? draft.expense;
    }
  };
  $('#event-editor').addEventListener('input', () => {
    syncDraftFromForm();
    drawSummary(draft);
  });
  $('#event-editor').addEventListener('change', syncDraftFromForm);
  $('#choose').onclick = () => {
    syncDraftFromForm();
    selection = new Set(draft.selected);
    $('#search').value = '';
    drawMembers();
    dialog.showModal();
  };
  $('#extra-kind').onchange = () => { $('#group-size').hidden = $('#extra-kind').value !== 'group'; };
  app.querySelectorAll('[data-remove]').forEach((button) => {
    button.onclick = () => {
      syncDraftFromForm();
      draft.extras = draft.extras.filter((extra) => extra.id !== button.dataset.remove);
      prunePaid(draft);
      renderEventEdit(event);
    };
  });
  $('#extra-add').onclick = () => {
    syncDraftFromForm();
    const name = $('#event-editor [name="extra-name"]').value.trim();
    const count = $('#extra-kind').value === 'person' ? 1 : Number($('#event-editor [name="extra-count"]').value);
    if (!name || !Number.isInteger(count) || count < 1 || count > 100000) return status('이름과 인원수를 확인해 주세요.');
    draft.extras.push({ id: id(), name, count });
    renderEventEdit(event);
  };
  bind('#event-editor', (data) => {
    const name = data.get('name').trim();
    const date = data.get('date');
    if (!name || (eventKind(draft) === 'event' && !date)) return status('이름과 행사 시행일을 확인해 주세요.');
    const amount = eventKind(draft) === 'settlement' ? data.get('amountPerPerson') : data.get('expense');
    if (amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0)
      return status(eventKind(draft) === 'settlement' ? '인당 납부액을 확인해 주세요.' : '총 납부액을 확인해 주세요.');
    if (data.get('time') && !data.get('deadline')) return status('마감 날짜도 입력해 주세요.');
    const updated = structuredClone(draft);
    Object.assign(updated, { name, date: eventKind(draft) === 'event' ? date : '',
      deadline: data.get('deadline'), time: data.get('time') });
    if (eventKind(draft) === 'settlement') {
      updated.amountPerPerson = Number(amount);
      updated.expense = '';
    } else {
      updated.expense = Number(amount);
      delete updated.amountPerPerson;
    }
    prunePaid(updated);
    change((next) => {
      const index = next.events.findIndex(({ id }) => id === event.id);
      next.events[index] = updated;
    }, () => {
      eventDraft = null;
      location.hash = eventPage(event);
    });
  });
}

function drawMembers() {
  const event = currentEvent();
  if (!event) return;
  const query = $('#search').value.trim().toLowerCase();
  updateMemberCount(event);
  $('#member-list').innerHTML = roster(event).filter(({ name }) => name.toLowerCase().includes(query))
    .map((member) => `<label class="member"><input type="checkbox" value="${member.id}"
      ${selection.has(member.id) ? 'checked' : ''}>${escape(member.name)}</label>`).join('')
    || '<p>표시할 사람이 없어요.</p>';
  $('#member-list').onchange = (inputEvent) => {
    const checkbox = inputEvent.target;
    if (checkbox.checked) selection.add(checkbox.value);
    else selection.delete(checkbox.value);
    updateMemberCount(event);
  };
}

function updateMemberCount(event) {
  const source = location.hash.endsWith('/edit') && eventDraft?.id === event.id ? eventDraft : event;
  const total = people({ ...source, selected: [...selection] });
  $('#count').textContent = '총 참여 ' + total + '명';
}

$('#search').oninput = drawMembers;
$('#done').onclick = () => {
  const event = currentEvent();
  const selected = [...selection];
  dialog.close();
  if (location.hash.endsWith('/edit') && eventDraft?.id === event?.id) {
    eventDraft.selected = selected;
    prunePaid(eventDraft);
    renderEventEdit(event);
    return;
  }
  change((next) => {
    const item = next.events.find(({ id }) => id === event.id);
    item.selected = selected;
    prunePaid(item);
  }, () => { location.hash = eventPage(event); });
};

$('#payment-close').onclick = () => paymentDialog.close();
bind('#payment-form', (data) => {
  const event = currentEvent();
  if (!event) return;
  const paid = data.getAll('paid');
  change((next) => {
    const item = next.events.find(({ id }) => id === event.id);
    item.paid = paid;
    prunePaid(item);
  }, () => {
    paymentDialog.close();
    render();
  });
});

function renderSettingsView() {
  const profile = state.profile;
  app.innerHTML = `<div class="event-actions"><h1>설정</h1><a class="button-link" href="#settings/edit">설정 수정</a></div>
    <section><h2>총무 정보</h2>
      <p>이름: ${escape(profile.name || '미설정')}</p><p>은행: ${escape(profile.bank || '미설정')}</p>
      <p>계좌번호: ${escape(profile.account || '미설정')}</p><p>예금주: ${escape(profile.holder || '미설정')}</p></section>
    <section><h2>공지 템플릿</h2>
      ${state.templates.length ? state.templates.map((item) => `<details><summary>${escape(item.name)}</summary><pre class="template-body">${escape(item.body)}</pre></details>`).join('') : '<p>등록한 템플릿이 없어요.</p>'}
      <p><small>자동 입력 항목: {{이벤트명}} {{시행일}} {{인원}} {{참여자명단}} {{인당비용}} {{납부액}} {{마감}} {{총무}} {{은행}} {{계좌}} {{예금주}}</small></p>
    </section>
    ${local ? '' : '<section><h2>인수인계</h2><p>링크를 만들고 후임 총무에게 직접 전달해 주세요. 후임이 링크에서 수락하면 관리 권한이 이전돼요.</p><button id="invite">인수인계 링크 만들기</button><label>인수인계 링크<input id="invite-url" readonly></label><button class="secondary" id="logout">로그아웃</button></section>'}`;
  if (!local) {
    $('#logout').onclick = async () => { await client.auth.signOut(); location.reload(); };
    $('#invite').onclick = async () => {
      const { data, error } = await client.rpc('create_handover', { club_id: club.id });
      if (error) return status(error.message);
      const url = new URL(location.pathname, location.origin);
      url.searchParams.set('handover', data);
      $('#invite-url').value = url.href;
      $('#invite-url').select();
    };
  }
}

function renderSettingsEdit() {
  const profile = state.profile;
  app.innerHTML = `<div class="event-actions"><a href="#settings">‹ 설정 보기</a></div><h1>설정 수정</h1><form id="profile"><h2>총무 정보</h2>
    ${field('총무 이름', 'name', 'required', profile.name)}
    ${field('은행', 'bank', 'required', profile.bank)}
    ${field('계좌번호', 'account', 'required', profile.account)}
    ${field('예금주', 'holder', 'required', profile.holder)}
    <button>총무 정보 저장</button></form>
    <form id="new-template"><h2>공지 템플릿</h2>
      ${state.templates.length ? `<ul>${state.templates.map((item) => '<li>' + escape(item.name) + '</li>').join('')}</ul>` : '<p>등록한 템플릿이 없어요.</p>'}
      <p><small>자동 입력 항목 {{이벤트명}} {{시행일}} {{인원}} {{참여자명단}} {{인당비용}} {{납부액}} {{마감}} {{총무}} {{은행}} {{계좌}} {{예금주}}</small></p>
      ${field('템플릿 이름', 'name', 'required')}
      <label>내용<textarea name="body" required></textarea></label><button>템플릿 저장</button>
    </form>
    `;
  bind('#profile', (data) => {
    const values = Object.fromEntries([...data].map(([key, value]) => [key, value.trim()]));
    if (Object.values(values).some((value) => !value)) return status('총무 정보를 모두 입력해 주세요.');
    change((next) => { next.profile = values; }, () => { location.hash = '#settings'; });
  });
  bind('#new-template', (data) => {
    const [name, body] = ['name', 'body'].map((key) => data.get(key).trim());
    if (!name || !body) return status('템플릿 이름과 내용을 입력해 주세요.');
    change((next) => next.templates.push({ id: id(), name, body }), () => { location.hash = '#settings'; });
  });
}

async function start() {
  if (local) {
    $('#mode').textContent = '이 브라우저에서만 저장되는 체험판';
    state = JSON.parse(localStorage.getItem(storageKey) ?? 'null') ?? newState();
    render();
    return;
  }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.86.0');
  client = createClient(config.supabaseUrl, config.publishableKey);
  const url = new URL(location.href);
  const token = url.searchParams.get('handover');
  const result = await client.auth.getSession();
  if (result.error) throw result.error;
  session = result.data.session;
  if (!session) {
    app.innerHTML = '<section><h1>동아리 정산</h1><button id="login">카카오 로그인</button></section>';
    $('#login').onclick = async () => {
      const redirectTo = new URL(location.pathname, location.origin);
      if (token) redirectTo.searchParams.set('handover', token);
      const { error } = await client.auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: redirectTo.href } });
      if (error) status(error.message);
    };
    return;
  }
  if (token) {
    app.innerHTML = '<section><h1>인수인계</h1><button id="accept">총무 권한 받기</button></section>';
    $('#accept').onclick = async () => {
      const { error } = await client.rpc('accept_handover', { invite_token: token });
      if (error) return status(error.message);
      location.replace(location.pathname);
    };
    return;
  }
  const { data, error } = await client.from('club_workspace').select('id,state,revision').maybeSingle();
  if (error) throw error;
  if (!data) {
    app.innerHTML = '<section><h1>총무 권한이 필요해요</h1><p>후임 총무라면 전달받은 인수인계 링크를 열어 주세요.</p><button id="exit">로그아웃</button></section>';
    $('#exit').onclick = async () => { await client.auth.signOut(); location.reload(); };
    return;
  }
  club = data;
  state = data.state;
  render();
}

window.addEventListener('hashchange', () => { if (local || club) render(); });
start().catch((error) => status(error.message || '앱을 열지 못했어요.'));
