import { expect, it } from 'vitest';
import { safeAdminReturnTo } from './router';

it('returns only supported local destinations after admin login', () => {
  expect(safeAdminReturnTo('/s/abc123')).toBe('/s/abc123');
  expect(safeAdminReturnTo('/s/abc123/')).toBe('/s/abc123/');
  expect(safeAdminReturnTo('/')).toBe('/');
  for (const value of [null, '', '//example.com', 'https://example.com', '\\example.com', '/s/short', '/s/abc123#admin=secret', '/admin?returnTo=https://example.com', '/s/abc123\n']) {
    expect(safeAdminReturnTo(value)).toBe('/admin');
  }
});
