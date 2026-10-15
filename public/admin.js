import { $, api, escapeHtml as esc, phoneMask, formatPhone, dateTime, localErrors } from './shared.js';

let state = null;
let page = 1;
const pageSize = 25;
let query = '';
let loading = false;
let activeAnimation = null;
let requestKey = null;
let confirmAction = null;
let lastDrawId = null;
let toastTimeout;
const stage = $('#draw-stage');

function toast(message) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function errorMessage(message) { $('#admin-error').textContent = message; $('#admin-error').hidden = !message; }
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => { el.hidden = el.id !== `tab-${tab}`; });
  document.querySelectorAll('[data-tab]').forEach(el => { const active = el.dataset.tab === tab; el.classList.toggle('active', active); active ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current'); });
  $('#panel-title').textContent = { participants: 'Participantes', raffle: 'Sorteio', history: 'Histórico' }[tab];
}
document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => switchTab(el.dataset.tab)));

function filtered() {
  const normalize = value => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
  const q = normalize(query.trim());
  return (state?.participants || []).filter(p => !q || [p.name, p.phone, formatPhone(p.phone), p.company, p.role, p.number].some(v => normalize(v).includes(q)));
}
function renderTable() {
  if (!state) return;
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Math.min(page, pages);
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  $('#participants-body').innerHTML = visible.map(p => `<tr><td><div class="person"><span class="avatar">${esc(p.name.split(/\s+/u).map(n => n[0]).slice(0, 2).join(''))}</span><div><strong>${esc(p.name)}</strong><small>${p.won ? '<span class="winner-badge">Sorteado</span>' : 'Nº ' + String(p.number).padStart(4, '0')}</small></div></div></td><td class="phone-cell">${esc(formatPhone(p.phone))}</td><td><strong class="company-cell">${esc(p.company)}</strong><small>${esc(p.role)}</small></td><td class="date-cell">${esc(dateTime(p.createdAt))}</td><td><div class="row-actions"><button class="text-button" data-edit="${esc(p.id)}" ${state.activeDraw ? 'disabled' : ''} aria-label="Editar ${esc(p.name)}">Editar</button><button class="text-button delete-button" data-delete="${esc(p.id)}" ${state.activeDraw ? 'disabled' : ''} aria-label="Excluir ${esc(p.name)}">Excluir</button></div></td></tr>`).join('');
  $('#table-empty').hidden = rows.length > 0;
  $('#table-empty h3').textContent = query ? 'Nenhum cadastro encontrado.' : 'Nenhuma inscrição por aqui.';
  $('#table-empty p').textContent = query ? 'Tente buscar por outro nome, telefone ou empresa.' : 'Os cadastros aparecerão nesta lista assim que forem confirmados.';
  $('#table-count').textContent = `${rows.length} participante${rows.length === 1 ? '' : 's'}${query ? ' encontrado' + (rows.length === 1 ? '' : 's') : ''}`;
  $('#page-label').textContent = `${page} / ${pages}`;
  $('#previous-page').disabled = page <= 1;
  $('#next-page').disabled = page >= pages;
  // CSV always contains the entire list, independent of the current visual filter.
}
function renderHistory() {
  const draws = state?.draws || [];
  $('#history-list').innerHTML = draws.length ? draws.map((draw, index) => `<article class="history-card"><span class="history-icon" aria-hidden="true">✧</span><div><span class="section-index">SORTEIO ${String(draws.length - index).padStart(2, '0')} · ${esc(dateTime(draw.startedAt))}</span><h3>${esc(draw.winner.name)}</h3><p>${esc(draw.winner.company)} · Inscrição nº ${String(draw.winner.number).padStart(4, '0')}</p><small>${draw.count} participante${draw.count === 1 ? '' : 's'} nesta rodada</small></div><button class="button button-outline small" data-result="${esc(draw.id)}">Ver resultado ↗</button></article>`).join('') : '<div class="empty-state table-card"><span aria-hidden="true">✧</span><h3>O primeiro ganhador vem aí.</h3><p>Os resultados aparecerão aqui depois de cada sorteio.</p></div>';
}
function render() {
  $('#stat-total').textContent = state.total;
  $('#stat-eligible').textContent = state.eligible;
  $('#stat-companies').textContent = state.companies;
  const toggle = $('#registration-toggle');
  toggle.disabled = false;
  toggle.textContent = state.registrationOpen ? '● Inscrições abertas · Encerrar' : '○ Inscrições encerradas · Reabrir';
  toggle.classList.toggle('open-status', state.registrationOpen);
  $('#start-draw').disabled = !state.eligible && !state.activeDraw;
  $('#start-draw').innerHTML = state.activeDraw ? 'Acompanhar sorteio <span aria-hidden="true">↗</span>' : 'Iniciar sorteio <span aria-hidden="true">↗</span>';
  renderTable();
  renderHistory();
}
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    state = await api('/api/admin/dashboard');
    render();
    errorMessage('');
    $('#sync-status').textContent = '● Atualizado agora';
    if (state.activeDraw && !lastDrawId) showDraw({ ...state.activeDraw, serverTime: state.serverTime });
  } catch (err) { errorMessage(err.message); $('#sync-status').textContent = 'Sem conexão'; }
  finally { loading = false; }
}
$('#refresh-button').addEventListener('click', refresh);
$('#search').addEventListener('input', event => { query = event.target.value; page = 1; renderTable(); });
$('#previous-page').addEventListener('click', () => { page--; renderTable(); });
$('#next-page').addEventListener('click', () => { page++; renderTable(); });

function confirm({ title, description, action, button = 'Confirmar' }) {
  $('#confirm-title').textContent = title;
  $('#confirm-description').textContent = description;
  $('#confirm-action').textContent = button;
  $('#confirm-error').hidden = true;
  confirmAction = action;
  $('#confirm-dialog').showModal();
}
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#confirm-action').addEventListener('click', async () => {
  $('#confirm-action').disabled = true;
  try { await confirmAction(); $('#confirm-dialog').close(); }
  catch (err) { $('#confirm-error').textContent = err.message; $('#confirm-error').hidden = false; }
  finally { $('#confirm-action').disabled = false; }
});
$('#registration-toggle').addEventListener('click', () => {
  if (!state) return;
  const open = !state.registrationOpen;
  confirm({ title: open ? 'Reabrir inscrições?' : 'Encerrar inscrições?', description: open ? 'A página de cadastro voltará a receber participantes.' : 'Novas inscrições serão bloqueadas. Os participantes já cadastrados continuam no sorteio.', button: open ? 'Reabrir inscrições' : 'Encerrar inscrições', action: async () => { await api('/api/admin/event', { method: 'PATCH', body: JSON.stringify({ registrationOpen: open }) }); await refresh(); toast(open ? 'Inscrições reabertas.' : 'Inscrições encerradas.'); } });
});
phoneMask($('#edit-phone'));
$('#participants-body').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit]');
  const remove = event.target.closest('[data-delete]');
  const id = edit?.dataset.edit || remove?.dataset.delete;
  if (!id) return;
  const person = state.participants.find(p => p.id === id);
  if (edit) {
    const form = $('#edit-form');
    ['id', 'name', 'phone', 'role', 'company'].forEach(key => { form.elements.namedItem(key).value = key === 'phone' ? formatPhone(person.phone) : person[key]; });
    $('#edit-error').hidden = true;
    $('#edit-dialog').showModal();
  } else {
    confirm({ title: 'Excluir participante?', description: `${person.name} será removido da lista de cadastros e não participará dos próximos sorteios. Resultados anteriores permanecem no histórico.`, button: 'Excluir cadastro', action: async () => { await api(`/api/admin/participants/${id}`, { method: 'DELETE', body: '{}' }); await refresh(); toast('Cadastro excluído.'); } });
  }
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const button = event.target.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const errors = localErrors(data);
    if (Object.keys(errors).length) throw new Error(Object.values(errors).join(' '));
    await api(`/api/admin/participants/${data.id}`, { method: 'PATCH', body: JSON.stringify(data) });
    $('#edit-dialog').close();
    await refresh();
    toast('Cadastro atualizado.');
  } catch (err) { $('#edit-error').textContent = Object.values(err.fields || {}).join(' ') || err.message; $('#edit-error').hidden = false; }
  finally { button.disabled = false; }
});

$('#start-draw').addEventListener('click', async () => {
  if (state.activeDraw) {
    try { showDraw(await api(`/api/admin/draws/${state.activeDraw.id}`)); }
    catch (err) { errorMessage(err.message); }
    return;
  }
  requestKey = crypto.randomUUID();
  confirm({ title: 'Vamos conhecer o ganhador?', description: `Há ${state.eligible} participante(s) disponível(is). Ao confirmar, começa a contagem de 10 segundos. Ganhadores anteriores ficam fora desta rodada.`, button: 'Começar os 10 segundos', action: async () => {
    const draw = await api('/api/admin/draws', { method: 'POST', body: JSON.stringify({ requestKey }) });
    showDraw(draw);
    await refresh();
  } });
});

function showDraw(draw) {
  if (activeAnimation) cancelAnimationFrame(activeAnimation);
  activeAnimation = null;
  lastDrawId = draw.id;
  if (!stage.open) stage.showModal();
  stage.classList.remove('has-winner');
  $('#confetti').replaceChildren();
  $('#winner-content').hidden = true;
  $('#countdown').hidden = false;
  $('#rolling-name').hidden = false;
  $('#names-window').hidden = false;
  $('#stage-heading').textContent = 'O kit churrasco vai para...';
  $('#stage-status').textContent = '';
  $('#stage-count').textContent = `${draw.count} participante${draw.count === 1 ? '' : 's'} nesta rodada`;
  $('#names-track').textContent = [...draw.firstNames, ...draw.firstNames].join('  ·  ');
  if (draw.status === 'completed') return reveal(draw);
  const deadline = performance.now() + Math.max(0, draw.revealAt - draw.serverTime);
  let lastSecond = null;
  const animate = () => {
    const remaining = Math.max(0, deadline - performance.now());
    const seconds = Math.ceil(remaining / 1000);
    const progress = Math.min(0.999, Math.max(0, 1 - remaining / 10000));
    $('#countdown').textContent = String(seconds).padStart(2, '0');
    $('#rolling-name').textContent = draw.firstNames[Math.floor(progress * Math.max(draw.firstNames.length, 70)) % draw.firstNames.length] || 'Boa sorte!';
    if (seconds !== lastSecond) { $('#stage-status').textContent = seconds > 0 ? `${seconds} segundo${seconds === 1 ? '' : 's'}` : 'Confirmando o resultado...'; lastSecond = seconds; }
    if (remaining > 0) activeAnimation = requestAnimationFrame(animate);
    else { activeAnimation = null; fetchResult(draw.id); }
  };
  animate();
}
async function fetchResult(id) {
  if (lastDrawId !== id) return;
  try {
    const result = await api(`/api/admin/draws/${id}`);
    if (lastDrawId !== id) return;
    if (result.status !== 'completed') { setTimeout(() => fetchResult(id), 300); return; }
    reveal(result);
    await refresh();
  } catch (err) {
    $('#stage-status').textContent = 'Reconectando para mostrar o resultado salvo...';
    setTimeout(() => fetchResult(id), 2500);
  }
}
function reveal(draw) {
  $('#countdown').hidden = true;
  $('#rolling-name').hidden = true;
  $('#names-window').hidden = true;
  $('#winner-content').hidden = false;
  $('#stage-heading').textContent = 'Temos um ganhador.';
  $('#winner-name').textContent = draw.winner.name;
  $('#winner-company').textContent = draw.winner.company;
  $('#winner-number').textContent = `INSCRIÇÃO Nº ${String(draw.winner.number).padStart(4, '0')}`;
  $('#stage-status').textContent = 'Resultado registrado. Parabéns ao ganhador!';
  stage.classList.add('has-winner');
  $('#confetti').innerHTML = Array.from({ length: 32 }, (_, i) => `<i class="confetti-${i % 8}"></i>`).join('');
}
async function closeStage() {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  stage.close();
  refresh();
}
$('#close-stage').addEventListener('click', closeStage);
$('#winner-back').addEventListener('click', closeStage);
stage.addEventListener('cancel', event => { event.preventDefault(); closeStage(); });
$('#fullscreen-button').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast('Use a tela cheia do navegador para apresentar.'); }
});
$('#history-list').addEventListener('click', event => {
  const button = event.target.closest('[data-result]');
  if (!button) return;
  const draw = state.draws.find(d => d.id === button.dataset.result);
  showDraw(draw);
});
await refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
