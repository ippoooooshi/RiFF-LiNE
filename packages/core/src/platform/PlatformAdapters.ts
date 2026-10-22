/**
 * L5 が起動時に作った 4 系統の具象を 1 つにまとめ、Webコアの組み立ての関数に引数で渡す型（web-core-foundation.md 3.1 節）。
 * 1 つの型にまとめるのは、4 つのどれかを渡し忘れたときに型の検査で見つけるため。
 * v1 で注入するのはこの 4 系統だけ。将来のアダプタは、足すときにここへ足す。
 * 7.2 節：①〜④は AD-3 のアダプタとして Webコアへ注入する <!-- req webcorefoundation:070a57a7.a685 --> <!-- req webcorefoundation:85290f71.2979 --> <!-- req webcorefoundation:deb9f8fb.1bdf --> <!-- req webcorefoundation:4c0ea023.907e --> <!-- req webcorefoundation:780a25e7.ce15 -->
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
// <!-- req webcorefoundation:0b8f7d8d.7352 --> <!-- req webcorefoundation:0b8f7d8d.b184 -->
// 13.2 節：アプリロックは作らず、AuthAdapter の空の型も将来の 6 つのアダプタの型も v1 で置かない。足すときは 3.1 節の形でアダプタを 1 つ足して起動のときに注入するだけで、コマンド層・データモデル・画面には手を入れない。通知と省電力も同じく、足すときに 3.1 節の形の新しいアダプタとして足す <!-- req webcorefoundation:72770e10.2020 --> <!-- req webcorefoundation:72770e10.72ab --> <!-- req webcorefoundation:72770e10.8e13 --> <!-- req webcorefoundation:72770e10.21ab --> <!-- req webcorefoundation:72770e10.dbfe --> <!-- req webcorefoundation:72770e10.089f --> <!-- req webcorefoundation:72770e10.ef86 --> <!-- req webcorefoundation:72770e10.86ed --> <!-- req webcorefoundation:d660a867.0c32 --> <!-- req webcorefoundation:d660a867.b019 --> <!-- req webcorefoundation:d660a867.d68d --> <!-- req webcorefoundation:314ec5bd.3093 --> <!-- req webcorefoundation:314ec5bd.43a7 --> <!-- req webcorefoundation:314ec5bd.c75c -->
