import { $, api, phoneMask, localErrors } from './shared.js';

const form = $('#registration-form');
const button = $('#submit-button');
const stepOneFields = ['name', 'phone', 'role', 'company', 'consent'];
let step = 1;
phoneMask($('#phone'));
function clearErrors() {
  document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  $('#form-message').hidden = true;
}
function showErrors(fields, message) {
  for (const [key, value] of Object.entries(fields)) {
    const inputs = [...form.elements].filter(input => input.name === key);
    const output = $(`#${key}-error`);
    if (output) output.textContent = value;
    inputs.forEach(input => input.setAttribute('aria-invalid', 'true'));
  }
  if (message) { $('#form-message').textContent = message; $('#form-message').hidden = false; }
  const first = form.querySelector('.form-step:not([hidden]) [aria-invalid="true"]');
  if (first) first.focus();
}
function goTo(next) {
  step = next;
  $('#step-1').hidden = step !== 1;
  $('#step-2').hidden = step !== 2;
  $('#registration-view').hidden = step === 3;
  $('#success-view').hidden = step !== 3;
  $('.registration-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const pick = (errors, keys) => Object.fromEntries(Object.entries(errors).filter(([key]) => keys.includes(key)));
form.addEventListener('submit', async event => {
  event.preventDefault();
  clearErrors();
  const data = Object.fromEntries(new FormData(form));
  data.consent = $('#consent').checked;
  const errors = localErrors(data);
  if (!data.consent) errors.consent = 'Confirme o uso dos dados para participar.';
  if (step === 1) {
    const stepErrors = pick(errors, stepOneFields);
    if (Object.keys(stepErrors).length) return showErrors(stepErrors);
    goTo(2);
    return $('#questions-title').focus({ preventScroll: true });
  }
  if (Object.keys(errors).length) return showErrors(errors);
  button.disabled = true;
  button.firstElementChild.textContent = 'Confirmando...';
  try {
    const result = await api('/api/registrations', { method: 'POST', body: JSON.stringify(data) });
    $('#success-name').textContent = result.firstName;
    $('#ticket-number').textContent = `Nº ${String(result.number).padStart(4, '0')}`;
    goTo(3);
    $('#success-view').setAttribute('tabindex', '-1');
    $('#success-view').focus({ preventScroll: true });
    form.reset();
  } catch (err) {
    const fields = err.fields || {};
    // Duplicate phone or invalid personal data is fixed on step 1.
    if (Object.keys(pick(fields, stepOneFields)).length) { goTo(1); return showErrors(fields); }
    showErrors(fields, err.message);
  }
  finally { button.disabled = false; button.firstElementChild.textContent = 'Confirmar participação'; }
});
$('#back-button').addEventListener('click', () => { clearErrors(); goTo(1); $('#name').focus({ preventScroll: true }); });
api('/api/event').then(status => {
  if (!status.registrationOpen) { $('#registration-view').hidden = true; $('#closed-view').hidden = false; }
}).catch(() => { /* Submission reports connectivity errors and preserves the form. */ });
