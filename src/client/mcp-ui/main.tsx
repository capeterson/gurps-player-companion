import { App } from '@modelcontextprotocol/ext-apps';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import {
  type CharacterDetailEnvelope,
  characterDetailEnvelope,
} from '../../shared/schemas/character.ts';
import { type FocusedDetail, focusedDetail } from '../../shared/schemas/details.ts';
import { ToastProvider } from '../lib/toast.tsx';
import './style.css';
import { CharacterDetailsApp } from './CharacterDetailsApp.tsx';
import { FocusedDetailsApp } from './FocusedDetailsApp.tsx';

type Details = CharacterDetailEnvelope | FocusedDetail;
type ReadTarget = { name: string; arguments: { path: Record<string, string> }; key: string };
function readTarget(path: {
  id: string;
  itemId?: string | undefined;
  skillId?: string | undefined;
}): ReadTarget {
  if (path.itemId)
    return {
      name: 'get_character_inventory_item',
      arguments: { path: { id: path.id, itemId: path.itemId } },
      key: `item:${path.id}:${path.itemId}`,
    };
  if (path.skillId)
    return {
      name: 'get_campaign_library_skill',
      arguments: { path: { id: path.id, skillId: path.skillId } },
      key: `library-skill:${path.id}:${path.skillId}`,
    };
  return { name: 'get_character', arguments: { path: { id: path.id } }, key: path.id };
}

function EmbeddedCharacter() {
  const [data, setData] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const appRef = useRef<App | null>(null);
  const target = useRef<ReadTarget | null>(null);
  const generation = useRef(0);
  const acceptResult = useCallback(
    (result: {
      structuredContent?: unknown;
      isError?: boolean | undefined;
    }) => {
      const parsed = z
        .object({ status: z.literal(200), body: z.union([characterDetailEnvelope, focusedDetail]) })
        .safeParse(result.structuredContent);
      if (result.isError || !parsed.success) {
        setData(null);
        setError(
          target.current?.name === 'get_character'
            ? 'Character details are unavailable. Access may have changed; refresh to try again.'
            : 'Details are unavailable. Access may have changed; refresh to try again.',
        );
        return;
      }
      const body = parsed.data.body;
      target.current =
        'kind' in body
          ? body.kind === 'inventory_item'
            ? readTarget({ id: body.characterId, itemId: body.item.id })
            : readTarget({ id: body.skill.campaignId, skillId: body.skill.id })
          : readTarget({ id: body.id });
      setData(parsed.data.body);
      setError(null);
    },
    [],
  );
  useEffect(() => {
    const app = new App({ name: 'GURPS details', version: '0.1.0' }, {});
    appRef.current = app;
    const theme = (value?: string) => {
      document.documentElement.dataset.theme =
        value === 'light' ? 'illuminated-manuscript' : 'gilded-tome';
    };
    app.onhostcontextchanged = ({ theme: value }) => theme(value);
    app.ontoolinput = ({ arguments: input }) => {
      generation.current++;
      setData(null);
      setError(null);
      setRefreshing(false);
      const path = z
        .object({
          id: z.string().uuid(),
          itemId: z.string().uuid().optional(),
          skillId: z.string().uuid().optional(),
        })
        .safeParse(input?.path);
      target.current = path.success ? readTarget(path.data) : null;
    };
    app.ontoolresult = (result) => {
      generation.current++;
      acceptResult(result);
      setRefreshing(false);
    };
    app.ontoolcancelled = () => {
      generation.current++;
      setData(null);
      setError('Details request cancelled.');
      setRefreshing(false);
    };
    void app
      .connect()
      .then(() => theme(app.getHostContext()?.theme))
      .catch(() => {
        setData(null);
        setError('Could not connect to the MCP Apps host.');
      });
    return () => {
      generation.current++;
      appRef.current = null;
      void app.close();
    };
  }, [acceptResult]);

  const refresh = async () => {
    const app = appRef.current;
    const requested = target.current;
    if (!app || !requested || refreshing) return;
    const current = ++generation.current;
    setRefreshing(true);
    setError(null);
    // Drop the previous snapshot while rechecking current authorization.
    setData(null);
    try {
      const result = await app.callServerTool({
        name: requested.name,
        arguments: requested.arguments,
      });
      if (generation.current === current) acceptResult(result);
    } catch {
      if (generation.current === current) setError('Could not refresh details. Try again.');
    } finally {
      if (generation.current === current) setRefreshing(false);
    }
  };
  if (data && 'kind' in data)
    return (
      <FocusedDetailsApp key={target.current?.key} data={data} refresh={() => void refresh()} />
    );
  return (
    <CharacterDetailsApp
      key={target.current?.key ?? 'loading'}
      data={data}
      error={error}
      refresh={target.current ? () => void refresh() : undefined}
      refreshing={refreshing}
    />
  );
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <MemoryRouter>
      <ToastProvider>
        <EmbeddedCharacter />
      </ToastProvider>
    </MemoryRouter>,
  );
