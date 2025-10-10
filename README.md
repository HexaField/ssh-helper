# SSH Helper

Set up SSH trust between two machines quickly using a QR code or short pairing code over a LAN or Tailscale.

- Offerer: the machine that will receive the peer's SSH public key and add it to `~/.ssh/authorized_keys`.
- Accepter: the machine that will send its SSH public key to the offerer.

This tool spins up a small local Node.js server on the offerer. The accepter can scan a QR code or enter a short code to securely deliver its SSH public key.

## Features
- Works over LAN or any network where devices can reach each other (e.g., Tailscale)
- QR code flow and short pairing code flow
- Minimal, no external accounts
- Bash helper scripts for macOS/Linux

## Quick start (Offerer)
1) Install Node.js 18+.
2) Start the helper:
	- macOS/Linux: run `scripts/start-server.sh` or:
	- `npm install` then `npm start`
3) Open the printed URL (http://localhost:4321). Share the QR or the 8-char code + IP with the accepter.

## Quick start (Accepter)
Option A — QR code:
- Scan the QR from the offerer; it opens an install page with a one-liner.

Option B — Code + IP:
- Run the accept script with the IP and the 8-char code or full token:

	scripts/accept.sh 192.168.1.10 ABCD1234

The script will generate an SSH key if missing and send your public key over HTTP to the offerer.

Detailed steps are in the sections below. This README will be updated as features are implemented.

## Security note
Keys are sent directly to the offerer over your local network connection initiated by the accepter; pairing tokens are short-lived. Review the source before use in sensitive environments.

*** Work in progress ***