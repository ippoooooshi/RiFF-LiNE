// UT-ERR-TMPL: error-logging-foundation.md §2.1 — renderMessageTemplate
// 検証観点: プレースホルダ無し／有り／キー欠落／複数／非文字列値（C0/C1）。

import { describe, expect, it } from 'vitest';

import { renderMessageTemplate } from './messageTemplate';

describe('renderMessageTemplate', () => {
  it('renderMessageTemplate_NoPlaceholder_ReturnsTemplateAsIs', () => {
    expect(renderMessageTemplate('保存に失敗しました。')).toBe('保存に失敗しました。');
    expect(renderMessageTemplate('保存に失敗しました。', { songId: 's1' })).toBe('保存に失敗しました。');
  });

  it('renderMessageTemplate_PlaceholderWithMatchingKey_Substitutes', () => {
    expect(renderMessageTemplate('曲 {context.songId} の保存に失敗', { songId: 's1' })).toBe('曲 s1 の保存に失敗');
  });

  it('renderMessageTemplate_MultiplePlaceholders_AllSubstituted', () => {
    const out = renderMessageTemplate('{context.a} と {context.b} と {context.a}', { a: 'X', b: 'Y' });
    expect(out).toBe('X と Y と X');
  });

  it('renderMessageTemplate_MissingKey_LeavesPlaceholderLiteral', () => {
    expect(renderMessageTemplate('小節 {context.barIndex} は範囲外', {})).toBe('小節 {context.barIndex} は範囲外');
    expect(renderMessageTemplate('小節 {context.barIndex} は範囲外')).toBe('小節 {context.barIndex} は範囲外');
  });

  it('renderMessageTemplate_NonStringValue_CoercedToString', () => {
    expect(renderMessageTemplate('{context.n}/{context.b}/{context.u}', { n: 3, b: false, u: undefined })).toBe(
      '3/false/undefined',
    );
  });
});
