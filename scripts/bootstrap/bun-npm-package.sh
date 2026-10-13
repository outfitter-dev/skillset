#!/usr/bin/env bash
#
# bun-npm-package.sh - print the npm package that carries the native Bun
# interpreter for this host, mirroring the target selection in Bun's own
# installer (https://bun.com/install). Exits non-zero for unsupported hosts.
#
# SKILLSET_BOOTSTRAP_CPUINFO overrides /proc/cpuinfo for tests.

set -euo pipefail

platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$platform" in
  darwin|linux) ;;
  *) exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) arch="aarch64" ;;
  x86_64|amd64) arch="x64" ;;
  *) exit 1 ;;
esac

# An x64 shell under Rosetta 2 still runs the native arm64 interpreter.
if [[ "$platform-$arch" == "darwin-x64" ]] &&
  [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" == "1" ]]; then
  arch="aarch64"
fi

package="@oven/bun-$platform-$arch"

if [[ "$platform" == "linux" ]]; then
  # musl's loader prints its banner for `ldd --version` but exits 1, so read
  # the output and ignore the status.
  libc_banner="$(ldd --version 2>&1 || true)"
  if [[ "$libc_banner" == *musl* ]]; then
    package="$package-musl"
  fi
fi

# x64 hosts without AVX2 need the baseline build.
if [[ "$arch" == "x64" ]]; then
  case "$platform" in
    linux)
      if ! grep -qw avx2 "${SKILLSET_BOOTSTRAP_CPUINFO:-/proc/cpuinfo}" 2>/dev/null; then
        package="$package-baseline"
      fi
      ;;
    darwin)
      if [[ "$(sysctl -n machdep.cpu.leaf7_features 2>/dev/null || true)" != *AVX2* ]]; then
        package="$package-baseline"
      fi
      ;;
  esac
fi

printf '%s\n' "$package"
