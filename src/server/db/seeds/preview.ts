/**
 * Provision (or rebuild with --force) the read-only guest preview campaign.
 * Servers with PREVIEW_MODE_ENABLED=true do this automatically at startup.
 *
 * Usage: bun run db:seed:preview [--force]
 */

import { provisionPreviewCampaign } from '../../services/preview/provision.ts';
import { closeDb } from '../client.ts';

if (import.meta.main) {
  try {
    const result = await provisionPreviewCampaign({ force: process.argv.includes('--force') });
    console.log(
      `guest preview ${result.rebuilt ? 'provisioned' : 'already current'}: ${result.campaignId}`,
    );
  } catch (error) {
    console.error('guest preview provisioning failed', error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
