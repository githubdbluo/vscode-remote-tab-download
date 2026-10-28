'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { transferFile, DownloadCancelled } = require('./transfer');

function sourceUri(vscode, argument) {
  // An explicit context-menu URI always wins over the active editor.
  if (argument !== undefined) {
    return argument instanceof vscode.Uri ? argument : undefined;
  }
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input?.uri instanceof vscode.Uri) return input.uri;
  // Diff/webview/terminal tabs must not silently download another editor's file.
  return undefined;
}

function isDirty(vscode, uri) {
  const key = uri.toString();
  return vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
    tab.isDirty && tab.input?.uri?.toString() === key
  )) || vscode.workspace.textDocuments.some(doc => doc.isDirty && doc.uri.toString() === key);
}

function createDownloadCommand(vscode, state, options = {}) {
  const transfer = options.transfer || transferFile;
  const t = (...args) => vscode.l10n.t(...args);
  return async function download(argument) {
    try {
      const source = sourceUri(vscode, argument);
      if (!source || !['vscode-remote', 'file'].includes(source.scheme)) {
        throw new Error('Select a saved file tab or right-click its editor tab.');
      }
      const stat = await vscode.workspace.fs.stat(source);
      if (stat.type & vscode.FileType.Directory) throw new Error('Select a file tab, not a directory.');

      if (isDirty(vscode, source)) {
        const choice = await vscode.window.showWarningMessage(
          t('This file has unsaved changes. Save it first to include them, or download the saved version.'),
          { modal: true }, t('Download Saved Version')
        );
        if (choice !== t('Download Saved Version')) return;
      }

      const name = path.posix.basename(source.path);
      let directory = state.get('lastDirectory');
      if (typeof directory !== 'string' || !fs.existsSync(directory)) {
        const downloads = path.join(os.homedir(), 'Downloads');
        directory = fs.existsSync(downloads) ? downloads : os.homedir();
      }
      const destination = await vscode.window.showSaveDialog({
        title: t('Download file to this computer'), saveLabel: t('Download'),
        defaultUri: vscode.Uri.file(path.join(directory, name))
      });
      if (!destination) return;
      if (destination.scheme !== 'file') throw new Error('Select a local save path, not a remote directory.');

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: t('Downloading {0}', name), cancellable: true
      }, (progress, token) => transfer(
        uri => vscode.workspace.fs.readFile(uri), source, destination, token,
        value => progress.report({ ...value, message: t(value.message) })
      ));
      await state.update('lastDirectory', path.dirname(destination.fsPath)).catch(() => {});
      const action = await vscode.window.showInformationMessage(t('Downloaded to: {0}', destination.fsPath), t('Show in Folder'));
      if (action) await vscode.commands.executeCommand('revealFileInOS', destination);
      return destination;
    } catch (error) {
      if (error instanceof DownloadCancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(t('Download failed: {0}', t(message)));
    }
  };
}

module.exports = { createDownloadCommand, sourceUri, isDirty };
