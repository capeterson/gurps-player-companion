// Keep the command process alive long enough for the five-second notification
// maintenance timer to fire if OpenAPI generation starts application workers.
setTimeout(() => {}, 6_000);
