#!/bin/sh
set -eu

# A stable project and port pair keeps each checkout's containers, volumes,
# and host bindings separate without requiring a hand-written Compose copy.
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
checksum=$(printf '%s' "$repo_dir" | cksum | awk '{ print $1 }')
project="gpc-$checksum"
port_offset=$((checksum % 10000))
GPC_APP_PORT=${GPC_APP_PORT:-$((20000 + port_offset))}
GPC_DB_PORT=${GPC_DB_PORT:-$((30000 + port_offset))}
export GPC_APP_PORT GPC_DB_PORT

if [ "${1:-}" = "info" ]; then
  printf 'Compose project: %s\nApp: http://localhost:%s\nPostgres: localhost:%s\n' \
    "$project" "$GPC_APP_PORT" "$GPC_DB_PORT"
  exit 0
fi

lease_dir="${XDG_STATE_HOME:-$HOME/.local/state}/worktree-container-cleanup/leases"
mkdir -p "$lease_dir"
lease_tmp=$(mktemp "$lease_dir/$project.XXXXXX")
printf '%s\n' "$repo_dir" > "$lease_tmp"
mv -f "$lease_tmp" "$lease_dir/$project"

if [ "${1:-}" = "keepalive" ]; then
  printf 'Renewed cleanup lease for %s\n' "$project"
  exit 0
fi

cd "$repo_dir"
exec docker compose -p "$project" -f docker-compose.dev.yml "$@"
