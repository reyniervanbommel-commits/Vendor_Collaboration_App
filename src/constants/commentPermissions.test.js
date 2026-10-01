import { describe, expect, it } from 'vitest';
import { applyCommentPermissionToggle } from './commentPermissions';

describe('applyCommentPermissionToggle', () => {
  it('zet View aan wanneer Add aan gaat', () => {
    expect(applyCommentPermissionToggle([], 'comments.write').sort()).toEqual([
      'comments.view',
      'comments.write',
    ]);
  });

  it('zet View aan wanneer de kolom aan gaat', () => {
    expect(applyCommentPermissionToggle(['comments.write'], 'comments.column').sort()).toEqual([
      'comments.column',
      'comments.view',
      'comments.write',
    ]);
  });

  it('zet Add en de kolom uit wanneer View uit gaat', () => {
    expect(applyCommentPermissionToggle(
      ['comments.view', 'comments.write', 'comments.column'],
      'comments.view',
    )).toEqual([]);
  });
});
