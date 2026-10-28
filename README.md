# Remote Tab Download

**Download the file you already have open.** Right-click an editor tab, choose **Download to Local…**, and save it on your computer—even when the file is outside your workspace.

[简体中文](README.zh-CN.md) · [Report an issue](https://github.com/githubdbluo/vscode-remote-tab-download/issues)

## Use

1. Connect to your remote environment in desktop VS Code or a compatible editor.
2. Open a file. It can be anywhere the remote connection can read.
3. Right-click that file's editor tab → **Download to Local…**.
4. Choose a local destination in the save dialog.

You can also run **Remote Tab Download: Download to Local…** from the Command Palette to download the active file tab.

## Features

- **Outside-workspace files:** no copying into the Explorer tree or changing workspace folders.
- **The tab you clicked:** right-click an inactive tab without accidentally downloading another active editor.
- **Binary files and custom editors:** XLSX, PDF, ZIP, images, notebooks, and text are copied as their original bytes.
- **Reuse your remote connection:** works with `vscode-remote:` resources supplied by Remote SSH, WSL, Dev Containers, and other compatible providers. No separate SSH client, credentials, or server required.
- **Local save dialog:** downloads go to your computer. The last destination folder is remembered.
- **Safe replacement:** write a temporary file beside the destination and replace the final file only after the transfer completes. Cancelled or failed transfers leave the previous destination intact.
- **English and Simplified Chinese:** follows the editor's display language.

## Install

Install **Remote Tab Download** by **robin211737** from the VS Code Marketplace, or download a VSIX from [GitHub Releases](https://github.com/githubdbluo/vscode-remote-tab-download/releases) and use **Extensions: Install from VSIX…**.

Install it **locally**, rather than on the SSH host. The extension declares `extensionKind: ["ui"]` and saves files using your local extension host.

## Behavior and limits

- Downloads use the **saved file on disk**. If the editor reports unsaved changes, you can cancel and save first or explicitly download the saved version.
- The extension reads the whole file into memory using VS Code's filesystem API. It is intended for documents and ordinary files, not multi-GB disk images.
- Cancellation takes effect after an in-flight remote read completes; that API does not support interruption.
- One file per action. Directories, untitled buffers, diff editors, terminals, and webviews without a file URI are not supported.
- Local `file:` tabs can also be saved to a different local path.
- Desktop editors only. VS Code for the Web is not supported.

## Privacy

No telemetry, analytics, credentials collection, third-party runtime dependencies, or separate network services. Source bytes travel through your editor's existing filesystem provider to the local destination you select. The last local destination folder is stored in the editor's extension state.

## Development

Requires Node.js 22+ for packaging; the extension supports VS Code 1.74+.

```sh
npm ci
npm test
npm run package
```

Tests cover resource selection, outside-workspace binary downloads, dirty custom editors, cancellation, read failures, and replacement failures. The final extension was smoke-tested in stock VS Code 1.104.2 for local binary saving and in openUBMC Studio 1.135.0 for outside-workspace Remote SSH downloads to Windows, with matching SHA-256 checksums. The smoke tests use real extension APIs and filesystem operations, with save/success dialogs stubbed. WSL, containers, and macOS/Linux clients have not yet been tested manually.

## License

MIT. This is an independent extension and is not affiliated with Microsoft or openUBMC.
