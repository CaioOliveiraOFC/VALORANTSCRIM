import { expect, it } from 'vitest';
import { safeAdminReturnTo } from './router';

it('returns only supported local destinations after admin login', () => {
  expect(safeAdminReturnTo('/s/abc123')).toBe('/s/abc123');
  expect(safeAdminReturnTo('/s/abc123/')).toBe('/s/abc123/');
  expect(safeAdminReturnTo('/')).toBe('/');
  expect(safeAdminReturnTo('/admin/management')).toBe('/admin/management');
  for (const value of [null, '', '//example.com', 'https://example.com', '\\example.com', '/s/short', '/s/abc123#admin=secret', '/admin?returnTo=https://example.com', '/admin/management?next=https://example.com', '/admin/management#admin=secret', '/s/abc123\n']) {
    expect(safeAdminReturnTo(value)).toBe('/admin');
  }
});
