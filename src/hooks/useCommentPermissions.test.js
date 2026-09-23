import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../context/AuthContext';
import { useCommentPermissions } from './useCommentPermissions';

function withAuth(value) {
  return function Wrapper({ children }) {
    return React.createElement(AuthContext.Provider, { value }, children);
  };
}

describe('useCommentPermissions', () => {
  it('geeft een admin altijd de drie rechten', () => {
    const { result } = renderHook(() => useCommentPermissions(), {
      wrapper: withAuth({ user: { role: 'admin' }, permissions: [] }),
    });
    expect(result.current).toEqual({ canView: true, canWrite: true, canSeeColumn: true });
  });

  it('verbergt schrijven en de kolom zonder view', () => {
    const { result } = renderHook(() => useCommentPermissions(), {
      wrapper: withAuth({
        user: { role: 'employee' },
        permissions: ['comments.write', 'comments.column'],
      }),
    });
    expect(result.current).toEqual({ canView: false, canWrite: false, canSeeColumn: false });
  });
});
