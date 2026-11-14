#!/bin/sh
# Install wrike-tui.
#
# Downloads the release binary for this machine: Linux or macOS, x64 or arm64.
# Windows uses install.ps1 instead.
#
#   curl -fsSL https://raw.githubusercontent.com/joegeary/wrike-tui/main/install.sh | sh
#
# INSTALL_DIR moves where the binary lands, and defaults to ~/.local/bin.
# VERSION pins a release, as v0.2.0, and defaults to the latest.
#
# install.ps1 is this script for Windows. Change a decision in one and check the other.

set -eu

REPO="joegeary/wrike-tui"
BINARY="wrike-tui"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

die() {
	echo "$1" >&2
	exit 1
}

# https only, redirects included, so the download cannot be steered to plain http.
fetch() {
	curl --proto '=https' --tlsv1.2 -fsSL "$@"
}

# Everything runs from main, which is called on the last line. A download cut
# short through the pipe then defines nothing and runs nothing.
main() {
	for tool in curl tar uname; do
		command -v "$tool" >/dev/null 2>&1 ||
			die "$tool is not on PATH, and installing wrike-tui needs it."
	done

	case "$(uname -s)" in
	Linux) os="linux" ;;
	Darwin) os="darwin" ;;
	MINGW* | MSYS* | CYGWIN*)
		die "This is Windows. Install from PowerShell instead:
    irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex"
		;;
	*) die "No release binary for $(uname -s). wrike-tui is built for Linux, macOS and Windows." ;;
	esac

	case "$(uname -m)" in
	x86_64 | amd64) arch="x64" ;;
	arm64 | aarch64) arch="arm64" ;;
	*) die "No release binary for $os on $(uname -m). wrike-tui is built for x64 and arm64." ;;
	esac

	# A shell running under Rosetta reports x86_64 on Apple silicon. The arm64 build is the one to run there.
	if [ "$os/$arch" = "darwin/x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = "1" ]; then
		arch="arm64"
	fi

	if command -v sha256sum >/dev/null 2>&1; then
		sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
	elif command -v shasum >/dev/null 2>&1; then
		sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
	else
		die "Neither sha256sum nor shasum is on PATH, and checking the download needs one."
	fi

	# The latest release's tag, read out of the API without asking for jq. No -f
	# on this call, so a release-less repository, a rate limit and a network
	# failure each come back as their own answer.
	if [ -n "${VERSION:-}" ]; then
		tag="v${VERSION#v}"
	else
		answer="$(curl --proto '=https' --tlsv1.2 -sSL -H 'Accept: application/vnd.github+json' -w '\n%{http_code}' \
			"https://api.github.com/repos/$REPO/releases/latest")" ||
			die "Could not reach the GitHub API to look up the latest release."
		status="$(printf '%s\n' "$answer" | tail -n 1)"
		case "$status" in
		200) ;;
		404) die "There is no published release to install yet." ;;
		403 | 429) die "The GitHub API refused the lookup, most likely a rate limit. Try again later, or set VERSION=v0.2.0." ;;
		*) die "The GitHub API answered $status looking up the latest release." ;;
		esac
		tag="$(printf '%s\n' "$answer" |
			sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
			head -n 1)"
		[ -n "$tag" ] || die "Could not read a tag out of the latest release."
	fi

	archive="$BINARY-$os-$arch.tar.gz"
	download="https://github.com/$REPO/releases/download/$tag"
	work="$(mktemp -d 2>/dev/null || mktemp -d -t wrike-tui)"
	staged="$INSTALL_DIR/.$BINARY.new"
	target="$INSTALL_DIR/$BINARY"
	trap 'rm -rf "$work" "$staged"' EXIT
	trap 'exit 1' HUP INT TERM

	echo "Downloading wrike-tui $tag for $os-$arch"
	fetch "$download/$archive" -o "$work/$archive" ||
		die "Could not download $download/$archive. Is $tag a release?"
	fetch "$download/SHA256SUMS" -o "$work/SHA256SUMS" ||
		die "Could not download the checksums for $tag."

	# This arrived through a pipe from the network, so the archive is checked
	# against the checksums the release publishes rather than trusted for arriving.
	expected="$(awk -v name="$archive" '$2 == name || $2 == "*" name { print $1; exit }' "$work/SHA256SUMS")"
	[ -n "$expected" ] || die "$tag publishes no checksum for $archive. Nothing was installed."
	[ "$(sha256 "$work/$archive")" = "$expected" ] ||
		die "$archive does not match the checksum published for $tag. Nothing was installed."

	tar -xzf "$work/$archive" -C "$work" "$BINARY" || die "$archive holds no $BINARY binary. Nothing was installed."

	mkdir -p "$INSTALL_DIR" || die "Could not create $INSTALL_DIR."
	[ -e "$target" ] && upgrade=1 || upgrade=0

	# Staged beside the target and renamed over it. Copying straight onto the
	# binary fails on Linux while it runs, which is what an upgrade often is.
	cp "$work/$BINARY" "$staged" || die "Could not write to $INSTALL_DIR. Nothing was installed."
	chmod 0755 "$staged"
	said="$("$staged" --version </dev/null 2>&1)" || said=""
	[ "$said" = "wrike-tui ${tag#v}" ] ||
		die "The downloaded binary did not run here (it said \"$said\"). Nothing was installed."
	mv -f "$staged" "$target"

	echo "Installed wrike-tui ${tag#v} at $target"

	case ":$PATH:" in
	*":$INSTALL_DIR:"*)
		found="$(command -v "$BINARY" 2>/dev/null || true)"
		if [ -n "$found" ] && [ "$found" != "$target" ]; then
			echo
			echo "$found comes before it on your PATH, so \`$BINARY\` still runs that one."
		fi
		;;
	*)
		echo
		echo "$INSTALL_DIR is not on your PATH. Add this line to your shell's startup file:"
		echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
		;;
	esac

	if [ "$upgrade" = 0 ]; then
		echo
		echo "Log in before the first run:"
		echo "    $BINARY auth login"
	fi
}

main
