'use strict';

// Self-contained functions: the builder embeds them into the pin service methods.
function readPins(storage, gameId) {
  try {
    const pins = JSON.parse(storage.getItem(`wand-local:pins:v1:${String(gameId)}`) || '[]');
    return Array.isArray(pins) ? [...new Set(pins.filter(pin => typeof pin === 'string' && pin.length > 0))] : [];
  } catch {
    return [];
  }
}

function writePins(storage, gameId, pins) {
  if (!Array.isArray(pins)) throw new TypeError('Local pins must be an array');
  const clean = [...new Set(pins.filter(pin => typeof pin === 'string' && pin.length > 0))];
  // A failed write must not report success or overwrite a different game's pins.
  storage.setItem(`wand-local:pins:v1:${String(gameId)}`, JSON.stringify(clean));
  return { data: clean };
}

function createFileStorage(fs, filename) {
  function read() {
    let text;
    try { text = fs.readFileSync(filename, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    const records = JSON.parse(text);
    if (!records || typeof records !== 'object' || Array.isArray(records)) throw new TypeError('Invalid local pin file');
    return records;
  }
  return {
    getItem(key) { return read()[key] ?? null; },
    setItem(key, value) {
      const records = read();
      records[key] = value;
      fs.writeFileSync(filename + '.tmp', JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(filename + '.tmp', filename);
    }
  };
}

module.exports = { readPins, writePins, createFileStorage };
