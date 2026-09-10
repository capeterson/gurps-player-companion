export function MechanicsUnavailable() {
  return (
    <p className="alert alert-warning" role="alert">
      Linked rules are unavailable. Calculated stats and rolls are paused until their definitions
      sync. Reconnect to load them; a missing library entry may need the GM's attention.
    </p>
  );
}
