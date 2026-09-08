// UT-EDIT-COMPOSITE: editing-core.md §6.3 — CompositeCommand
// 検証観点: execute は登録順・undo は逆順、affectedTrackIndices は合併集合、
//           estimateSizeBytes は子の合計、空 children で例外（C0/C1）。

import { describe, expect, it } from 'vitest';

import { CompositeCommand } from './CompositeCommand';
import { FakeCommand } from '../testing/editingFakes';

describe('CompositeCommand', () => {
  it('constructor_EmptyChildren_Throws', () => {
    expect(() => new CompositeCommand('x', 'X', [])).toThrow();
  });

  it('execute_RunsChildrenInOrder_UndoInReverse', () => {
    const order: string[] = [];
    const child = (name: string): FakeCommand => {
      const c = new FakeCommand({ kind: name });
      const origExecute = c.execute.bind(c);
      const origUndo = c.undo.bind(c);
      c.execute = () => {
        order.push(`e:${name}`);
        return origExecute();
      };
      c.undo = () => {
        order.push(`u:${name}`);
        return origUndo();
      };
      return c;
    };
    const composite = new CompositeCommand('insert-bar', '小節を挿入', [child('a'), child('b'), child('c')]);

    composite.execute();
    composite.undo();

    expect(order).toEqual(['e:a', 'e:b', 'e:c', 'u:c', 'u:b', 'u:a']);
  });

  it('affectedTrackIndices_IsSortedUnionOfChildren', () => {
    const composite = new CompositeCommand('x', 'X', [
      new FakeCommand({ affectedTrackIndices: [2, 0] }),
      new FakeCommand({ affectedTrackIndices: [0, 1] }),
    ]);
    expect(composite.affectedTrackIndices).toEqual([0, 1, 2]);
  });

  it('estimateSizeBytes_IsSumOfChildren', () => {
    const composite = new CompositeCommand('x', 'X', [
      new FakeCommand({ sizeBytes: 100 }),
      new FakeCommand({ sizeBytes: 250 }),
    ]);
    expect(composite.estimateSizeBytes()).toBe(350);
  });

  it('execute_ReturnsLastChildOutcome', () => {
    const composite = new CompositeCommand('x', 'X', [
      new FakeCommand({ cursorAdvanceOnExecute: 'beat' }),
      new FakeCommand({ cursorAdvanceOnExecute: 'none' }),
    ]);
    expect(composite.execute().cursorAdvance).toBe('none');
  });
});
