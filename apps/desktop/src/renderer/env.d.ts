/// <reference types="vite/client" />

import type { RiffLineApi } from '@riff-line/shared-types';

declare global {
  interface Window {
    /** preload の contextBridge が公開する型安全な API（web-core-foundation.md §3.4）。 */
    readonly riffLineApi: RiffLineApi;
  }
}

export {};
