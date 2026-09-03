# Browser Vault

Browser Vault is a local-first Chrome Manifest V3 popup for reusable text snippets. It has no backend, authentication, or remote data store. Vault data is persisted in IndexedDB inside the browser.

## Development

```bash
npm install
npm run build
```

The production extension is written to `dist/`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the `dist/` directory.

After source changes, run `npm run build` again and use the extension reload button in Chrome.

## Included workflows

- Create, rename, nest, move, and delete folders.
- Create, edit, copy, search, and delete copy-pastables.
- Drag files and folders between folders or back to root.
- Export a portable JSON backup and import it by merging or replacing.
