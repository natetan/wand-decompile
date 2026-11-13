'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const os = require('node:os');
const { readPins, writePins, createFileStorage } = require('./local-pins.cjs');

const repo = path.resolve(__dirname, '..');
const helperRelative = 'resources/app.asar.unpacked/static/unpacked/auxiliary/WandAuxiliaryService.exe';
// These identities bind the native offset and JS anchors to the investigated release.
const supported = {
  version: '12.72.0',
  archive: '5abf4b22cb0d8ad2329637c7c686d8b7efc8bb04304437c248067e0e24e123d5',
  helper: '1755e5306e3d28f6b92106c7b99abf36575f807862a89e4ba9fef738edda53fc',
  launcher: 'a0957390f8cf0eadcf9e2268c7147494a1fc9761807e24c81c6fd7b7a1c5f7eb',
  patchedHelper: '354c1f2288035f5e07e3118849f41e33829584ebbea78b481d2c1b3796baa97e',
  manualArchive: '668d84771339b5f41b904998bf0fc80546cf3a0eab7b2403d30bc4e95159e17a',
  manualExecutable: 'f65c51e32c47ec360f8586701cb3ba48c0311e79c90a59d89bf0ea777e969548'
};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function assert(condition, message) { if (!condition) throw new Error(message); }

function options(argv) {
  const result = { output: path.join(repo, 'local-wand') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--source', '--output'].includes(arg)) {
      assert(argv[i + 1] && !argv[i + 1].startsWith('--'), `${arg} requires a path`);
      result[arg.slice(2)] = path.resolve(argv[++i]);
    } else if (['--dry-run', '--update', '--verify', '--help'].includes(arg)) result[arg.slice(2)] = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  assert(!(result.verify && (result.update || result['dry-run'])), '--verify cannot be combined with build modes');
  return result;
}

function latestSource() {
  // Some desktop sandboxes remap LOCALAPPDATA; also check the actual user home.
  const candidates = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Wand'), path.join(os.homedir(), 'AppData', 'Local', 'Wand')].filter(Boolean);
  const root = candidates.find(candidate => fs.existsSync(candidate));
  assert(root, 'No Wand installation found. Set --source to its installed app-* directory.');
  const versions = fs.readdirSync(root, { withFileTypes: true })
    .filter(item => item.isDirectory() && /^app-\d+(\.\d+){2}$/.test(item.name))
    .map(item => item.name).sort((a, b) => {
      const av = a.slice(4).split('.').map(Number), bv = b.slice(4).split('.').map(Number);
      for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return bv[i] - av[i];
      return 0;
    });
  assert(versions.length, `No Wand app-* installation found in ${root}`);
  return path.join(root, versions[0]);
}

function readAsar(bytes) {
  assert(bytes.length >= 16 && bytes.readUInt32LE(0) === 4, 'Unsupported ASAR header');
  const headerLength = bytes.readUInt32LE(12), base = 8 + bytes.readUInt32LE(4);
  assert(16 + headerLength <= base && base <= bytes.length, 'Invalid ASAR bounds');
  const header = bytes.subarray(16, 16 + headerLength), tree = JSON.parse(header);
  const files = [];
  function walk(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files || {})) {
      assert(name !== '..' && !/[\\/]/.test(name), 'Unsafe ASAR member name');
      const member = prefix ? `${prefix}/${name}` : name;
      if (entry.files) walk(entry, member);
      else if (!entry.unpacked && !entry.link) {
        const offset = Number(entry.offset);
        assert(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(entry.size) && entry.size >= 0 && base + offset + entry.size <= bytes.length, `Invalid member range: ${member}`);
        files.push({ member, entry, bytes: bytes.subarray(base + offset, base + offset + entry.size) });
      }
    }
  }
  walk(tree);
  return { tree, files, header };
}

function integrity(bytes, blockSize = 4194304) {
  assert(Number.isSafeInteger(blockSize) && blockSize > 0, 'Invalid integrity block size');
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize) blocks.push(hash(bytes.subarray(offset, offset + blockSize)));
  return { algorithm: 'SHA256', hash: hash(bytes), blockSize, blocks };
}

function patchArchive(original) {
  const asar = readAsar(original), changes = [], seen = new Set();
  function once(text, before, after, label) {
    assert(text.split(before).length === 2, `Expected exactly one anchor: ${label}`);
    changes.push(label);
    return text.replace(before, after);
  }
  function feature(text, before, after, key, member) {
    if (!text.includes(before)) return text;
    assert(!seen.has(key), `Duplicate feature anchor: ${key}`);
    seen.add(key);
    return once(text, before, after, `${member}: ${key}`);
  }
  let offset = 0;
  const parts = [];
  for (const file of asar.files) {
    let bytes = file.bytes;
    if (file.member.endsWith('.js')) {
      let text = bytes.toString('utf8');
      text = feature(text, 'get isEnabled(){return this.isEnabledForUser&&!this.account?.subscription}', 'get isEnabled(){return false}', 'disable daily timer', file.member);
      text = feature(text, 'accountChanged(){(0,w.Lt)(this.account?.flags,p.GQ.AdDeveloper)?this.active=!0:this.account?.subscription?this.active=!1:this.active=!0}', 'accountChanged(){this.active=false;this.src=null}', 'disable display ads', file.member);
      text = feature(text, 'get canStart(){return this.remoteFlagEnabled&&!!this.account&&!this.account.subscription}', 'get canStart(){return false}', 'disable rewarded ads', file.member);
      if (['app-3d588d45.47cb050c661c12db54d6.bundle.js', 'app-b37ddaa5.39a1bc99821fabdf810c.bundle.js', 'overlay-3d588d45.5b2296217e4dc11a0812.bundle.js'].includes(file.member)) {
        text = feature(text, 'get canUsePinnedMods(){return this.modsListContext.isPro}', 'get canUsePinnedMods(){return true}', `enable local pinning only (${file.member})`, file.member);
      }
      text = feature(text, 'await this.#e.dispatch(p.oz,this.modsListContext.trainer.gameId,t),this.#i(()=>this.#a.updatePinnedMods(this.modsListContext.trainer.gameId??"",t.map(e=>e.uuid)))', 'await this.#a.updatePinnedMods(this.modsListContext.trainer.gameId??"",t.map(e=>e.uuid)),await this.#e.dispatch(p.oz,this.modsListContext.trainer.gameId,t)', 'persist pins immediately', file.member);
      if (file.member === 'app-b37ddaa5.39a1bc99821fabdf810c.bundle.js') {
        const restoreStart = text.indexOf('async#n(){this.disableAutoPins');
        const restoreEnd = text.indexOf('async#g(){', restoreStart);
        assert(restoreStart >= 0 && restoreEnd > restoreStart, 'Pin restoration method anchor missing');
        text = text.slice(0, restoreStart) + 'async#n(){const e=this.modsListContext.trainer;if(!e)return;const t=e.gameId??"",s=await this.#a.getPinnedMods(t)||[],i=s.map(t=>e.blueprint.cheats.find(e=>e.uuid===t)).filter(Boolean),a=this.pinnedMods?.[t]||[];if(a.length!==i.length||a.some((e,t)=>e.uuid!==i[t]?.uuid))await this.#e.dispatch(p.oz,e.gameId,i)}' + text.slice(restoreEnd);
        seen.add('restore local pins'); changes.push(`${file.member}: restore local pins on trainer initialization`);
      }
      const pinStorage = `(${createFileStorage.toString()})(s(35392),s(24824).S().info.paths.storage+"/local-pins.json")`;
      text = feature(text, 'async getPinnedMods(e){return(await this.#R(e)).pinnedMods}', `async getPinnedMods(e){return (${readPins.toString()})(${pinStorage},e)}`, 'read pins from local profile', file.member);
      text = feature(text, 'async updatePinnedMods(e,t){const s=await this.#e.updatePinnedMods(e,t);return this.#b(e,{pinnedMods:s.data}),s}', `async updatePinnedMods(e,t){return (${writePins.toString()})(${pinStorage},e,t)}`, 'write pins to local profile', file.member);
      if (file.member === 'index.js') {
        const start = text.indexOf('let r=qt.getPath("userData");');
        const end = text.indexOf('initializeConfig(t.platform());', start);
        assert(start >= 0 && end > start, 'Main-process profile setup anchor missing');
        text = text.slice(0, start) + 'const localProfile=n.resolve(n.dirname(process.execPath),"..","profile");e.mkdirSync(localProfile,{recursive:true});qt.setPath("userData",localProfile);qt.setPath("sessionData",localProfile);Zt="local-copy";' + text.slice(end);
        changes.push('index.js: isolate profile');
        text = once(text, 'n.join(process.env.LOCALAPPDATA,"Wand","logs","tophat")', 'n.join(l.getPath("userData"),"logs","tophat")', 'index.js: isolate native logs');
        text = once(text, 'function isUpdaterAvailable(){', 'function isUpdaterAvailable(){return false;', 'index.js: disable app updater');
        text = once(text, 'qt.setAsDefaultProtocolClient(t,process.execPath,e)', 'false', 'index.js: disable development protocol registration');
        text = once(text, 'qt.setAsDefaultProtocolClient(e)', 'false', 'index.js: disable protocol registration');
        text = once(text, 'qt.setLoginItemSettings(n);', 'void n;', 'index.js: disable startup registration');
        const adStart = text.indexOf('function blockMaliciousAdRequests(){');
        const adEnd = text.indexOf('function restoreWindow(){', adStart);
        assert(adStart >= 0 && adEnd > adStart, 'Ad partition handler anchor missing');
        text = text.slice(0, adStart) + 'function blockMaliciousAdRequests(){o().session.fromPartition("persist:ads").webRequest.onBeforeRequest({urls:["*://*/*"]},((e,t)=>t({cancel:true})))}' + text.slice(adEnd);
        changes.push('index.js: block ads-partition network requests');
      }
      const next = Buffer.from(text);
      if (!next.equals(bytes)) {
        new vm.Script(text, { filename: file.member });
        bytes = next;
        file.entry.integrity = integrity(bytes, file.entry.integrity?.blockSize);
      }
    }
    file.entry.offset = String(offset);
    file.entry.size = bytes.length;
    parts.push(bytes);
    offset += bytes.length;
  }
  assert(seen.size === 10 && changes.includes('index.js: isolate profile'), 'Required patches were not all applied');
  const json = Buffer.from(JSON.stringify(asar.tree));
  const payloadSize = Math.ceil((4 + json.length) / 4) * 4;
  const header = Buffer.alloc(4 + payloadSize), size = Buffer.alloc(8);
  header.writeUInt32LE(payloadSize); header.writeUInt32LE(json.length, 4); json.copy(header, 8);
  size.writeUInt32LE(4); size.writeUInt32LE(header.length, 4);
  return { bytes: Buffer.concat([size, header, ...parts]), oldHeaderHash: hash(asar.header), newHeaderHash: hash(json), changes };
}

function prepare(source) {
  const archive = fs.readFileSync(path.join(source, 'resources/app.asar'));
  assert(hash(archive) === supported.archive, `Unsupported Wand build at ${source}. Only the investigated ${supported.version} archive is supported; no output was changed. Re-analyze new app releases with REA.`);
  const helper = fs.readFileSync(path.join(source, helperRelative));
  assert(hash(helper) === supported.helper, 'Auxiliary helper changed; native patch is not applicable');
  assert(helper[0x2741] === 0x11 && helper[0x2742] === 0x07 && helper[0x2743] === 0x2a, 'Native instruction guard failed');
  const patched = patchArchive(archive);
  const executable = fs.readFileSync(path.join(source, 'Wand.exe'));
  const digestOffset = executable.indexOf(patched.oldHeaderHash);
  assert(digestOffset >= 0 && executable.indexOf(patched.oldHeaderHash, digestOffset + 1) < 0, 'Expected exactly one executable archive-header digest');
  executable.write(patched.newHeaderHash, digestOffset, 64, 'ascii');
  helper[0x2741] = 0x16; helper[0x2742] = 0;
  assert(hash(helper) === supported.patchedHelper, 'Unexpected patched-helper digest');
  const launcher = fs.readFileSync(path.join(source, '..', 'Wand.exe'));
  assert(hash(launcher) === supported.launcher, 'Parent launcher changed; verify its identity and signature before adding support');
  return { archive: patched.bytes, executable, helper, launcher, source, changes: [...patched.changes, 'Wand.exe: regenerate embedded archive-header digest', 'auxiliary helper: override WinVerifyTrust wrapper result; preserve certificate allowlist and later checks'] };
}

function verifyApp(app, expected, requireLocalPins = false) {
  const archive = fs.readFileSync(path.join(app, 'resources/app.asar'));
  const asar = readAsar(archive);
  for (const file of asar.files) {
    if (!file.entry.integrity) continue;
    const measured = integrity(file.bytes, file.entry.integrity.blockSize);
    assert(file.entry.integrity.algorithm === 'SHA256' && measured.hash === file.entry.integrity.hash && JSON.stringify(measured.blocks) === JSON.stringify(file.entry.integrity.blocks), `Member integrity mismatch: ${file.member}`);
  }
  const read = prefix => asar.files.filter(f => f.member.startsWith(prefix)).map(f => f.bytes.toString()).join('\n');
  const code = read('app-');
  for (const anchor of ['get isEnabled(){return false}', 'accountChanged(){this.active=false;this.src=null}', 'get canStart(){return false}']) assert(code.includes(anchor), `Missing patched behavior: ${anchor}`);
  const localPins = code.includes('get canUsePinnedMods(){return true}') && code.includes('wand-local:pins:v1:') && code.includes('async getPinnedMods(e){return (function readPins') && code.includes('async updatePinnedMods(e,t){return (function writePins') && code.includes('/local-pins.json') && code.includes('async#n(){const e=this.modsListContext.trainer;');
  if (requireLocalPins) assert(localPins, 'Local pinning patch is missing');
  const main = asar.files.find(f => f.member === 'index.js')?.bytes.toString();
  assert(main?.includes('const localProfile=n.resolve(n.dirname(process.execPath),"..","profile")'), 'Profile is not isolated at the expected root');
  const executable = fs.readFileSync(path.join(app, 'Wand.exe'));
  assert(executable.indexOf(hash(asar.header)) >= 0, 'Executable/header digest mismatch');
  const hashes = { archive: hash(archive), executable: hash(executable), helper: hash(fs.readFileSync(path.join(app, helperRelative))) };
  for (const key of Object.keys(hashes)) assert(hashes[key] === expected[key], `Unexpected ${key} digest`);
  return { ...hashes, packedFiles: asar.files.length, localPins };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Path must stay inside output: ${target}`);
  // Do not move/write through junctions or symbolic links in an existing ancestor.
  for (let current = target; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), `Refusing linked path: ${current}`);
  }
}

function install(output, prepared, update) {
  assert(!fs.existsSync(output) || update, 'Output exists. Close the local app and use --update; profile will be retained.');
  assert(path.resolve(output) !== path.parse(output).root, 'Output cannot be a drive root');
  assert(!fs.existsSync(output) || !fs.lstatSync(output).isSymbolicLink(), 'Output cannot be a junction or symlink');
  assert(!fs.existsSync(output) || fs.existsSync(path.join(output, `app-${supported.version}`, 'Wand.exe')), 'Existing output is not a recognized local installation');
  const sourceRelative = path.relative(output, prepared.source);
  assert(sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative), 'Source cannot be inside output');
  const outputRelative = path.relative(prepared.source, output);
  assert(outputRelative.startsWith('..') || path.isAbsolute(outputRelative), 'Output cannot be inside source');
  const launcherPath = path.join(output, 'Wand.exe');
  assert(!fs.existsSync(launcherPath) || hash(fs.readFileSync(launcherPath)) === supported.launcher, 'Unexpected existing root launcher; review it before rebuilding');
  fs.mkdirSync(output, { recursive: true });
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const stage = path.join(output, `.build-${stamp}`), active = path.join(output, `app-${supported.version}`);
  inside(output, stage); inside(output, active);
  fs.cpSync(prepared.source, stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'resources/app.asar'), prepared.archive);
  fs.writeFileSync(path.join(stage, 'Wand.exe'), prepared.executable);
  fs.writeFileSync(path.join(stage, helperRelative), prepared.helper);
  const measured = verifyApp(stage, { archive: hash(prepared.archive), executable: hash(prepared.executable), helper: hash(prepared.helper) }, true);
  const backup = path.join(output, 'backups', `app-${supported.version}-${stamp}`);
  let oldMoved = false;
  try {
    if (fs.existsSync(active)) {
      inside(output, backup); inside(output, active);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.renameSync(active, backup); oldMoved = true;
    }
    inside(output, stage); inside(output, active);
    fs.renameSync(stage, active);
  } catch (error) {
    if (oldMoved && !fs.existsSync(active)) { inside(output, backup); inside(output, active); fs.renameSync(backup, active); }
    throw new Error(`Could not replace the application. Close all local Wand/helper processes and retry. Staged files are retained at ${stage}. ${error.message}`);
  }
  // The existing root launcher must be the same signed original, never a patched app.
  fs.writeFileSync(launcherPath, prepared.launcher);
  fs.mkdirSync(path.join(output, 'profile'), { recursive: true });
  fs.writeFileSync(path.join(output, 'Launch Wand Local.cmd'), '@echo off\r\nstart "Wand Local" /D "%~dp0app-12.72.0" "%~dp0app-12.72.0\\Wand.exe"\r\n');
  const manifest = { version: supported.version, source: prepared.source, hashes: measured, features: { localPins: true }, launcher: hash(prepared.launcher), changes: prepared.changes, builtAt: new Date().toISOString(), profile: 'profile', backup: oldMoved ? path.relative(output, backup) : null };
  fs.writeFileSync(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function main() {
  const args = options(process.argv.slice(2));
  if (args.help) {
    console.log('node scripts/build-local.cjs [--dry-run | --update | --verify] [--source <installed app-* directory>] [--output <local root>]');
    return;
  }
  if (args.verify) {
    const manifestPath = path.join(args.output, 'build-manifest.json');
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : null;
    const expected = manifest?.hashes || { archive: supported.manualArchive, executable: supported.manualExecutable, helper: supported.patchedHelper };
    const result = verifyApp(path.join(args.output, `app-${supported.version}`), expected, manifest?.features?.localPins === true);
    assert(hash(fs.readFileSync(path.join(args.output, 'Wand.exe'))) === supported.launcher, 'Root launcher identity mismatch');
    console.log(JSON.stringify({ status: 'verified on disk; gameplay is a separate test', ...result }, null, 2));
    return;
  }
  const prepared = prepare(args.source || latestSource());
  if (args['dry-run']) {
    console.log(JSON.stringify({ mode: 'dry-run; no output changed', source: prepared.source, output: args.output, changes: prepared.changes, hashes: { archive: hash(prepared.archive), executable: hash(prepared.executable), helper: hash(prepared.helper) } }, null, 2));
    return;
  }
  console.log(JSON.stringify(install(args.output, prepared, args.update), null, 2));
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
