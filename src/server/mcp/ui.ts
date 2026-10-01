import { readFile } from 'node:fs/promises';

export const CHARACTER_UI_URI = 'ui://gurps-player-companion/character.html';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/** The resource is generic. Data arrives through authorized read tool results. */
export function characterUiMetadata(toolName: string) {
  return ['get_character', 'get_character_inventory_item', 'get_campaign_library_skill'].includes(
    toolName,
  )
    ? { ui: { resourceUri: CHARACTER_UI_URI } }
    : {};
}

export const characterUiResource = {
  uri: CHARACTER_UI_URI,
  name: 'character_details',
  title: 'GURPS details',
  description:
    'Read-only character sheets and focused item, container, or library skill cards using the web app’s components.',
  mimeType: MCP_APP_MIME_TYPE,
  _meta: {
    ui: {
      prefersBorder: true,
      csp: { connectDomains: [], resourceDomains: [] },
    },
  },
};

export async function readCharacterUi() {
  // Do not cache across development rebuilds or fall back to a stale shell.
  const text = await readFile('dist/mcp-ui/character.html', 'utf8');
  return { contents: [{ ...characterUiResource, text }] };
}
