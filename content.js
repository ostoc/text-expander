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

  function simulateTyping(element, text, win) {
    if (!win) win = window;

    const chars = text.split('');
    let index = 0;

    function typeNextChar() {
      if (index >= chars.length) return;

      const char = chars[index];
      const keyCode = char.charCodeAt(0);
      const eventInit = {
        bubbles: true,
        cancelable: true,
        key: char,
        code: 'Key' + char.toUpperCase(),
        keyCode: keyCode,
        which: keyCode
      };

      const keyDownEvent = new KeyboardEvent('keydown', eventInit);
      const keyPressEvent = new KeyboardEvent('keypress', eventInit);
      const keyUpEvent = new KeyboardEvent('keyup', eventInit);

      element.dispatchEvent(keyDownEvent);
      element.dispatchEvent(keyPressEvent);

      win.document.execCommand('insertText', false, char);

      element.dispatchEvent(keyUpEvent);

      index++;
      setTimeout(typeNextChar, 5);
    }

    typeNextChar();
  }

  function expandText(textInput, shortcut, expansion, win) {
    if (!win) win = window;
    const tagName = textInput.nodeName.toUpperCase();

    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      const cursorPos = textInput.selectionStart;
      const currentText = textInput.value;
      const beforeShortcut = currentText.slice(0, cursorPos - shortcut.length);
      const afterCursor = currentText.slice(cursorPos);
      const newText = beforeShortcut + expansion + afterCursor;

      textInput.value = newText;
      const newPos = beforeShortcut.length + expansion.length;
      textInput.setSelectionRange(newPos, newPos);
    } else {
      simulateTyping(textInput, expansion, win);
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

  function checkAndExpand(textInput, win) {
    if (!snippets.length || !isEditableElement(textInput)) return;

    const currentText = getTextContent(textInput);
    const cursorPos = getCursorPosition(textInput, win);

    const lastWord = getLastWord(currentText, cursorPos);
    if (!lastWord || lastWord.length < 2) return;

    const match = snippets.find(s => s.shortcut === lastWord);
    if (match) {
      expandText(textInput, lastWord, match.expansion, win);
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (!isEditableElement(target)) return;

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