export const newState = () => ({ semesters: [], events: [], templates: [], profile: {} });
export const id = () => crypto.randomUUID();
export const people = (event) =>
  event.selected.length + event.extras.reduce((total, extra) => total + extra.count, 0);
export function settlement(event) {
  const count = people(event);
  if (event.expense === '' || !count) return null;
  const amount = Math.floor(Number(event.expense) / count);
  return { amount, remainder: Number(event.expense) - amount * count };
}
export const won = (value) => Number(value).toLocaleString('ko-KR') + '원';
export const deadline = (event) => event.deadline
  ? event.deadline + (event.time ? ' ' + event.time : '') + '까지'
  : '';
export function notice(template, event, profile) {
  const result = settlement(event);
  const fields = {
    이벤트명: event.name, 시행일: event.date, 인원: people(event),
    납부액: result ? won(result.amount) : '', 마감: deadline(event),
    총무: profile.name, 은행: profile.bank, 계좌: profile.account, 예금주: profile.holder,
  };
  return template.replace(/\{\{([^{}]+)\}\}/g, (match, key) =>
    Object.hasOwn(fields, key) ? fields[key] ?? '' : match);
}
