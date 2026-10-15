export const $ = (selector, root = document) => root.querySelector(selector);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function formatPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (!digits.length) return '';
  if (digits.length < 3) return `(${digits}`;
  const rest = digits.slice(2);
  const split = rest.length > 8 ? 5 : 4;
  return `(${digits.slice(0, 2)}) ${rest.slice(0, split)}${rest.length > split ? '-' + rest.slice(split) : ''}`;
}
export function phoneMask(input) {
  input.addEventListener('input', () => {
    const end = input.selectionStart === input.value.length;
    const position = input.selectionStart;
    const before = input.value.length;
    input.value = formatPhone(input.value);
    if (!end) input.setSelectionRange(Math.max(0, position + input.value.length - before), Math.max(0, position + input.value.length - before));
  });
}
export async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { cache: 'no-store', ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Tawper-Request': '1', ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir.'), { fields: data.fields || {}, status: response.status });
    return data;
  } catch (err) {
    if (err.name === 'AbortError' || err instanceof TypeError) throw new Error('Sem conexão com o servidor. Confira a internet e tente novamente.');
    throw err;
  } finally { clearTimeout(timeout); }
}
export const dateTime = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value));
export function localErrors(data) {
  const errors = {};
  if (!/^\p{L}.*\s+\p{L}/u.test(data.name.trim())) errors.name = 'Informe seu nome e sobrenome.';
  const phone = data.phone.replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 13) errors.phone = 'Informe um telefone válido com DDD.';
  if (data.role.trim().length < 2) errors.role = 'Informe seu cargo.';
  if (data.company.trim().length < 2) errors.company = 'Informe a empresa que você representa.';
  return errors;
}
