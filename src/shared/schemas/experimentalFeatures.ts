import { z } from 'zod';

/** Account opt-ins; changes are made only from an interactive user session. */
export const experimentalFeatures = z.object({ mcpUi: z.boolean() }).strict();
export type ExperimentalFeatures = z.infer<typeof experimentalFeatures>;
