# Text Expander

Browser extension for Chrome and Firefox that expands text shortcuts into full snippets.

## Features

- **Instant expansion** — press Space, Tab, or Enter after a shortcut to expand immediately
- **Markdown support** — expansions render bold, italic, headings, lists, tables, code blocks, and links in rich-text editors
- **Works everywhere** — standard inputs, textareas, contenteditable elements, ProseMirror editors, and Jira
- **Two-panel options page** — snippet list on the left, editor on the right with a full-height expansion field
- **Import / Export** — save and load your snippet library as a YAML file for backup or sharing
- **Persistent storage** — snippets survive browser restarts and updates

## Installation

### Chrome
1. Navigate to `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the extension directory

### Firefox
1. Navigate to `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json`

## Usage

1. Click the extension icon to open the options page
2. Click **+ New** to create a snippet — enter a shortcut and the text to expand to
3. Type the shortcut in any text field, then press Space, Tab, or Enter to expand

### Import / Export

- **Export YAML** — downloads your snippets as `snippets.yaml`
- **Import YAML** — loads snippets from a `.yaml` or `.yml` file, replacing the current library

YAML format:

```yaml
snippets:
  - shortcut: ":sig"
    description: "Email signature"
    expansion: |
      Best regards,
      John Doe
  - shortcut: ":hello"
    expansion: Hello there
```

## Permissions

- `storage` — for persisting snippets locally
- `host_permissions: <all_urls>` — to run the content script on every page