import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import {
  readStatusBarPreferences,
  useStatusBarPreferences,
  writeStatusBarPreferences,
} from './statusBarPreferences.ts';

beforeEach(() => localStorage.clear());

it('defaults all optional header controls off and scopes changes to one user', () => {
  const { result, rerender } = renderHook(({ userId }) => useStatusBarPreferences(userId), {
    initialProps: { userId: 'user-a' },
  });
  expect(result.current).toEqual({
    showPosture: false,
    showManeuver: false,
    showConditions: false,
  });

  act(() => {
    expect(
      writeStatusBarPreferences('user-a', {
        showPosture: true,
        showManeuver: true,
        showConditions: false,
      }),
    ).toBe(true);
  });
  expect(result.current).toEqual({ showPosture: true, showManeuver: true, showConditions: false });
  expect(readStatusBarPreferences('user-b')).toEqual({
    showPosture: false,
    showManeuver: false,
    showConditions: false,
  });
  rerender({ userId: 'user-b' });
  expect(result.current).toEqual({
    showPosture: false,
    showManeuver: false,
    showConditions: false,
  });
});

it('treats malformed or partial stored preferences as off', () => {
  localStorage.setItem('gpc:status-bar-preferences:user-a', '{bad json');
  expect(readStatusBarPreferences('user-a')).toEqual({
    showPosture: false,
    showManeuver: false,
    showConditions: false,
  });
  localStorage.setItem('gpc:status-bar-preferences:user-a', '{"showConditions":true}');
  expect(readStatusBarPreferences('user-a')).toEqual({
    showPosture: false,
    showManeuver: false,
    showConditions: true,
  });
});
