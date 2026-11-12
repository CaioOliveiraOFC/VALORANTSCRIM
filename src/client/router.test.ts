import { expect, it } from 'vitest';
import { parseRoute, safeAdminReturnTo } from './router';

it('returns only supported local destinations after admin login', () => {
  expect(safeAdminReturnTo('/s/abc123')).toBe('/s/abc123');
  expect(safeAdminReturnTo('/s/abc123/')).toBe('/s/abc123/');
  expect(safeAdminReturnTo('/')).toBe('/');
  expect(safeAdminReturnTo('/admin/management')).toBe('/admin/management');
  for (const value of [null, '', '//example.com', 'https://example.com', '\\example.com', '/s/short', '/s/abc123#admin=secret', '/admin?returnTo=https://example.com', '/admin/management?next=https://example.com', '/admin/management#admin=secret', '/s/abc123\n']) {
    expect(safeAdminReturnTo(value)).toBe('/admin');
  }
});


it('recognizes the VCT-first public navigation and preserves shared room links', () => {
  expect(parseRoute('/')).toEqual({name:'home'});
  expect(parseRoute('/vct')).toEqual({name:'vct'});
  expect(parseRoute('/historico')).toEqual({name:'history'});
  expect(parseRoute('/x1')).toEqual({name:'x1'});
  expect(parseRoute('/s/abc123')).toEqual({name:'scrim',id:'abc123'});
  for (const path of ['/vct','/historico','/x1']) expect(safeAdminReturnTo(path)).toBe(path);
  for (const path of ['/vct?next=https://example.com','//vct','/x1#admin=secret']) expect(safeAdminReturnTo(path)).toBe('/admin');
});
