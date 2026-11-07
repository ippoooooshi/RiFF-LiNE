/**
 * main のサムネイルの写しの作り直し（data-model-persistence.md 9.1 節、2026-11-04 sub 2、T22 A）。
 *
 * - 曲一覧が `thumbnailRef` の写しを見つけられないとき、曲一覧のレンダラーが IPC の invoke 1 本 `thumbnail:regenerate`
 *   （要求 `{ songId: string }`、応答は写しを作れたかの `boolean`）で頼む。
 * - main は今の主ストレージのルート（`appconfig:getActiveRoot` と同じ引き方）のアダプタで、その曲のファイルを読み、
 *   `appMeta.thumbnail` の base64 を PNG のバイト列に戻して、保存のときの写しと同じ一時ファイルからの改名で
 *   `thumbnails/{songId}.png` に書いてから `true` を返す。曲のファイルが読めないか `appMeta.thumbnail` が `null` なら写さずに `false`。
 *   中身は Webコアの `regenerateThumbnailCopy`（細い入口 `persistence/mirror`。alphaTab を引き込まない）1 つで、ここに同じ処理を持たない。
 * - main は曲のファイルを書かない（書き手は 9.1 節の決まりどおりレンダラー）。写しと `index.json` の読みだけをする。
 *
 * main.ts には分かれ道を置かず（web-core-foundation.md 14.7 節）、判断はここの関数に出す。
 */

import { regenerateThumbnailCopy } from '@riff-line/core/persistence/mirror';
import type { FileSystemAdapterFactory } from '@riff-line/core/platform';
import { THUMBNAIL_CHANNELS, type ThumbnailRegenerateResponse } from '@riff-line/shared-types';

import type { IpcMainLike } from './ipc';
import { parseThumbnailRegenerate } from './ipcPayload';

export interface ThumbnailRegenerateDeps {
  /** 主ストレージのルートのアダプタを作る（main では `ElectronFileSystemAdapterFactory`）。 */
  adapterFactory: Pick<FileSystemAdapterFactory, 'createForRoot'>;
  /** 今の主ストレージのルート（`{...}/TabApp`）。`appconfig:getActiveRoot` と同じ引き方。 */
  resolveActiveRoot: () => Promise<string>;
}

/**
 * その曲の写しを作り直す（`thumbnail:regenerate` の中身）。
 * 主ストレージのルートを引けない・写しを書けない（base64 として読めない・書き込みの失敗）ときも、写しを作れなかったので `false` を返し、
 * 投げない（曲一覧は曲名だけの枠のままにする、9.1 節）。
 */
export async function regenerateThumbnail(deps: ThumbnailRegenerateDeps, songId: string): Promise<boolean> {
  try {
    const adapter = deps.adapterFactory.createForRoot(await deps.resolveActiveRoot());
    return await regenerateThumbnailCopy(adapter, songId);
  } catch (error) {
    // 写しが無くても曲一覧は曲名だけの枠で出せる。ログのファイルには書かず、コンソールにだけ残す（コードを持つ知らせは 9.1 節に無い）。
    console.error(`[thumbnail] 写しを作り直せませんでした: ${songId}`, error);
    return false;
  }
}

/** `thumbnail:regenerate` のハンドラを登録する。要求の形を確かめてから使う（web-core-foundation.md 6.2 節）。 */
export function registerThumbnailHandlers(ipcMain: IpcMainLike, deps: ThumbnailRegenerateDeps): void {
  ipcMain.handle(THUMBNAIL_CHANNELS.regenerate, async (_event, payload): Promise<ThumbnailRegenerateResponse> => {
    const { songId } = parseThumbnailRegenerate(THUMBNAIL_CHANNELS.regenerate, payload);
    return regenerateThumbnail(deps, songId);
  });
}
