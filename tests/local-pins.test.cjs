'use strict';

const assert = require('node:assert/strict');
const { readPins, writePins, createFileStorage } = require('../scripts/local-pins.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function test(name, run) { run(); console.log(`PASS ${name}`); }

function storage() {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

test('pins persist in game order and unpin without changing another game', () => {
  const local = storage();
  writePins(local, 'slay', ['hp', 'energy', 'hp']);
  writePins(local, 'mirage', ['health']);
  assert.deepEqual(readPins(local, 'slay'), ['hp', 'energy']);
  writePins(local, 'slay', ['energy']);
  assert.deepEqual(readPins(local, 'slay'), ['energy']);
  assert.deepEqual(readPins(local, 'mirage'), ['health']);
  writePins(local, 'slay', []);
  assert.deepEqual(readPins(local, 'slay'), []);
});

test('missing and malformed local storage does not break trainer rendering', () => {
  const local = storage();
  assert.deepEqual(readPins(local, 'missing'), []);
  local.setItem('wand-local:pins:v1:bad', '{bad JSON');
  assert.deepEqual(readPins(local, 'bad'), []);
  local.setItem('wand-local:pins:v1:bad', JSON.stringify({ pins: ['hp'] }));
  assert.deepEqual(readPins(local, 'bad'), []);
  local.setItem('wand-local:pins:v1:bad', JSON.stringify(['hp', null, '', 5, 'hp']));
  assert.deepEqual(readPins(local, 'bad'), ['hp']);
});

test('failed persistence does not report a successful save', () => {
  const blocked = { getItem() { throw new Error('storage unavailable'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(readPins(blocked, 'slay'), []);
  assert.throws(() => writePins(blocked, 'slay', ['hp']), /quota/);
});

test('file-backed pins survive a new storage instance and preserve malformed files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wand-local-pins-'));
  const filename = path.join(directory, 'pins.json');
  try {
    writePins(createFileStorage(fs, filename), 'slay', ['hp']);
    writePins(createFileStorage(fs, filename), 'mirage', ['stealth']);
    assert.deepEqual(readPins(createFileStorage(fs, filename), 'slay'), ['hp']);
    assert.deepEqual(readPins(createFileStorage(fs, filename), 'mirage'), ['stealth']);
    fs.writeFileSync(filename, '{malformed');
    assert.deepEqual(readPins(createFileStorage(fs, filename), 'slay'), []);
    assert.throws(() => writePins(createFileStorage(fs, filename), 'slay', ['energy']));
    assert.equal(fs.readFileSync(filename, 'utf8'), '{malformed');
  } finally {
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    if (fs.existsSync(filename + '.tmp')) fs.unlinkSync(filename + '.tmp');
    fs.rmdirSync(directory);
  }
});
