#!/bin/sh
set -eu

# The promotion workflow calls resolve once before acceptance, then promotes
# that immutable reference. Never resolve the source tag after testing starts.
case "${1:-}" in
  resolve)
    : "${IMAGE:?}" "${SRC:?}" "${GITHUB_OUTPUT:?}"
    descriptor=$(docker buildx imagetools inspect "$IMAGE:$SRC" --format '{{json .Manifest}}')
    digest=$(printf '%s' "$descriptor" | bun -e '
      const manifest = JSON.parse(await Bun.stdin.text());
      if (!/^sha256:[a-f0-9]{64}$/.test(manifest.digest)) throw new Error("Invalid image digest");
      if (manifest.manifests) {
        const runnable = manifest.manifests.filter(m => m.platform?.os !== "unknown");
        if (runnable.length !== 1 || runnable[0].platform?.os !== "linux" || runnable[0].platform?.architecture !== "amd64") {
          throw new Error("Promotion requires one linux/amd64 image; every shipped platform must pass acceptance");
        }
      }
      console.log(manifest.digest);
    ')
    candidate="$IMAGE@$digest"
    docker pull --platform linux/amd64 "$candidate"
    revision=$(docker image inspect "$candidate" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
    expected=$(git rev-parse HEAD)
    if [ "$revision" != "$expected" ]; then
      echo "::error::Source image revision '$revision' does not match checked-out commit '$expected'" >&2
      exit 1
    fi
    platform=$(docker image inspect "$candidate" --format '{{.Os}}/{{.Architecture}}')
    [ "$platform" = linux/amd64 ] || { echo '::error::Unsupported image platform' >&2; exit 1; }
    printf 'candidate=%s\n' "$candidate" >> "$GITHUB_OUTPUT"
    ;;
  promote)
    : "${IMAGE:?}" "${CANDIDATE:?}" "${VER:?}" "${GITHUB_OUTPUT:?}"
    case "$CANDIDATE" in
      "$IMAGE@sha256:"*) ;;
      *) echo '::error::Promotion requires a pinned digest' >&2; exit 1 ;;
    esac
    printf '%s\n' "${CANDIDATE##*@}" | grep -Eq '^sha256:[a-f0-9]{64}$' \
      || { echo '::error::Promotion requires a pinned digest' >&2; exit 1; }
    printf '%s\n' "$VER" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' \
      || { echo '::error::Invalid release version' >&2; exit 1; }
    set -- -t "$IMAGE:v$VER" -t "$IMAGE:$VER"
    case "$VER" in
      *-*) printf 'prerelease=true\n' >> "$GITHUB_OUTPUT" ;;
      *)
        set -- "$@" -t "$IMAGE:latest" -t "$IMAGE:${VER%.*}"
        printf 'prerelease=false\n' >> "$GITHUB_OUTPUT"
        ;;
    esac
    docker buildx imagetools create --prefer-index=false "$@" "$CANDIDATE"
    ;;
  *) echo 'Usage: release-image.sh resolve|promote' >&2; exit 1 ;;
esac
