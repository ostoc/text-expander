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
      console.log('Text Expander: setCursorPositionAfterNode error', e);
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
      console.log('Text Expander: replaceTextContentEditable error', e);
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
      console.log('Text Expander: Contenteditable replacement failed');
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

    console.log('Text Expander: Expanded', shortcut, 'to', expansion);
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

  function handleBlur() {
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
