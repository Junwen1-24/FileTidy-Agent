const elements = {
  rootPath: document.querySelector('#rootPath'), pathForm: document.querySelector('#pathForm'),
  scanButton: document.querySelector('#scanButton'), resetDemoButton: document.querySelector('#resetDemoButton'),
  summaryCards: document.querySelector('#summaryCards'), lastScan: document.querySelector('#lastScan'),
  searchInput: document.querySelector('#searchInput'), tagFilter: document.querySelector('#tagFilter'),
  statusFilter: document.querySelector('#statusFilter'), selectAll: document.querySelector('#selectAll'),
  fileRows: document.querySelector('#fileRows'), fileTableWrap: document.querySelector('#fileTableWrap'),
  loadingState: document.querySelector('#loadingState'), emptyState: document.querySelector('#emptyState'),
  selectionLabel: document.querySelector('#selectionLabel'), confirmButton: document.querySelector('#confirmButton'),
  organizeButton: document.querySelector('#organizeButton'), historyList: document.querySelector('#historyList'),
  filesView: document.querySelector('#filesView'), historyView: document.querySelector('#historyView'),
  previewDialog: document.querySelector('#previewDialog'), previewSummary: document.querySelector('#previewSummary'),
  previewList: document.querySelector('#previewList'), executeOrganize: document.querySelector('#executeOrganize'),
  closeDialog: document.querySelector('#closeDialog'), cancelOrganize: document.querySelector('#cancelOrganize'), toast: document.querySelector('#toast')
};

let state = null;
let selected = new Set();
let previewIds = [];
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || '请求失败，请稍后重试。');
  return payload.data;
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { elements.toast.className = 'toast'; }, 3200);
}

function setBusy(isBusy, label = '处理中…') {
  elements.scanButton.disabled = isBusy;
  elements.resetDemoButton.disabled = isBusy;
  if (isBusy) { elements.loadingState.querySelector('p').textContent = label; elements.loadingState.classList.remove('hidden'); }
  else elements.loadingState.classList.add('hidden');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function filteredFiles() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const tag = elements.tagFilter.value;
  const status = elements.statusFilter.value;
  return (state?.files || []).filter((file) => {
    const tags = [...file.confirmedTags, ...file.suggestions.map((item) => item.tag)];
    if (query && !`${file.name} ${file.relativePath}`.toLowerCase().includes(query)) return false;
    if (tag && !tags.includes(tag)) return false;
    if (status === 'pending' && file.confirmedTags.length > 0) return false;
    if (status === 'confirmed' && file.confirmedTags.length === 0) return false;
    if (status === 'organized' && !file.organized) return false;
    return true;
  });
}

function renderSummary() {
  const cards = [
    ['已发现文件', state.summary.total], ['待确认', state.summary.pending],
    ['已确认标签', state.summary.confirmed], ['可关注空间', formatBytes(state.summary.reclaimableBytes)]
  ];
  elements.summaryCards.innerHTML = cards.map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`).join('');
  elements.lastScan.textContent = state.lastScan ? `最近扫描 ${new Date(state.lastScan.completedAt).toLocaleString('zh-CN')}` : '尚未扫描';
}

function renderFilters() {
  const previous = elements.tagFilter.value;
  const tags = [...new Set(state.files.flatMap((file) => [...file.confirmedTags, ...file.suggestions.map((item) => item.tag)]))].sort((a,b) => a.localeCompare(b, 'zh-CN'));
  elements.tagFilter.innerHTML = '<option value="">全部标签</option>' + tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('');
  if (tags.includes(previous)) elements.tagFilter.value = previous;
}

function renderFiles() {
  const files = filteredFiles();
  elements.emptyState.classList.toggle('hidden', files.length > 0);
  elements.fileTableWrap.classList.toggle('hidden', files.length === 0);
  elements.fileRows.innerHTML = files.map((file) => {
    const suggestions = file.suggestions.map((item) => `<span class="tag suggested" title="${escapeHtml(item.reason)}">${escapeHtml(item.tag)}</span>`).join('');
    return `<tr>
      <td><input class="file-select" data-id="${file.id}" type="checkbox" ${selected.has(file.id) ? 'checked' : ''} aria-label="选择 ${escapeHtml(file.name)}"></td>
      <td><div class="file-name">${escapeHtml(file.name)}</div><div class="file-meta">${escapeHtml(file.relativePath)} · ${file.sizeLabel}</div>${file.organized ? '<span class="status-pill">已整理</span>' : ''}</td>
      <td><div class="tags">${suggestions}</div><div class="tag-help">悬停标签查看判断依据</div></td>
      <td><input class="tag-input" data-id="${file.id}" value="${escapeHtml(file.confirmedTags.join(', '))}" placeholder="用逗号分隔，失焦保存"></td>
      <td><div class="destination">${escapeHtml(file.recommendation.folder)}</div><div class="file-meta">${escapeHtml(file.recommendation.reason)}</div></td>
    </tr>`;
  }).join('');
  const visibleIds = files.map((file) => file.id);
  elements.selectAll.checked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  elements.selectAll.indeterminate = visibleIds.some((id) => selected.has(id)) && !elements.selectAll.checked;
  updateSelection();
}

function renderHistory() {
  const operations = state.operations || [];
  if (!operations.length) {
    elements.historyList.innerHTML = '<div class="state-block"><div class="empty-icon">↩</div><h3>还没有整理记录</h3><p>完成一次文件整理后，记录会出现在这里。</p></div>';
    return;
  }
  elements.historyList.innerHTML = operations.map((operation) => `<article class="history-item"><div><strong>${operation.items.length} 个文件已整理</strong><p>${new Date(operation.createdAt).toLocaleString('zh-CN')} · ${operation.status === 'undone' ? '已撤销' : '可撤销'}</p></div><button class="button secondary undo-button" data-id="${operation.id}" ${operation.status === 'undone' ? 'disabled' : ''}>撤销移动</button></article>`).join('');
}

function render() {
  elements.rootPath.value = state.settings.rootPath || '';
  selected = new Set([...selected].filter((id) => state.files.some((file) => file.id === id)));
  renderSummary(); renderFilters(); renderFiles(); renderHistory();
}

function updateSelection() {
  const count = selected.size;
  elements.selectionLabel.textContent = count ? `已选择 ${count} 个文件` : '未选择文件';
  elements.confirmButton.disabled = count === 0;
  elements.organizeButton.disabled = count === 0;
}

async function loadState() {
  setBusy(true, '正在读取本地数据…');
  try { state = await api('/api/state'); render(); }
  catch (error) { notify(error.message, true); }
  finally { setBusy(false); }
}

elements.pathForm.addEventListener('submit', async (event) => {
  event.preventDefault(); setBusy(true, '正在验证目录…');
  try {
    state = await api('/api/settings', { method: 'POST', body: JSON.stringify({ rootPath: elements.rootPath.value }) });
    state = await api('/api/scan', { method: 'POST' }); selected.clear(); render(); notify('目录已保存并完成扫描。');
  } catch (error) { notify(error.message, true); } finally { setBusy(false); }
});

elements.scanButton.addEventListener('click', async () => {
  setBusy(true, '正在扫描目录并生成标签…');
  try { state = await api('/api/scan', { method: 'POST' }); render(); notify(`扫描完成，共发现 ${state.summary.total} 个文件。`); }
  catch (error) { notify(error.message, true); } finally { setBusy(false); }
});

elements.resetDemoButton.addEventListener('click', async () => {
  setBusy(true, '正在重建演示目录…');
  try { state = await api('/api/demo/reset', { method: 'POST' }); selected.clear(); render(); notify('演示数据已重置。'); }
  catch (error) { notify(error.message, true); } finally { setBusy(false); }
});

[elements.searchInput, elements.tagFilter, elements.statusFilter].forEach((element) => element.addEventListener('input', renderFiles));
elements.selectAll.addEventListener('change', () => {
  for (const file of filteredFiles()) elements.selectAll.checked ? selected.add(file.id) : selected.delete(file.id);
  renderFiles();
});
elements.fileRows.addEventListener('change', async (event) => {
  const checkbox = event.target.closest('.file-select');
  if (checkbox) { checkbox.checked ? selected.add(checkbox.dataset.id) : selected.delete(checkbox.dataset.id); renderFiles(); return; }
  const input = event.target.closest('.tag-input');
  if (!input) return;
  const tags = input.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  try {
    const file = await api(`/api/files/${encodeURIComponent(input.dataset.id)}/tags`, { method: 'PATCH', body: JSON.stringify({ tags }) });
    const index = state.files.findIndex((item) => item.id === file.id); state.files[index] = file;
    state.summary.pending = state.files.filter((item) => item.confirmedTags.length === 0).length;
    state.summary.confirmed = state.files.length - state.summary.pending; render(); notify('标签已保存。');
  } catch (error) { notify(error.message, true); }
});

elements.confirmButton.addEventListener('click', async () => {
  elements.confirmButton.disabled = true;
  try { await api('/api/files/bulk-confirm', { method: 'POST', body: JSON.stringify({ fileIds: [...selected] }) }); state = await api('/api/state'); render(); notify('建议标签已确认并持久化。'); }
  catch (error) { notify(error.message, true); }
});

elements.organizeButton.addEventListener('click', async () => {
  try {
    const preview = await api('/api/organize/preview', { method: 'POST', body: JSON.stringify({ fileIds: [...selected] }) });
    previewIds = preview.items.map((item) => item.id); elements.previewSummary.textContent = `即将移动 ${preview.count} 个文件。目标目录不存在时会自动创建，同名文件会保留两份。`;
    elements.previewList.innerHTML = preview.items.map((item) => `<div class="preview-item"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.from)} → ${escapeHtml(item.to)}</span></div>`).join('');
    elements.previewDialog.showModal();
  } catch (error) { notify(error.message, true); }
});

elements.executeOrganize.addEventListener('click', async () => {
  elements.executeOrganize.disabled = true; elements.executeOrganize.textContent = '正在移动…';
  try { const result = await api('/api/organize/execute', { method: 'POST', body: JSON.stringify({ fileIds: previewIds }) }); state = result.state; selected.clear(); elements.previewDialog.close(); render(); notify(`已整理 ${result.operation.items.length} 个文件，可在操作记录中撤销。`); }
  catch (error) { notify(error.message, true); }
  finally { elements.executeOrganize.disabled = false; elements.executeOrganize.textContent = '确认整理'; }
});
[elements.closeDialog, elements.cancelOrganize].forEach((button) => button.addEventListener('click', () => elements.previewDialog.close()));
elements.historyList.addEventListener('click', async (event) => {
  const button = event.target.closest('.undo-button'); if (!button) return;
  button.disabled = true; button.textContent = '撤销中…';
  try { state = await api(`/api/operations/${encodeURIComponent(button.dataset.id)}/undo`, { method: 'POST' }); render(); notify('文件已恢复到整理前的位置。'); }
  catch (error) { button.disabled = false; button.textContent = '撤销移动'; notify(error.message, true); }
});
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
  elements.filesView.classList.toggle('hidden', button.dataset.view !== 'files');
  elements.historyView.classList.toggle('hidden', button.dataset.view !== 'history');
}));

loadState();
