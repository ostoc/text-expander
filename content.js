(function() {
  const api = typeof browser !== 'undefined' ? browser : chrome;

  const KEYCODE_BACKSPACE = 8;
  const EXPANSION_DELAY = 100;
  const CLEAR_BUFFER_TIMEOUT = 750;
  const TRIGGER_KEYS = new Set([' ', 'Tab', 'Enter']);

  let snippets = [];
  let expansionTimer = null;
  let typingTimer = null;

  function loadSnippets() {
    return api.storage.local.get('snippets').then((result) => {
      snippets = result.snippets || [];
    }).catch((err) => {
      console.error('Text Expander: Error loading snippets', err);
      snippets = [];
    });
  }

  function isEditableElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

    const tagName = el.tagName.toLowerCase();
    return tagName === 'input' ||
      tagName === 'textarea' ||
      el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true';
  }

  function getTextContent(el) {
    if (el.nodeName === 'INPUT' || el.nodeName === 'TEXTAREA') {
      return el.value;
    }

    return el.textContent || '';
  }

  function getCursorPosition(el, win) {
    if (!win) win = window;

    if (el.nodeName === 'INPUT' || el.nodeName === 'TEXTAREA') {
      try {
        return el.selectionStart;
      } catch (e) {
        return el.value.length;
      }
    }

    try {
      const sel = win.getSelection();
      if (!sel || !sel.rangeCount) return 0;

      const range = sel.getRangeAt(0);
      const preRange = range.cloneRange();
      preRange.selectNodeContents(el);
      preRange.setEnd(range.endContainer, range.endOffset);
      return preRange.toString().length;
    } catch (e) {
      return 0;
    }
  }

  function setCursorPosition(el, pos) {
    if (el.nodeName !== 'INPUT' && el.nodeName !== 'TEXTAREA') return;

    try {
      if (el.setSelectionRange) {
        el.setSelectionRange(pos, pos);
      }
    } catch (e) {}
  }

  function clearTimers() {
    if (expansionTimer) {
      clearTimeout(expansionTimer);
      expansionTimer = null;
    }

    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
  }

  function replaceText(text, shortcut, expansion, cursorPosition) {
    return text.slice(0, cursorPosition - shortcut.length) + expansion + text.slice(cursorPosition);
  }

  function findTextPosition(element, targetOffset, win) {
    if (!win) win = window;

    const doc = element.ownerDocument || win.document;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let traversed = 0;
    let currentNode = walker.nextNode();

    if (!currentNode) {
      return { node: element, offset: 0 };
    }

    while (currentNode) {
      const length = currentNode.textContent.length;
      if (targetOffset <= traversed + length) {
        return { node: currentNode, offset: targetOffset - traversed };
      }

      traversed += length;
      currentNode = walker.nextNode();
    }

    return { node: element, offset: element.childNodes.length };
  }

  function createExpansionFragment(expansion, win) {
    if (!win) win = window;

    const doc = win.document;
    const fragment = doc.createDocumentFragment();
    const lines = expansion.split('\n');

    lines.forEach((line, index) => {
      if (line) {
        fragment.appendChild(doc.createTextNode(line));
      }

      if (index < lines.length - 1) {
        fragment.appendChild(doc.createElement('br'));
      }
    });

    return fragment;
  }

  function isProseMirrorEditor(element) {
    return !!(
      element &&
      element.nodeType === Node.ELEMENT_NODE &&
      (
        element.classList.contains('ProseMirror') ||
        element.closest('.ProseMirror')
      )
    );
  }

  function isJiraEditor(element) {
    return !!(
      element &&
      element.nodeType === Node.ELEMENT_NODE &&
      (
        element.id === 'ak-editor-textarea' ||
        element.getAttribute('data-editor-id') ||
        /atlassian|jira/i.test((element.ownerDocument && element.ownerDocument.location && element.ownerDocument.location.hostname) || '')
      )
    );
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInlineMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    html = html.replace(/(^|[^\*])\*([^\*]+)\*(?!\*)/g, '$1<em>$2</em>');
    html = html.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>');

    return html;
  }

  function snippetToHtml(expansion) {
    const lines = expansion.split('\n');
    const blocks = [];
    let listItems = [];
    let orderedListItems = [];
    let quoteLines = [];
    let tableRows = [];
    let codeBlockLines = [];
    let inCodeBlock = false;
    let codeFenceLanguage = '';

    function flushList() {
      if (!listItems.length) return;
      blocks.push('<ul>' + listItems.join('') + '</ul>');
      listItems = [];
    }

    function flushOrderedList() {
      if (!orderedListItems.length) return;
      blocks.push('<ol>' + orderedListItems.join('') + '</ol>');
      orderedListItems = [];
    }

    function flushQuote() {
      if (!quoteLines.length) return;
      blocks.push('<blockquote><p>' + quoteLines.join('<br>') + '</p></blockquote>');
      quoteLines = [];
    }

    function isTableSeparator(line) {
      const trimmed = line.trim();
      return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmed);
    }

    function splitTableRow(line) {
      return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => renderInlineMarkdown(cell.trim()));
    }

    function flushTable() {
      if (!tableRows.length) return;

      const [header, ...body] = tableRows;
      const thead = '<thead><tr>' + header.map((cell) => '<th>' + cell + '</th>').join('') + '</tr></thead>';
      const tbody = body.length
        ? '<tbody>' + body.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('') + '</tbody>'
        : '';

      blocks.push('<table>' + thead + tbody + '</table>');
      tableRows = [];
    }

    function flushCodeBlock() {
      if (!codeBlockLines.length) return;

      const languageClass = codeFenceLanguage
        ? ' class="language-' + escapeHtml(codeFenceLanguage) + '"'
        : '';

      blocks.push('<pre><code' + languageClass + '>' + escapeHtml(codeBlockLines.join('\n')) + '</code></pre>');
      codeBlockLines = [];
      codeFenceLanguage = '';
    }

    function flushBlocks() {
      flushList();
      flushOrderedList();
      flushQuote();
      flushTable();
      flushCodeBlock();
    }

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        if (inCodeBlock) {
          flushCodeBlock();
          inCodeBlock = false;
          return;
        }

        flushList();
        flushOrderedList();
        flushQuote();
        flushTable();
        inCodeBlock = true;
        codeFenceLanguage = trimmed.slice(3).trim();
        return;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        return;
      }

      if (trimmed.startsWith('|')) {
        flushList();
        flushOrderedList();
        flushQuote();
        if (!isTableSeparator(trimmed)) {
          tableRows.push(splitTableRow(trimmed));
        }
        return;
      }

      if (/^[-*] \[[ xX]\] /.test(line)) {
        flushQuote();
        flushTable();
        flushOrderedList();

        const checked = /^[-*] \[[xX]\] /.test(line);
        const content = line.replace(/^[-*] \[[ xX]\] /, '');
        listItems.push(
          '<li><input type="checkbox"' + (checked ? ' checked' : '') + ' disabled> ' +
          renderInlineMarkdown(content) +
          '</li>'
        );
        return;
      }

      if (/^[-*] /.test(line)) {
        flushQuote();
        flushTable();
        flushOrderedList();
        listItems.push('<li>' + renderInlineMarkdown(line.slice(2)) + '</li>');
        return;
      }

      if (/^\d+[.)] /.test(line)) {
        flushQuote();
        flushTable();
        flushList();
        orderedListItems.push('<li>' + renderInlineMarkdown(line.replace(/^\d+[.)] /, '')) + '</li>');
        return;
      }

      if (/^> ?/.test(line)) {
        flushList();
        flushOrderedList();
        flushTable();
        quoteLines.push(renderInlineMarkdown(line.replace(/^> ?/, '')));
        return;
      }

      flushBlocks();

      if (!trimmed) {
        return;
      }

      if (/^#{1,6} /.test(line)) {
        const match = line.match(/^(#{1,6})\s+(.*)$/);
        const level = match[1].length;
        blocks.push('<h' + level + '>' + renderInlineMarkdown(match[2]) + '</h' + level + '>');
        return;
      }

      if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed) || /^___+$/.test(trimmed)) {
        blocks.push('<hr>');
        return;
      }

      if (/^## /.test(line)) {
        blocks.push('<h2>' + renderInlineMarkdown(line.slice(3)) + '</h2>');
        return;
      }

      if (/^`{4,}/.test(trimmed)) {
        blocks.push('<pre><code>' + escapeHtml(line) + '</code></pre>');
        return;
      }

      blocks.push('<p>' + renderInlineMarkdown(line) + '</p>');
    });

    if (inCodeBlock) {
      flushCodeBlock();
    }

    flushBlocks();
    return blocks.join('');
  }

  function dispatchClipboardEvent(target, type, text, html, win) {
    if (!win) win = window;

    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      if (html) {
        clipboardData.setData('text/html', html);
      }

      const event = new ClipboardEvent(type, {
        bubbles: true,
        cancelable: true,
        clipboardData
      });

      Object.defineProperty(event, 'clipboardData', {
        value: clipboardData
      });

      return target.dispatchEvent(event);
    } catch (e) {
      return false;
    }
  }

  function insertIntoProseMirror(textInput, range, shortcut, expansion, win) {
    if (!win) win = window;

    const selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    textInput.focus();

    const deleted = win.document.execCommand('delete', false);

    const htmlExpansion = snippetToHtml(expansion);

    if (isJiraEditor(textInput)) {
      const insertedHtml = win.document.execCommand('insertHTML', false, htmlExpansion);

      if (insertedHtml) {
        return true;
      }
    }

    const pasteEventAccepted = dispatchClipboardEvent(textInput, 'paste', expansion, htmlExpansion, win);
    const insertedHtml = win.document.execCommand('insertHTML', false, htmlExpansion);

    if (pasteEventAccepted || insertedHtml) {
      return true;
    }

    const inserted = win.document.execCommand('insertText', false, expansion);
    return inserted;
  }

  function setCursorPositionAfterNode(node, win) {
    if (!win) win = window;

    try {
      const sel = win.getSelection();
      if (!sel || !win.document.createRange) return;

      const range = win.document.createRange();
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      console.error('Text Expander: setCursorPositionAfterNode error', e);
    }
  }

  function replaceTextContentEditable(textInput, shortcut, expansion, win) {
    if (!win) win = window;

    const cursorPosition = getCursorPosition(textInput, win);
    const startOffset = cursorPosition - shortcut.length;

    if (startOffset < 0) {
      return false;
    }

    const start = findTextPosition(textInput, startOffset, win);
    const end = findTextPosition(textInput, cursorPosition, win);

    if (!start || !end) {
      return false;
    }

    try {
      const range = win.document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);

      if (isProseMirrorEditor(textInput)) {
        return insertIntoProseMirror(textInput, range, shortcut, expansion, win);
      }

      range.deleteContents();

      const fragment = createExpansionFragment(expansion, win);
      const marker = win.document.createComment('text-expander-caret');
      fragment.appendChild(marker);
      range.insertNode(fragment);

      setCursorPositionAfterNode(marker, win);
      if (marker.parentNode) {
        marker.parentNode.removeChild(marker);
      }

      return true;
    } catch (e) {
      console.error('Text Expander: replaceTextContentEditable error', e);
      return false;
    }
  }

  function expandText(textInput, shortcut, expansion, win) {
    if (!win) win = window;

    const tagName = textInput.nodeName.toUpperCase();

    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      const cursorPos = textInput.selectionStart;
      const currentText = textInput.value;
      const newText = replaceText(currentText, shortcut, expansion, cursorPos);
      const newPos = cursorPos - shortcut.length + expansion.length;

      textInput.value = newText;
      setCursorPosition(textInput, newPos);
    } else if (!replaceTextContentEditable(textInput, shortcut, expansion, win)) {
      return;
    }

    try {
      const event = new InputEvent('input', { bubbles: true, cancelable: true });
      textInput.dispatchEvent(event);
    } catch (e) {
      try {
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e2) {}
    }
  }

  function getFocusedEditableElement(win) {
    if (!win) win = window;

    try {
      const sel = win.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        let node = range.startContainer;

        if (!node) return null;

        if (node.nodeType === Node.TEXT_NODE) {
          node = node.parentNode;
        }

        while (node) {
          if (isEditableElement(node)) {
            return node;
          }
          node = node.parentNode;
        }
      }
    } catch (e) {}

    return null;
  }

  function findLastWordForShortcuts(text, cursorPos) {
    if (cursorPos === 0) return '';

    const textBeforeCursor = text.slice(0, cursorPos);

    for (let i = snippets.length - 1; i >= 0; i--) {
      const shortcut = snippets[i].shortcut;
      const shortcutStart = cursorPos - shortcut.length;

      if (shortcutStart >= 0) {
        const candidate = textBeforeCursor.slice(shortcutStart);
        if (candidate === shortcut) {
          return shortcut;
        }
      }
    }

    const words = textBeforeCursor.split(/[\s\n]+/);
    return words[words.length - 1] || '';
  }

  function checkAndExpand(textInput, win) {
    if (!snippets.length) return;
    if (!textInput || !isEditableElement(textInput)) return;

    const currentText = getTextContent(textInput);
    if (!currentText) return;

    const cursorPos = getCursorPosition(textInput, win);
    if (cursorPos === 0) return;

    const lastWord = findLastWordForShortcuts(currentText, cursorPos);
    if (!lastWord || lastWord.length < 2) return;

    const match = snippets.find((snippet) => snippet.shortcut === lastWord);
    if (match) {
      expandText(textInput, lastWord, match.expansion, win);
    }
  }

  function handleKeyDown(event) {
    if (!TRIGGER_KEYS.has(event.key)) return;

    let target = event.target;
    if (!target || !isEditableElement(target)) {
      target = getFocusedEditableElement(window);
    }
    if (!target || !isEditableElement(target)) return;
    if (!snippets.length) return;

    const currentText = getTextContent(target);
    if (!currentText) return;

    const cursorPos = getCursorPosition(target, window);
    if (cursorPos === 0) return;

    const lastWord = findLastWordForShortcuts(currentText, cursorPos);
    if (!lastWord || lastWord.length < 2) return;

    const match = snippets.find((s) => s.shortcut === lastWord);
    if (match) {
      event.preventDefault();
      clearTimers();
      expandText(target, lastWord, match.expansion, window);
    }
  }

  function handleInput(event) {
    let target = event.target;

    if (!target || !isEditableElement(target)) {
      target = getFocusedEditableElement(window);
    }

    if (!target || !isEditableElement(target)) return;

    clearTimers();

    expansionTimer = setTimeout(() => {
      checkAndExpand(target, window);
    }, EXPANSION_DELAY);

    typingTimer = setTimeout(clearTimers, CLEAR_BUFFER_TIMEOUT);
  }

  function handleKeyUp(event) {
    const target = event.target;
    if (!isEditableElement(target)) return;

    const charCode = event.keyCode || event.which;
    if (charCode === KEYCODE_BACKSPACE) {
      clearTimers();
    }
  }

  function handleBlur() {
    clearTimers();
  }

  function attachListeners(doc, win) {
    if (!doc || !doc.addEventListener) return;
    if (!win) win = doc.defaultView;

    doc.addEventListener('keydown', handleKeyDown, true);
    doc.addEventListener('input', handleInput, true);
    doc.addEventListener('keyup', handleKeyUp, true);
    doc.addEventListener('blur', handleBlur, true);
  }

  function init() {
    attachListeners(document, window);

    const processIframe = (iframe) => {
      try {
        if (iframe.contentDocument) {
          attachListeners(iframe.contentDocument, iframe.contentWindow);
        }
      } catch (e) {}
    };

    document.querySelectorAll('iframe').forEach(processIframe);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === 'IFRAME') {
            processIframe(node);
          }
        });
      });
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  loadSnippets().then(init);

  api.storage.onChanged.addListener((changes) => {
    if (changes.snippets) {
      loadSnippets();
    }
  });
})();
