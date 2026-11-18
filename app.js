import { config } from './config.js';
import { newState, id, people, settlement, won, deadline, notice } from './model.mjs';

const $ = (selector) => document.querySelector(selector);
const app = $('#app');
const dialog = $('#members');
const status = (message) => { $('#status').textContent = message; };
const escape = (value = '') => String(value).replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const local = !config.supabaseUrl || !config.publishableKey;
const storageKey = 'club-treasurer-v1';
let state = newState();
let client, club, session;
let saving = false;
let selection = new Set();

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

async function change(edit, refresh = render) {
  if (saving) return;
  saving = true;
  try {
    const next = structuredClone(state);
    edit(next);
    await save(next);
    status('저장했어요.');
    refresh();
  } catch (error) {
    status(error.message || '저장에 실패했어요.');
    if (dialog.open) drawMembers();
  } finally { saving = false; }
}

const eventPage = (event) => '#event/' + event.id;
const currentEvent = () => state.events.find((event) => eventPage(event) === location.hash);
const roster = (event) => state.semesters.find(({ id }) => id === event.semester)?.members ?? [];
const field = (label, name, extra = '', value = '') =>
  `<label>${label}<input name="${name}" ${extra} value="${escape(value)}"></label>`;

function render() {
  $('#nav').hidden = false;
  const event = currentEvent();
  if (event) return renderEvent(event);
  if (location.hash === '#roster') return renderRoster();
  if (location.hash === '#settings') return renderSettings();
  app.innerHTML = `<h1>이벤트</h1>
    <form id="new-event"><h2>새 이벤트</h2>
      ${field('이벤트명', 'name', 'required maxlength="100"')}
      ${field('시행일', 'date', 'type="date" required')}
      <label>학기<select name="semester" required>${[...state.semesters].reverse().map((term) =>
        `<option value="${term.id}">${escape(term.name)}</option>`).join('')}</select></label>
      <button ${state.semesters.length ? '' : 'disabled'}>이벤트 만들기</button>
      ${state.semesters.length ? '' : '<p><a href="#roster">학기 명단을 먼저 등록해 주세요.</a></p>'}
    </form>
    ${[...state.events].sort((a, b) => b.date.localeCompare(a.date)).map((item) =>
      `<a class="card between" href="${eventPage(item)}"><strong>${escape(item.name)}</strong>
        <small>${item.date} · ${people(item)}명 ${settlement(item) ? '· ' + won(settlement(item).amount) : ''}</small></a>`).join('')
      || '<p>등록한 이벤트가 없어요.</p>'}`;
  bind('#new-event', (data) => {
    const name = data.get('name').trim();
    if (!name) return status('이벤트명을 입력해 주세요.');
    const item = { id: id(), name, date: data.get('date'), semester: data.get('semester'),
      selected: [], extras: [], expense: '', deadline: '', time: '' };
    change((next) => next.events.push(item), () => { location.hash = eventPage(item); });
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
  $('#amount').textContent = result ? won(result.amount) : '—';
  $('#remainder').textContent = result ? '버림 차액 ' + won(result.remainder)
    : people(event) ? '총 지출액을 입력해 주세요.' : '참여자를 먼저 선택해 주세요.';
}

function renderEvent(event) {
  app.innerHTML = `<a href="#events">‹ 이벤트 목록</a><h1>${escape(event.name)}</h1>
    <section class="summary" aria-live="polite">1인당 납부액<strong id="amount"></strong><small id="remainder"></small></section>
    <section class="between"><span>시행일 ${event.date}</span><strong>총 참여 ${people(event)}명</strong></section>
    <section><h2>참여자</h2><button id="choose">참여자 선택</button>
      <p>${roster(event).filter((member) => event.selected.includes(member.id)).map((member) => escape(member.name)).join(' · ')}</p>
      ${event.extras.map((extra) => `<p class="between"><span>${escape(extra.name)} · ${extra.count}명</span>
        <button class="secondary" data-remove="${extra.id}">제외</button></p>`).join('')}
      <details><summary>추가 참여자 등록</summary><form id="extra">
        <label>등록 방식<select id="extra-kind" name="kind"><option value="person">이름</option><option value="group">단체명과 인원</option></select></label>
        ${field('이름 또는 단체명', 'name', 'required maxlength="80"')}
        <div id="group-size" hidden>${field('단체 인원', 'count', 'type="number" min="1" max="100000" step="1"', '1')}</div>
        <button>이 이벤트에 추가</button></form></details>
    </section>
    <form id="cost"><h2>정산과 입금 마감</h2>
      ${field('총 지출액 (원)', 'expense', 'type="number" inputmode="numeric" min="0" max="999999999999" step="1"', event.expense)}
      ${field('입금 마감 날짜', 'deadline', 'type="date"', event.deadline)}
      ${field('마감 시간 (선택, 한국 시간)', 'time', 'type="time"', event.time)}
      <p>${deadline(event) ? '입금 마감 ' + deadline(event) : '입금 마감 미정'}</p>
      <button>저장</button>
    </form>
    <section><h2>입금 공지</h2>${state.templates.length ? `
      <label>템플릿<select id="template">${state.templates.map((template) =>
        `<option value="${template.id}">${escape(template.name)}</option>`).join('')}</select></label>
      <label>공지 미리보기<textarea id="notice"></textarea></label>
      <button id="copy" ${settlement(event) ? '' : 'disabled'}>공지 복사</button>`
      : '<p><a href="#settings">설정에서 공지 템플릿을 등록해 주세요.</a></p>'}
    </section>`;
  drawSummary(event);
  const update = (edit, refresh) => change((next) => edit(next.events.find((item) => item.id === event.id)), refresh);
  $('#extra-kind').onchange = () => { $('#group-size').hidden = $('#extra-kind').value !== 'group'; };
  $('#choose').onclick = () => {
    selection = new Set(event.selected);
    $('#search').value = '';
    drawMembers();
    dialog.showModal();
  };
  app.querySelectorAll('[data-remove]').forEach((button) => {
    button.onclick = () => update((item) => {
      item.extras = item.extras.filter((extra) => extra.id !== button.dataset.remove);
    });
  });
  bind('#extra', (data) => {
    const name = data.get('name').trim();
    const count = data.get('kind') === 'person' ? 1 : Number(data.get('count'));
    if (!name || !Number.isInteger(count) || count < 1 || count > 100000) return status('이름과 인원수를 확인해 주세요.');
    update((item) => item.extras.push({ id: id(), name, count }));
  });
  const expense = $('#cost [name="expense"]');
  expense.oninput = () => drawSummary({ ...event, expense: expense.validity.valid ? expense.value : '' });
  bind('#cost', (data) => {
    if (data.get('time') && !data.get('deadline')) return status('마감 날짜도 입력해 주세요.');
    update((item) => Object.assign(item, Object.fromEntries(data)));
  });
  if ($('#template')) {
    const preview = () => {
      const template = state.templates.find(({ id }) => id === $('#template').value);
      $('#notice').value = notice(template.body, event, state.profile);
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
  const total = people({ ...event, selected: [...selection] });
  $('#count').textContent = '총 참여 ' + total + '명';
}

$('#search').oninput = drawMembers;
$('#done').onclick = () => {
  const event = currentEvent();
  const selected = [...selection];
  dialog.close();
  change((next) => {
    next.events.find(({ id }) => id === event.id).selected = selected;
  });
};

function renderSettings() {
  const profile = state.profile;
  app.innerHTML = `<h1>설정</h1><form id="profile"><h2>현 총무 정보</h2>
    ${field('총무 이름', 'name', 'required', profile.name)}
    ${field('은행', 'bank', 'required', profile.bank)}
    ${field('계좌번호', 'account', 'required', profile.account)}
    ${field('예금주', 'holder', 'required', profile.holder)}
    <button>총무 정보 저장</button></form>
    <form id="new-template"><h2>공지 템플릿</h2>
      ${state.templates.length ? `<ul>${state.templates.map((item) => '<li>' + escape(item.name) + '</li>').join('')}</ul>` : '<p>등록한 템플릿이 없어요.</p>'}
      <p><small>자동 입력 항목 {{이벤트명}} {{시행일}} {{인원}} {{납부액}} {{마감}} {{총무}} {{은행}} {{계좌}} {{예금주}}</small></p>
      ${field('템플릿 이름', 'name', 'required')}
      <label>내용<textarea name="body" required></textarea></label><button>템플릿 저장</button>
    </form>
    ${local ? '' : '<section><h2>인수인계</h2><p>링크를 만들고 후임 총무에게 직접 전달해 주세요. 후임이 링크에서 수락하면 관리 권한이 이전돼요.</p><button id="invite">인수인계 링크 만들기</button><label>인수인계 링크<input id="invite-url" readonly></label><button class="secondary" id="logout">로그아웃</button></section>'}`;
  bind('#profile', (data) => {
    const values = Object.fromEntries([...data].map(([key, value]) => [key, value.trim()]));
    if (Object.values(values).some((value) => !value)) return status('총무 정보를 모두 입력해 주세요.');
    change((next) => { next.profile = values; });
  });
  bind('#new-template', (data) => {
    const [name, body] = ['name', 'body'].map((key) => data.get(key).trim());
    if (!name || !body) return status('템플릿 이름과 내용을 입력해 주세요.');
    change((next) => next.templates.push({ id: id(), name, body }));
  });
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
