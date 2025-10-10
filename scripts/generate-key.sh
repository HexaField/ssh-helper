#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$HOME/.ssh"
if [[ ! -f "$HOME/.ssh/id_ed25519" ]]; then
  echo "Generating SSH key (ed25519)"
  ssh-keygen -t ed25519 -N '' -f "$HOME/.ssh/id_ed25519" <<< y
else
  echo "SSH key already exists at ~/.ssh/id_ed25519"
fi
