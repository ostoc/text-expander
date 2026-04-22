const api = typeof browser !== 'undefined' ? browser : chrome;

let snippets = [];
let selectedIndex = null;

document.addEventListener('DOMContentLoaded', () => {
  loadSnippets();
  document.getElementById('newBtn').addEventListener('click', openNew);
  document.getElementById('saveBtn').addEventListener('click', saveSnippet);
  document.getElementById('cancelBtn').addEventListener('click', cancelEdit);
  document.getElementById('deleteBtn').addEventListener('click', deleteSnippet);
  document.getElementById('exportBtn').addEventListener('click', exportSnippets);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', handleImportFile);
});

function loadSnippets() {
  api.storage.local.get('snippets').then((result) => {
    snippets = result.snippets || [];
    renderSnippets();
    updateEditorState();
  });
}

function renderSnippets() {
  const container = document.getElementById('snippets');
  container.innerHTML = '';

  snippets.forEach((snippet, index) => {
    const item = document.createElement('div');
    item.className = 'snippet-item' + (index === selectedIndex ? ' selected' : '');

    const shortcutEl = document.createElement('span');
    shortcutEl.className = 'snippet-shortcut';
    shortcutEl.textContent = snippet.shortcut;

    const subEl = document.createElement('span');
    subEl.className = snippet.description ? 'snippet-description' : 'snippet-preview';
    subEl.textContent = snippet.description || snippet.expansion;

    item.appendChild(shortcutEl);
    item.appendChild(subEl);
    item.addEventListener('click', () => selectSnippet(index));
    container.appendChild(item);
  });
}

function selectSnippet(index) {
  selectedIndex = index;
  renderSnippets();
  showEditorPanel(index);
}

function openNew() {
  selectedIndex = null;
  renderSnippets();
  showEditorPanel(null);
}

function showEditorPanel(index) {
  document.getElementById('emptyNoSnippets').classList.add('hidden');
  document.getElementById('emptySelect').classList.add('hidden');
  document.getElementById('editorPanel').classList.remove('hidden');

  const isNew = index === null;
  document.getElementById('editorTitle').textContent = isNew ? 'New Snippet' : 'Edit Snippet';
  document.getElementById('deleteBtn').classList.toggle('hidden', isNew);

  const snippet = isNew ? { shortcut: '', description: '', expansion: '' } : snippets[index];
  document.getElementById('shortcut').value = snippet.shortcut;
  document.getElementById('description').value = snippet.description || '';
  document.getElementById('expansion').value = snippet.expansion;

  document.getElementById('shortcut').focus();
}

function updateEditorState() {
  if (!document.getElementById('editorPanel').classList.contains('hidden')) return;

  const hasSnippets = snippets.length > 0;
  document.getElementById('emptyNoSnippets').classList.toggle('hidden', hasSnippets);
  document.getElementById('emptySelect').classList.toggle('hidden', !hasSnippets);
}

function saveSnippet() {
  const shortcut = document.getElementById('shortcut').value.trim();
  const expansion = document.getElementById('expansion').value.trim();
  const description = document.getElementById('description').value.trim();

  if (!shortcut || !expansion) {
    alert('Please enter both a shortcut and expansion text.');
    return;
  }

  if (selectedIndex !== null) {
    snippets[selectedIndex] = { shortcut, expansion, description };
  } else {
    snippets.push({ shortcut, expansion, description });
    selectedIndex = snippets.length - 1;
  }

  api.storage.local.set({ snippets }).then(() => {
    renderSnippets();
    document.getElementById('editorTitle').textContent = 'Edit Snippet';
    document.getElementById('deleteBtn').classList.remove('hidden');
  });
}

function cancelEdit() {
  selectedIndex = null;
  document.getElementById('editorPanel').classList.add('hidden');
  renderSnippets();
  updateEditorState();
}

function deleteSnippet() {
  if (selectedIndex === null) return;

  snippets.splice(selectedIndex, 1);
  selectedIndex = null;

  api.storage.local.set({ snippets }).then(() => {
    document.getElementById('editorPanel').classList.add('hidden');
    renderSnippets();
    updateEditorState();
  });
}

// --- Export ---

function exportSnippets() {
  if (!snippets.length) {
    alert('No snippets to export.');
    return;
  }
  const yaml = snippetsToYaml(snippets);
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'snippets.yaml';
  a.click();
  URL.revokeObjectURL(url);
}

// --- Import ---

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = parseYamlSnippets(e.target.result);
      if (!imported.length) {
        alert('No valid snippets found in the file.');
        return;
      }
      const msg = snippets.length
        ? `Replace ${snippets.length} existing snippet(s) with ${imported.length} imported snippet(s)?`
        : `Import ${imported.length} snippet(s)?`;
      if (!confirm(msg)) return;

      snippets = imported;
      selectedIndex = null;
      api.storage.local.set({ snippets }).then(() => {
        document.getElementById('editorPanel').classList.add('hidden');
        renderSnippets();
        updateEditorState();
      });
    } catch (err) {
      alert('Failed to parse YAML: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// --- YAML serializer ---

function snippetsToYaml(list) {
  let out = 'snippets:\n';
  for (const s of list) {
    out += `  - shortcut: ${yamlQuote(s.shortcut)}\n`;
    if (s.description) {
      out += `    description: ${yamlQuote(s.description)}\n`;
    }
    if (s.expansion.includes('\n')) {
      out += `    expansion: |\n`;
      for (const line of s.expansion.split('\n')) {
        out += `      ${line}\n`;
      }
    } else {
      out += `    expansion: ${yamlQuote(s.expansion)}\n`;
    }
  }
  return out;
}

function yamlQuote(str) {
  if (!str) return '""';
  const needsQuote =
    /[:#{}\[\]|>&!'"@`]/.test(str) ||
    /^\s|\s$/.test(str) ||
    /^(true|false|null|yes|no|on|off)$/i.test(str) ||
    /^\d/.test(str);
  if (!needsQuote) return str;
  return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// --- YAML parser (handles the format produced by snippetsToYaml) ---

function parseYamlSnippets(text) {
  const lines = text.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length && !lines[i].trimEnd().startsWith('snippets:')) i++;
  i++;

  while (i < lines.length) {
    if (!/^  -\s/.test(lines[i])) { i++; continue; }

    const snippet = {};

    // First key on the "  - " line
    const firstKv = lines[i].replace(/^  -\s+/, '').match(/^(\w+):\s*(.*)/);
    if (firstKv) {
      i++;
      if (firstKv[2].trim() === '|') {
        const block = collectBlock(lines, i, 6);
        snippet[firstKv[1]] = block.text;
        i = block.next;
      } else {
        snippet[firstKv[1]] = yamlUnquote(firstKv[2].trim());
      }
    } else {
      i++;
    }

    // Remaining fields indented 4 spaces
    while (i < lines.length && /^    \w/.test(lines[i])) {
      const kv = lines[i].slice(4).match(/^(\w+):\s*(.*)/);
      if (!kv) { i++; continue; }
      i++;
      if (kv[2].trim() === '|') {
        const block = collectBlock(lines, i, 6);
        snippet[kv[1]] = block.text;
        i = block.next;
      } else {
        snippet[kv[1]] = yamlUnquote(kv[2].trim());
      }
    }

    if (snippet.shortcut && snippet.expansion) result.push(snippet);
  }

  return result;
}

function collectBlock(lines, start, indent) {
  const prefix = ' '.repeat(indent);
  const blockLines = [];
  let i = start;
  while (i < lines.length && (lines[i].startsWith(prefix) || lines[i].trim() === '')) {
    blockLines.push(lines[i].startsWith(prefix) ? lines[i].slice(indent) : '');
    i++;
  }
  while (blockLines.length && blockLines[blockLines.length - 1] === '') blockLines.pop();
  return { text: blockLines.join('\n'), next: i };
}

function yamlUnquote(str) {
  if ((str.startsWith('"') && str.endsWith('"'))) {
    return str.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (str.startsWith("'") && str.endsWith("'")) {
    return str.slice(1, -1).replace(/''/g, "'");
  }
  return str;
}
