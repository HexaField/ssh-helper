import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';
import QRCode from 'qrcode';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Simple helpers
const readJson = async (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', chunk => data += chunk);
  req.on('end', () => {
    try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
  });
  req.on('error', reject);
});

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({ iface: name, address: net.address });
      }
    }
  }
  return results;
}

function getLocalPublicKey() {
  const sshDir = path.join(os.homedir(), '.ssh');
  const cand = [
    path.join(sshDir, 'id_ed25519.pub'),
    path.join(sshDir, 'id_rsa.pub'),
  ];
  for (const f of cand) {
    try {
      if (fs.existsSync(f)) {
        const txt = fs.readFileSync(f, 'utf8').trim();
        if (txt) return txt;
      }
    } catch {}
  }
  return null;
}

function genToken() {
  // 6-char base32-like for readability
  return crypto.randomBytes(4).toString('hex').slice(0, 8);
}

// State
let state = {
  token: genToken(),
  port: Number(process.env.PORT) || 4321,
  paired: false,
  lastInstallFrom: null,
  lastInstallUser: null,
  tokenIssuedAt: Date.now(),
  tokenTtlSec: 15 * 60,
};

const publicDir = path.join(__dirname, 'public');

// Minimal QR: return a PNG QR code via a very small dependency-free implementation by delegating to Google Chart API alternative? Can't call network.
// Instead, provide a simple install URL text as data URL QR-like placeholder (fallback to showing URL text). We'll deliver textual URL and let client render QR via JS if needed.
// For simplicity, we serve a PNG via a tiny inline library would be heavy; so we return 302 redirect to a minimal HTML that uses a JS QR generator offline.

function send(res, code, body, headers = {}) {
  const defaultHeaders = { 'content-type': 'application/json; charset=utf-8' };
  const finalHeaders = { ...defaultHeaders, ...headers };
  res.writeHead(code, finalHeaders);
  if (typeof body === 'object' && finalHeaders['content-type'].includes('application/json')) {
    res.end(JSON.stringify(body));
  } else {
    res.end(body);
  }
}

function serveStatic(req, res) {
  let reqPath = url.parse(req.url).pathname;
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(publicDir, path.normalize(reqPath));
  if (!filePath.startsWith(publicDir)) {
    return send(res, 403, JSON.stringify({ error: 'forbidden' }));
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, JSON.stringify({ error: 'not found' }));
    }
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'application/octet-stream';
    send(res, 200, data, { 'content-type': type });
  });
}

function buildInstallURL(host, port, token) {
  return `http://${host}:${port}/install/${token}`;
}

function renderQRHTML(urlText) {
  // Simple HTML that renders a QR using a tiny inline script (qrcode-svg via CDN is not allowed). We'll use QRCode.js inline from MIT source subset.
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><meta charset="utf-8"><title>QR</title><style>body{font:16px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:grid;place-items:center;height:100svh;margin:0}#c{display:grid;gap:12px;place-items:center}</style>
  <div id=c><div id=q></div><div>${esc(urlText)}</div></div>
  <script>(function(){function l(e){var t=[[1,26,19],[1,44,34],[1,70,55],[1,100,80],[1,134,108],[2,86,68],[2,98,78],[2,121,97]];for(var n=0;n<t.length;n++)if(e<=t[n][1])return n+1;return 8}function g(e){var t=document.createElement('canvas'),n=t.getContext('2d'),r=4,a=e.getModuleCount();t.width=t.height=a*r;for(var i=0;i<a;i++)for(var o=0;o<a;o++){n.fillStyle=e.isDark(i,o)?'#000':'#fff';n.fillRect(i*r,o*r,r,r)}return t}function q(t){var n=window.QRCodeGenerator||window.QRCode; if(n){var e=new n(0,'L');e.addData(t);e.make();return g(e)}var e=document.createElement('div');e.textContent='QR library unavailable';return e}var s='` + urlText + `';var u=document.getElementById('q');
  var d=document.createElement('script');d.src='https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';d.onload=function(){u.appendChild(q(s));};document.head.appendChild(d);}())</script>`;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const method = req.method || 'GET';
  const pathName = parsed.pathname || '/';

  // APIs
  if (pathName === '/api/status' && method === 'GET') {
    // Rotate token if expired or if previously paired
    const ageSec = Math.floor((Date.now() - state.tokenIssuedAt) / 1000);
    if (ageSec > state.tokenTtlSec || state.paired) {
      state.token = genToken();
      state.tokenIssuedAt = Date.now();
      state.paired = false;
    }
    const ips = getLocalIPs();
    const host = ips[0]?.address || 'localhost';
    const sha = crypto.createHash('sha1').update(state.token).digest('hex').slice(0, 8);
    const oneliner = `curl -fsSL http://${host}:${state.port}/api/install/${state.token} | bash`;
    const hasPubkey = !!getLocalPublicKey();
    const grantOneliner = `curl -fsSL "http://${host}:${state.port}/api/install/${state.token}?mode=grant" | bash`;
    return send(res, 200, { token: state.token, code: sha, paired: state.paired, port: state.port, oneliner, grantOneliner, hasPubkey, expiresIn: state.tokenTtlSec - Math.max(0, ageSec) });
  }

  if (pathName === '/api/ips' && method === 'GET') {
    return send(res, 200, { addresses: getLocalIPs() });
  }

  if (pathName.startsWith('/api/qrcode') && method === 'GET') {
    const token = parsed.query.token || state.token;
    const ips = getLocalIPs();
    const host = req.headers.host?.split(':')[0] || ips[0]?.address || 'localhost';
    const link = buildInstallURL(host, state.port, token);
    try {
      const png = await QRCode.toBuffer(link, { type: 'png', errorCorrectionLevel: 'M', margin: 1, scale: 6 });
      return send(res, 200, png, { 'content-type': 'image/png' });
    } catch (e) {
      return send(res, 500, { error: e.message || String(e) });
    }
  }

  // One-shot install script delivery
  if (pathName.startsWith('/api/install/') && method === 'GET') {
    const token = decodeURIComponent(pathName.split('/').pop() || '');
    if (token !== state.token) return send(res, 400, { error: 'invalid token' });
    const hostFromHeader = (req.headers['host']||'').split(':')[0];
    const mode = (parsed.query.mode || 'send').toString();
    const script = `#!/usr/bin/env bash
set -euo pipefail

# SSH accepter script: send our public key to the offerer
HOST="${parsed.query.host || hostFromHeader}"
PORT=${state.port}
TOKEN="${state.token}"

mkdir -p "$HOME/.ssh"

if [[ "${mode}" == "grant" ]]; then
  echo "Granting offerer access to this machine by appending their SSH public key..."
  OFFERER_PUBKEY=$(curl -fsSL "http://"${HOST}:${state.port}"/api/publickey?token=${state.token}") || { echo "Failed to fetch offerer's public key" >&2; exit 1; }
  if [[ -z "${OFFERER_PUBKEY}" ]]; then echo "Invalid response or missing pubkey" >&2; exit 1; fi
  printf "\n# @hexafield/ssh-helper %s offerer@%s\n%s\n" "$(date -u +%FT%TZ)" "${HOST}" "${OFFERER_PUBKEY}" >> "$HOME/.ssh/authorized_keys"
  chmod 700 "$HOME/.ssh" || true
  chmod 600 "$HOME/.ssh/authorized_keys" || true
  echo "Added offerer's key to authorized_keys."
else
  if [[ ! -f "$HOME/.ssh/id_ed25519.pub" && ! -f "$HOME/.ssh/id_rsa.pub" ]]; then
    ssh-keygen -t ed25519 -N '' -f "$HOME/.ssh/id_ed25519" <<< y >/dev/null 2>&1 || true
  fi
  PUBKEY_FILE="${HOME}/.ssh/id_ed25519.pub"
  if [[ ! -f "$PUBKEY_FILE" ]]; then PUBKEY_FILE="${HOME}/.ssh/id_rsa.pub"; fi
  PUBKEY="$(cat "$PUBKEY_FILE")"
  USER_NAME="$(whoami)"
  HOSTNAME_FQDN="$(hostname)"

  payload=$(cat <<JSON
{"token":"${state.token}","pubkey":"$PUBKEY","user":"$USER_NAME","hostname":"$HOSTNAME_FQDN"}
JSON
)

  curl -fsSL -X POST "http://"${HOST}:${state.port}"/api/pairing/${state.token}" \
    -H 'Content-Type: application/json' \
    -d "$payload" && echo "\nSent public key to ${HOST}." || { echo "Failed to send key" >&2; exit 1; }
fi
`;
    return send(res, 200, script, { 'content-type': 'text/x-sh; charset=utf-8' });
  }

  // Accept posted public key
  if (pathName.startsWith('/api/pairing/') && method === 'POST') {
    const token = decodeURIComponent(pathName.split('/').pop() || '');
    if (token !== state.token) return send(res, 400, { error: 'invalid token' });
    // Enforce TTL
    const ageSec = Math.floor((Date.now() - state.tokenIssuedAt) / 1000);
    if (ageSec > state.tokenTtlSec) return send(res, 400, { error: 'token expired' });
    try {
  const body = await readJson(req);
      if (!body || typeof body.pubkey !== 'string') return send(res, 400, { error: 'missing pubkey' });
      const pub = (body.pubkey || '').trim().replace(/[\r\n]+/g, ' ');
      // Basic validation: type, base64 blob, optional comment
      if (!/^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/=]+( .*)?$/.test(pub)) {
        return send(res, 400, { error: 'invalid pubkey format' });
      }

      const sshDir = path.join(os.homedir(), '.ssh');
      const authKeys = path.join(sshDir, 'authorized_keys');
      if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      const entry = `\n# @hexafield/ssh-helper ${new Date().toISOString()} ${body.user || ''}@${body.hostname || ''}\n${pub}\n`;
      fs.appendFileSync(authKeys, entry, { mode: 0o600 });
      try { fs.chmodSync(sshDir, 0o700); } catch {}
      try { fs.chmodSync(authKeys, 0o600); } catch {}
      state.paired = true;
      state.lastInstallFrom = body.hostname || null;
      state.lastInstallUser = body.user || null;
      // Rotate token after success
      state.token = genToken();
      state.tokenIssuedAt = Date.now();
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 500, { error: e.message || String(e) });
    }
  }

  // Grant sudo to a user on the offerer machine
  if (pathName === '/api/grant-sudo' && method === 'POST') {
    try {
      const body = await readJson(req);
      const token = body?.token || parsed.query.token;
      const username = (body?.username || state.lastInstallUser || '').toString();
      const nopass = !!body?.nopass;
      if (!token || token !== state.token) return send(res, 400, { error: 'invalid token' });
      const ageSec = Math.floor((Date.now() - state.tokenIssuedAt) / 1000);
      if (ageSec > state.tokenTtlSec) return send(res, 400, { error: 'token expired' });
      if (!username) return send(res, 400, { error: 'missing username' });

      const sudoLine = nopass ? `${username} ALL=(ALL) NOPASSWD: ALL` : `${username} ALL=(ALL) ALL`;
      const filename = `/etc/sudoers.d/ssh-helper-${username}`;

      // If running as root, attempt to write sudoers.d file and validate with visudo
      if (typeof process.getuid === 'function' && process.getuid() === 0) {
        try {
          fs.writeFileSync(filename, `# added by ssh-helper on ${new Date().toISOString()}\n${sudoLine}\n`, { mode: 0o440 });
          // Validate syntax
          try { execSync(`visudo -c -f ${filename}`, { stdio: 'pipe' }); } catch (e) {
            // revert and error
            try { fs.unlinkSync(filename); } catch {};
            return send(res, 500, { error: 'visudo validation failed', detail: String(e) });
          }
          return send(res, 200, { ok: true, applied: true, file: filename });
        } catch (e) {
          return send(res, 500, { error: 'failed to write sudoers file', detail: String(e) });
        }
      }

      // Not running as root: return a safe command the offerer should run as root to apply
      const safeCmd = `sudo bash -c 'cat > ${filename} <<\'EOF\'\n# added by ssh-helper on ${new Date().toISOString()}\n${sudoLine}\nEOF\' && sudo chmod 440 ${filename} && sudo visudo -c -f ${filename}`;
      return send(res, 200, { ok: true, applied: false, needs_root: true, command: safeCmd });
    } catch (e) {
      return send(res, 500, { error: e.message || String(e) });
    }
  }

  // Resolve a short code (sha) to the current token
  if (pathName.startsWith('/api/resolve/') && method === 'GET') {
    const code = decodeURIComponent(pathName.split('/').pop() || '');
    const sha = crypto.createHash('sha1').update(state.token).digest('hex').slice(0, 8);
    if (code === sha) return send(res, 200, { token: state.token });
    return send(res, 404, { error: 'not found' });
  }

  // Serve offerer's public key (requires valid, current token)
  if (pathName === '/api/publickey' && method === 'GET') {
    const token = parsed.query.token;
    const ageSec = Math.floor((Date.now() - state.tokenIssuedAt) / 1000);
    if (!token || token !== state.token || ageSec > state.tokenTtlSec) {
      return send(res, 400, { error: 'invalid or expired token' });
    }
    const key = getLocalPublicKey();
    if (!key) return send(res, 404, { error: 'no public key found on offerer' });
    return send(res, 200, key + "\n", { 'content-type': 'text/plain; charset=utf-8' });
  }

  if (pathName === '/api/reset' && method === 'POST') {
    state.token = genToken();
    state.tokenIssuedAt = Date.now();
    state.paired = false;
    return send(res, 200, { ok: true, token: state.token });
  }

  // Install page
  if (pathName.startsWith('/install/')) {
    const token = decodeURIComponent(pathName.split('/').pop() || '');
    const ips = getLocalIPs();
    const host = ips[0]?.address || req.headers.host?.split(':')[0] || 'localhost';
    const html = `<!doctype html><meta charset=utf-8><title>SSH Helper Install</title>
    <style>body{font:16px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:1rem;max-width:800px;margin:0 auto}code,pre{background:#0001;padding:.3rem .4rem;border-radius:6px}</style>
    <h1>Send your SSH public key</h1>
    <p>This will send your machine's SSH public key to the offerer so they can SSH into you.</p>
    <ol>
      <li>Open a terminal on this device.</li>
      <li>Run:</li>
    </ol>
    <pre>curl -fsSL http://${host}:${state.port}/api/install/${token} | bash</pre>
    <p>Token: <code>${token}</code></p>`;
    return send(res, 200, html, { 'content-type': 'text/html; charset=utf-8' });
  }

  // Static files
  if (method === 'GET') return serveStatic(req, res);
  send(res, 404, { error: 'not found' });
});

server.listen(state.port, () => {
  const ips = getLocalIPs();
  console.log(`SSH Helper listening on: http://localhost:${state.port}`);
  for (const ip of ips) console.log(`  http://${ip.address}:${state.port}`);
});
