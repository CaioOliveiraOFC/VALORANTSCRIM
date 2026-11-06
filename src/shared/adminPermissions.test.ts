import { describe, expect, it } from 'vitest';
import { PERMISSION_DEFINITIONS, PERMISSION_KEYS, noPermissions, parsePermissions, presetPermissions } from './adminPermissions.js';

describe('canonical administrative capabilities', () => {
  it('defines exactly the eleven known capabilities with user-facing labels', () => {
    expect(PERMISSION_KEYS).toHaveLength(11);
    expect(PERMISSION_DEFINITIONS.map(item => item.key)).toEqual(PERMISSION_KEYS);
    expect(PERMISSION_DEFINITIONS.every(item => item.label && item.description)).toBe(true);
    expect(PERMISSION_KEYS).not.toContain('accessAll');
  });

  it('returns fresh maps and keeps organizer corrections and trash explicitly denied', () => {
    const organizer = presetPermissions('organizer');
    expect(Object.entries(organizer).filter(([, allowed]) => !allowed).map(([key]) => key)).toEqual(['correctStats', 'deleteRooms']);
    expect(Object.values(presetPermissions('full')).every(Boolean)).toBe(true);
    expect(Object.values(noPermissions()).every(value => value === false)).toBe(true);
    organizer.manageTeams = false;
    expect(presetPermissions('organizer').manageTeams).toBe(true);
    const denied = noPermissions(); denied.createRooms = true;
    expect(noPermissions().createRooms).toBe(false);
  });

  it('accepts only explicit booleans and defaults missing known keys to false', () => {
    expect(parsePermissions({ manageTeams: true, deleteRooms: false })).toEqual({ ...noPermissions(), manageTeams: true });
    expect(parsePermissions({})).toEqual(noPermissions());
    for (const value of [null, undefined, [], true, 'full', { accessAll: true }, { isSuperAdmin: true },
      { manageAccounts: true }, { deleteRooms: 'true' }, { createRooms: 1 }, { importMatches: null }]) {
      expect(() => parsePermissions(value)).toThrow();
    }
    expect(() => presetPermissions('owner' as never)).toThrow();
  });

  it('does not promote inherited or prototype-shaped permissions', () => {
    expect(parsePermissions(Object.create({ deleteRooms: true }))).toEqual(noPermissions());
    expect(() => parsePermissions(JSON.parse('{"__proto__":{"deleteRooms":true}}'))).toThrow();
  });
});
