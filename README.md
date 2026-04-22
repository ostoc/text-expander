# Text Expander

Browser extension for Chrome and Firefox that expands text shortcuts into full snippets.

## Features

- Create and manage text snippets with custom shortcuts
- Automatic expansion when typing shortcuts in text fields
- 400ms delay to prevent mistriggering
- Persistent storage across browser restarts

## Installation

### Chrome
1. Navigate to `chrome://extensions/`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the extension directory

### Firefox
1. Navigate to `about://debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select the manifest.json file

## Usage

1. Click the extension icon in the toolbar to open the options page
2. Add snippets with a shortcut (abbreviation) and expansion text
3. Type the shortcut in any text input field
4. Wait 400ms after typing the shortcut to trigger expansion

## Permissions

- `storage` - For persisting snippets locally