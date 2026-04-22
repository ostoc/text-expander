document.addEventListener('DOMContentLoaded', () => {
  loadSnippets();

  document.getElementById('addBtn').addEventListener('click', addSnippet);
  document.getElementById('cancelBtn').addEventListener('click', cancelEdit);
});

function cancelEdit() {
  editingIndex = null;
  document.getElementById('shortcut').value = '';
  document.getElementById('expansion').value = '';
  document.getElementById('description').value = '';
  document.getElementById('addBtn').textContent = 'Add Snippet';
  document.getElementById('cancelBtn').classList.add('hidden');
}

function loadSnippets() {
  browser.storage.local.get('snippets').then((result) => {
    const snippets = result.snippets || [];
    renderSnippets(snippets);
  });
}

function renderSnippets(snippets) {
  const container = document.getElementById('snippets');
  container.innerHTML = '';

  if (snippets.length === 0) {
    container.innerHTML = '<p class="empty">No snippets yet. Add one above!</p>';
    return;
  }

  snippets.forEach((snippet, index) => {
    const item = document.createElement('div');
    item.className = 'snippet-item';
    item.innerHTML = `
      <div class="snippet-info">
        <span class="snippet-shortcut">${escapeHtml(snippet.shortcut)}</span>
        <div class="snippet-expansion">${escapeHtml(snippet.expansion)}</div>
        ${snippet.description ? `<div class="snippet-description">${escapeHtml(snippet.description)}</div>` : ''}
      </div>
      <div class="snippet-actions">
        <button class="edit-btn" data-index="${index}">Edit</button>
        <button class="delete-btn" data-index="${index}">Delete</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => deleteSnippet(parseInt(e.target.dataset.index)));
  });

  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => editSnippet(parseInt(e.target.dataset.index)));
  });
}

let editingIndex = null;

function addSnippet() {
  const shortcut = document.getElementById('shortcut').value.trim();
  const expansion = document.getElementById('expansion').value.trim();
  const description = document.getElementById('description').value.trim();

  if (!shortcut || !expansion) {
    alert('Please enter both shortcut and expansion text.');
    return;
  }

  browser.storage.local.get('snippets').then((result) => {
    const snippets = result.snippets || [];
    if (editingIndex !== null) {
      snippets[editingIndex] = { shortcut, expansion, description };
      editingIndex = null;
      document.getElementById('addBtn').textContent = 'Add Snippet';
      document.getElementById('cancelBtn').classList.add('hidden');
    } else {
      snippets.push({ shortcut, expansion, description });
    }
    return browser.storage.local.set({ snippets });
  }).then(() => {
    document.getElementById('shortcut').value = '';
    document.getElementById('expansion').value = '';
    document.getElementById('description').value = '';
    loadSnippets();
  });
}

function editSnippet(index) {
  browser.storage.local.get('snippets').then((result) => {
    const snippets = result.snippets || [];
    const snippet = snippets[index];
    if (!snippet) return;

    editingIndex = index;
    document.getElementById('shortcut').value = snippet.shortcut;
    document.getElementById('expansion').value = snippet.expansion;
    document.getElementById('description').value = snippet.description || '';
    document.getElementById('addBtn').textContent = 'Save Changes';
    document.getElementById('cancelBtn').classList.remove('hidden');
  });
}

function deleteSnippet(index) {
  browser.storage.local.get('snippets').then((result) => {
    const snippets = result.snippets || [];
    snippets.splice(index, 1);
    return browser.storage.local.set({ snippets });
  }).then(loadSnippets);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}