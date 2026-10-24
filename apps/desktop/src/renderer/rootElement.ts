/**
 * レンダラーの入口（main.tsx）から出した判断の関数（web-core-foundation.md 14.7 節、2026-10-25 本人決定）。 <!-- req webcorefoundation:c27f130d.ad74 --> <!-- req webcorefoundation:8f5284e2.6075 -->
 *
 * 入口は単体テストで読み込まず数えに出ないので、入口には分かれ道を置かず、判断はこのファイルの関数に出して単体テストで通す。
 * 単体テストは apps/desktop/src/renderer/rootElement.test.ts（UT-DEV-ROOT）。
 */

/** React を載せる要素の id（index.html の `<div id="root">`）。 */
export const ROOT_ELEMENT_ID = 'root';

/**
 * React を載せる要素を引く。無ければ起動を止める。
 * @param doc `document`
 * @returns `#root` の要素
 * @throws Error `#root` が無いとき
 */
export function requireRootElement<E>(doc: { getElementById(id: string): E | null }): E {
  const rootElement = doc.getElementById(ROOT_ELEMENT_ID);
  if (rootElement === null) throw new Error('renderer bootstrap failed: #root not found');
  return rootElement;
}
