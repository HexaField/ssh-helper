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
