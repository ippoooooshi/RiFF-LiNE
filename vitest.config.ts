import { defineConfig } from 'vitest/config';

// ワークスペース横断のテスト構成（11_test_strategy.md §1）。
// - core: Webコアの単体テスト。ScoreRenderHost が DOM 要素を扱うため jsdom
// - desktop: Electron ラッパー層（main / preload / renderer の純ロジック）の単体＋結合テスト。Node 環境
// - desktop-renderer: renderer の React bootstrap（DI 配線）の結合テスト。jsdom ＋ .tsx（独立レビュー B-4）
export default defineConfig({
  test: {
    // web-core-foundation.md 14.7 節：カバレッジは vitest run --coverage（pnpm test:coverage）で測り、C0 と C1 の 100% を CI で確かめる。 <!-- req webcorefoundation:918ed38a.ee99 --> <!-- req webcorefoundation:918ed38a.e20b --> <!-- req webcorefoundation:918ed38a.5273 --> <!-- req webcorefoundation:c070751a.1c34 --> <!-- req webcorefoundation:c070751a.0e5f --> <!-- req webcorefoundation:c070751a.8040 --> <!-- req webcorefoundation:40474098.33b4 --> <!-- req webcorefoundation:40474098.5bbb --> <!-- req webcorefoundation:40474098.90b1 --> <!-- req webcorefoundation:84878443.cda9 --> <!-- req webcorefoundation:84878443.0f16 --> <!-- req webcorefoundation:c40ead5a.3f26 --> <!-- req webcorefoundation:c40ead5a.3f36 --> <!-- req webcorefoundation:c40ead5a.250d -->
    // しきい値をかけるのは作業パッケージ 1 で書き直した・新しく書いたファイルだけ。作業パッケージ 2〜8 のファイルは、それぞれのパッケージで作り直すときに足す（14.7 節）。 <!-- req webcorefoundation:8f5284e2.74bd --> <!-- req webcorefoundation:8f5284e2.17d1 --> <!-- req webcorefoundation:8f5284e2.cd1b --> <!-- req webcorefoundation:8f5284e2.4d1a --> <!-- req webcorefoundation:8f5284e2.8f82 --> <!-- req webcorefoundation:7a3794eb.dcef --> <!-- req webcorefoundation:fa08abc7.7685 --> <!-- req webcorefoundation:fa08abc7.25a4 -->
    // statements は C0、branches は C1（14.3 節の (b)）。台本の入口（if (isMain) の中）は子のプロセスで打つテストで確かめ、ここでは数えない <!-- req webcorefoundation:068908bc.bd69 --> <!-- req webcorefoundation:068908bc.79b6 --> <!-- req webcorefoundation:068908bc.b0b8 --> <!-- req webcorefoundation:05848c76.88d7 --> <!-- req webcorefoundation:05848c76.cec7 --> <!-- req webcorefoundation:05848c76.1a16 --> <!-- req webcorefoundation:05848c76.43a2 --> <!-- req webcorefoundation:05848c76.c7dc --> <!-- req webcorefoundation:ed67a321.0219 --> <!-- req webcorefoundation:ed67a321.5a5f --> <!-- req webcorefoundation:ed67a321.ee57 --> <!-- req webcorefoundation:ed67a321.4efc --> <!-- req webcorefoundation:ed67a321.b260 --> <!-- req webcorefoundation:ed67a321.910e --> <!-- req webcorefoundation:ed67a321.3fce -->
    // （子のプロセスの分を混ぜると、テストの中で読み込んだ分と数えがぶつかって崩れたため）
    // 15.5 節・15.7 節：実装した全メソッドの C0 と C1 の 100% を単体テストの完了の条件とし、この計測で確かめる。重要なロジックの C2 は 14.3 節の組み合わせの表（packages/core/src/testing/combinations.ts）を通すテストで確かめる <!-- req webcorefoundation:86a70f48.c04a --> <!-- req webcorefoundation:86a70f48.4eed --> <!-- req webcorefoundation:86a70f48.031c --> <!-- req webcorefoundation:0b1dbf55.8dba --> <!-- req webcorefoundation:0b1dbf55.110b --> <!-- req webcorefoundation:0b1dbf55.90b2 -->
    // 選び方：ブランチの始まり（45569cd）からの git の差分のうち、新しく作ったファイル全部と、作業パッケージ 1 の受け持ちで書き直したファイル。テストのファイル・Electron と組み立ての入口（main.ts・preload.ts・main.tsx・copy-alphatab-assets.mjs）と、差分にあっても作業パッケージ 2〜8 の部品は除く（2026-10-24 チャット側の決定） <!-- req webcorefoundation:8f5284e2.2503 --> <!-- req webcorefoundation:8f5284e2.d7dd --> <!-- req webcorefoundation:8f5284e2.d996 --> <!-- req webcorefoundation:8f5284e2.9021 -->
    coverage: {
      provider: 'v8',
      thresholds: {
        'packages/core/src/rendering/**/*.ts': { 100: true, perFile: true },
        'packages/shared-types/src/**/*.ts': { 100: true, perFile: true },
        'packages/core/src/platform/{AudioSessionAdapter,FileSystemAdapter,PlatformAdapters,UpdateCheckAdapter,WindowAdapter,index}.ts':
          { 100: true, perFile: true },
        'packages/core/src/{index,export/index}.ts': { 100: true, perFile: true },
        'packages/core/src/testing/{scoreFixtures,combinations}.ts': { 100: true, perFile: true },
        'packages/{ui-desktop,ui-shared}/src/index.ts': { 100: true, perFile: true },
        'packages/core/src/domain/{SongDocument,pitch}.ts': { 100: true, perFile: true },
        'apps/desktop/src/main/{userDataDir,devTools,ipc,ipcPayload,entryDecisions}.ts': { 100: true, perFile: true },
        'apps/desktop/src/renderer/{updateCheck,rootElement}.ts': { 100: true, perFile: true },
        'apps/desktop/scripts/{check-license-files,check-doc-refs,run-app}.mjs': { 100: true, perFile: true },
      },
    },
    projects: [
      {
        test: {
          name: 'core',
          root: 'packages/core',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'desktop',
          root: 'apps/desktop',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        // React コンポーネントの DI 配線（App.tsx の EditWindow / SongListWindow bootstrap）を
        // jsdom でマウントして「例外なく chrome が描画される」ことを検証する（B-4、B-3 の初期化順回帰を固定）。
        // JSX は Vitest 既定のトランスフォーマ（oxc）が .tsx を automatic runtime で処理する。
        test: {
          name: 'desktop-renderer',
          root: 'apps/desktop',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.tsx'],
        },
      },
    ],
  },
});
// web-core-foundation.md 14.2 節：単体テストと結合テストは同じ Vitest で走らせ、ファイルの名前で分ける（結合テストは *.integration.test.ts）。プロジェクトは core・desktop・desktop-renderer の 3 つで、どれも両方を拾う。単体テストは対象と同じフォルダの *.test.ts に置く <!-- req webcorefoundation:64f10aef.6816 --> <!-- req webcorefoundation:64f10aef.c8ee --> <!-- req webcorefoundation:64f10aef.8ac3 --> <!-- req webcorefoundation:64f10aef.7f60 --> <!-- req webcorefoundation:7a3794eb.348e -->
