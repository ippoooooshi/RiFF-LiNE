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
  // <!-- req webcorefoundation:7f0aaf39.6dd1 --> <!-- req webcorefoundation:e4fed3ac.99f5 --> <!-- req webcorefoundation:09c25074.b0cf --> <!-- req webcorefoundation:fa94f8f7.a03c --> <!-- req webcorefoundation:52ee2144.1b7a --> <!-- req webcorefoundation:0529d60f.e7e5 --> <!-- req webcorefoundation:0529d60f.222a --> <!-- req webcorefoundation:0529d60f.979e --> <!-- req webcorefoundation:99e17f74.f16c --> <!-- req webcorefoundation:99e17f74.2be9 --> <!-- req webcorefoundation:99e17f74.b375 --> <!-- req webcorefoundation:99e17f74.438c -->
  fileSystem: FileSystemAdapter;
  audioSession: AudioSessionAdapter;
  window: WindowAdapter;
  updateCheck: UpdateCheckAdapter;
}
