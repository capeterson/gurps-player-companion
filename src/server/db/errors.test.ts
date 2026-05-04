import { describe, expect, it } from 'bun:test';
import { isUniqueViolation } from './errors.ts';

describe('isUniqueViolation', () => {
  it('matches a 23505 error', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('rejects other SQLSTATE codes', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation({ code: '42P01' })).toBe(false);
  });

  it('rejects shapes without a code field', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });

  it('matches by constraint name when specified', () => {
    expect(
      isUniqueViolation({ code: '23505', constraint: 'users_email_key' }, 'users_email_key'),
    ).toBe(true);
    expect(
      isUniqueViolation(
        { code: '23505', constraint: 'campaign_memberships_campaign_user_key' },
        'users_email_key',
      ),
    ).toBe(false);
  });
});
