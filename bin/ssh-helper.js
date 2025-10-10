#!/usr/bin/env node
// Simple CLI for @hexafield/ssh-helper
// Commands: start, status, accept, grant, gen-key, open

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    } else out._.push(a);
  }
  return out;
}

function localIPs() {
  const nets = os.networkInterfaces();
  const res = [];
  for (const n of Object.keys(nets)) {
    for (const i of nets[n] ?? []) if (i.family === 'IPv4' && !i.internal) res.push(i.address);
  }
  return res;
}

async function httpJSON(method, urlStr, body) {
  const init = { method, headers: {} };
  if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(urlStr, init);
  if (!res.ok) throw new Error(`${method} ${urlStr} -> ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function ensureKey() {
  const ssh = path.join(os.homedir(), '.ssh');
  const ed = path.join(ssh, 'id_ed25519');
  const edPub = ed + '.pub';
  const rsaPub = path.join(ssh, 'id_rsa.pub');
  if (!fs.existsSync(edPub) && !fs.existsSync(rsaPub)) {
    fs.mkdirSync(ssh, { recursive: true, mode: 0o700 });
    const proc = spawn('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', ed], { stdio: 'inherit' });
    return new Promise((resolve, reject) => proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error('ssh-keygen failed'))));
  }
}

function readPubKey() {
  const ssh = path.join(os.homedir(), '.ssh');
  const cand = [path.join(ssh, 'id_ed25519.pub'), path.join(ssh, 'id_rsa.pub')];
  for (const f of cand) if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  return null;
}

async function cmdStart(flags) {
  const port = Number(flags.port || process.env.PORT || 4321);
  const serverPath = path.resolve(__dirname, '../server.js');
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, PORT: String(port) }, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

async function cmdStatus(flags) {
  const host = flags.host || 'localhost';
  const port = Number(flags.port || 4321);
  const s = await httpJSON('GET', `http://${host}:${port}/api/status`);
  console.log(JSON.stringify(s, null, 2));
}

async function resolveToken({ host, port, code, token }) {
  if (token) return token;
  if (!code) throw new Error('Pass --token or --code');
  if (String(code).length !== 8) throw new Error('Code must be 8 characters');
  const r = await httpJSON('GET', `http://${host}:${port}/api/resolve/${code}`);
  if (!r?.token) throw new Error('Failed to resolve code to token');
  return r.token;
}

async function cmdAccept(flags) {
  const host = flags.host;
  if (!host) throw new Error('Missing --host');
  const port = Number(flags.port || 4321);
  const token = await resolveToken({ host, port, code: flags.code, token: flags.token });
  await ensureKey();
  const pub = readPubKey();
  if (!pub) throw new Error('No SSH public key found');
  const payload = { token, pubkey: pub, user: os.userInfo().username, hostname: os.hostname() };
  const r = await httpJSON('POST', `http://${host}:${port}/api/pairing/${token}`, payload);
  console.log('Pairing response:', r);
}

async function cmdGrant(flags) {
  const host = flags.host;
  if (!host) throw new Error('Missing --host');
  const port = Number(flags.port || 4321);
  const token = await resolveToken({ host, port, code: flags.code, token: flags.token });
  const resp = await httpJSON('GET', `http://${host}:${port}/api/publickey?token=${encodeURIComponent(token)}`);
  if (typeof resp !== 'string') throw new Error('Unexpected response');
  const ssh = path.join(os.homedir(), '.ssh');
  const ak = path.join(ssh, 'authorized_keys');
  fs.mkdirSync(ssh, { recursive: true, mode: 0o700 });
  fs.appendFileSync(ak, `\n# @hexafield/ssh-helper ${new Date().toISOString()} offerer@${host}\n${resp.trim()}\n`, { mode: 0o600 });
  try { fs.chmodSync(ssh, 0o700); } catch {}
  try { fs.chmodSync(ak, 0o600); } catch {}
  console.log('Added offerer public key to authorized_keys');
}

async function cmdOpen(flags) {
  const host = flags.host || 'localhost';
  const port = Number(flags.port || 4321);
  const urlStr = `http://${host}:${port}`;
  const platform = process.platform;
  const opener = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', urlStr] : [urlStr];
  spawn(opener, args, { stdio: 'ignore', detached: true }).unref();
  console.log('Opened', urlStr);
}

async function cmdGenKey() {
  await ensureKey();
  const pub = readPubKey();
  if (pub) console.log(pub);
}

async function main() {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  const flags = parseArgs(rest);
  try {
    switch (command) {
      case 'start':
        return await cmdStart(flags);
      case 'status':
        return await cmdStatus(flags);
      case 'accept':
        return await cmdAccept(flags);
      case 'grant':
        return await cmdGrant(flags);
      case 'open':
        return await cmdOpen(flags);
      case 'gen-key':
        return await cmdGenKey(flags);
      case 'help':
      case undefined:
        console.log(`ssh-helper CLI

Usage:
  npx @hexafield/ssh-helper start [--port=4321]
  npx @hexafield/ssh-helper status [--host=localhost] [--port=4321]
  npx @hexafield/ssh-helper accept --host=<offerer-ip> (--code=ABCDEFGH | --token=<token>) [--port=4321]
  npx @hexafield/ssh-helper grant --host=<offerer-ip> (--code=ABCDEFGH | --token=<token>) [--port=4321]
  npx @hexafield/ssh-helper open [--host=localhost] [--port=4321]
  npx @hexafield/ssh-helper gen-key

Notes:
- Use code (8 chars) or full token. Code is resolved via /api/resolve.
- Works over LAN or Tailscale. Set --host to any reachable IP of the offerer.
`);
        return;
      default:
        console.error('Unknown command:', command);
        process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.message || e);
    process.exit(1);
  }
}

main();
