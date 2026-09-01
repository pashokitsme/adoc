#!/usr/bin/env bash
# Links adoc into $PREFIX/bin (default ~/.local/bin) and its skill into
# ~/.claude/skills, then installs the Bun dependencies.
#
# Usage:
#   ./install.sh [options]
#
#   -n, --dry-run        Print what would happen, change nothing
#   -f, --force          Move an existing real file aside as <name>.bak
#       --uninstall      Remove the links this script made
#       --prefix DIR     Install under DIR instead of ~/.local
#       --no-skill       Leave ~/.claude/skills alone
#   -h, --help           Show this help and exit
#
# The links point at this checkout, so editing a file here changes the
# installed tool immediately — there is no build or copy step.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"
SKILLS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
DRY_RUN=0
FORCE=0
UNINSTALL=0
WITH_SKILL=1

usage() { sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "  would: $*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
	case "$1" in
	-n | --dry-run) DRY_RUN=1 ;;
	-f | --force) FORCE=1 ;;
	--uninstall) UNINSTALL=1 ;;
	--no-skill) WITH_SKILL=0 ;;
	--prefix) PREFIX="${2:?--prefix needs a directory}"; shift ;;
	-h | --help) usage; exit 0 ;;
	*) say "install.sh: unknown option '$1'" >&2; usage >&2; exit 2 ;;
	esac
	shift
done

BIN="$PREFIX/bin"
TOOL="$BIN/adoc"
SKILL="$SKILLS_DIR/adoc"

# a link is ours if it resolves into this checkout — that survives a rename
ours() { [ -L "$1" ] && case "$(readlink "$1")" in "$REPO"*) return 0 ;; esac; return 1; }

if [ "$UNINSTALL" = 1 ]; then
	for target in "$TOOL" "$SKILL"; do
		if ours "$target"; then
			say "  remove   $target"
			run rm "$target"
		elif [ -e "$target" ]; then
			say "  skip     $target is not ours"
		fi
	done
	say "done"
	exit 0
fi

link() { # link <source> <target>
	local src="$1" dst="$2"
	if ours "$dst"; then
		say "  ok       $dst (already linked)"
		return
	fi
	if [ -e "$dst" ] || [ -L "$dst" ]; then
		if [ "$FORCE" != 1 ]; then
			say "  skip     $dst exists — rerun with --force to move it aside"
			return
		fi
		[ -e "$dst.bak" ] && { say "  skip     $dst.bak is in the way"; return; }
		say "  backup   $dst -> $dst.bak"
		run mv "$dst" "$dst.bak"
	fi
	say "  link     $dst"
	run ln -s "$src" "$dst"
}

run mkdir -p "$BIN"
link "$REPO/main.ts" "$TOOL"

if [ "$WITH_SKILL" = 1 ]; then
	run mkdir -p "$SKILLS_DIR"
	link "$REPO/skills/adoc" "$SKILL"
fi

if command -v bun >/dev/null 2>&1; then
	say "installing dependencies with bun"
	if [ "$DRY_RUN" = 1 ]; then say "  would: bun install --cwd $REPO"; else (cd "$REPO" && bun install --silent); fi
else
	say "  missing  bun — adoc will not run (https://bun.sh)"
fi

case ":$PATH:" in
*":$BIN:"*) ;;
*) say "  note     $BIN is not on your PATH" ;;
esac
