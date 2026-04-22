(function() {
  console.log('Text Expander: Content script loaded');
  let snippets = [];
  let typingTimeout = null;

  function loadSnippets() {
    return browser.storage.local.get('snippets').then((result) => {
      snippets = result.snippets || [];
      console.log('Text Expander: Loaded', snippets.length, 'snippets');
    }).catch((err) => {
      console.error('Text Expander: Error loading snippets', err);
      snippets = [];
    });
  }

  function handleInput(event) {
    const target = event.target;
    if (!target) return;

    const tagName = target.tagName.toLowerCase();
    if (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && !target.isContentEditable) return;

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      checkAndExpand(target);
    }, 400);
  }

  function checkAndExpand(target) {
    if (!snippets.length) {
      console.log('Text Expander: No snippets loaded');
      return;
    }

    const text = target.value || target.innerText || '';
    const cursorPos = target.selectionStart || 0;
    const beforeCursor = text.slice(0, cursorPos);
    const lastWord = beforeCursor.split(/[\s\n]/).pop();

    if (!lastWord) return;

    const match = snippets.find(s => s.shortcut === lastWord);
    if (!match) {
      console.log('Text Expander: No match for', lastWord);
      return;
    }

    console.log('Text Expander: Expanding', lastWord, 'to', match.expansion);

    const before = text.slice(0, cursorPos - lastWord.length);
    const after = text.slice(cursorPos);
    const newValue = before + match.expansion + after;

    target.value = newValue;
    const newPos = before.length + match.expansion.length;
    target.setSelectionRange(newPos, newPos);

    const inputEvent = new InputEvent('input', { bubbles: true, cancelable: true });
    target.dispatchEvent(inputEvent);
  }

  document.addEventListener('input', handleInput, true);

  loadSnippets();

  browser.storage.onChanged.addListener((changes) => {
    if (changes.snippets || changes.delay) {
      loadSnippets();
    }
  });
})();