import { describe, expect, it } from 'vitest';
import { groupStackLayoutByStatus, poStackSegmentFill } from './rccpPoStackFill';

describe('rccpPoStackFill', () => {
  it('fills the open part above the axis in the open color at full opacity', () => {
    expect(poStackSegmentFill('open', {
      openColor: '#111111', receivedColor: '#222222', side: 'above',
    })).toEqual({ fill: '#111111', opacity: 1 });
  });

  it('fades the already-ordered (received) part above the axis in the received color', () => {
    expect(poStackSegmentFill('ordered', {
      openColor: '#111111', receivedColor: '#222222', side: 'above',
    })).toEqual({ fill: '#222222', opacity: 0.3 });
  });

  it('always fills the received bar below the axis at full opacity', () => {
    expect(poStackSegmentFill('received', {
      openColor: '#111111', receivedColor: '#222222', side: 'below',
    })).toEqual({ fill: '#222222', opacity: 1 });
  });

  it('groups contiguous same-status rects into one band', () => {
    const groups = groupStackLayoutByStatus([
      { y: 10, height: 20, segment: { status: 'ordered' } },
      { y: 30, height: 15, segment: { status: 'ordered' } },
      { y: 45, height: 25, segment: { status: 'open' } },
    ]);
    expect(groups).toEqual([
      { status: 'ordered', top: 10, bottom: 45 },
      { status: 'open', top: 45, bottom: 70 },
    ]);
  });

  it('returns no groups for an empty layout', () => {
    expect(groupStackLayoutByStatus([])).toEqual([]);
  });
});
