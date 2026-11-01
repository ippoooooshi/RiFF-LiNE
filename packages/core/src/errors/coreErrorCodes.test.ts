// UT-ERR-CODES: error-logging-foundation.md 4 節、00_reference.md 5 節 —CORE_ERROR_CODES / registerCoreErrorCodes
// 検証観点: EXPECTED のコードすべてが登録され、レベルが統合表（00_reference.md 5 節）と一致すること（C0/C1）。
// CORE_ERROR_CODES は登録パッケージ = 3 の 13 行。文言・見出し・ボタンは 4 節の表の本文、画面に出さないコードは
// showOnScreen: false と logOnlyReason（2.5 節・2.6 節）。PERSISTENCE_ERROR_CODES は登録パッケージ = 2 のうちこのファイルに置くもの：
// FILE-009〜011 は data-model-persistence.md 14.2 節（validateMirrorConfig の errors と infos）、FILE-012〜014 は 12 節（保存先の移行）、
// FILE-015 は 14.1 節（終了のときのミラーの写しの待ちの打ち切り）。

import { describe, expect, it } from 'vitest';

import {
  CORE_ERROR_CODES,
  PERSISTENCE_ERROR_CODES,
  REPEATED_CRASH_THRESHOLD,
  registerCoreErrorCodes,
  registerPersistenceErrorCodes,
} from './coreErrorCodes';
import { ErrorCodeRegistry } from './ErrorCodeRegistry';
import { errorCodeRegistry, notificationCenter } from './index';
import { NotificationCenter } from './NotificationCenter';
import type { ErrorCodeDefinition, NotificationEvent, NotificationLevel } from './types';

/** 00_reference.md 5 節「エラーコード統合表」の登録パッケージ = 3（本パッケージ）の 13 行。 */
const EXPECTED: Record<string, NotificationLevel> = {
  'FILE-001': 'error',
  'FILE-002': 'critical',
  'FILE-003': 'error',
  'FILE-004': 'critical',
  'FILE-005': 'warning',
  'FILE-008': 'critical',
  'SYS-001': 'warning',
  'SYS-002': 'critical',
  'SYS-003': 'warning',
  'SYS-004': 'error',
  'SYS-005': 'error',
  'SYS-006': 'info',
  'RENDER-001': 'error',
};

/** 登録パッケージ = 2 のうち coreErrorCodes.ts に置いているコード。 */
const EXPECTED_PERSISTENCE: Record<string, NotificationLevel> = {
  // data-model-persistence.md 17 節・00_reference.md 5 節：ゴミ箱の復元期限の残りが 3 日以下の曲は Warning の FILE-007
  'FILE-007': 'warning',
  'FILE-009': 'error',
  'FILE-010': 'error',
  'FILE-011': 'info',
  'FILE-012': 'critical',
  'FILE-013': 'critical',
  'FILE-014': 'info',
  // data-model-persistence.md 14.1 節：終了のときのミラーの写しの待ちの打ち切りは Warning の FILE-015
  'FILE-015': 'warning',
  'SONG-003': 'warning',
};

/** 4 節の表の文言（Critical は本文）。 */
const EXPECTED_MESSAGES: Record<string, string> = {
  'FILE-001': '保存に失敗しました。保存先の空き容量・アクセス権を確認してください',
  'FILE-002':
    'このファイルの中身が、保存したときの記録と一致しません。保存の途中で書き込みが止まったか、ほかのアプリで書き換えられた可能性があります。ひとつ前に保存した内容（自動保存を含む）を復元しますか？',
  'FILE-003': 'クラウド同期フォルダ内のファイルにアクセスできません。同期状況を確認してください',
  'FILE-004':
    'このファイルは、今のアプリより新しいバージョンのアプリで保存されているため、読み込めません。ファイルは変更していません。アプリを最新版に更新してから、もう一度開いてください。',
  'FILE-005': 'ミラー先への保存に失敗しました（主保存は正常です）',
  'FILE-008':
    'このファイルは中身が壊れていて、曲のデータとして読み込めません。保存の途中で書き込みが止まったか、ほかのアプリで書き換えられた可能性があります。ひとつ前に保存した内容（自動保存を含む）を復元しますか？',
  'SYS-001': '直前のクラッシュから復旧しました',
  'SYS-002':
    '画面の処理が、アプリを起動してから 3 回以上、異常終了して開き直されました。原因はログに記録してあります。閉じて作業を続けてください。ログの場所：{context.logFolder}',
  'SYS-003': '一時的に応答が停止していました',
  'SYS-004': '画面の表示中に問題が起きました',
  'SYS-005': '描画の外で未捕捉の例外が起きました',
  'SYS-006': '今後のバージョンで対応予定',
  'RENDER-001': '譜面の描画に失敗しました',
};

/** 4 節の表の Critical の見出しとボタン。 */
const EXPECTED_MODALS: Record<string, { title: string; buttons: { confirm: string; cancel?: string } }> = {
  'FILE-002': { title: 'データの整合性エラーを検知しました', buttons: { confirm: '復元する', cancel: 'キャンセル' } },
  'FILE-004': { title: 'このファイルは開けません', buttons: { confirm: '閉じる' } },
  'FILE-008': {
    title: 'このファイルは壊れているため開けません',
    buttons: { confirm: '復元する', cancel: 'キャンセル' },
  },
  'SYS-002': { title: '画面の処理が繰り返し異常終了しています', buttons: { confirm: '閉じる' } },
};

/** 00_reference.md 5 節の FILE-012・FILE-013 の行の見出しとボタン（2026-11-01 本人決定）。PERSISTENCE_ERROR_CODES の Critical。 */
const EXPECTED_PERSISTENCE_MODALS: Record<string, { title: string; buttons: { confirm: string; cancel?: string } }> = {
  'FILE-012': { title: '保存先を移しますか', buttons: { confirm: '移す', cancel: 'キャンセル' } },
  // ダイアログの中で選ぶものが無いので、FILE-004 と同じく「閉じる」だけ
  'FILE-013': { title: '保存先を移せませんでした', buttons: { confirm: '閉じる' } },
};

describe('CORE_ERROR_CODES', () => {
  it('CORE_ERROR_CODES_ContainsExactlyTheExpectedCodes', () => {
    expect(Object.keys(CORE_ERROR_CODES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('CORE_ERROR_CODES_LevelsMatchIntegrationTable', () => {
    for (const [code, level] of Object.entries(EXPECTED)) {
      expect(CORE_ERROR_CODES[code]?.level, code).toBe(level);
      expect(CORE_ERROR_CODES[code]?.messageTemplate.length, code).toBeGreaterThan(0);
    }
  });

  it('CORE_ERROR_CODES_MessagesMatchSection4Table', () => {
    for (const [code, message] of Object.entries(EXPECTED_MESSAGES)) {
      expect(CORE_ERROR_CODES[code]?.messageTemplate, code).toBe(message);
    }
  });

  it('CORE_ERROR_CODES_CriticalCodesHaveTitleAndButtons', () => {
    const criticalCodes = Object.entries(CORE_ERROR_CODES)
      .filter(([, definition]) => definition.level === 'critical')
      .map(([code]) => code)
      .sort();
    expect(criticalCodes).toEqual(Object.keys(EXPECTED_MODALS).sort());
    for (const [code, modal] of Object.entries(EXPECTED_MODALS)) {
      expect(CORE_ERROR_CODES[code]?.title, code).toBe(modal.title);
      expect(CORE_ERROR_CODES[code]?.buttons, code).toEqual(modal.buttons);
      // 「OK」だけにしない（肯定・否定をはっきりさせる、2.1 節）
      expect(CORE_ERROR_CODES[code]?.buttons?.confirm, code).not.toBe('OK');
    }
  });

  it('CORE_ERROR_CODES_Sys004AndSys005_NotOnScreenWithReason', () => {
    for (const code of ['SYS-004', 'SYS-005']) {
      expect(CORE_ERROR_CODES[code]?.showOnScreen, code).toBe(false);
      expect(CORE_ERROR_CODES[code]?.logOnlyReason?.length, code).toBeGreaterThan(0);
    }
    expect(CORE_ERROR_CODES['SYS-005']?.logOnlyReason).toBe(
      'プログラムの誤りで投げた例外を、開発者ツールのコンソールだけでなくログに残すための記録で、使う人に知らせることが無い',
    );
  });

  it('CORE_ERROR_CODES_OtherCodes_OnScreen', () => {
    for (const code of Object.keys(EXPECTED).filter((c) => c !== 'SYS-004' && c !== 'SYS-005')) {
      expect(CORE_ERROR_CODES[code]?.showOnScreen ?? true, code).toBe(true);
    }
    expect(CORE_ERROR_CODES['SYS-006']?.showOnScreen).toBe(true);
  });

  it('REPEATED_CRASH_THRESHOLD_Is3_AndEmbeddedInSys002', () => {
    expect(REPEATED_CRASH_THRESHOLD).toBe(3);
    expect(CORE_ERROR_CODES['SYS-002']?.messageTemplate).toContain(`${REPEATED_CRASH_THRESHOLD} 回以上`);
  });
});

describe('PERSISTENCE_ERROR_CODES', () => {
  it('PERSISTENCE_ERROR_CODES_ContainsExactlyTheExpectedCodes', () => {
    expect(Object.keys(PERSISTENCE_ERROR_CODES).sort()).toEqual(Object.keys(EXPECTED_PERSISTENCE).sort());
  });

  it('PERSISTENCE_ERROR_CODES_LevelsMatchIntegrationTable', () => {
    for (const [code, level] of Object.entries(EXPECTED_PERSISTENCE)) {
      expect(PERSISTENCE_ERROR_CODES[code]?.level, code).toBe(level);
      expect(PERSISTENCE_ERROR_CODES[code]?.messageTemplate.length, code).toBeGreaterThan(0);
    }
  });

  it('PERSISTENCE_ERROR_CODES_File015_NotOnScreenWithReason', () => {
    // 00_reference.md 5 節の FILE-015 の行：Warning（画面に出さない）、理由は出す画面が無いため
    expect(PERSISTENCE_ERROR_CODES['FILE-015']?.showOnScreen).toBe(false);
    expect(PERSISTENCE_ERROR_CODES['FILE-015']?.logOnlyReason).toBe('最後のウィンドウを閉じた後で、出す画面が無いため');
  });

  it('PERSISTENCE_ERROR_CODES_CriticalCodesHaveTitleAndButtons', () => {
    const criticalCodes = Object.entries(PERSISTENCE_ERROR_CODES)
      .filter(([, definition]) => definition.level === 'critical')
      .map(([code]) => code)
      .sort();
    expect(criticalCodes).toEqual(Object.keys(EXPECTED_PERSISTENCE_MODALS).sort());
    for (const [code, modal] of Object.entries(EXPECTED_PERSISTENCE_MODALS)) {
      expect(PERSISTENCE_ERROR_CODES[code]?.title, code).toBe(modal.title);
      expect(PERSISTENCE_ERROR_CODES[code]?.buttons, code).toEqual(modal.buttons);
    }
  });
});

describe('ErrorCodeDefinition — Critical の見出しとボタン（error-logging-foundation.md 2.1 節）', () => {
  it('AllCriticalCodes_HaveNonEmptyTitleAndConfirmButton', () => {
    const all = Object.entries({ ...CORE_ERROR_CODES, ...PERSISTENCE_ERROR_CODES });
    const critical = all.filter(([, definition]) => definition.level === 'critical');
    expect(critical.length).toBe(6);
    for (const [code, definition] of critical) {
      expect(definition.title?.trim().length, code).toBeGreaterThan(0);
      expect(definition.buttons?.confirm.trim().length, code).toBeGreaterThan(0);
      // 「OK」だけにしない（肯定・否定をはっきりさせる、2.1 節）
      expect(definition.buttons?.confirm, code).not.toBe('OK');
    }
  });

  it('ErrorCodeDefinition_CriticalWithoutTitleOrButtons_RejectedByTypecheck', () => {
    // 型で止まることの確かめ（pnpm typecheck はテストのファイルも見る）。下の 3 つは型の誤りで、
    // 型が通ってしまうと、使われない ts-expect-error の注として typecheck が赤になる。
    // @ts-expect-error Critical のコードは title を省けない
    const withoutTitle: ErrorCodeDefinition = {
      level: 'critical',
      messageTemplate: 'm',
      buttons: { confirm: '閉じる' },
    };
    // @ts-expect-error Critical のコードは buttons を省けない
    const withoutButtons: ErrorCodeDefinition = { level: 'critical', messageTemplate: 'm', title: '見出し' };
    // @ts-expect-error Critical 以外のコードは title を持てない
    const nonCriticalWithTitle: ErrorCodeDefinition = { level: 'error', messageTemplate: 'm', title: '見出し' };
    const critical: ErrorCodeDefinition = {
      level: 'critical',
      title: '見出し',
      messageTemplate: 'm',
      buttons: { confirm: '閉じる' },
    };
    expect(
      [withoutTitle, withoutButtons, nonCriticalWithTitle, critical].map((definition) => definition.level),
    ).toEqual(['critical', 'critical', 'error', 'critical']);
  });
});

describe('registerCoreErrorCodes', () => {
  it('registerCoreErrorCodes_RegistersAllCodesResolvable', () => {
    const registry = new ErrorCodeRegistry();
    registerCoreErrorCodes(registry);
    for (const code of Object.keys(EXPECTED)) {
      expect(registry.has(code), code).toBe(true);
      expect(registry.resolve(code).level, code).toBe(EXPECTED[code]);
    }
    for (const code of Object.keys(EXPECTED_PERSISTENCE)) {
      expect(registry.has(code), code).toBe(false);
    }
  });

  it('registerPersistenceErrorCodes_RegistersAllCodesResolvable', () => {
    const registry = new ErrorCodeRegistry();
    registerPersistenceErrorCodes(registry);
    for (const code of Object.keys(EXPECTED_PERSISTENCE)) {
      expect(registry.resolve(code).level, code).toBe(EXPECTED_PERSISTENCE[code]);
    }
  });

  it('report_Sys002WithLogFolder_TitleButtonsAndBodyWithPath', () => {
    const registry = new ErrorCodeRegistry();
    registerCoreErrorCodes(registry);
    const nc = new NotificationCenter(registry);
    const events: NotificationEvent[] = [];
    nc.subscribe((event) => events.push(event));

    nc.report('SYS-002', { logFolder: 'TabApp/logs' });

    expect(events[0]).toMatchObject({
      level: 'critical',
      channel: 'modal',
      showOnScreen: true,
      title: '画面の処理が繰り返し異常終了しています',
      buttons: { confirm: '閉じる' },
    });
    expect(events[0]?.message.endsWith('ログの場所：TabApp/logs')).toBe(true);
  });

  it('report_Sys006WithFeature_ToastOnScreenAndFeatureNotInMessage', () => {
    const registry = new ErrorCodeRegistry();
    registerCoreErrorCodes(registry);
    const nc = new NotificationCenter(registry);
    const events: NotificationEvent[] = [];
    nc.subscribe((event) => events.push(event));

    nc.report('SYS-006', { feature: 'PDF 書き出し' });

    expect(events[0]).toMatchObject({
      level: 'info',
      channel: 'toast',
      showOnScreen: true,
      message: '今後のバージョンで対応予定',
      context: { feature: 'PDF 書き出し' },
    });
  });

  it('report_Sys004AndSys005_ShowOnScreenFalseInEvent', () => {
    const registry = new ErrorCodeRegistry();
    registerCoreErrorCodes(registry);
    const nc = new NotificationCenter(registry);
    const events: NotificationEvent[] = [];
    nc.subscribe((event) => events.push(event));

    nc.report('SYS-004', { windowKind: 'edit', error: new Error('render') });
    nc.report('SYS-005', { kind: 'error', error: new Error('click') });

    expect(events.map((event) => [event.code, event.showOnScreen, typeof event.stack])).toEqual([
      ['SYS-004', false, 'string'],
      ['SYS-005', false, 'string'],
    ]);
  });
});

describe('errors/index — 共有レジストリと共有 NotificationCenter（2.4 節）', () => {
  it('errorCodeRegistry_HasCoreAndPersistenceCodes', () => {
    for (const [code, level] of Object.entries({ ...EXPECTED, ...EXPECTED_PERSISTENCE })) {
      expect(errorCodeRegistry.resolve(code).level, code).toBe(level);
    }
  });

  it('notificationCenter_ResolvesFromSharedRegistry', () => {
    const events: NotificationEvent[] = [];
    const off = notificationCenter.subscribe((event) => events.push(event));

    notificationCenter.report('SYS-003');
    off();

    expect(events.map((event) => [event.code, event.level, event.channel])).toEqual([['SYS-003', 'warning', 'toast']]);
  });
});
