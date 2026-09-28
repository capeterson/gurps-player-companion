import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { api } from '../lib/api.ts';
import { ToastProvider } from '../lib/toast.tsx';
import { writeActiveUser } from '../sync/activeUser.ts';
import { MediaImage } from './MediaImage.tsx';

vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return { ...actual, api: vi.fn().mockResolvedValue({ enabled: true }) };
});

const USER_ID = '0193b3c0-f1f0-7000-8000-00000000a001';
const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000a002';
const ASSET_ID = '0193b3c0-f1f0-7000-8000-00000000a003';

function mount(editable = true) {
  return render(
    <ToastProvider>
      <MediaImage targetType="character" targetId={CHARACTER_ID} editable={editable} name="Ari" />
    </ToastProvider>,
  );
}

async function seedCharacter(portraitAssetId?: string) {
  const db = getLocalDb();
  await db.characters.put({
    id: CHARACTER_ID,
    ownerId: USER_ID,
    campaignId: null,
    name: 'Ari',
    height: null,
    weight: null,
    age: null,
    birthdate: null,
    appearance: null,
    st: 10,
    dx: 10,
    iq: 10,
    ht: 10,
    hpMod: 0,
    willMod: 0,
    perMod: 0,
    fpMod: 0,
    speedQuarterMod: 0,
    moveMod: 0,
    dismissedWarnings: [],
    activeConditionGroups: [],
    ...(portraitAssetId ? { portraitAssetId } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  });
  await db.syncMeta.put({ key: 'media:capabilities', value: true });
}

afterEach(async () => {
  vi.mocked(api).mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.removeItem('gpc.activeUser');
  await resetLocalDb();
});

beforeEach(() => {
  vi.mocked(api).mockResolvedValue({ enabled: true } as never);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:portrait-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

describe('MediaImage', () => {
  it('shows an already downloaded portrait when its entity is available offline', async () => {
    await seedCharacter(ASSET_ID);
    await getLocalDb().mediaManifests.put({
      id: ASSET_ID,
      state: 'ready',
      thumbUrl: `/media/${ASSET_ID}/thumb.webp`,
      displayUrl: `/media/${ASSET_ID}/display.webp`,
      width: 1024,
      height: 768,
      reason: null,
    });
    mount(false);

    const portrait = await screen.findByRole('img', { name: 'Ari portrait' });
    expect(portrait).toHaveAttribute('src', `/media/${ASSET_ID}/display.webp`);
  });

  it('falls back to the thumbnail, shows a placeholder, then retries after reconnecting', async () => {
    await seedCharacter(ASSET_ID);
    await getLocalDb().mediaManifests.put({
      id: ASSET_ID,
      state: 'ready',
      thumbUrl: `/media/${ASSET_ID}/thumb.webp`,
      displayUrl: `/media/${ASSET_ID}/display.webp`,
      width: 1024,
      height: 768,
      reason: null,
    });
    mount(false);

    const display = await screen.findByRole('img', { name: 'Ari portrait' });
    expect(display).toHaveAttribute('src', `/media/${ASSET_ID}/display.webp`);
    fireEvent.error(display);

    const thumbnail = await screen.findByRole('img', { name: 'Ari portrait' });
    await waitFor(() => expect(thumbnail).toHaveAttribute('src', `/media/${ASSET_ID}/thumb.webp`));
    fireEvent.error(thumbnail);
    expect(await screen.findByText('Image unavailable')).toBeVisible();
    expect(screen.queryByRole('img', { name: 'Ari portrait' })).toBeNull();

    fireEvent(window, new Event('online'));

    expect(await screen.findByRole('img', { name: 'Ari portrait' })).toHaveAttribute(
      'src',
      `/media/${ASSET_ID}/display.webp`,
    );
  });

  it('shows the upload control and queued state after retaining selected bytes', async () => {
    writeActiveUser(USER_ID);
    await seedCharacter();
    mount();

    const input = await screen.findByLabelText('Upload portrait');
    const selected = new NodeFile([new NodeBlob(['portrait'])], 'portrait.png', {
      type: 'image/png',
    });
    fireEvent.change(input, { target: { files: [selected] } });

    expect(await screen.findByRole('status')).toHaveTextContent('Image queued for upload');
    expect(await screen.findByRole('img', { name: 'Ari portrait' })).toHaveAttribute(
      'src',
      'blob:portrait-preview',
    );
    const db = getLocalDb();
    await waitFor(async () => expect(await db.mediaUploads.count()).toBe(1));
    expect(await db.outbox.count()).toBe(1);
    expect((await db.characters.get(CHARACTER_ID))?.portraitAssetId).toBe(
      (await db.mediaUploads.toCollection().first())?.id,
    );
  });

  it('shows the reason and flashes the portrait surface when a selected file is rejected', async () => {
    writeActiveUser(USER_ID);
    await seedCharacter();
    mount();

    const input = await screen.findByLabelText('Upload portrait');
    const unsupported = new NodeFile(['not an image'], 'portrait.gif', {
      type: 'image/gif',
    });
    fireEvent.change(input, { target: { files: [unsupported] } });

    expect(
      await screen.findByText("Couldn't save Portrait — Choose a JPEG, PNG, or WebP image"),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByLabelText('Upload portrait').parentElement?.parentElement).toHaveAttribute(
        'data-flashing',
        'true',
      ),
    );
    expect(await getLocalDb().mediaUploads.count()).toBe(0);
  });

  it('keeps only the newest selected portrait when replacements are queued in order', async () => {
    writeActiveUser(USER_ID);
    await seedCharacter();
    mount();
    const input = await screen.findByLabelText('Upload portrait');
    const first = new NodeFile(['first'], 'first.png', { type: 'image/png' });
    const second = new NodeFile(['second'], 'second.png', { type: 'image/png' });

    fireEvent.change(input, { target: { files: [first] } });
    await waitFor(async () => expect(await getLocalDb().mediaUploads.count()).toBe(1));
    fireEvent.change(input, { target: { files: [second] } });

    const db = getLocalDb();
    await waitFor(async () =>
      expect(await (await db.mediaUploads.toCollection().first())?.blob.text()).toBe('second'),
    );
    const upload = await db.mediaUploads.toCollection().first();
    const [op] = await db.outbox.toArray();
    expect(await upload?.blob.text()).toBe('second');
    expect(op).toMatchObject({
      fieldPath: 'portraitAssetId',
      attemptedValue: upload?.id,
      localMediaUploadId: upload?.id,
    });
    expect((await db.characters.get(CHARACTER_ID))?.portraitAssetId).toBe(upload?.id);
  });
});
