import { $, api, phoneMask, localErrors } from './shared.js';

const form = $('#registration-form');
const button = $('#submit-button');
phoneMask($('#phone'));
function clearErrors() {
  document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  $('#form-message').hidden = true;
}
function showErrors(fields, message) {
  for (const [key, value] of Object.entries(fields)) {
    const input = form.elements.namedItem(key);
    const output = $(`#${key}-error`);
    if (output) output.textContent = value;
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  if (message) { $('#form-message').textContent = message; $('#form-message').hidden = false; }
  const first = form.querySelector('[aria-invalid="true"]');
  if (first) first.focus();
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  clearErrors();
  const data = Object.fromEntries(new FormData(form));
  data.consent = $('#consent').checked;
  const errors = localErrors(data);
  if (!data.consent) errors.consent = 'Confirme o uso dos dados para participar.';
  if (Object.keys(errors).length) return showErrors(errors);
  button.disabled = true;
  button.firstElementChild.textContent = 'Confirmando...';
  try {
    const result = await api('/api/registrations', { method: 'POST', body: JSON.stringify(data) });
    $('#success-name').textContent = result.firstName;
    $('#ticket-number').textContent = `Nº ${String(result.number).padStart(4, '0')}`;
    $('#registration-view').hidden = true;
    $('#success-view').hidden = false;
    $('#success-view').setAttribute('tabindex', '-1');
    $('#success-view').focus();
    $('#success-view').scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.reset();
  } catch (err) { showErrors(err.fields || {}, err.message); }
  finally { button.disabled = false; button.firstElementChild.textContent = 'Confirmar participação'; }
});
api('/api/event').then(status => {
  if (!status.registrationOpen) { $('#registration-view').hidden = true; $('#closed-view').hidden = false; }
}).catch(() => { /* Submission reports connectivity errors and preserves the form. */ });
