import { describe, expect, it } from 'vitest';
import { activeMentions, findMentionQuery, insertMention, splitMentions } from './mentionText';

describe('mentionText', () => {
  it('vindt de query achter @ bij de caret', () => {
    expect(findMentionQuery('Check @SFM-12', 13)).toEqual({ start: 6, query: 'SFM-12' });
    expect(findMentionQuery('@A', 2)).toEqual({ start: 0, query: 'A' });
    expect(findMentionQuery('mail a@b.nl', 11)).toBeNull();
    expect(findMentionQuery('@x y', 4)).toBeNull();
    expect(findMentionQuery('no mention', 10)).toBeNull();
  });

  it('voegt de gekozen waarde in zonder dubbele spatie', () => {
    expect(insertMention('Check @SFM tomorrow', 6, 10, 'SFM-12542-00-01'))
      .toEqual({ text: 'Check @SFM-12542-00-01 tomorrow', caret: 23 });
    expect(insertMention('Check @SF', 6, 9, 'SFM-1')).toEqual({ text: 'Check @SFM-1 ', caret: 13 });
  });

  it('houdt alleen mentions die nog als los token in de tekst staan', () => {
    const m = [{ columnId: 11, value: 'A-1' }, { columnId: 11, value: 'B-2' }, { columnId: 11, value: 'A-1' }];
    expect(activeMentions('see @A-1 now', m)).toEqual([{ columnId: 11, value: 'A-1' }]);
    expect(activeMentions('see @A-10', [{ columnId: 11, value: 'A-1' }])).toEqual([]);
    expect(activeMentions('ok @A-1.', [{ columnId: 11, value: 'A-1' }])).toHaveLength(1);
    expect(activeMentions('x', null)).toEqual([]);
  });

  it('splitst tekst in tekst- en mention-delen', () => {
    expect(splitMentions('Late @A-1 again', [{ value: 'A-1' }])).toEqual([
      { type: 'text', value: 'Late ' }, { type: 'mention', value: 'A-1' }, { type: 'text', value: ' again' },
    ]);
    expect(splitMentions('Plain', [])).toEqual([{ type: 'text', value: 'Plain' }]);
    expect(splitMentions('@A.B and @A.B', [{ value: 'A.B' }]).filter((p) => p.type === 'mention')).toHaveLength(2);
  });

  it('ondersteunt waarden met een spatie (Open order)', () => {
    expect(insertMention('Check @op', 6, 9, 'Open order')).toEqual({ text: 'Check @Open order ', caret: 18 });
    expect(findMentionQuery('Check @Open order ', 18)).toBeNull();
    expect(activeMentions('x @Open order now', [{ columnId: 13, value: 'Open order' }])).toHaveLength(1);
    expect(splitMentions('x @Open order now', [{ value: 'Open order' }])).toEqual([
      { type: 'text', value: 'x ' }, { type: 'mention', value: 'Open order' }, { type: 'text', value: ' now' },
    ]);
  });
});
