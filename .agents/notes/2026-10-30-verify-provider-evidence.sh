#!/usr/bin/env bash
set -euo pipefail

notes=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for packet in compound-keywords set-433-external-evidence set-433-license-recapture set-442-repeat-evidence; do
  # The original verifiers use assert. Ignore PYTHONOPTIMIZE without changing their checksummed bytes.
  python3 -E "$notes/2026-10-30-$packet/verify.py"
done
