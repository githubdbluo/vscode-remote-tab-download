'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class DownloadCancelled extends Error {
  constructor() { super('Download cancelled'); this.name = 'DownloadCancelled'; }
}

function checkCancelled(token) {
  if (token?.isCancellationRequested) throw new DownloadCancelled();
}

// Write beside the destination and rename only after the entire transfer succeeds.
// A cancelled/failed read never truncates an existing destination file.
async function transferFile(readFile, source, destination, token, report = () => {}, localFs = fs) {
  if (destination.scheme !== 'file') throw new Error('Select a local save path.');
  if (source.toString() === destination.toString()) throw new Error('The destination must differ from the source file.');
  checkCancelled(token);
  report({ message: 'Reading source file…' });
  const bytes = await readFile(source);
  checkCancelled(token);
  const target = destination.fsPath;
  const temporary = path.join(path.dirname(target), `.remote-tab-download-${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    report({ message: 'Writing local file…' });
    const handle = await localFs.open(temporary, 'wx');
    temporaryCreated = true;
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    checkCancelled(token);
    await localFs.rename(temporary, target);
    return bytes.byteLength;
  } finally {
    if (temporaryCreated) await localFs.unlink(temporary).catch(() => {});
  }
}

module.exports = { transferFile, DownloadCancelled };
