'use strict';

const vscode = require('vscode');
const { createDownloadCommand } = require('./download');

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand(
    'remoteTabDownload.download', createDownloadCommand(vscode, context.globalState)
  ));
}

module.exports = { activate };
