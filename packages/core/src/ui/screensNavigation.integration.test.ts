// IT-SCREENS: 画面群・ナビゲーションの結合（screens-navigation.md §5.3・§6・§8 DoD 基準2/4）
//
// - §5.3: NotificationCenter → NotificationUIBinder → ScoreHighlightBinder → ScoreRenderHost 拡張の通し
// - §6:   複数編集ウィンドウ相当の ToolbarViewModel / StatusBarViewModel が独立して動く
// - §8 基準2: 各画面が「本書が定めた接続先」を通じて動く（AD-2 の層分離）
import { describe, expect, it, vi } from 'vitest';

import { CommandHistory, CursorController } from '../editing';
import { ErrorCodeRegistry, NotificationCenter } from '../errors';

import { NotificationUIBinder } from './NotificationUIBinder';
import { ScoreHighlightBinder, type ScoreHighlightHost } from './ScoreHighlightBinder';
import { StatusBarViewModel } from './StatusBarViewModel';
import { ToolbarViewModel } from './ToolbarViewModel';
import { registerUiErrorCodes } from './uiErrorCodes';

function makeCenter(): NotificationCenter {
  const registry = new ErrorCodeRegistry();
  registry.register('EDIT-001', { level: 'error', messageTemplate: 'dup' });
  registry.register('EDIT-004', { level: 'warning', messageTemplate: 'memo' });
  registerUiErrorCodes(registry);
  return new NotificationCenter(registry);
}

describe('IT: 通知の UI 振り分け（screens-navigation.md §5.3）', () => {
  it('Errorレベル通知がハイライトチャンネル経由でScoreRenderHost拡張を呼ぶ', () => {
    // IT-SCREENS-01 §5.3（channel=highlight の alt 分岐）
    const center = makeCenter();
    const show = vi.fn();
    const clear = vi.fn();
    const host: ScoreHighlightHost = { showErrorHighlight: show, clearErrorHighlight: clear };
    const highlightBinder = new ScoreHighlightBinder(host);
    const toast = vi.fn();
    const modal = vi.fn();
    const uiBinder = new NotificationUIBinder({ toast, highlight: (e) => highlightBinder.handle(e), modal });
    uiBinder.attach(center);

    // EDIT-001（Error）→ highlight。context の barIndex/trackIndex がそのまま渡る。
    center.report('EDIT-001', { barIndex: 7, trackIndex: 1 });
    expect(show).toHaveBeenCalledWith({ trackIndex: 1, startBarIndex: 7, barCount: 1, code: 'EDIT-001' });
    expect(toast).not.toHaveBeenCalled();

    // EDIT-004（Warning）→ toast。
    center.report('EDIT-004', {});
    expect(toast).toHaveBeenCalledTimes(1);

    // TAG-001（Error だが譜面に紐付かない）→ highlight チャンネルだが解除のみ。
    center.report('TAG-001', { limit: 50 });
    expect(clear).toHaveBeenCalled();

    uiBinder.detach();
  });
});

describe('IT: 複数編集ウィンドウの独立動作（screens-navigation.md §6）', () => {
  it('2つの編集ウィンドウの ToolbarViewModel / StatusBarViewModel が互いに影響しない', () => {
    // IT-SCREENS-02 §6（editing-core.md §6.2 と同じスコープ設計のテストパターン再利用）
    const makeWindow = (): {
      toolbar: ToolbarViewModel;
      statusBar: StatusBarViewModel;
      cursor: CursorController;
      history: CommandHistory;
    } => {
      const history = new CommandHistory({ render: () => undefined }, { report: () => undefined });
      const cursor = new CursorController();
      const toolbar = new ToolbarViewModel(history, null);
      const statusBar = new StatusBarViewModel(
        cursor,
        { zoomPercent: 100 },
        {
          read: () => ({ barNumber: cursor.position.barIndex + 1, timeSignature: '4/4', tempoBpm: 120, capoFret: 0 }),
        },
      );
      return { toolbar, statusBar, cursor, history };
    };

    const a = makeWindow();
    const b = makeWindow();

    // ウィンドウ A だけパネルを開き、カーソルを進める。
    a.toolbar.togglePanel('mixer');
    a.cursor.setPosition({ trackIndex: 0, barIndex: 4, beatIndex: 0 });

    expect(a.toolbar.getState().panels.mixer).toBe(true);
    expect(b.toolbar.getState().panels.mixer).toBe(false);
    expect(a.statusBar.getState().barNumber).toBe(5);
    expect(b.statusBar.getState().barNumber).toBe(1);

    for (const w of [a, b]) {
      w.toolbar.dispose();
      w.statusBar.dispose();
      w.history.dispose();
    }
  });
});
