/**
 * L5 が起動時に作った 4 系統の具象を 1 つにまとめ、Webコアの組み立ての関数に引数で渡す型（web-core-foundation.md 3.1 節）。
 * 1 つの型にまとめるのは、4 つのどれかを渡し忘れたときに型の検査で見つけるため。
 * v1 で注入するのはこの 4 系統だけ。将来のアダプタは、足すときにここへ足す。
 */

import type { AudioSessionAdapter } from './AudioSessionAdapter';
import type { FileSystemAdapter } from './FileSystemAdapter';
import type { UpdateCheckAdapter } from './UpdateCheckAdapter';
import type { WindowAdapter } from './WindowAdapter';

export interface PlatformAdapters {
  fileSystem: FileSystemAdapter;
  audioSession: AudioSessionAdapter;
  window: WindowAdapter;
  updateCheck: UpdateCheckAdapter;
}
