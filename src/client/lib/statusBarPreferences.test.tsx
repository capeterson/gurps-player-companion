import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useStatusBarPreferences, writeStatusBarPreferences } from './statusBarPreferences.ts';

beforeEach(() => localStorage.clear());

const readStatusBarPreferences = (userId: string) =>
  renderHook(() => useStatusBarPreferences(userId)).result.current;

it('defaults the status header off and scopes changes to one user', () => {
  const { result, rerender } = renderHook(({ userId }) => useStatusBarPreferences(userId), {
    initialProps: { userId: 'user-a' },
  });
  expect(result.current).toEqual({ showStatusHeader: false });

  act(() => {
    expect(writeStatusBarPreferences('user-a', { showStatusHeader: true })).toBe(true);
  });
  expect(result.current).toEqual({ showStatusHeader: true });
  expect(readStatusBarPreferences('user-b')).toEqual({ showStatusHeader: false });
  rerender({ userId: 'user-b' });
  expect(result.current).toEqual({ showStatusHeader: false });
});

it('treats malformed stored preferences as off', () => {
  localStorage.setItem('gpc:status-bar-preferences:user-a', '{bad json');
  expect(readStatusBarPreferences('user-a')).toEqual({ showStatusHeader: false });
});

it('migrates the older per-control switches: any one on keeps the header on', () => {
  localStorage.setItem('gpc:status-bar-preferences:user-a', '{"showConditions":true}');
  expect(readStatusBarPreferences('user-a')).toEqual({ showStatusHeader: true });
  localStorage.setItem(
    'gpc:status-bar-preferences:user-a',
    '{"showPosture":false,"showManeuver":false,"showConditions":false}',
  );
  expect(readStatusBarPreferences('user-a')).toEqual({ showStatusHeader: false });
});
