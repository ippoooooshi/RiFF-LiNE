---
name: electron
description: Electron main / preload / renderer を書くときの規約。既定値とオフライン制約。
paths:
  - "apps/desktop/**/*.ts"
  - "apps/desktop/**/*.tsx"
---

# Electron 規約【プロジェクト固有】

## セキュリティ既定値（例外なし）

```ts
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,      // 必須
    nodeIntegration: false,      // 必須
    sandbox: true,
    preload: /* preload スクリプトのパス */,
  },
})
```

renderer から Node.js API を直接触らない。**必ず preload 経由の IPC** を通す。`contextBridge.exposeInMainWorld` で公開する API は、チャンネル契約に定義されたものだけ。チャンネルの名前と要求・応答の型は `packages/shared-types` に置き、決まりは `docs/detailed_design/web-core-foundation.md` の 3.1 節と 6.3 節にある。チャンネルの一覧は 1 か所に持たず、それを使う機能の詳細設計（ファイル I/O は data-model-persistence.md、ログとクラッシュは error-logging-foundation.md、ウィンドウとメニューは screens-navigation.md、印刷は export-print.md）にシグネチャと一緒に書く（6.3 節）。

IPC ハンドラは受け取った引数を**検証してから**使う。renderer は信頼境界の外側として扱う。

## オフライン制約

実行時は完全オフライン。**外部 CDN からの読み込みを一切書かない。** alphaTab 本体・フォント・SoundFont はすべてローカル同梱。`https://` で始まる URL がランタイムコードに現れたら、それは違反。

開発時の `pnpm install` と CI のみネットワークを使ってよい。

## main / preload / renderer の責務

| プロセス | 置くもの | 置かないもの |
|---|---|---|
| main | ファイル I/O、ウィンドウ管理、OS 連携、IPC ハンドラ | ドメインロジック |
| preload | `contextBridge` による API 公開のみ | ロジック全般 |
| renderer | UI と `packages/core` の呼び出し | Node.js API の直接呼び出し |

ドメインロジックは `packages/core` に置く。main にも renderer にも書かない。

## 複数ウィンドウ

複数の曲を別ウィンドウで開ける。ただし**同一の曲を二重に開くことは禁止**し、既に開いている場合は該当ウィンドウを前面化する。ウィンドウ単位の状態（編集ウィンドウスコープのクラス）とアプリ全体の状態を混同しない。

## 起動口

`run-app.cmd` または `pnpm dev` が唯一の起動口。**新しい起動スクリプトを作らない。**
