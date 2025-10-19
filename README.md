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

## Granting sudo to the accepter (optional)
Sometimes you may want to grant the accepter sudo access on the offerer machine. This can be done from the web UI or the CLI.

- Web UI: on the offerer page (http://localhost:4321) there is a "Grant accepter sudo on this machine" button under the Accepter one-liner. Clicking it will attempt to write a sudoers file (`/etc/sudoers.d/ssh-helper-<username>`) if the helper is running as root. If the helper is not running as root, it will return a safe command you can run as root to apply the sudoers file.

- CLI: use the `grant-sudo` command to request the offerer add sudo for the accepter. Example:

```bash
npx @hexafield/ssh-helper grant-sudo --host=192.168.1.10 --code=ABCDEFGH --username=accepter
```

The server will respond with either a success object (applied on the offerer) or a `needs_root` response containing a `command` string you should run on the offerer as root to apply the sudoers file safely. Default behavior grants normal sudo (password required). Use `--nopass` to request NOPASSWD (administrator discretion required).

Security note: granting sudo is powerful. Prefer granting only specific commands via a custom sudoers file rather than full NOPASSWD all-commands access.

Detailed steps are in the sections below. This README will be updated as features are implemented.

## Security note
Keys are sent directly to the offerer over your local network connection initiated by the accepter; pairing tokens are short-lived. Review the source before use in sensitive environments.

## CLI via npx

You can use the CLI either locally from this repo or (once published) via npm.

- Local (from this repo):
	- npx --no-install ssh-helper help
	- npx --no-install ssh-helper start --port=4321
	- npx --no-install ssh-helper status --host=localhost --port=4321
	- npx --no-install ssh-helper accept --host=192.168.1.10 --code=ABCDEFGH
	- npx --no-install ssh-helper grant --host=192.168.1.10 --code=ABCDEFGH
	- npx --no-install ssh-helper open --host=localhost --port=4321

- From npm (after publish under `@hexafield/ssh-helper`):
	- npx @hexafield/ssh-helper help
	- npx @hexafield/ssh-helper start --port=4321
	- npx @hexafield/ssh-helper status --host=localhost --port=4321
	- npx @hexafield/ssh-helper accept --host=192.168.1.10 --code=ABCDEFGH
	- npx @hexafield/ssh-helper grant --host=192.168.1.10 --code=ABCDEFGH
	- npx @hexafield/ssh-helper open --host=localhost --port=4321

Commands:
- start: run the server (use --port)
- status: print server status JSON
- accept: send your pubkey to the offerer (use --host and --code or --token)
- grant: append the offerer’s pubkey to your `authorized_keys`
- open: open the web UI in your browser
- gen-key: generate an ed25519 SSH key if missing and print the public key

*** Work in progress ***