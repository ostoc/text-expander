(function() {
  console.log('Text Expander: Content script loaded');

  const KEYCODE_BACKSPACE = 8;
  const EXPANSION_DELAY = 400;
  const CLEAR_BUFFER_TIMEOUT = 750;

  let snippets = [];
  let expansionTimer = null;
  let typingTimer = null;

  function loadSnippets() {
    return browser.storage.local.get('snippets').then((result) => {
      snippets = result.snippets || [];
      console.log('Text Expander: Loaded', snippets.length, 'snippets');
    }).catch((err) => {
      console.error('Text Expander: Error loading snippets', err);
      snippets = [];
    });
  }

  function isEditableElement(el) {
    if (!el) return false;
    const tagName = el.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' ||
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
    let pos = 0;

    if (el.nodeName === 'INPUT' || el.nodeName === 'TEXTAREA') {
      try {
        pos = el.selectionStart;
      } catch (e) {
        pos = el.value.length;
      }
    } else {
      try {
        const sel = win.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          pos = range.endOffset;
        }
      } catch (e) {
        pos = 0;
      }
    }
    return pos;
  }

  function setCursorPosition(el, pos, win) {
    if (!win) win = window;

    if (el.nodeName === 'INPUT' || el.nodeName === 'TEXTAREA') {
      try {
        if (el.setSelectionRange) {
          el.setSelectionRange(pos, pos);
        }
      } catch (e) {}
    }
  }

  function getLastWord(text, cursorPos) {
    if (cursorPos === 0) return '';
    const textBeforeCursor = text.slice(0, cursorPos);
    const words = textBeforeCursor.split(/[\s\n]+/);
    return words[words.length - 1] || '';
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

  function replaceText(text, shortcut, autotext, cursorPosition) {
    return text.slice(0, cursorPosition - shortcut.length) + autotext + text.slice(cursorPosition);
  }

  function replaceTextContentEditable(shortcut, autotext, node, win) {
    if (!win) win = window;

    const textInput = node.parentNode;
    console.log('Text Expander: textInput:', textInput);

    const cursorPosition = getCursorPosition(textInput, win);

    let text = node.textContent || '';
    let newContent = replaceText(text, shortcut, autotext, cursorPosition);

    let multiline = false;
    if (autotext.indexOf('\n') >= 0) {
      const lines = newContent.split('\n');
      newContent = lines.join('<br>');
      multiline = true;
    }

    const el = win.document.createElement('div');
    el.innerHTML = newContent;

    const frag = win.document.createDocumentFragment();
    let cursorNode = null;

    while (el.firstChild) {
      const tempNode = el.firstChild;
      if (tempNode.nodeType === Node.COMMENT_NODE && tempNode.nodeValue === 'CURSOR') {
        cursorNode = tempNode;
      }
      frag.appendChild(tempNode);
    }

    if (node.parentNode) {
      node.parentNode.replaceChild(frag, node);

      if (cursorNode && cursorNode.parentNode) {
        setCursorPositionAfterNode(cursorNode, win);
        cursorNode.parentNode.removeChild(cursorNode);
      } else if (textInput.lastChild) {
        setCursorPositionAfterNode(textInput.lastChild, win);
      }
    }
  }

  function setCursorPositionAfterNode(node, win) {
    if (!win) win = window;

    try {
      const sel = win.getSelection();
      if (sel && win.document.createRange) {
        const range = win.document.createRange();
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (e) {
      console.log('Text Expander: setCursorPositionAfterNode error', e);
    }
  }

  function findFocusedNode(win) {
    if (!win) win = window;

    try {
      const sel = win.getSelection();
      if (sel && sel.rangeCount) {
        return sel.getRangeAt(0).startContainer;
      }
    } catch (e) {}
    return null;
  }

  function expandText(textInput, shortcut, expansion, win) {
    if (!win) win = window;
    const tagName = textInput.nodeName.toUpperCase();

    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      const cursorPos = textInput.selectionStart;
      const currentText = textInput.value;
      const newText = replaceText(currentText, shortcut, expansion, cursorPos);

      textInput.value = newText;
      const newPos = cursorPos - shortcut.length + expansion.length;
      textInput.setSelectionRange(newPos, newPos);
    } else {
      const sel = win.getSelection();
      if (!sel || !sel.rangeCount) {
        console.log('Text Expander: No selection');
        return;
      }

      const range = sel.getRangeAt(0);

      const cursorPos = getCursorPosition(textInput, win);
      const currentText = getTextContent(textInput);

      if (!currentText || currentText.length < shortcut.length) {
        console.log('Text Expander: Not enough text');
        return;
      }

      const textBeforeCursor = currentText.slice(0, cursorPos);
      const shortcutEndPos = textBeforeCursor.lastIndexOf(shortcut);

      if (shortcutEndPos === -1) {
        console.log('Text Expander: Shortcut not found in text');
        return;
      }

      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const textNode = range.startContainer;
        const textNodeContent = textNode.textContent || '';
        const offsetInNode = cursorPos - textNodeContent.length;

        if (offsetInNode >= 0 && shortcutEndPos < textNodeContent.length) {
          range.setStart(textNode, shortcutEndPos - offsetInNode);
          range.setEnd(textNode, shortcutEndPos - offsetInNode + shortcut.length);

          sel.removeAllRanges();
          sel.addRange(range);

          range.deleteContents();

          simulateTypingWithEvents(textInput, expansion, win);

          console.log('Text Expander: Simulated typing for expansion');
        } else {
          const before = currentText.slice(0, shortcutEndPos);
          const after = currentText.slice(shortcutEndPos + shortcut.length);
          const newContent = before + expansion + after;

          textInput.textContent = newContent;
          setCursorPosition(textInput, shortcutEndPos + expansion.length, win);

          console.log('Text Expander: Direct content replacement');
        }
      } else {
        const before = currentText.slice(0, shortcutEndPos);
        const after = currentText.slice(shortcutEndPos + shortcut.length);
        const newContent = before + expansion + after;

        textInput.textContent = newContent;

        const newPos = shortcutEndPos + expansion.length;
        setCursorPosition(textInput, newPos, win);

        console.log('Text Expander: Fallback replacement');
      }
    }

    try {
      const event = new InputEvent('input', { bubbles: true, cancelable: true });
      textInput.dispatchEvent(event);
    } catch (e) {
      try {
        textInput.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e2) {}
    }

    console.log('Text Expander: Expanded', shortcut, 'to', expansion);
  }

  function simulateTypingWithEvents(element, text, win) {
    if (!win) win = window;

    const chars = text.split('');
    let index = 0;

    function typeNextChar() {
      if (index >= chars.length) return;

      const char = chars[index];
      const isNewline = char === '\n';

      if (isNewline) {
        try {
          const br = win.document.createElement('br');
          const textNode = win.document.createTextNode('');
          const container = win.document.createDocumentFragment();
          container.appendChild(br);
          container.appendChild(textNode);

          const sel = win.getSelection();
          if (sel && sel.rangeCount) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(container);

            range.setStartAfter(textNode);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (e) {}
      } else {
        const keyCode = char.charCodeAt(0);

        const eventInit = {
          bubbles: true,
          cancelable: true,
          key: char,
          code: 'Key' + char.toUpperCase(),
          keyCode: keyCode,
          which: keyCode
        };

        const keyDown = new KeyboardEvent('keydown', eventInit);
        const keyPress = new KeyboardEvent('keypress', eventInit);
        const keyUp = new KeyboardEvent('keyup', eventInit);

        element.dispatchEvent(keyDown);
        element.dispatchEvent(keyPress);

        win.document.execCommand('insertText', false, char);

        element.dispatchEvent(keyUp);
      }

      index++;
      setTimeout(typeNextChar, 10);
    }

    typeNextChar();
  }

  function checkAndExpand(textInput, win) {
    if (!snippets.length) return;
    if (!textInput || !isEditableElement(textInput)) return;

    const currentText = getTextContent(textInput);
    if (!currentText) return;

    const cursorPos = getCursorPosition(textInput, win);
    if (cursorPos === 0) return;

    const textBeforeCursor = currentText.slice(0, cursorPos);

    let foundShortcut = '';
    let shortcutPos = -1;

    for (const snippet of snippets) {
      const shortcut = snippet.shortcut;
      const pos = textBeforeCursor.lastIndexOf(shortcut);
      if (pos !== -1 && pos + shortcut.length <= textBeforeCursor.length) {
        if (pos > shortcutPos) {
          shortcutPos = pos;
          foundShortcut = shortcut;
        }
      }
    }

    if (!foundShortcut) return;

    const match = snippets.find(s => s.shortcut === foundShortcut);
    if (match) {
      console.log('Text Expander: Found match for', foundShortcut, 'at position', shortcutPos);
      expandText(textInput, foundShortcut, match.expansion, win);
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

    const match = snippets.find(s => s.shortcut === lastWord);
    if (match) {
      console.log('Text Expander: Found match for', lastWord, '->', match.expansion);
      expandText(textInput, lastWord, match.expansion, win);
    }
  }

  function handleInput(event) {
    let target = event.target;

    if (!target || !isEditableElement(target)) {
      target = getFocusedEditableElement(window);
    }

    if (!target || !isEditableElement(target)) return;

    clearTimers();

    console.log('Text Expander: input event on', target);

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

  function handleBlur(event) {
    clearTimers();
  }

  function attachListeners(doc, win) {
    if (!doc || !doc.addEventListener) return;
    if (!win) win = doc.defaultView;

    doc.addEventListener('input', handleInput, true);
    doc.addEventListener('keyup', handleKeyUp, true);
    doc.addEventListener('blur', handleBlur, true);

    console.log('Text Expander: Attached listeners');
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

  browser.storage.onChanged.addListener((changes) => {
    if (changes.snippets) {
      loadSnippets();
    }
  });
})();