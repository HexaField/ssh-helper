#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm install --silent
npm run start
