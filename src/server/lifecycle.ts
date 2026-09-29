/**
 * Process lifecycle state shared by the entrypoint and request handlers.
 *
 * On SIGTERM/SIGINT the entrypoint flips `draining`: readiness turns 503 so a
 * load balancer stops routing here, responses ask keep-alive clients to
 * reconnect (`Connection: close`), WebSockets are closed with 1012 (service
 * restart) so clients reconnect to the replacement, and in-flight requests,
 * including media processing, get a bounded grace period to finish.
 */

let draining = false;

export function isDraining(): boolean {
  return draining;
}

export function beginDraining(): void {
  draining = true;
}

/** Test helper. */
export function _resetDrainingForTests(): void {
  draining = false;
}
