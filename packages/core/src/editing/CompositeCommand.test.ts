// UT-EDIT-COMPOSITE: editing-core.md 2.3 節 — CompositeCommand
// 検証観点: execute は前から順・undo は後ろから順、affectedTrackIndices は子の和集合、
//           estimateSizeBytes は子の合計、execute と undo の戻り値はカーソルを動かさない（2.2 節）、子が空なら例外（C0/C1）。

import { describe, expect, it } from 'vitest';

import { CompositeCommand } from './CompositeCommand';
import { FakeCommand } from '../testing/editingFakes';

describe('CompositeCommand', () => {
  it('constructor_EmptyChildren_Throws', () => {
    expect(() => new CompositeCommand('x', 'paste', [])).toThrow();
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
    const composite = new CompositeCommand('insert-bar', 'insert-bar', [child('a'), child('b'), child('c')]);

    composite.execute();
    composite.undo();

    expect(order).toEqual(['e:a', 'e:b', 'e:c', 'u:c', 'u:b', 'u:a']);
  });

  it('affectedTrackIndices_IsSortedUnionOfChildren', () => {
    const composite = new CompositeCommand('x', 'paste', [
      new FakeCommand({ affectedTrackIndices: [2, 0] }),
      new FakeCommand({ affectedTrackIndices: [0, 1] }),
    ]);
    expect(composite.affectedTrackIndices).toEqual([0, 1, 2]);
  });

  it('estimateSizeBytes_IsSumOfChildren', () => {
    const composite = new CompositeCommand('x', 'paste', [
      new FakeCommand({ sizeBytes: 100 }),
      new FakeCommand({ sizeBytes: 250 }),
    ]);
    expect(composite.estimateSizeBytes()).toBe(350);
  });

  it('execute_ChildAdvancesBeat_StillReturnsNone', () => {
    // editing-core.md 2.2 節：execute が 'beat' を返すのは PlaceNoteCommand と InsertRestCommand だけ。まとめは 'none'
    const composite = new CompositeCommand('x', 'paste', [
      new FakeCommand({ cursorAdvanceOnExecute: 'none' }),
      new FakeCommand({ cursorAdvanceOnExecute: 'beat' }),
    ]);
    expect(composite.execute().cursorAdvance).toBe('none');
    expect(composite.undo().cursorAdvance).toBe('none');
  });

  it('kindAndLabel_AreKeptAsGiven', () => {
    const composite = new CompositeCommand('insert-bar', 'insert-bar', [new FakeCommand()]);
    expect(composite.kind).toBe('insert-bar');
    expect(composite.label).toBe('insert-bar');
  });
});
