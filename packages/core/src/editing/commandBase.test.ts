// UT-EDIT-HIST: commandBase（履歴の予算に数えるコマンドの大きさの見積り）
// 検証節: editing-core.md 2.3 節（estimateSizeBytes() の合計を 80MB の判定に使う）
// 検証観点: 差分だけを持つコマンドの固定の見積り、スナップショットを持つコマンドの見積り（JSON の長さの 2 倍に固定の分を足す）、
//   JSON にできないスナップショットのときは固定の見積りに戻ること。
// <!-- req webcorefoundation:5dc1870d.0a2b --> <!-- req webcorefoundation:5dc1870d.0c51 -->

import { describe, expect, it } from 'vitest';

import { BASE_COMMAND_BYTES, estimateSnapshotBytes } from './commandBase';

describe('commandBase — コマンドの大きさの見積り', () => {
  it('estimateSnapshotBytes_JSONにできるスナップショット_長さの2倍に固定の分を足す', () => {
    // UT-EDIT-HIST-01 editing-core.md 2.3 節
    const snapshot = { fret: 5, string: 3 };
    const expected = JSON.stringify(snapshot).length * 2 + BASE_COMMAND_BYTES;
    expect(estimateSnapshotBytes(snapshot)).toBe(expected);
    expect(estimateSnapshotBytes(snapshot)).toBeGreaterThan(BASE_COMMAND_BYTES);
  });

  it('estimateSnapshotBytes_JSONにできないスナップショット_固定の見積りに戻す', () => {
    // UT-EDIT-HIST-02 editing-core.md 2.3 節
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(estimateSnapshotBytes(circular)).toBe(BASE_COMMAND_BYTES);
    expect(estimateSnapshotBytes(10n)).toBe(BASE_COMMAND_BYTES);
  });
});
