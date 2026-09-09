/**
 * 初回オンボーディングオーバーレイ（screens-navigation.md §4.8 #13・§5.5）。
 *
 * `AppPreferencesService.load().onboardingSeen` が false の場合のみ自動表示。「スキップ」「次へ」操作の結果は
 * `AppPreferencesService.save({ onboardingSeen: true })` で永続化する。設定ダイアログの「アプリ情報」タブから
 * 再表示可能（03_screens_ui_pc.md §12）。
 */

import { useState } from 'react';

import { tokens } from './common';

const STEPS: { title: string; body: string }[] = [
  { title: 'ようこそ RiFF-LiNE へ', body: '耳コピ用のタブ譜を素早く作るためのアプリです。' },
  { title: '曲を作る', body: '「新規曲…」からパートと楽器を選ぶと編集ウィンドウが開きます。' },
  { title: '入力と再生', body: 'フレット入力バー・音価パレットで打ち込み、スペースキーで再生できます。' },
];

export interface OnboardingOverlayProps {
  /** 「スキップ」または最終ステップ完了時に呼ばれる。呼び出し先が onboardingSeen: true を保存する。 */
  onDismiss: () => void;
}

export function OnboardingOverlay(props: OnboardingOverlayProps): React.JSX.Element {
  const [index, setIndex] = useState(0);
  const step = STEPS[index] ?? STEPS[0]!;
  const isLast = index >= STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-label="はじめに"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: tokens.baseFont,
        color: tokens.text,
      }}
    >
      <div style={{ background: tokens.bg, borderRadius: 10, padding: 24, width: 420, textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>{step.title}</h2>
        <p style={{ color: tokens.subtext }}>{step.body}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '12px 0' }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: i === index ? tokens.accent : tokens.border,
              }}
              aria-hidden="true"
            />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" onClick={props.onDismiss}>
            スキップ
          </button>
          {isLast ? (
            <button type="button" onClick={props.onDismiss}>
              はじめる
            </button>
          ) : (
            <button type="button" onClick={() => setIndex((i) => Math.min(STEPS.length - 1, i + 1))}>
              次へ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
