'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { transferFile, DownloadCancelled } = require('../src/transfer');
const { createDownloadCommand, sourceUri } = require('../src/download');

function uri(value) {
  const url = new URL(value);
  return { scheme: url.protocol.slice(0, -1), path: decodeURIComponent(url.pathname),
    fsPath: value.startsWith('file:') ? require('node:url').fileURLToPath(url) : url.pathname,
    toString: () => value, isUri: true };
}
const remote = uri('vscode-remote://ssh-remote+test/root/outside/中文%20报告.xlsx');
const other = uri('vscode-remote://ssh-remote+test/workspace/active.md');

async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-tab-download-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return { folder, target: uri(pathToFileURL(path.join(folder, '中文 报告.xlsx')).href) };
}

function mockApi(destination) {
  const calls = { read: [], errors: [], info: [], save: [] };
  const api = {
    l10n: { t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[i])) },
    Uri: class MockUri {
      static [Symbol.hasInstance](value) { return value?.isUri === true; }
      static file(value) { return uri(pathToFileURL(value).href); }
    },
    FileType: { File: 1, Directory: 2 }, ProgressLocation: { Notification: 15 },
    workspace: { textDocuments: [], fs: {
      stat: async () => ({ type: 1 }),
      readFile: async source => { calls.read.push(source); return Uint8Array.from([80, 75, 0, 255, 128, 13, 10]); }
    } },
    window: {
      tabGroups: { activeTabGroup: { activeTab: { input: { uri: other } } }, all: [] },
      showSaveDialog: async options => { calls.save.push(options); return destination; },
      showWarningMessage: async () => undefined,
      showErrorMessage: async value => { calls.errors.push(value); },
      showInformationMessage: async value => { calls.info.push(value); },
      withProgress: async (_, task) => task({ report() {} }, { isCancellationRequested: false })
    },
    commands: { executeCommand: async () => {} }
  };
  return { api, calls, state: { get: () => undefined, update: async () => {} } };
}

test('right-clicked inactive XLSX URI takes priority over another active text editor', () => {
  const { api } = mockApi();
  assert.equal(sourceUri(api, remote), remote);
  assert.equal(sourceUri(api), other);
});

test('command palette resolves a custom editor without activeTextEditor', () => {
  const { api } = mockApi();
  api.window.tabGroups.activeTabGroup.activeTab.input = { uri: remote, viewType: 'xlsx.editor' };
  assert.equal(sourceUri(api), remote);
});

test('ambiguous explicit arguments and diff tabs never fall back to another file', () => {
  const { api } = mockApi();
  assert.equal(sourceUri(api, { groupId: 1 }), undefined);
  api.window.tabGroups.activeTabGroup.activeTab.input = { original: remote, modified: other };
  assert.equal(sourceUri(api), undefined);
});

test('outside-workspace binary remote download preserves every byte and uses local dialog URI', async t => {
  const { target } = await fixture(t);
  const { api, state, calls } = mockApi(target);
  await createDownloadCommand(api, state)(remote);
  assert.deepEqual(calls.read, [remote]);
  assert.deepEqual(await fs.readFile(target.fsPath), Buffer.from([80, 75, 0, 255, 128, 13, 10]));
  assert.equal(calls.save[0].defaultUri.scheme, 'file');
  assert.equal(path.basename(calls.save[0].defaultUri.fsPath), '中文 报告.xlsx');
  assert.equal(calls.errors.length, 0);
});

test('cancelled save dialog never reads file contents', async () => {
  const { api, calls, state } = mockApi(undefined);
  await createDownloadCommand(api, state)(remote);
  assert.equal(calls.read.length, 0);
  assert.equal(calls.errors.length, 0);
});

test('remote destination is refused before any content is read', async () => {
  const { api, calls, state } = mockApi(other);
  await createDownloadCommand(api, state)(remote);
  assert.equal(calls.read.length, 0);
  assert.match(calls.errors[0], /local save path/);
});

test('dirty custom editor requires choosing the saved version', async () => {
  const { api, calls, state } = mockApi();
  api.window.tabGroups.all = [{ tabs: [{ isDirty: true, input: { uri: remote } }] }];
  await createDownloadCommand(api, state)(remote);
  assert.equal(calls.save.length, 0);
  assert.equal(calls.read.length, 0);
});

test('dirty custom editor can explicitly download the saved version', async t => {
  const { target } = await fixture(t);
  const { api, calls, state } = mockApi(target);
  api.window.tabGroups.all = [{ tabs: [{ isDirty: true, input: { uri: remote } }] }];
  api.window.showWarningMessage = async () => 'Download Saved Version';
  await createDownloadCommand(api, state)(remote);
  assert.equal(calls.read.length, 1);
});

test('remote missing file fails visibly without showing a save dialog', async () => {
  const { api, calls, state } = mockApi();
  api.workspace.fs.stat = async () => { throw new Error('FileNotFound'); };
  await createDownloadCommand(api, state)(remote);
  assert.match(calls.errors[0], /FileNotFound/);
  assert.equal(calls.save.length, 0);
});

test('directories and untitled resources are refused', async () => {
  const { api, calls, state } = mockApi();
  api.workspace.fs.stat = async () => ({ type: 2 });
  await createDownloadCommand(api, state)(remote);
  await createDownloadCommand(api, state)(uri('untitled:/Untitled-1'));
  assert.equal(calls.errors.length, 2);
  assert.equal(calls.read.length, 0);
});

test('successful replacement is binary-safe and leaves no temporary file', async t => {
  const { target, folder } = await fixture(t);
  await fs.writeFile(target.fsPath, 'old data');
  const bytes = Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256));
  await transferFile(async () => bytes, remote, target);
  assert.deepEqual(await fs.readFile(target.fsPath), bytes);
  assert.deepEqual(await fs.readdir(folder), [path.basename(target.fsPath)]);
});

test('read failure preserves the existing destination', async t => {
  const { target, folder } = await fixture(t);
  await fs.writeFile(target.fsPath, 'old data');
  await assert.rejects(transferFile(async () => { throw new Error('connection lost'); }, remote, target));
  assert.equal(await fs.readFile(target.fsPath, 'utf8'), 'old data');
  assert.equal((await fs.readdir(folder)).length, 1);
});

test('cancellation after remote read preserves the existing destination', async t => {
  const { target } = await fixture(t);
  await fs.writeFile(target.fsPath, 'old data');
  const token = { isCancellationRequested: false };
  await assert.rejects(transferFile(async () => {
    token.isCancellationRequested = true; return Buffer.from('new data');
  }, remote, target, token), DownloadCancelled);
  assert.equal(await fs.readFile(target.fsPath, 'utf8'), 'old data');
});

test('cancellation after temporary write cleans temporary data and preserves destination', async t => {
  const { target, folder } = await fixture(t);
  await fs.writeFile(target.fsPath, 'old data');
  const token = { isCancellationRequested: false };
  const localFs = { ...fs, open: async (...args) => {
    const handle = await fs.open(...args);
    return { writeFile: async bytes => { await handle.writeFile(bytes); token.isCancellationRequested = true; },
      close: () => handle.close() };
  } };
  await assert.rejects(transferFile(async () => Buffer.from('new data'), remote, target, token, () => {}, localFs), DownloadCancelled);
  assert.equal(await fs.readFile(target.fsPath, 'utf8'), 'old data');
  assert.equal((await fs.readdir(folder)).length, 1);
});

test('rename failure cleans temporary data without damaging destination', async t => {
  const { target, folder } = await fixture(t);
  await fs.writeFile(target.fsPath, 'old data');
  const localFs = { ...fs, rename: async () => { throw new Error('destination locked'); } };
  await assert.rejects(transferFile(async () => Buffer.from('new data'), remote, target, undefined, () => {}, localFs));
  assert.equal(await fs.readFile(target.fsPath, 'utf8'), 'old data');
  assert.equal((await fs.readdir(folder)).length, 1);
});

test('same local source and target are refused', async t => {
  const { target } = await fixture(t);
  await assert.rejects(transferFile(async () => Buffer.from('data'), target, target), /differ from the source/);
});
