import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export class AppError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export function validateParticipant(body, { requireAnswers = true } = {}) {
  const errors = {};
  const clean = (key, label, min, max) => {
    const value = typeof body?.[key] === 'string' ? body[key].trim().replace(/\s+/g, ' ') : '';
    if (value.length < min || value.length > max || /[\u0000-\u001f<>]/u.test(value)) errors[key] = `${label}: informe de ${min} a ${max} caracteres.`;
    return value;
  };
  const name = clean('name', 'Nome', 3, 100);
  if (!/^\p{L}.*\s+\p{L}/u.test(name)) errors.name = 'Informe seu nome e sobrenome.';
  const role = clean('role', 'Cargo', 2, 100);
  const company = clean('company', 'Empresa', 2, 120);
  const answer = (key, message) => {
    const value = body?.[key];
    if (value === true || value === 'yes') return true;
    if (value === false || value === 'no') return false;
    if (requireAnswers || value !== undefined) errors[key] = message;
    return undefined;
  };
  const isCustomer = answer('isCustomer', 'Informe se você já é nosso cliente.');
  const wantsTechnicalSupport = answer('wantsTechnicalSupport', 'Informe se deseja receber um atendimento técnico.');
  const raw = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const parsed = raw.length <= 30 && /^[+()\d\s-]+$/u.test(raw) ? parsePhoneNumberFromString(raw, 'BR') : null;
  if (!parsed || parsed.country !== 'BR' || !parsed.isValid() || !['MOBILE', 'FIXED_LINE', 'FIXED_LINE_OR_MOBILE'].includes(parsed.getType())) {
    errors.phone = 'Informe um telefone brasileiro válido, com DDD.';
  }
  if (Object.keys(errors).length) throw new AppError(422, 'Confira os campos indicados.', errors);
  return { name, phone: parsed.number, role, company, isCustomer, wantsTechnicalSupport };
}

export function csvCell(value) {
  let safe = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(safe)) safe = `'${safe}`;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows) {
  const header = ['Inscrição', 'Nome', 'Telefone', 'Cargo', 'Empresa', 'Já é cliente', 'Deseja atendimento técnico', 'Cadastro (Brasília)', 'Já sorteado'];
  const answer = value => value == null ? 'Não informado' : value ? 'Sim' : 'Não';
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' });
  return '\uFEFF' + [header, ...rows.map(row => [row.number, row.name, row.phone, row.role, row.company, answer(row.isCustomer), answer(row.wantsTechnicalSupport), date.format(new Date(row.createdAt)), row.won ? 'Sim' : 'Não'])].map(line => line.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
