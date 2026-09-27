# GURPS Player Companion Dev plugin

This portable plugin connects ChatGPT and Codex to the development GURPS
Player Companion MCP server at `https://gurps-dev.abundant.zip/mcp`.

## Connect in ChatGPT

1. In ChatGPT, open **Settings → Security and login** and enable developer mode.
2. Open **Plugins**, choose **Add**, and enter
   `https://gurps-dev.abundant.zip/mcp` as the MCP server URL.
3. Complete GURPS Player Companion sign-in and consent. Grant only the scopes
   needed for the test (`gpc:read`, `gpc:write`, and/or `gpc:manage`).
4. Install the resulting personal plugin and test it in a new Work chat.
5. The compatibility package's `.app.json` maps this private dev connection to
   registered app `asdk_app_6ab84c7010688191b967ff41f99b0318`.

The root `plugin.json` and `mcp.json` are the portable package. The
`.codex-plugin/plugin.json` and `.app.json` files provide the local-tooling and
registered-app compatibility mapping.
The shared ChatGPT icon is `assets/icon-256.png` (256×256, opaque PNG, under
10,000 bytes). No custom ChatGPT UI is included; all capabilities come from MCP
tools.

Local or repository marketplace imports that declare `mcp.json` are currently
desktop-only. For multi-user testing on supported ChatGPT surfaces, publish the
registered dev plugin to selected roles in the same workspace; testers outside
that workspace must add the dev MCP URL independently. Every tester signs into
their own GURPS Player Companion account and grants their own scopes.

## Smoke tests

- Ask it to list your characters without changing anything.
- Ask it to retrieve one character and summarize current combat status.
- With write consent, make a reversible edit and read the character again.
- Revoke the connection in GURPS Player Companion **Settings → Connected apps**
  and confirm a later call requires authorization again.

See [PUBLISHING.md](PUBLISHING.md) before creating a production package or
submission.
