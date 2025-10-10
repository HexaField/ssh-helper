#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <offerer-host> <token-or-code> [port=4321]" >&2
  exit 1
fi

HOST="$1"
CODE_OR_TOKEN="$2"
PORT="${3:-4321}"

# Resolve 8-char code to token if needed
if [[ ${#CODE_OR_TOKEN} -eq 8 && "$CODE_OR_TOKEN" != *-* ]]; then
  echo "Resolving code..."
  set +e
  TOKEN=$(curl -fsSL "http://$HOST:$PORT/api/resolve/$CODE_OR_TOKEN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  set -e
  if [[ -z "${TOKEN:-}" ]]; then
    echo "Failed to resolve code. You can pass the full token instead." >&2
    exit 1
  fi
else
  TOKEN="$CODE_OR_TOKEN"
fi

mkdir -p "$HOME/.ssh"
if [[ ! -f "$HOME/.ssh/id_ed25519.pub" && ! -f "$HOME/.ssh/id_rsa.pub" ]]; then
  ssh-keygen -t ed25519 -N '' -f "$HOME/.ssh/id_ed25519" <<< y >/dev/null 2>&1 || true
fi
PUBKEY_FILE="${HOME}/.ssh/id_ed25519.pub"
if [[ ! -f "$PUBKEY_FILE" ]]; then PUBKEY_FILE="${HOME}/.ssh/id_rsa.pub"; fi
PUBKEY="$(cat "$PUBKEY_FILE")"
USER_NAME="$(whoami)"
HOSTNAME_FQDN="$(hostname)"

payload=$(cat <<JSON
{"token":"$TOKEN","pubkey":"$PUBKEY","user":"$USER_NAME","hostname":"$HOSTNAME_FQDN"}
JSON
)

curl -fsSL -X POST "http://$HOST:$PORT/api/pairing/$TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$payload"
echo "\nSent public key to $HOST.$( [[ "$PORT" != "80" ]] && echo ":$PORT" )"
