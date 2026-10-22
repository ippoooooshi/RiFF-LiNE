/**
 * IPC の要求の形を確かめる（web-core-foundation.md 6.2 節「main の IPC のハンドラは、受け取った引数を確かめてから使う」）。
 *
 * レンダラーは信頼の境界の外なので、ハンドラは `as` で型を付けるだけにせず、ここで形を確かめてから使う。
 * 形が違えば `InvalidIpcPayloadError` を投げ、`ipcRenderer.invoke` の Promise が reject になる（6.3 節の invoke の決まり）。
 * 確かめるのは型の形（オブジェクト・文字列・バイト列・数）だけで、パスの中身（絶対パスか、ルートの外へ出ないか）は
 * 受け取ったアダプタが確かめる（ElectronFileSystemAdapter）。メッセージにはチャンネルの名前と欄の名前だけを入れ、値は入れない。
 * 6.2 節 <!-- req webcorefoundation:c17748d6.5f73 -->
 */

import type {
  AppConfigWritePointerRequest,
  NotificationEvent,
  StorageRootPointer,
  WindowFlushAutoSaveAck,
} from '@riff-line/shared-types';

/** IPC の要求の形が違う。 */
export class InvalidIpcPayloadError extends TypeError {
  readonly channel: string;
  readonly field: string;

  constructor(channel: string, field: string) {
    super(`IPC の要求の形が違います（${channel} の ${field}）。`);
    this.name = 'InvalidIpcPayloadError';
    this.channel = channel;
    this.field = field;
  }
}

type Fields = Record<string, unknown>;

/** 要求がオブジェクト（null・配列でない）であることを確かめる。 */
export function expectRecord(channel: string, payload: unknown, field = '要求'): Fields {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InvalidIpcPayloadError(channel, field);
  }
  return payload as Fields;
}

function str(channel: string, fields: Fields, key: string): string {
  const v = fields[key];
  if (typeof v !== 'string') throw new InvalidIpcPayloadError(channel, key);
  return v;
}

function bytes(channel: string, fields: Fields, key: string): Uint8Array {
  const v = fields[key];
  if (!(v instanceof Uint8Array)) throw new InvalidIpcPayloadError(channel, key);
  return v;
}

/** `relativePath` だけの要求（fs:readFile・listDirectory・ensureDirectory）。 */
export function parseRelativePath(channel: string, payload: unknown): { relativePath: string } {
  const f = expectRecord(channel, payload);
  return { relativePath: str(channel, f, 'relativePath') };
}

/** `relativePath` と `data` の要求（fs:writeFile）。 */
export function parseWrite(channel: string, payload: unknown): { relativePath: string; data: Uint8Array } {
  const f = expectRecord(channel, payload);
  return { relativePath: str(channel, f, 'relativePath'), data: bytes(channel, f, 'data') };
}

/** `rootPath` と `relativePath` の要求（fs:*At の読み・一覧・作成・削除・有無）。 */
export function parseAt(channel: string, payload: unknown): { rootPath: string; relativePath: string } {
  const f = expectRecord(channel, payload);
  return { rootPath: str(channel, f, 'rootPath'), relativePath: str(channel, f, 'relativePath') };
}

/** `rootPath`・`relativePath`・`data` の要求（fs:writeFileAt）。 */
export function parseWriteAt(
  channel: string,
  payload: unknown,
): { rootPath: string; relativePath: string; data: Uint8Array } {
  const f = expectRecord(channel, payload);
  return {
    rootPath: str(channel, f, 'rootPath'),
    relativePath: str(channel, f, 'relativePath'),
    data: bytes(channel, f, 'data'),
  };
}

/** `rootPath`・`fromRelativePath`・`toRelativePath` の要求（fs:renameFileAt・copyFileAt）。 */
export function parseMoveAt(
  channel: string,
  payload: unknown,
): { rootPath: string; fromRelativePath: string; toRelativePath: string } {
  const f = expectRecord(channel, payload);
  return {
    rootPath: str(channel, f, 'rootPath'),
    fromRelativePath: str(channel, f, 'fromRelativePath'),
    toRelativePath: str(channel, f, 'toRelativePath'),
  };
}

const STORAGE_TYPES: ReadonlySet<string> = new Set<StorageRootPointer['storageType']>([
  'local',
  'icloud',
  'gdrive',
  'custom',
]);

/** appconfig:writePointer の要求。 */
export function parseWritePointer(channel: string, payload: unknown): AppConfigWritePointerRequest {
  const pointer = expectRecord(channel, expectRecord(channel, payload).pointer, 'pointer');
  const storageType = str(channel, pointer, 'storageType');
  if (!STORAGE_TYPES.has(storageType)) throw new InvalidIpcPayloadError(channel, 'storageType');
  return {
    pointer: {
      rootAbsolutePath: str(channel, pointer, 'rootAbsolutePath'),
      storageType: storageType as StorageRootPointer['storageType'],
    },
  };
}

/** log:append の要求（renderer の NotificationCenter が出した記録 1 件）。 */
export function parseNotificationEvent(channel: string, payload: unknown): NotificationEvent {
  const f = expectRecord(channel, payload);
  for (const key of ['level', 'channel', 'code', 'message', 'timestamp']) str(channel, f, key);
  if (f.context !== undefined) expectRecord(channel, f.context, 'context');
  return f as unknown as NotificationEvent;
}

/** window:openSong の要求。 */
export function parseSongId(channel: string, payload: unknown): { songId: string } {
  const f = expectRecord(channel, payload);
  return { songId: str(channel, f, 'songId') };
}

/** window:flushAutoSaveAck の要求。 */
export function parseFlushAck(channel: string, payload: unknown): WindowFlushAutoSaveAck {
  const token = expectRecord(channel, payload).token;
  if (typeof token !== 'number' || !Number.isInteger(token)) throw new InvalidIpcPayloadError(channel, 'token');
  return { token };
}
