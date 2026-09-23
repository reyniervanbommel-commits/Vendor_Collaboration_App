'use strict';

const pagePermissions = require('./pagePermissions');
const { classifyPermissionPatch, hasCommentPermission } = require('./commentPermissions');

describe('classifyPermissionPatch', () => {
  it('weigert een instellingen-id op een vendor', () => {
    const result = classifyPermissionPatch('supplier', ['odata', 'comments.view']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/employees/i);
  });

  it('staat de drie comment-ids toe op een vendor', () => {
    const result = classifyPermissionPatch('supplier', [
      'comments.view',
      'comments.write',
      'comments.column',
    ]);
    expect(result).toEqual({
      ok: true,
      pageNames: ['comments.view', 'comments.write', 'comments.column'],
    });
  });

  it('weigert comment-ids op een admin', () => {
    const result = classifyPermissionPatch('admin', ['comments.view']);
    expect(result.ok).toBe(false);
  });

  it('weigert een onbekende id', () => {
    expect(classifyPermissionPatch('employee', ['not-a-permission']).ok).toBe(false);
  });
});

describe('hasCommentPermission', () => {
  it('geeft een admin altijd true zonder query', async () => {
    const req = { user: { id: 1, role: 'admin' } };
    expect(await hasCommentPermission(req, 'comments.view')).toBe(true);
    expect(req._commentPermissions).toBeUndefined();
  });

  it('leest de permissies één keer per request', async () => {
    const spy = vi.spyOn(pagePermissions, 'listPagePermissions')
      .mockResolvedValue(['comments.view', 'comments.write']);
    const req = { user: { id: 4, role: 'employee' } };
    expect(await hasCommentPermission(req, 'comments.view')).toBe(true);
    expect(await hasCommentPermission(req, 'comments.write')).toBe(true);
    expect(await hasCommentPermission(req, 'comments.column')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
