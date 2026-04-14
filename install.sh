#!/usr/bin/env bash
set -euo pipefail

# Tmpo installer — downloads the CLI and daemon from GitHub Releases.
#
# Usage:
#   curl -fsSL https://tmpo.sh/install | bash

REPO="jasonkatz/tmpo"
INSTALL_DIR="${TMPO_INSTALL_DIR:-$HOME/.tmpo/bin}"

# --- Platform detection ---

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)      err "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *)              err "Unsupported architecture: $arch" ;;
  esac

  echo "${os}-${arch}"
}

# --- Helpers ---

err() {
  echo "error: $1" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || err "'$1' is required but not found"
}

# --- Main ---

main() {
  need curl
  need chmod

  local platform
  platform="$(detect_platform)"

  echo "Detected platform: ${platform}"

  # Resolve latest release tag
  local tag
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')"

  if [ -z "$tag" ]; then
    err "Could not determine latest release. Check https://github.com/${REPO}/releases"
  fi

  echo "Latest release: ${tag}"

  local base_url="https://github.com/${REPO}/releases/download/${tag}"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir:-}"' EXIT

  # Download CLI and daemon
  echo "Downloading tmpo (~5MB)..."
  curl -fL --progress-bar -o "${tmpdir}/tmpo" "${base_url}/tmpo-${platform}"

  echo "Downloading tmpod (~60MB)..."
  curl -fL --progress-bar -o "${tmpdir}/tmpod" "${base_url}/tmpod-${platform}"

  # Install
  mkdir -p "$INSTALL_DIR"
  chmod +x "${tmpdir}/tmpo" "${tmpdir}/tmpod"
  mv "${tmpdir}/tmpo" "${INSTALL_DIR}/tmpo"
  mv "${tmpdir}/tmpod" "${INSTALL_DIR}/tmpod"

  echo ""
  echo "Installed to ${INSTALL_DIR}:"
  echo "  ${INSTALL_DIR}/tmpo"
  echo "  ${INSTALL_DIR}/tmpod"

  # Check PATH
  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo ""
    echo "Add tmpo to your PATH by adding this to your shell profile:"
    echo ""
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""

    # Offer to add it automatically
    local shell_profile=""
    if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "$SHELL")" = "zsh" ]; then
      shell_profile="$HOME/.zshrc"
    elif [ -n "${BASH_VERSION:-}" ] || [ "$(basename "$SHELL")" = "bash" ]; then
      shell_profile="$HOME/.bashrc"
    fi

    if [ -n "$shell_profile" ] && [ -f "$shell_profile" ]; then
      if ! grep -q "${INSTALL_DIR}" "$shell_profile" 2>/dev/null; then
        answer=""
        got_answer=0
        if { true > /dev/tty; } 2>/dev/null; then
          printf "Add to %s now? [Y/n] " "$shell_profile" > /dev/tty
          if read -r answer < /dev/tty; then
            got_answer=1
          else
            # No tty input available — print a newline so the bare prompt
            # doesn't trail into the next line, then skip.
            printf "\n" > /dev/tty
          fi
        fi
        if [ "$got_answer" = "1" ] && { [ -z "$answer" ] || [ "$answer" = "y" ] || [ "$answer" = "Y" ]; }; then
          echo "" >> "$shell_profile"
          echo "# tmpo" >> "$shell_profile"
          echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$shell_profile"
          echo "Added to ${shell_profile}. Restart your shell or run:"
          echo "  source ${shell_profile}"
        fi
      fi
    fi
  fi

  echo ""
  echo "Run 'tmpo --help' to get started."
}

main
