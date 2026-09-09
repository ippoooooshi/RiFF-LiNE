/**
 * ルーティングと DI 組み立て（bootstrap）＝ 薄いホスト（ui.rule.md、screens-navigation.md §4.8）。
 *
 * `location.hash` で曲一覧ウィンドウ（`#songlist`）／編集ウィンドウ（`#edit/<songId>`）を切り替える。
 * 画面の見た目に依存しないロジックは `@riff-line/core/ui` の ViewModel / Binder / Service が持ち、ここは
 * それらを生成して `screens/` の React シェルへ結ぶだけ（AD-2、レイヤー依存規則）。
 *
 * 編集ウィンドウ単位スコープのインスタンス一式（`CommandHistory` / `CursorController` / `ViewModeController` /
 * `ZoomController`）はこの App がウィンドウごとに 1 セット生成する（screens-navigation.md §4.1、00_reference.md §2）。
 * `PlaybackService`（生 AlphaSynth を要する）の実体化は Phase 1 実機検証で結線する（G23 P7、playback-integration.md §10.1）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CommandHistory,
  CursorController,
  LocalBackupService,
  ScoreRenderHost,
  SchemaMigrator,
  SongIndexService,
  SongRepository,
  ViewModeController,
  ZoomController,
  type NewSongSetup,
  type SongSummary,
} from '@riff-line/core';
import { notificationCenter } from '@riff-line/core/errors';
import {
  AppPreferencesService,
  MenuBarController,
  NotificationUIBinder,
  ScoreHighlightBinder,
  StatusBarViewModel,
  TagStore,
  ToolbarViewModel,
  type AppPreferences,
  type MenuItemId,
} from '@riff-line/core/ui';

import { bootstrapErrorLogging } from './errorLoggingBootstrap';
import { ErrorBoundary } from './ErrorBoundary';
import { IpcFileSystemAdapter } from './ipcFileSystem';
import { createSongAndOpen, warnIfNearSongLimit } from './songActions';
import {
  EditWindowShell,
  LicenseDialog,
  NewSongWizard,
  OnboardingOverlay,
  SettingsDialog,
  SongListView,
  TagManagementDialog,
  TrashDialog,
} from './screens';

const FONT_ASSETS_BASE_PATH = 'alphatab/font/';
const SOUND_FONT_ASSETS_BASE_PATH = 'alphatab/soundfont/';
const SAMPLE_ALPHATEX = '\\title "RiFF-LiNE" \\tempo 120 . 3.3*4 | 0.4 2.4 3.4 5.4 | 3.3*4';

/** `#edit/<songId>` なら songId、そうでなければ null（曲一覧）。 */
function parseRoute(hash: string): { view: 'songlist' } | { view: 'edit'; songId: string } {
  const match = /^#?edit\/(.+)$/.exec(hash);
  return match !== null ? { view: 'edit', songId: decodeURIComponent(match[1]!) } : { view: 'songlist' };
}

export function App(): React.JSX.Element {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const teardown = bootstrapErrorLogging();
    return teardown;
  }, []);

  // 描画時例外でウィンドウが白飛びしないよう、各ウィンドウをエラーバウンダリで包む（B-3/B-4、bootstrap 頑健化）。
  return (
    <ErrorBoundary label={route.view === 'edit' ? '編集ウィンドウ' : '曲一覧ウィンドウ'}>
      {route.view === 'edit' ? <EditWindow songId={route.songId} /> : <SongListWindow />}
    </ErrorBoundary>
  );
}

// ===== 曲一覧ウィンドウ =====

function SongListWindow(): React.JSX.Element {
  const [songs, setSongs] = useState<SongSummary[]>([]);
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [dialog, setDialog] = useState<'none' | 'wizard' | 'settings' | 'tags' | 'trash' | 'license'>('none');
  const [showOnboarding, setShowOnboarding] = useState(false);

  /** アクティブルートの曲一覧を読み直し、上限接近なら SONG-001 を出す（screens-navigation.md §3.5）。 */
  const refreshSongs = useMemo(
    () => async (): Promise<void> => {
      const activeRoot = await window.riffLineApi.appConfig.getActiveRoot();
      const loaded = await new SongIndexService(new IpcFileSystemAdapter(activeRoot)).load().catch(() => []);
      setSongs(loaded);
      warnIfNearSongLimit(loaded.filter((s) => !s.isTrashed).length, (code, context) =>
        notificationCenter.report(code, context),
      );
    },
    [],
  );

  useEffect(() => {
    // アクティブルートを解決してから index / preferences を読む（起動シーケンス、screens-navigation.md §5.1・§5.5）。
    void (async () => {
      try {
        const activeRoot = await window.riffLineApi.appConfig.getActiveRoot();
        const adapter = new IpcFileSystemAdapter(activeRoot);
        const prefs = new AppPreferencesService(adapter);
        const [, loadedPrefs] = await Promise.all([refreshSongs(), prefs.load()]);
        setPreferences(loadedPrefs);
        setShowOnboarding(!loadedPrefs.onboardingSeen);
        setTags(await new TagStore(adapter, notificationCenter).list().catch(() => []));
      } catch (error) {
        console.error('[SongListWindow] bootstrap failed:', error);
        // アクティブルート解決に失敗しても最低限の描画は行えるよう、既定値で埋める。
        setPreferences(await new AppPreferencesService(new IpcFileSystemAdapter('')).load().catch(() => null));
      }
    })();
  }, [refreshSongs]);

  async function persistPreferences(next: AppPreferences): Promise<void> {
    setPreferences(next);
    const activeRoot = await window.riffLineApi.appConfig.getActiveRoot();
    await new AppPreferencesService(new IpcFileSystemAdapter(activeRoot)).save(next);
  }

  /** 新規曲作成ウィザード完了時：曲数評価 → SongRepository.create → 編集ウィンドウを開く（screens-navigation.md §5.2）。 */
  async function completeNewSong(setup: NewSongSetup): Promise<void> {
    setDialog('none');
    const activeRoot = await window.riffLineApi.appConfig.getActiveRoot();
    const activeAdapter = new IpcFileSystemAdapter(activeRoot);
    const backupRoot = await window.riffLineApi.appConfig.getLocalBackupRoot();
    const migrator = new SchemaMigrator();
    const index = new SongIndexService(activeAdapter);
    const localBackup = new LocalBackupService(activeAdapter, new IpcFileSystemAdapter(backupRoot), migrator);
    const repo = new SongRepository(activeAdapter, migrator, index, localBackup);

    await createSongAndOpen(
      {
        countActiveSongs: () => songs.filter((s) => !s.isTrashed).length,
        createSong: async (s) => (await repo.create(s)).id,
        openSong: (songId) => window.riffLineApi.windows.openSong(songId),
        report: (code, context) => notificationCenter.report(code, context),
      },
      setup,
    );
    await refreshSongs();
  }

  if (preferences === null) {
    return <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>読み込み中…</main>;
  }

  return (
    <>
      <SongListView
        songs={songs}
        layout={preferences.songListLayout}
        onChangeLayout={(layout) => void persistPreferences({ ...preferences, songListLayout: layout })}
        onOpenSong={(songId) => void window.riffLineApi.windows.openSong(songId)}
        onCreateSong={() => setDialog('wizard')}
        onRenameSong={() => undefined}
        onEditTags={() => setDialog('tags')}
        onMoveToTrash={() => undefined}
        onDuplicateSong={() => undefined}
        onOpenTrash={() => setDialog('trash')}
        onOpenSettings={() => setDialog('settings')}
      />

      {dialog === 'wizard' ? (
        <NewSongWizard
          preferences={preferences}
          tuningPresets={[]}
          onCancel={() => setDialog('none')}
          onComplete={(setup) => void completeNewSong(setup)}
        />
      ) : null}

      {dialog === 'settings' ? (
        <SettingsDialog
          preferences={preferences}
          storageSummary={{ activeRootLabel: 'アクティブフォルダ', mirrorCount: 0, trashRetentionDays: 30 }}
          onSavePreferences={(next) => {
            void persistPreferences(next);
            setDialog('none');
          }}
          onChangeStorageRoot={() => undefined}
          onOpenTagManagement={() => setDialog('tags')}
          onShowOnboarding={() => {
            setShowOnboarding(true);
            setDialog('none');
          }}
          onClose={() => setDialog('none')}
        />
      ) : null}

      {dialog === 'tags' ? (
        <TagManagementDialog
          tags={tags}
          onCreate={(name) => {
            void (async () => {
              const activeRoot = await window.riffLineApi.appConfig.getActiveRoot();
              const store = new TagStore(new IpcFileSystemAdapter(activeRoot), notificationCenter);
              await store.create(name);
              setTags(await store.list());
            })();
          }}
          onRename={(id, name) => {
            void (async () => {
              const activeRoot = await window.riffLineApi.appConfig.getActiveRoot();
              const store = new TagStore(new IpcFileSystemAdapter(activeRoot), notificationCenter);
              await store.rename(id, name);
              setTags(await store.list());
            })();
          }}
          onDelete={(id) => {
            void (async () => {
              const activeRoot = await window.riffLineApi.appConfig.getActiveRoot();
              const store = new TagStore(new IpcFileSystemAdapter(activeRoot), notificationCenter);
              await store.delete(id);
              setTags(await store.list());
            })();
          }}
          onClose={() => setDialog('none')}
        />
      ) : null}

      {dialog === 'trash' ? (
        <TrashDialog
          entries={[]}
          onRestore={() => undefined}
          onPermanentlyDelete={() => undefined}
          onClose={() => setDialog('none')}
        />
      ) : null}

      {dialog === 'license' ? <LicenseDialog onClose={() => setDialog('none')} /> : null}

      {showOnboarding ? (
        <OnboardingOverlay
          onDismiss={() => {
            setShowOnboarding(false);
            void persistPreferences({ ...preferences, onboardingSeen: true });
          }}
        />
      ) : null}
    </>
  );
}

// ===== 編集ウィンドウ =====

interface EditWindowRig {
  host: ScoreRenderHost;
  cursor: CursorController;
  history: CommandHistory;
  viewMode: ViewModeController;
  zoom: ZoomController;
  toolbar: ToolbarViewModel;
  statusBar: StatusBarViewModel;
  highlight: ScoreHighlightBinder;
  notify: NotificationUIBinder;
  menu: MenuBarController;
}

function EditWindow(props: { songId: string }): React.JSX.Element {
  const scoreContainerRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const rerender = (): void => setTick((n) => n + 1);

  // 編集ウィンドウ単位スコープのインスタンス一式（screens-navigation.md §4.1）。
  const rig = useRef<EditWindowRig | null>(null);

  useEffect(() => {
    const container = scoreContainerRef.current;
    if (container === null) return;

    // 生成した資源を後入れ先出しで片付ける。bootstrap が途中で失敗しても部分生成物を確実に破棄する（B-3）。
    const teardown: Array<() => void> = [];
    const runTeardown = (): void => {
      for (const dispose of teardown.splice(0).reverse()) {
        try {
          dispose();
        } catch (error) {
          console.error('[EditWindow] teardown step threw:', error);
        }
      }
    };

    try {
      const host = new ScoreRenderHost();
      teardown.push(() => host.dispose());
      host.on('renderError', ({ error }) =>
        notificationCenter.report('RENDER-001', { detail: error instanceof Error ? error.message : String(error) }),
      );

      // B-3: `ViewModeController` / `ZoomController` は ctor で `host.applyViewMode` / `applyZoom` を呼ぶため、
      //      それらの構築より前に `host.initialize()` を済ませる（未初期化だと `requireApi()` が throw して白画面になる）。
      host.initialize(container, {
        engine: 'svg',
        fontAssetsBasePath: FONT_ASSETS_BASE_PATH,
        soundFontAssetsBasePath: SOUND_FONT_ASSETS_BASE_PATH,
      });

      const cursor = new CursorController();
      const history = new CommandHistory(
        { render: (trackIndices?: number[]) => host.render(trackIndices) },
        notificationCenter,
      );
      teardown.push(() => history.dispose());
      const viewMode = new ViewModeController(host, cursor);
      teardown.push(() => viewMode.dispose());
      const zoom = new ZoomController(host, () => viewMode.currentMode);
      const toolbar = new ToolbarViewModel(history, null);
      teardown.push(() => toolbar.dispose());
      const statusBar = new StatusBarViewModel(cursor, zoom, {
        // 小節位置はカーソルから取得。拍子/テンポ/カポの実値取得は `ScoreRenderHost` 経由の Score/Part アクセサ
        // （未定義）を要するため Phase 1 追い込みへ委譲し、ここでは既定値を返す（screens-navigation.md §9.0、非ブロッキング#6）。
        read: () => ({ barNumber: cursor.position.barIndex + 1, timeSignature: '4/4', tempoBpm: 120, capoFret: 0 }),
      });
      teardown.push(() => statusBar.dispose());
      const highlight = new ScoreHighlightBinder(host);
      const notify = new NotificationUIBinder({
        toast: () => rerender(),
        highlight: (event) => highlight.handle(event),
        modal: () => rerender(),
      });
      const menu = new MenuBarController({
        'edit.undo': () => history.undo(),
        'edit.redo': () => history.redo(),
        'help.showLicense': () => undefined,
      });

      // Phase 1 実機検証（G23 P1）向けに、サンプル譜面を描画して編集ウィンドウのレンダリング経路を通す。
      // ロード失敗は host の 'renderError' イベント経由で RENDER-001 になる（ここでは throw しない）。
      host.loadScore(ScoreRenderHost.parseAlphaTex(SAMPLE_ALPHATEX));
      host.render();

      teardown.push(toolbar.onChange(rerender));
      teardown.push(statusBar.onChange(rerender));
      teardown.push(notify.attach(notificationCenter));
      // クローズ確定前の自動保存 flush 要求を受ける（screens-navigation.md §4.1・§9.0 P2-a）。
      // このウィンドウ担当の曲だけに応答する。実 AutoSaveScheduler.flush を差し込む配線は Phase 1 追い込み
      // （現状は履歴がメモリ内のみで永続化経路が編集ウィンドウに未結線のため、往復だけ実体化し即 ack する）。
      teardown.push(
        window.riffLineApi.windows.onFlushAutoSaveRequest((request) => {
          if (request.songId !== props.songId) return;
          window.riffLineApi.windows.ackFlushAutoSave(request.token);
        }),
      );

      rig.current = { host, cursor, history, viewMode, zoom, toolbar, statusBar, highlight, notify, menu };
      setBootstrapError(null);
      rerender();
    } catch (error) {
      // どの生成段階で落ちてもツリーを unmount させず、原因を画面とログに出す（B-3）。
      const message = error instanceof Error ? error.message : String(error);
      console.error('[EditWindow] bootstrap failed:', error);
      notificationCenter.report('RENDER-001', { detail: message });
      runTeardown();
      rig.current = null;
      setBootstrapError(message);
    }

    return () => {
      runTeardown();
      rig.current = null;
    };
  }, [props.songId]);

  const current = rig.current;
  const menuTemplate = useMemo(() => current?.menu.buildTemplate() ?? [], [current, tick]);

  if (bootstrapError !== null) {
    return (
      <main
        role="alert"
        style={{ fontFamily: 'system-ui, sans-serif', padding: 16, color: '#d64545' }}
        data-testid="edit-bootstrap-error"
      >
        <h1 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>編集ウィンドウの初期化に失敗しました</h1>
        <p style={{ color: '#6b6b70', margin: 0, whiteSpace: 'pre-wrap' }}>{bootstrapError}</p>
      </main>
    );
  }

  return (
    <EditWindowShell
      menuTemplate={menuTemplate}
      toolbar={
        current?.toolbar.getState() ?? {
          canUndo: false,
          canRedo: false,
          isPlaying: false,
          panels: { mixer: false, partManagement: false, tuning: false, fretboard: false, memoList: false },
        }
      }
      statusBar={
        current?.statusBar.getState() ?? {
          barNumber: 1,
          timeSignature: '4/4',
          tempoBpm: 120,
          capoFret: 0,
          zoomPercent: current?.zoom.zoomPercent ?? 100,
        }
      }
      scoreContainerRef={scoreContainerRef}
      onUndo={() => current?.history.undo()}
      onRedo={() => current?.history.redo()}
      onPlayPause={() => undefined}
      onStop={() => undefined}
      onTogglePanel={(name) => current?.toolbar.togglePanel(name)}
      onInvokeMenu={(id) => current?.menu.invoke(id as MenuItemId)}
    />
  );
}
