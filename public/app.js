async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function init() {
  try {
    const status = await fetchJSON('/api/status');
  const tokenEl = document.getElementById('token');
  const codeEl = document.getElementById('code');
  tokenEl.textContent = status.token;
  codeEl.textContent = status.code;
    document.getElementById('copyToken').onclick = () => {
      navigator.clipboard.writeText(status.token);
    };

    // QR code image for install
    const qrHint = document.getElementById('qr-hint');
    const qrcode = document.getElementById('qrcode');
    const img = new Image();
    img.alt = 'QR code';
  img.src = `/api/qrcode?token=${encodeURIComponent(status.token)}`;
    qrcode.innerHTML = '';
    qrcode.appendChild(img);

    const ips = await fetchJSON('/api/ips');
    const ul = document.getElementById('ips');
    ul.innerHTML = '';
    ips.addresses.forEach(a => {
      const li = document.createElement('li');
      li.textContent = `${a.address}:${status.port}`;
      ul.appendChild(li);
    });
    qrHint.textContent = `Scan from accepter; opens install page hosted here.`;

    const oneliner = document.getElementById('oneliner');
    const copyOneLiner = document.getElementById('copyOneLiner');
    oneliner.textContent = status.oneliner;
  copyOneLiner.onclick = () => navigator.clipboard.writeText(status.oneliner);
  document.getElementById('copyCode').onclick = () => navigator.clipboard.writeText(status.code);

    // Grant sudo flow
    const grantBtn = document.getElementById('grantSudoBtn');
    const grantResult = document.getElementById('grantResult');
    grantBtn.onclick = async () => {
      grantResult.textContent = 'Requesting sudo grant...';
      try {
        const resp = await fetch('/api/grant-sudo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: status.token }) });
        if (!resp.ok) throw new Error(`status ${resp.status}`);
        const j = await resp.json();
        if (j.applied) {
          grantResult.textContent = `Sudo applied on offerer: ${j.file}`;
        } else if (j.needs_root) {
          grantResult.innerHTML = `Not running as root. Run this on the offerer as root to apply:<br><pre>${j.command}</pre>`;
        } else {
          grantResult.textContent = JSON.stringify(j);
        }
      } catch (e) {
        grantResult.textContent = `Grant failed: ${e.message || e}`;
      }
    };

    // Poll pairing status
    const poll = async () => {
      try {
        const s = await fetchJSON('/api/status');
        if (s.paired) {
          document.title = 'SSH Helper — Paired';
        }
      } catch {}
      setTimeout(poll, 3000);
    };
    poll();
  } catch (e) {
    console.error(e);
    alert('Failed to load status. Is the server running?');
  }
}

init();
