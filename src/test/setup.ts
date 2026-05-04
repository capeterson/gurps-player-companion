import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// globals: false means RTL can't detect afterEach — wire cleanup explicitly.
afterEach(cleanup);
