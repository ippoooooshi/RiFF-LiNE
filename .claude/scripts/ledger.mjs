#!/usr/bin/env node
// 網羅台帳 段階3〜5: 要求分解の記録・検算と、判定の記録・集計。
//
// 分解（decompose）は上位ドキュメントだけを見て行う。下位を見せない。
//   → 検証キー方式が失敗した理由は「下位を見ながらキーを選んでいた」ため。
//      下位に無いものはキーにならなかった。上位だけを見る分解は、
//      下位の欠落に一切影響されない。
// 分解件数が split.mjs の推定下限を下回ったら、この場で拒否する。
//
// 使い方:
//   node .claude/scripts/ledger.mjs stats [--json]
//   node .claude/scripts/ledger.mjs next <edge> [件数|all] [--file <部分一致>] [--section <部分一致>] [--ids-only] [--phase decompose|judge]
//   node .claude/scripts/ledger.mjs show <edge> <unitId|reqId>
//     既定は all（全件）。試しに少しだけ回したいときだけ件数か --file / --section で絞る。
//   node .claude/scripts/ledger.mjs decompose <edge> <unitId> '["要求1","要求2"]'
//   node .claude/scripts/ledger.mjs judge <edge> <reqId> <verdict> '<evidence json>' [--human]
//   node .claude/scripts/ledger.mjs plan <edge> <reqId> <上位を直す|下位を直す|スコープ外|判断できない> --why <理由>
//   node .claude/scripts/ledger.mjs plan <edge> <reqId> --clear
//   node .claude/scripts/ledger.mjs plan-report <edge> [--json]
//   node .claude/scripts/ledger.mjs hold <edge> <entryId> --why <理由>   （割れた分を本人へ回す）
//   node .claude/scripts/ledger.mjs hold <edge> <entryId> --clear
//   node .claude/scripts/ledger.mjs stale-diff <edge> [--json]
//   node .claude/scripts/ledger.mjs stale-diff <edge> --ack <unitId> --why <理由>
//   node .claude/scripts/ledger.mjs stale-diff <edge> --ack-batch <陳腐化した時刻> --why <理由>
//     --human は人が判定したことの記録。humanJudged: true の段はこれが揃うまで完了にならない
//   node .claude/scripts/ledger.mjs approve-next <edge> [件数|all] [--file <部分一致>] [--ids-only]
//   node .claude/scripts/ledger.mjs approve-show <edge> <entryId>
//   node .claude/scripts/ledger.mjs approve <edge> <entryId> <要求|要求でない|判断できない> '<json>'
//     分解した断片 1 つずつに「これは要求か」を別の目で答える。分解した側とは別の役が行う。
//     「要求」と答えるときは expect（下位に現れるはずの一文）が必須。**書けないものは要求ではない。**
//   node .claude/scripts/ledger.mjs concede <edge> <entryId> [--why "<理由>"]
//     指摘に同意して、その要求を同じ断片の対象外へ移す。承認はそのまま引き継ぐ。
//     **同意するのを一番安くしておく**（高いと「反論して押し切る」が最短経路になる）。
//   node .claude/scripts/ledger.mjs rebut <edge> <entryId> '<json>'
//     指摘に反論して分解した側の扱いを維持する。維持する側にも expect を課す（反論を無料にしない）。
//   node .claude/scripts/ledger.mjs rebut <edge> <entryId> --clear --why "<理由>"
//     反論を取り消して指摘に戻す（記録は clearedRebuttals に残る）。
//   node .claude/scripts/ledger.mjs ops [--since <ISO>] [--expect approve,settle] [--json]
//     台帳に書いたコマンドの記録。--expect 以外の書き込みがあれば終了コード 1。ワークフローのあとに本体が読む。
//   node .claude/scripts/ledger.mjs approval-report <edge> [--json]
//   node .claude/scripts/ledger.mjs ask <edge> [--file <部分一致>] [--section <部分一致>] [--json]
//     決着に本人の判断が要るもの（保留・未閉鎖の列挙つきの指摘）を**まとめて質問にする。**
//     1 件ずつ割り込まない。聞くべきことは機械が本文から作る（lib/wording.mjs）。
//     既定では**答え済みのものを出さない**（--all で全件）。
//   node .claude/scripts/ledger.mjs ask-record <edge> <key> --question "<聞いたこと>" --answer "<答え>"
//     本人の答えを .claude/coverage/answers/ に残す。**答えに「等」「など」が入っていたら拒否する。**
//   node .claude/scripts/ledger.mjs refs <edge> [--json]
//     「出典・参照」として落とした断片の**参照先が実在するか**。
//     参照先が無ければ、正しい判定のまま中身が分母から消える。
//   node .claude/scripts/ledger.mjs settle-next <edge> [n] [--ids-only]
//     指摘に**同じ問いを盲でもう一度**投げる一覧。1 周目の判定は渡さない。
//   node .claude/scripts/ledger.mjs settle <edge> <entryId> <要求|要求でない|判断できない> '<json>'
//     2 周目の答えを記録する。**concede / rebut は選べない**——一致したかどうかから機械が導く。
//   node .claude/scripts/ledger.mjs settle-report <edge> [--json]
//     一致して落とした／割れた／再分解が要る の内訳。**割れたものが本体。**
//   node .claude/scripts/ledger.mjs ask-report <edge> [--json]
//     聞いた／記録した／原文を直した の進み具合。**セッションが切れた後の再開口。**
//   node .claude/scripts/ledger.mjs pending <edge> [--file <部分一致>] [--section <部分一致>] [--json]
//     担当範囲の未分解／未判定の件数。Stop hook と /wp が「分母が固定されているか」を見るのに使う
//   node .claude/scripts/ledger.mjs stale <edge>
//     edge は "req->bd" の形式。**シェルでは必ず引用符で囲む**（`>` はリダイレクト）。
//     引用を忘れて `req-` になった場合は、その旨を出して止まる。`req:bd` の形も受け付ける。
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync, statSync, renameSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, config, json, matchesAny, tier, tierFiles, read as readRel, exists as existsRel } from './lib/config.mjs'
import { checkEvidence } from './lib/evidence.mjs'
import { inspect, openEnumWords } from './lib/wording.mjs'

// ── 語の共有 ────────────────────────────────────────────────────────────
// 分解した要求・対象外の理由が、上位の原文と 1 語も共有していないなら、
// それは原文を読んで書いたものではない。v22 は `["x","x","x","x"]` が
// 下限 4 件を満たして通った（実測）ので、最低限の紐付けを要求する。
export function tokensOf(text) {
  const t = String(text || '')
  const out = new Set()
  for (const m of t.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) out.add(m[0].toLowerCase())
  for (const m of t.matchAll(/[ァ-ヴー]{2,}/g)) out.add(m[0])
  for (const m of t.matchAll(/[一-龥]{2,}/g)) out.add(m[0])
  for (const m of t.matchAll(/[0-9]+/g)) out.add(m[0])
  return out
}
export function sharesToken(text, src) {
  const a = tokensOf(text), b = tokensOf(src)
  for (const x of a) {
    if (b.has(x)) return true
    // 漢字列・カタカナ列は部分一致も許す（「再生位置」と「再生」を別語にしない）。
    // **カタカナを外していたのは取りこぼしだった**（2026-09-15、実地の分解で判明）:
    // 要件 §4.1 を 28 単位ぜんぶ分解したとき、
    //   要求「ピンチハーモニクスに対応すること」／ 出どころ「・ピンチ）」
    // が「1 語も共有していない」で弾かれた。日本語の複合語はカタカナでも同じ形になる。
    // 漢字だけを特別扱いする理由が無い。
    if (/^[一-龥]{2,}$/.test(x) || /^[ァ-ヴー]{2,}$/.test(x)) {
      for (const y of b) if (y.includes(x) || x.includes(y)) return true
    }
  }
  return false
}
// **語の無い原文には、原文そのものを逐語で含めることを求める。**（v30 T9）
// 実測（2026-09-25、turn 71）: 基本設計 01:54 の単位の本文が「**」の 2 文字だけだった
// （「…限られる。**」を「。」で切ったため）。語が 1 つも無いので、sharesToken はどんな理由にも
// false を返し、**正直に対象外にする道が無かった**——分解できない単位が 1 つ残ると、
// その章の分母は永久に固定されない。基本設計全体で同じ型が 12 件あった
// （「**」10 件、ひらがなだけの「これにより：」「次の形に改める。」）。
// 語に分けられない断片を逐語で見るのは、④（要求と出どころ）で既にやっている扱いと同じ。
// **検査を外すのではない。** 語が取れる原文には今までどおり語の共有を求める。
export function touchesSource(why, src) {
  const s = String(src || '')
  if (tokensOf(s).size === 0) return s.trim().length > 0 && String(why || '').includes(s.trim())
  return sharesToken(why, s)
}

// ── 承認（分解が「要求」として正しいかを、別の目で見る）─────────────────
//
// 形の検査（from が逐語か・区間が重なっていないか・取り残しが無いか）は、
// **嘘の紐付け**を全部捕まえる。捕まえられないのは
// 「紐付けは正しいが、そもそも要求ではない」もの——
// `（PC版）` → 「（PC版）を対象とした利用シーンである」は形として満点である。
// 意味を読まないと判定できないので、機械には原理的に見えない。
//
// そこで、分解とは別の役に 1 断片ずつ同じ問いを出す:
//   **「この断片は要求か」**（＝下位に書かれていなければ不備といえるか）
// 答えは 3 つに固定し、「要求」と答えるときは
//   **その要求が満たされたとき下位の文書に現れるはずの一文**（expect）
// を書かせる。書けないものは要求ではない。感想ではなく作文を課すことで、
// 「なんとなく良さそう」で通せなくする。
//
// 分解した側が水増しするのは**下限があるから**で、承認する側に下限は無い。
// 同じモデルでも掛かっている圧力が違うので、間違え方が違う。
// 重ならない誤りを二重に通すことだけが、この仕掛けの根拠である。
// 承認する側に件数の目標を与えた時点で、この根拠は消える。
export const APPROVAL_VERDICTS = ['要求', '要求でない', '判断できない']
// 「書式・記号の切れ端」は v30 T9 で足した。「**」だけの単位（文を「。」で切ったときに残る太字の印）を、
// ほかの種類に無理に当てはめさせないため。
export const NON_REQ_KINDS = ['ラベル・項目名', '目的・ねらい', '枠組み・位置づけ', '経緯・旧方針', '出典・参照', '根拠・前提の説明', 'プロジェクトの属性', '書式・記号の切れ端']

function hash12(x) { return createHash('sha256').update(String(x)).digest('hex').slice(0, 12) }

// 承認は**断片ごと**に紐づける。単位全体のハッシュに紐づけると、
// 10 件のうち 1 件を直しただけで残り 9 件の承認が消える。
// 「この断片は要求か」は断片だけで決まる問いなので、他の断片が変わっても答えは変わらない。
// 上位の原文そのものが変わった場合は sync が reqs を落とすので、そこで一緒に消える。
export function entriesOf(r) {
  const out = []
  ;(r.reqs || []).forEach((q, i) => out.push({ kind: 'req', idx: i, span: String(q.from || ''), text: String(q.text || ''), with: withOf(q), node: q }))
  ;(r.skips || []).forEach((k, i) => out.push({ kind: 'skip', idx: i, span: String(k.skip || ''), text: String(k.why || ''), node: k }))
  // **id は中身から作る。配列の添字にしない。**
  //
  // 実測（2026-09-17）: `#<番号>` は reqs の添字だったので、concede が 1 件
  // 配列から抜くたびに**以降の番号が繰り上がった**。1 つの一覧から作った
  // 5 件の concede を順に流したところ、2 件目が**別の断片に当たり**、
  // 「クリーンエレキ」についての理由が「歪みエレキ」に付いた。
  // concede は元に戻せないので、その付け違いは消せない。
  //
  // **位置で照合して壊れたのはこれで 3 回目**（anchor の連鎖、書き戻しの出力、これ）。
  // 中身が鍵なら、他の断片が動いても自分の id は変わらない。
  // 同じ中身の断片が同じ単位に 2 つあるときだけ、後ろに連番を足して区別する。
  const seen = new Map()
  for (const x of out) {
    const k = entryKeyOf(x)
    const n = seen.get(k) || 0; seen.set(k, n + 1)
    x.key = k
    x.id = `${r.unitId}#k${k}${n ? `.${n}` : ''}`
    x.legacyId = x.kind === 'req' ? `${r.unitId}#${x.idx}` : `${r.unitId}#s${x.idx}`
  }
  return out
}
// **「含む」（with）も断片の中身に入れる。**（v30 T11）無いときは前と同じ鍵になるので、
// 今までの承認・判定・本人待ちはそのまま引き継がれる。含むを足すと別の断片になり、承認し直しになる——
// 承認した人が見ていない組み合わせを、承認済みにしないため。
export function withOf(q) { return Array.isArray(q && q.with) ? q.with.map(String).filter(x => x.trim()) : [] }
export function entryKeyOf(e) {
  const w = Array.isArray(e.with) && e.with.length ? `\u0000with\u0000${e.with.join('\u0001')}` : ''
  return hash12(`${e.kind}\u0000${e.span}\u0000${e.text}${w}`)
}

// 断片ごとの承認の状態。
//   未承認     … まだ見ていない
//   承認       … 承認する側の答えと、分解した側の扱いが一致した
//   指摘       … 食い違った（要求として書いたものを「要求でない」と言われた、またはその逆）
//   反論で維持 … 指摘に対して反論が記録され、そのまま維持されている
//   保留       … 承認する側が判断できないと答えた
//   本人待ち   … 1 周目と 2 周目が割れたので、本人の判断へ回した
//
// **「本人待ち」を足した理由。**（実測 2026-09-20）
// 決着（settle）は「割れたら落とさず、本人へ回す」という設計だが、
// **Stop hook はそれを終わりとして認めていなかった。** 指摘が 1 件でも残っていると
// 止まり、許されるのは「分解を直す」か「反論を記録する」の 2 つだけ。
// 結果、**本人へ回すはずだった判断を、その場で `rebut` として置く**ことになった。
// ゲートが、設計が意図した経路を塞いで、判断を書かせた。
//
// **止める仕組みに「待つ」という終わり方が無いと、待つ代わりに決めてしまう。**
// だから状態として持たせる。黙って通すのではなく、**数えて見えるところに置く**。
export function entryApproval(e) {
  const a = e.node.approval
  if (!a || a.of !== entryKeyOf(e)) return { state: '未承認', approval: null }
  const held = e.node.hold && e.node.hold.of === entryKeyOf(e) ? e.node.hold : null
  if (a.verdict === '判断できない') return held ? { state: '本人待ち', approval: a, hold: held } : { state: '保留', approval: a }
  const agrees = (a.verdict === '要求') === (e.kind === 'req')
  if (agrees) return { state: '承認', approval: a }
  const reb = e.node.rebuttal
  // **hold は rebuttal より先に見る。**
  // 実測（2026-09-20）: Stop hook に「待つ」終わり方が無かったせいで、本人へ回すはずの
  // 判断が `rebut` として置かれた。あとから本人待ちへ戻そうとしたら、
  // ここで `反論で維持` が先に返るため戻せなかった——**直す道具が、直す対象に届かない。**
  // 反論の記録は消さない（下の rebuttal として残す）。**状態だけが「本人待ち」になる。**
  if (held) return { state: '本人待ち', approval: a, hold: held, rebuttal: (reb && reb.of === entryKeyOf(e)) ? reb : undefined }
  if (reb && reb.of === entryKeyOf(e)) return { state: '反論で維持', approval: a, rebuttal: reb }
  return { state: '指摘', approval: a }
}

// 指摘に同意して、要求を同じ断片の対象外へ移す実体。
// **concede コマンドと settle コマンドが同じものを呼ぶ。** 2 か所に書くと、
// 片方だけ直して「同じ同意」が 2 通りの結果になる（踏んだ罠 3 と同じ型）。
export function applyConcede(r, entry, a, why) {
  r.reqs.splice(entry.idx, 1)
  const node = { skip: entry.span, why, concededFrom: { kind: a.approval.kind, at: new Date().toISOString() } }
  // 承認を引き継ぐ。**同意したのに承認し直させない。**
  node.approval = { ...a.approval, of: entryKeyOf({ kind: 'skip', span: entry.span, text: why }), viaCompliance: true }
  // **そこまでに在った記録を捨てない。**
  //
  // 実測（2026-09-21）: 同意は reqs から節点ごと抜いて skips に別の節点を作る。
  // 承認だけを引き継いでいたので、**2 周目の答え・反論・本人へ回した理由が、
  // 同意した瞬間に台帳から消えていた。** 画面には
  // 「反論の記録が在りました」と出ていたが、**その直後に消していた。**
  // 後から読むと、割れたことも本人が見たことも残っていない——
  // 「同意で片付いた 1 件」にしか見えない。
  //
  // 数えられる状態（approval / rebuttal / hold）は of で照合するので、
  // **別の名前の下に入れておけば二度と数に入らない。** 記録としてだけ残る。
  const prior = {}
  if (entry.node && entry.node.second) prior.second = entry.node.second
  if (entry.node && entry.node.rebuttal) prior.rebuttal = entry.node.rebuttal
  if (entry.node && entry.node.clearedRebuttals) prior.clearedRebuttals = entry.node.clearedRebuttals
  if (entry.node && entry.node.hold) prior.hold = entry.node.hold
  if (Object.keys(prior).length) node.priorRecords = prior
  // **「含む」の断片も対象外へ運ぶ。**（v30 T11）運ばないと、その断片がどこにも割り当てられず、
  // 次に分解し直したときに「取り残し」で止まる。承認した側は含むごと見て「要求でない」と答えているので、
  // 同じ承認を引き継ぐ。
  const extra = (entry.with || []).map(w => {
    const wy = `${why}（「${String(entry.span).slice(0, 20)}」の要求に含めていた断片）`
    return { skip: w, why: wy, concededFrom: node.concededFrom,
             approval: { ...a.approval, of: entryKeyOf({ kind: 'skip', span: w, text: wy }), viaCompliance: true } }
  })
  r.skips = [...(r.skips || []), node, ...extra]
  return node
}

// 本人が「これは要求である」と決めたときの実体。**concede の裏返し。**
//
// **なぜ要るか（実測 2026-09-20 → 22、同じ型の 4 回目）。**
//   割れた断片を本人へ回す道（hold）と、本人が承認側を支持して閉じる道（concede）は在った。
//   **分解側を支持して閉じる道が無かった。**
//   いちばん近いのが `hold --clear` で、これは `反論で維持` に戻るだけ。
//   その記録は「**分解役が反論した**」であって「**本人が決めた**」ではない。
//   後から台帳を読む人に、本人が見て決めたことが残らない。
//
// concede と同じ形にする——**状態を増やさず、承認の記録を置き換え、元は残す。**
// 置き換えた承認には viaOwner を立てるので、後から数えられる。
export function applyUphold(entry, a, why) {
  const node = entry.node
  const prior = {}
  if (a.approval) prior.approval = a.approval
  if (node.second) prior.second = node.second
  if (node.rebuttal) prior.rebuttal = node.rebuttal
  if (node.hold) prior.hold = node.hold
  if (Object.keys(prior).length) node.priorRecords = { ...(node.priorRecords || {}), ...prior }
  // **状態を動かすために、数えられる名前から外す。** 記録は priorRecords に残る。
  delete node.rebuttal
  delete node.hold
  // **分解した側の扱いをそのまま残す。** 要求なら「要求」、対象外なら「要求でない」。
  // 実測（2026-09-24、turn 55）: 対象外にした断片が本人待ちになったとき、
  // 「対象外のまま」と決めるコマンドが無かった（uphold は要求だけ、concede は要求を外すだけ）。
  node.approval = entry.kind === 'req'
    ? { verdict: '要求', why, of: entryKeyOf(entry), at: new Date().toISOString(), viaOwner: true }
    : { verdict: '要求でない', kind: '本人の判断', why, of: entryKeyOf(entry), at: new Date().toISOString(), viaOwner: true }
  return node
}

// 2 周目の答えが在るか。**在れば二度聞かない。**
export function secondOf(e) {
  const t = e.node.second
  return (t && t.of === entryKeyOf(e)) ? t : null
}

// 1 周目（承認）と 2 周目が同じことを言っているか。
// **「要求か否か」だけで比べる。** 理由の文言は比べない——同じ判断を別の言葉で
// 書いただけで食い違い扱いになると、食い違いの件数が判断ではなく作文の差になる。
export function settleAgrees(entry, approval, verdict) {
  if (verdict === '判断できない' || approval?.verdict === '判断できない') return null
  return (verdict === '要求') === (approval?.verdict === '要求')
}

const SETTLE_NOTE =
  'これは 2 周目です。**1 周目に誰が何と答えたかは渡していません。** ' +
  '見せてから「同意しますか」と聞くと、ほぼ必ず同意します。そうやって集めた同意は、' +
  '判断ではなく提示のしかたの結果です。だから同じ問いを、同じ材料で、もう一度だけ投げています。' +
  ' **多数決をとっているのではありません。** 1 周目と同じ答えなら落とし、違う答えなら落とさずに本人へ回します。' +
  ' 前の答えに合わせようとしないでください。合わせても違っても、あなたの答えは記録として残るだけです。'


// ── 参照先が実在するか ───────────────────────────────────────────────
//
// なぜ要るか（実測 2026-09-16）:
//   要件定義書に、こう書かれた 1 行があった。
//     「該当する『不要』判定は本文書の各表内に個別に記載されている
//       （例：曲の複製機能、…、移調機能、曲のステータス管理、別解釈候補の管理、…）」
//   承認する側は 2 周ともこれを「出典・参照」と判定して落とした。**判定は正しい。**
//   実体が各表に在るなら、この行は所在を指しているだけだから。
//   ところが**移調機能・曲のステータス管理・別解釈候補の管理は、各表に無かった。**
//   参照先が無いので、この 3 つの「不要」判定は**どの断片にも載っていない**——
//   分母から静かに消えた。
//
//   落とす判断そのものは機械で検査できない。**参照先が解決するかは検査できる。**
//   そこだけを見る。

// 「例：A、B、C」の A/B/C を取り出す。読点区切りで、末尾の「等」「など」は落とす。
export function exampleItems(text) {
  const out = []
  for (const m of String(text || '').matchAll(/(?:例[：:])([^）)]*)/g)) {
    for (const raw of String(m[1]).split(/[、,]/)) {
      const t = raw.replace(/^[\s。]*/, '').replace(/[\s。]*$/, '')
        .replace(/(など|等|その他)$/, '').trim()
      if (t.length >= 3) out.push(t)
    }
  }
  return [...new Set(out)]
}

// 表記ゆれを拾うための断片。「の」「・」「／」で割った、3 文字以上のかたまり。
//   依存ライブラリの定期脆弱性スキャン → [依存ライブラリ, 定期脆弱性スキャン]
// **丸ごと一致しなくても、かたまりが在れば「表記ゆれの疑い」に留める。**
// ここを緩めないと、言い換えのたびに赤が出て検査ごと無視される（F21）。
function chunksOf(item) {
  return String(item).split(/[の・／\/]/).map(x => x.trim()).filter(x => x.length >= 3)
}

// tier の全文（行番号つき）。参照先を探す先。
function tierBodies(tierId) {
  let files = []
  try { files = tierFiles(tierId) } catch { return [] }
  const out = []
  for (const f of files) { try { out.push({ file: f, lines: readRel(f).split('\n') }) } catch { /* 読めないものは飛ばす */ } }
  return out
}

// 参照先が在るか。**自分が書かれている行は除く**——参照文そのものを実体と数えない。
export function resolveItem(bodies, item, fromFile, fromLine) {
  const at = []
  for (const b of bodies) for (let i = 0; i < b.lines.length; i++) {
    if (b.file === fromFile && i + 1 === fromLine) continue
    if (b.lines[i].includes(item)) at.push(`${b.file}:${i + 1}`)
  }
  if (at.length) return { state: '実体あり', at: at.slice(0, 3) }
  const near = []
  for (const c of chunksOf(item)) {
    for (const b of bodies) for (let i = 0; i < b.lines.length; i++) {
      if (b.file === fromFile && i + 1 === fromLine) continue
      if (b.lines[i].includes(c)) { near.push(`${c} → ${b.file}:${i + 1}`); break }
    }
  }
  if (near.length) return { state: '表記ゆれの疑い', at: near.slice(0, 3) }
  return { state: '見つからない', at: [] }
}

// 承認の集計。**「指摘」は消さない。**
// 承認する側が誤って「要求でない」と言ったとき黙って消すと、
// 網羅台帳が存在する理由そのもの——落ちが無いこと——が壊れる。
// 落ちるより残るほうが安全な側に倒す。
export function approvalCounts(rows) {
  const c = { entries: 0, unseen: 0, ok: 0, challenged: 0, heldOver: 0, deferred: 0, waiting: 0 }
  const KEY = { '未承認': 'unseen', '承認': 'ok', '指摘': 'challenged', '反論で維持': 'heldOver', '保留': 'deferred', '本人待ち': 'waiting' }
  for (const r of rows) {
    // **前の版から引き継いだ本人待ち**（v29 T7）。単位の本文が変わると断片の鍵が変わり、
    // 本人待ちの記録が新しい断片に付かない。付かないものは単位に残し、本人が外すまで数える。
    if (Array.isArray(r.staleHolds) && r.staleHolds.length) { c.waiting += r.staleHolds.length; c.waitingCarried = (c.waitingCarried || 0) + r.staleHolds.length }
    if (!Array.isArray(r.reqs)) continue
    for (const e of entriesOf(r)) { c.entries++; c[KEY[entryApproval(e).state]]++ }
  }
  // 未解決 = **AI 側がまだ動けるもの**。
  // 反論で維持は含めない（記録が残り、別に数えられる）。
  // **本人待ちも含めない。** 含めると、本人の返事を待っている間ずっと Stop が止まり、
  // 待つ代わりにその場で決めることになる——それを直すために足した状態なので。
  // 数からは外すが、`approval-report` と `pending` には必ず出す。**黙って消さない。**
  c.unresolved = c.unseen + c.challenged + c.deferred
  return c
}

// 承認する側が下位の文書を覗いたかどうかの手がかり。
//
// 承認は「下位に無ければ不備といえるか」を**上位だけを見て**答える作業である。
// 下位を開くと「下位に書いてあるから要求だ」という逆立ちした判断になり、
// 下位に無いものだけが「要求でない」に落ちる——つまり**漏れを漏れでないことにする**。
// 分解で下位を見せない理由と同じで、ここが一番効く。
//
// ただし**止めない。** 偶然の一致はあり得るし、当たっていない検査で止めると
// 警告そのものを無視する癖がつく。記録して数えるだけにして、
// approval-report で「多いかどうか」を見る。
export function expectFoundBelow(edge, expect) {
  const t = (() => { try { return tier(edge.to) } catch { return null } })()
  if (!t || !expect || expect.length < 12) return null
  let files = []
  try { files = tierFiles(edge.to) } catch { return null }
  for (const f of files) {
    let body = ''
    try { body = readRel(f) } catch { continue }
    const at = body.indexOf(expect)
    if (at >= 0) return { file: f, line: body.slice(0, at).split('\n').length }
  }
  return null
}

// 語尾の型。**承認する側には絶対に見せない。**
// 「非要求は語尾で見分けられる（要求は『〜すること』、非要求は『〜である』）」
// という仮説を、承認の結果と突き合わせて**あとから**測るためだけに使う。
// 先に見せると仮説が答えを作ってしまい、測定にならない。
export function endingKind(text) {
  const t = String(text || '').trim().replace(/[。．.\s]+$/, '')
  if (/(こと|できる|可能|とする)$/.test(t)) return '規範形'
  if (/(である|だ|とされる|位置づける|重視する|想定する|前提とする)$/.test(t)) return '説明形'
  return 'その他'
}

// ── 兄弟エッジ（同じ上位段を持つエッジ）─────────────────────────────
//
// `dd->impl` と `dd->it` は**どちらも上位が dd**。`sync` は edge.from を分母にするので、
// 同じ 2,350 単位が 2 つの台帳に別々に載る。
//
// **分解は上位だけを見て行う作業で、下位を見ない。** それがこの仕組みの土台なので、
// 同じ単位の分解は、どのエッジから見ても同じでなければならない。
// つまり 2 回やるのは二度手間であり、**2 つの結果が違ったらそれは不整合**である
// （片方で要求、もう片方で対象外、が黙って成立してしまう）。
//
// なので分解したら兄弟エッジにも同じものを書く。承認も一緒に運ぶ——
// 承認が答えているのは「この断片は要求か」で、これも下位に依存しない問いだから。
// **判定は運ばない。** 判定だけは下位ごとに違う。
export function siblingEdges(edge) {
  const id = edgeId(edge)
  return (config().edges || []).filter(x => x.from === edge.from && edgeId(x) !== id)
}

// 分解の中身だけを取り出す（判定・証拠は落とす）
export function decompositionOf(r) {
  return {
    reqs: (r.reqs || []).map(q => ({
      text: q.text, from: q.from,
      ...(q.approval ? { approval: q.approval } : {}),
      ...(q.rebuttal ? { rebuttal: q.rebuttal } : {}),
    })),
    skips: (r.skips || []).map(k => ({ ...k })),
  }
}

// 2 つの分解が同じか（本文と出どころだけを見る）
export function sameDecomposition(a, b) {
  const key = d => JSON.stringify([
    (d.reqs || []).map(q => [q.text, q.from]),
    (d.skips || []).map(k => [k.skip, k.why]),
  ])
  return key(a) === key(b)
}

// 判定した段の成果物だけを evidence の引用元として認める
function allowFilesFor(e) {
  const t = safeTier(e.to)
  return t?.sources?.length ? t.sources : null
}
function safeTier(id) { try { return tier(id) } catch { return null } }

const COVERAGE = join(ROOT, '.claude', 'coverage')
const EDGES = join(COVERAGE, 'edges')
const ANSWERS = join(COVERAGE, 'answers')
const UNITS = join(COVERAGE, 'units')

export const VERDICTS = ['一致', '部分', '不一致', '陳腐化', '申し送り先が不在', '対応先が誤り', '対象外']

// 判定役に毎回渡す制約。**1 か所にだけ置く。**
// 2 か所に同じ文字列を書いていたので、片方だけ直すと同じ判定が 2 通りの制約で動く。
//
// 「読み替えの表」の段（2026-09-21 追加）:
//   実測。上位（要件定義書 4.5/4.6 節）が iPhone 版の形で書かれ、下位（PC 版基本設計）が
//   1 節に「PC版での翻訳」表を持っていた。**表は「ボトムシート → 非モーダルのドッキングパネル」まで
//   書いており、例としてミキサー・パート管理・チューニング設定を名指ししていた。**
//   それでも判定役ごとに答えが割れ、同じ 121 行目の
//     「ノートを**長押し**して削除できること」→ 一致（03:15 の表を引用）
//     「ノートを**タップ**して削除できること」→ 不一致
//   が同居した。同じ表の同じ行が根拠になる 2 件が、逆の判定になっている。
//   **表を開いた判定役だけが一致を出していた。** 開かなかった側は
//   「上位の言葉どおりの記述が下位に無い」で不一致・対象外にした。
//   だから「探せ」を制約に入れる。
const JUDGE_NOTE_BASE =
  '下位を実際に開いて読み、意味で突き合わせる。目次や「反映済み」の記述を根拠にしない。'
  + ' **上位が下位と違う前提の言葉で書かれているとき**（別プラットフォーム・別フェーズ・別の操作手段など）は、'
  + '下位に**読み替えの表・対応表**が無いかを先に探すこと。在れば、**読み替えた形**が下位に在るかで判定する。'
  + ' **「上位の言葉どおりの記述が無い」は、対象外にする理由になりません。**'
  + ' 対象外にしてよいのは、**読み替え先が下位のどこにも無い**ときだけです。'

// プロジェクト固有の言い足しは project.json の judgeNote に書く。
// **道具側に文書名を埋めない。** 別のプロジェクトへ持っていくときに書き換えるのは project.json だけ。
function judgeNote(extra = '') {
  const own = String((config() || {}).judgeNote || '').trim()
  return JUDGE_NOTE_BASE + (own ? ' ' + own : '') + (extra || '')
}


// ── 判定のあとの「どちらを直すか」──────────────────────────────────
// 判定は「下位に降りているか」しか答えない。降りていなかったとき、
// **上位が古いのか下位が足りないのか**は別の問いで、人が決める。
// その判断を台帳の要求そのものに持たせる。
//
// なぜ台帳に置くか（実測 2026-09-19）:
//   146 件ぶんの分類を受け渡し用の Markdown に置いたところ、**毎ターン上書きされる場所**
//   だったために危うく消えるところだった。作業用ディレクトリの残骸から復旧できたのは偶然。
//
// 台帳に置くと、もう 1 つ性質が手に入る。**上位を直せばその単位は陳腐化して消え、
// 分類も一緒に消える。** 直したのに古い分類が残る、という腐り方をしない。
// 別ファイルに reqId で持たせると、消えた要求の分類だけが生き残る。
export const PLANS = ['上位を直す', '下位を直す', 'スコープ外', '判断できない']

// ── 要求 ID の印（v28 T4）────────────────────────────────────────────────
// 詳細設計を基本設計から作り直すとき、要求を満たす段落・表の行に
//   <!-- req 08:25bad510.7bd1 -->
// の形で印を付ける（本人決定 turn 68→69：HTML のコメント）。
// **印は判定役が「どこを読めばよいか」を知るための手がかりで、根拠ではない。**
// 根拠は今までどおり本文の逐語で取る。印だけ付いて中身が無い、は判定で見つける。
//
// 形：<章>:<単位の hash 8 桁>[~<同じ hash の何番目>].<要求の鍵 4 桁>[-<同じ中身の何番目>]
// 要求の ID（…/08_error_logging.md:25bad510~0#k7bd152053187）から機械で作る。
// 上位の文が変われば単位の hash も要求の鍵も変わるので、古い印は「行き先の無い印」として数えられる。
export const TAG_RE = /<!--\s*req\s+([^>]*?)\s*-->/g
export const TAG_TOKEN_RE = /^[^\s:]+:[0-9a-f]{1,8}(?:~\d+)?\.[0-9a-f]{4,12}(?:-\d+)?$/
export function tagOfEntryId(entryId, len = 4) {
  const id = String(entryId)
  const cut = id.lastIndexOf('#')
  const unitId = cut >= 0 ? id.slice(0, cut) : id
  const km = id.slice(cut + 1).match(/^k([0-9a-f]+)(?:\.(\d+))?$/)
  if (!km) return null
  const c2 = unitId.lastIndexOf(':')
  const file = c2 >= 0 ? unitId.slice(0, c2) : unitId
  const [h = '', n = '0'] = (c2 >= 0 ? unitId.slice(c2 + 1) : '').split('~')
  const base = file.split('/').pop().replace(/\.md$/i, '')
  const chap = (base.match(/^(\d+)/) || [])[1] || base.replace(/[^A-Za-z0-9_]/g, '')
  return `${chap}:${h.slice(0, 8)}${n && n !== '0' ? '~' + n : ''}.${km[1].slice(0, len)}${km[2] ? '-' + km[2] : ''}`
}
// 段の全要求の印を作る。**4 桁が重なったものは、重なった分だけ鍵を全桁にする。**
export function edgeTags(m) {
  const rows = []
  for (const r of m.values()) {
    if (!Array.isArray(r.reqs)) continue
    for (const x of entriesOf(r)) if (x.kind === 'req') rows.push({ r, x, tag: tagOfEntryId(x.id) })
  }
  const count = new Map()
  for (const w of rows) count.set(w.tag, (count.get(w.tag) || 0) + 1)
  for (const w of rows) if (count.get(w.tag) > 1) w.tag = tagOfEntryId(w.x.id, 12)
  const byId = new Map(rows.map(w => [w.x.id, w]))
  const byTag = new Map(rows.map(w => [w.tag, w]))
  return { rows, byId, byTag }
}
// 下位の文書から印を拾う。行番号つき。
export function scanTags(files) {
  const found = [], broken = []
  for (const f of files) {
    let text = ''
    try { text = readRel(f) } catch { continue }
    const lines = text.split('\n')
    lines.forEach((ln, i) => {
      for (const mm of ln.matchAll(TAG_RE)) {
        const toks = String(mm[1]).split(/[\s,、]+/).filter(Boolean)
        if (!toks.length) broken.push({ file: f, line: i + 1, raw: mm[0] })
        for (const t of toks) (TAG_TOKEN_RE.test(t) ? found : broken).push({ file: f, line: i + 1, tag: t, raw: mm[0] })
      }
    })
  }
  return { found, broken }
}

// 仕分けの場で使っていた言い回しも受ける。表記ゆれで弾かれるほうが害が大きい。
const PLAN_ALIAS = { 'どちらでもない（スコープ）': 'スコープ外', 'どちらでもない': 'スコープ外', 'スコープ': 'スコープ外' }

export function edgeId(e) { return `${e.from}->${e.to}` }
function edgeFile(id) { return join(EDGES, id.replace('->', '-') + '.jsonl') }
function answerFile(id) { return join(ANSWERS, id.replace('->', '-') + '.jsonl') }

// 本人の答えは**原文の本文**に紐づける。entryId ではない。
//
// なぜか: 答えを適用すると、その行は書き換わる。書き換わった行は再分割で
// 別の単位になり、entryId は消える。**entryId に紐づけると、適用した瞬間に
// 答えの記録が迷子になる。**
//
// 本文ハッシュなら逆の性質が手に入る:
//   原文がまだ在る → まだ適用していない
//   原文が消えた   → 適用済み
// **申告ではなく、原文が残っているかどうかで適用済みが決まる。**
export function sourceKeyOf(text) { return hash12(`ask\u0000${String(text || '')}`) }

export function loadAnswers(id) {
  const f = answerFile(id)
  const m = new Map()
  if (!existsSync(f)) return m
  for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l); m.set(r.key, r)
  }
  return m
}
function saveAnswers(id, m) {
  if (!existsSync(ANSWERS)) mkdirSync(ANSWERS, { recursive: true })
  const tmp = answerFile(id) + `.tmp${process.pid}`
  writeFileSync(tmp, [...m.values()].map(r => JSON.stringify(r)).join('\n') + '\n')
  renameSync(tmp, answerFile(id))
}


// 本人に聞くことを集める。**ask / ask-record / ask-report が同じものを見るため関数にしてある。**
// 別々に数えると、聞いた件数と記録した件数がずれる（踏んだ罠 3 と同じ型）。
export function askGroups(edge, inScope = () => true) {
  const m = loadEdge(edgeId(edge))
  const items = []
  for (const r of [...m.values()].filter(inScope)) {
    if (!Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      const a = entryApproval(en)
      if (a.state !== '保留' && a.state !== '指摘') continue
      // **実際に台帳を止めている断片だけを集める。**
      //   保留 … 承認する側が「判断できない」と答えた。定義上ここに来る
      //   指摘 … **断片そのもの**に未閉鎖の列挙があるものだけ
      //
      // 原文全体に inspect を掛けると「受入条件が無い」が広く当たり、
      // 実測で 15 件のはずが 45 件になった。**当たっていない質問を混ぜると、
      // 質問そのものが読まれなくなる。** 聞くのは詰まっている断片に限る。
      //
      // 指摘の引き金を「未閉鎖の列挙」だけに絞った理由（実測 2026-09-16）:
      //   「数値のない閾値」は THRESHOLD_WORD が語形だけで当たるので、
      //   閾値を語っていない文にも当たる。実際に出たのは
      //     L271「隙間時間でコツコツ進める」   … 「時間」に当たった
      //     L318「以下の理由からElectronを選択」 … 「以下」に当たった
      //   どちらも本人に聞くことが無い。**当たっていない質問を 2 件混ぜると、
      //   残り 12 件も同じ目で読まれる。** 閾値の不足は judge 側で拾う。
      const found = a.state === '保留' ? inspect(r.text) : inspect(en.span)
      if (a.state === '指摘' && !found.some(f => f.kind === '未閉鎖の列挙')) continue
      items.push({ entryId: en.id, file: r.file, line: r.line, section: r.section,
                   source: r.text, span: en.span,
                   as: en.kind === 'req' ? '要求' : '対象外', wrote: en.text,
                   state: a.state, resolvesBy: a.approval?.resolvesBy || null,
                   findings: found })
    }
  }
  // 同じ行から複数の断片が出ることがある。**行でまとめる**——本人は行を直すので。
  const byLine = new Map()
  for (const x of items) {
    const k = `${x.file}:${x.line}`
    if (!byLine.has(k)) byLine.set(k, { ...x, entryIds: [], spans: [] })
    const g = byLine.get(k); g.entryIds.push(x.entryId); g.spans.push(x.span)
  }
  // 見出しは**機械が作る。** 質問ツールの header は 12 文字までなので、そこに収める。
  // AI に考えさせると、聞いている対象と見出しがずれても誰も気づかない。
  const groups = [...byLine.values()].map(g => ({
    ...g, key: sourceKeyOf(g.source),
    header: `L${g.line} ${String(g.section || '').split(' > ').pop().replace(/^[0-9.]+ */, '')}`.slice(0, 12).trim(),
  }))
  return { items, groups }
}

// 原文から 12 文字以上の逐語が質問に含まれているか。
// CLAUDE.md の引用規約（12 文字以上）と同じ長さに揃えてある。
export function quotesVerbatim(source, question, minLen = 12) {
  const src = String(source || ''), q = String(question || '')
  if (!src || !q) return false
  if (src.length < minLen) return q.includes(src)
  for (let i = 0; i + minLen <= src.length; i++) if (q.includes(src.slice(i, i + minLen))) return true
  return false
}

// 答えを記録してよいかの検査。**通ったものだけが記録に残る。**
//
// 何を見ていて、何を見ていないか:
//   見る   未閉鎖の列挙 … 実測で 2 回やられた。L80「DADGADやFAG・・・など」、
//                        L123「アーティスト名なども」。**答えの側にも「など」が入る。**
//                        人間が気づいたから聞き直せただけで、機械は見ていなかった。
//   見る   質問が原文を逐語で引いているか … rules/core.md §2「矛盾は逐語引用する」と同型
//   見る   答えが質問の写しでないか
//   見ない 未定義の程度（「適切に」等）… 「必要に応じて独自プリセットを追加できる」の
//          ような**正しい答え**にも当たる。実測の裏付けが無いまま足すと過剰検出になり、
//          検査そのものが信用されなくなる（wording.mjs の F21）。
export function checkAnswer(source, question, answer) {
  const bad = []
  const a = String(answer || '').trim(), q = String(question || '').trim()
  if (!a) bad.push('答えが空です。')
  if (!q) bad.push('質問が空です。**何を聞いたかが残らないと、後で答えの意味が読めません。**')
  // 自前で数えない。**数え方は lib/wording.mjs の 1 か所だけ**（2026-09）。
  const enums = openEnumWords(a)
  if (enums.length) bad.push(
    `答えに「${enums.join('」「')}」が入っています。**閉じたつもりで閉じていません。**\n` +
    `    中身を全部挙げてもらうか、「これ以外は対象外」と言い切ってもらってください。`)
  if (q && !quotesVerbatim(source, q)) bad.push(
    '質問が原文を逐語で引いていません（12 文字以上）。\n' +
    '    原文を見せずに聞くと、本人は何について答えているか分かりません（rules/core.md §2）。')
  if (a && q && a === q) bad.push('答えが質問と同じです。')
  return bad
}

function readUnits(tierId) {
  const p = join(UNITS, `${tierId}.jsonl`)
  if (!existsSync(p)) throw new Error(`units/${tierId}.jsonl がありません。先に split.mjs を実行してください。`)
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

export function loadEdge(id) {
  const p = edgeFile(id)
  if (!existsSync(p)) return new Map()
  const m = new Map()
  readFileSync(p, 'utf8').split('\n').filter(Boolean).forEach(l => {
    const r = JSON.parse(l); m.set(r.unitId, r)
  })
  return m
}

// ── 台帳の書き込みは 1 プロセスずつ ────────────────────────────────────
//
// decompose / judge / approve / rebut / concede はどれも
// **jsonl を丸ごと読んで、1 か所だけ書き換えて、丸ごと書き戻す。**
// 排他が無いと、同時に走った 2 つのうち後に書いたほうが前の変更を消す。
//
// 実測（2026-09-16）: 20 件を同時に approve したところ、**3 件しか残らなかった。**
// ワークフローの書き戻し段が複数コマンドを並列に実行すると必ず起きる。
//
// decompose で表に出なかったのは、coverage が未分解が無くなるまで回し続けるので
// **消えた分を勝手に拾い直していた**から。**ループが不具合を隠していた。**
// approve は失敗した断片を除外して先へ進むので、そこで初めて見えた。
const heldLocks = new Set()
process.on('exit', () => { for (const p of heldLocks) { try { unlinkSync(p) } catch { /* 既に消えていてよい */ } } })

function sleepMs(ms) {
  // 同期的に待つ。ここは CLI の 1 コマンドなので非同期にする意味が無い。
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { const t = Date.now(); while (Date.now() - t < ms) { /* 最後の手段 */ } }
}

export function lockEdge(id, timeoutMs = 60_000) {
  if (!existsSync(EDGES)) mkdirSync(EDGES, { recursive: true })
  const lock = edgeFile(id) + '.lock'
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fd = openSync(lock, 'wx')   // 既にあれば EEXIST。**これが排他の本体。**
      closeSync(fd)
      heldLocks.add(lock)
      return lock
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      // 落ちたプロセスが残したロックは、十分古ければ奪う。
      try { if (Date.now() - statSync(lock).mtimeMs > 120_000) { unlinkSync(lock); continue } } catch { continue }
      if (Date.now() > deadline) {
        throw new Error(`台帳 ${id} のロックを ${Math.round(timeoutMs / 1000)} 秒待っても取れませんでした。\n` +
          `  他のコマンドが書き込み中か、${lock} が残っています。\n` +
          `  **書き込まずに終わります。** 消えた変更はありません。`)
      }
      sleepMs(20 + Math.floor(Math.random() * 60))
    }
  }
}
export function unlockEdge(lock) {
  if (!lock) return
  try { unlinkSync(lock) } catch { /* 既に消えていてよい */ }
  heldLocks.delete(lock)
}

function saveEdge(id, map) {
  if (!existsSync(EDGES)) mkdirSync(EDGES, { recursive: true })
  // **一時ファイルへ書いてから差し替える。** 途中で落ちても台帳が欠けた状態にならない。
  const tmp = edgeFile(id) + `.tmp${process.pid}`
  writeFileSync(tmp, [...map.values()].map(r => JSON.stringify(r)).join('\n') + '\n')
  renameSync(tmp, edgeFile(id))
  recordOp(id)
}

// ── 台帳への書き込みを、すべて記録する ─────────────────────────────────
// 実測（2026-09-24、turn 54）: 承認のワークフローの「書き戻し役」（コマンドを上から打つだけの役）が、
// 台本に無い `rebut` 4 件・`concede` 1 件を打ち、ゴールと報告まで書き換えた。
// **台帳には「誰がいつどのコマンドで書いたか」が残っておらず**、後から拾えたのは
// エージェントの記録（jsonl）を人が読んだからだった。
// 書き込みの経路は saveEdge 1 か所なので、ここで必ず 1 行残す。
// **何を書いたかは台帳が持っている。ここは「どのコマンドで書いたか」だけ。**
export const OPS_FILE = join(ROOT, '.claude', 'state', 'ledger-ops.jsonl')
function recordOp(edge) {
  try {
    mkdirSync(join(ROOT, '.claude', 'state'), { recursive: true })
    const argv = process.argv.slice(2)
    appendFileSync(OPS_FILE, JSON.stringify({
      at: new Date().toISOString(),
      cmd: invokedDirectly ? String(argv[0] || '') : '(import)',
      edge,
      args: argv.slice(1).map(a => String(a).slice(0, 120)),
      tty: !!(process.stdin && process.stdin.isTTY),
      pid: process.pid, ppid: process.ppid,
    }) + '\n')
  } catch { /* 記録に失敗しても台帳の書き込みは済んでいる。ops の件数のずれで気づける */ }
}
export function readOps() {
  if (!existsSync(OPS_FILE)) return []
  return readFileSync(OPS_FILE, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return { broken: l.slice(0, 80) } } })
}

// ── 本文が変わっても本人待ちを落とさない（v29 T7）──────────────────────────
// 実測（2026-09-25、turn 70）: 基本設計の書き損じ（「詳細設計旧詳細設計」）を直したら、その段落の
// 単位が陳腐化し、分解し直した新しい断片には前の本人待ちが付かなかった。承認し直したら通ってしまい、
// **本人の判断を待っていた 1 件が、本人を通らずに消えた。** v28 T3 は「中身が同じ断片」しか見ていない。
// 本文が変わったときは、前の本人待ちを**単位に**残し（staleHolds）、本人が release-hold で外すまで数える。
// 単位そのものが消えたときは、消えた単位の本人待ちを別のファイルに残す（同じく本人が外すまで数える）。
export const ORPHAN_HOLDS = join(ROOT, '.claude', 'coverage', 'orphan-holds.jsonl')
function holdsOfUnit(r) {
  const out = [...(Array.isArray(r?.staleHolds) ? r.staleHolds : [])]
  if (!Array.isArray(r?.reqs)) return out
  for (const e of entriesOf(r)) {
    if (entryApproval(e).state !== '本人待ち') continue
    out.push({ holdId: hash12(`${r.unitId}\u0000${e.id}\u0000${e.node.hold?.at || ''}`), fromUnit: r.unitId, file: r.file, line: r.line,
      kind: e.kind, span: e.span, text: e.text, hold: e.node.hold, approval: e.node.approval, second: e.node.second,
      carriedAt: new Date().toISOString() })
  }
  return out
}
export function readOrphanHolds(edge) {
  if (!existsSync(ORPHAN_HOLDS)) return []
  return readFileSync(ORPHAN_HOLDS, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return null } }).filter(x => x && (!edge || x.edge === edge))
}
function writeOrphanHolds(all) {
  mkdirSync(join(ROOT, '.claude', 'coverage'), { recursive: true })
  writeFileSync(ORPHAN_HOLDS, all.map(x => JSON.stringify(x)).join('\n') + (all.length ? '\n' : ''))
}

// 上位 tier の units を土台に、台帳の骨格を作る（既存の判定は保持する）
export function sync(edge) {
  const id = edgeId(edge)
  const _lock = lockEdge(id)
  try { return syncLocked(edge, id) } finally { unlockEdge(_lock) }
}
function syncLocked(edge, id) {
  // internal（private メンバー・未 export のモジュール内部）は分母に入れない。
  // （ここから下はロックの中）
  // 外へ出していないものに「下位へ降りているか」を問うても判定できず、
  // 未判定件数だけが増えて数字の意味が薄れる。units ファイルには残るので見える。
  const units = readUnits(edge.from).filter(u => u.minReq > 0 && !u.internal)
  const cur = loadEdge(id)
  const next = new Map()

  // 引き継ぎの索引を 3 つ持つ。
  //   byId     … 本文が同じ（行が動いただけ）→ そのまま引き継ぐ
  //   byAnchor … 位置は同じで本文が変わった  → 判定を落として「要再判定」にする
  //   byLegacy … v22 の id（file:line:hash6）→ file:hash6 で寄せて移行する
  // v22 は byId しか無く、しかも id に行番号が入っていたので、
  // **上位に 1 行足すだけで判定が全部消えていた**（実測 25 件）。
  const byId = new Map(), byAnchor = new Map(), byLegacy = new Map()
  for (const r of cur.values()) {
    byId.set(r.unitId, r)
    if (r.anchor) byAnchor.set(r.anchor, r)
    const k = `${r.file}:${String(r.hash || '').slice(0, 6)}`
    if (!byLegacy.has(k)) byLegacy.set(k, [])
    byLegacy.get(k).push(r)
  }
  const used = new Set()
  const carry = r => { used.add(r.unitId); return r }

  let kept = 0, stale = 0, fresh = 0

  // **本文一致を全件先に取る。位置での拾い直しはその後。**
  //
  // 1 つのループで「id → anchor → 新規」と落としていくと、挿入された 1 行が
  // **次の行の anchor を先に取ってしまう。** 取られた行は自分の id が既に
  // used なので、さらに次の anchor へ流れる——**1 行の挿入が、以降の行を
  // 全部「位置は同じで本文が変わった」に落とす。**
  //
  // 実測（2026-09-17）: 表の途中に 1 行挿入したら、本文が変わっていない 22 行まで
  // 陳腐化して作り直しになった（想定 8 件 → 実際 24 件）。
  // 設計フェーズは文書に行を挿入し続ける作業なので、これは日常的に起きる。
  //
  // anchor は「同じ場所の本文が変わった」を捕まえるための鍵で、
  // **本文が一致する行に対して使う理由は無い。** だから 2 周に分ける。
  const idMatch = new Map()
  for (const u of units) {
    let prev = byId.get(u.id)
    if (!prev || prev.hash !== u.hash) {
      const cands = (byLegacy.get(`${u.file}:${String(u.hash).slice(0, 6)}`) || [])
        .filter(r => !used.has(r.unitId) && r.hash === u.hash)
      prev = cands[0] || null
    }
    if (prev && prev.hash === u.hash && !used.has(prev.unitId)) { carry(prev); idMatch.set(u.id, prev) }
  }

  // 組み立ては**文書順**で。台帳の行順が入れ替わると、差分が読めなくなる。
  for (const u of units) {
    // 1. 本文が同じ
    const prev = idMatch.get(u.id)
    if (prev) {
      kept++
      next.set(u.id, { ...prev, unitId: u.id, anchor: u.anchor,
                       line: u.line, section: u.section, label: u.label,
                       text: u.text, minReq: u.minReq, flags: u.flags })
      continue
    }

    const base = {
      unitId: u.id, anchor: u.anchor, hash: u.hash, file: u.file, line: u.line, kind: u.kind,
      section: u.section, label: u.label, text: u.text, minReq: u.minReq, flags: u.flags,
    }

    // 2. 位置は同じで本文が変わった
    const at = u.anchor ? byAnchor.get(u.anchor) : null
    if (at && !used.has(at.unitId)) {
      carry(at); stale++
      next.set(u.id, {
        ...base,
        // **判定は落とす。** 上位の本文が変わったなら、そこから降ろした要求も
        // 導き直さなければならない。ただし前の分解と判定は参照用に残す
        // （捨てると、何がどう変わったのかを後から追えなくなる）。
        // **分解し直す前にもう一度変わったときは、最後に分解した版を参照に残す。**（v31 T12）
        // 実測（2026-09-26、turn 72）: 01:79 を 2 回直す間に分解し直さなかったら、2 回目の sync で
        // 「前の分解」が中間の版（分解していない＝reqs が null）に置き換わり、前の要求 2 件が
        // stalePrevReqs から落ちた。stale-diff にも出ず、**前の要求が黙って消えた。**
        ...(Array.isArray(at.reqs) || !at.staleFrom
          ? { staleFrom: at.hash, staleText: at.text, stalePrevReqs: Array.isArray(at.reqs) ? at.reqs : undefined }
          : { staleFrom: at.staleFrom, staleText: at.staleText, stalePrevReqs: at.stalePrevReqs }),
        staleAt: new Date().toISOString(),
        ...(holdsOfUnit(at).length ? { staleHolds: holdsOfUnit(at) } : {}),
        reqs: null,
      })
      continue
    }

    // 3. 新規
    fresh++
    next.set(u.id, { ...base, reqs: null })
  }
  // 消えた単位の本人待ちは、別のファイルに残す（v29 T7）。**黙って消さない。**
  {
    const lost = []
    for (const r of cur.values()) if (!used.has(r.unitId)) for (const h of holdsOfUnit(r)) lost.push({ ...h, edge: id, lostAt: new Date().toISOString() })
    if (lost.length) {
      const all = readOrphanHolds(null)
      const have = new Set(all.map(x => `${x.edge}\u0000${x.holdId}`))
      writeOrphanHolds([...all, ...lost.filter(x => !have.has(`${x.edge}\u0000${x.holdId}`))])
      console.error(`△ 本人待ちを持っていた単位が ${lost.length} 件ぶん消えました。本人待ちとして残しています（release-hold で本人が外すまで数えます）。`)
    }
  }
  // 兄弟エッジが既に分解している単位は、ここで引き継ぐ。
  // decompose 時の伝播だけだと、**後から作ったエッジ**が空のままになる。
  let inherited = 0
  const sibMaps = siblingEdges(edge).map(sib => { try { return loadEdge(edgeId(sib)) } catch { return null } }).filter(Boolean)
  if (sibMaps.length) {
    for (const r of next.values()) {
      if (Array.isArray(r.reqs)) continue
      for (const sm of sibMaps) {
        const sr = sm.get(r.unitId)
        if (!sr || sr.hash !== r.hash || !Array.isArray(sr.reqs)) continue
        const d = decompositionOf(sr)
        r.reqs = d.reqs
        if (d.skips.length) r.skips = d.skips; else delete r.skips
        delete r.staleFrom
        inherited++
        break
      }
    }
  }
  saveEdge(id, next)
  const st = stats(edge, next)
  return { ...st, carried: kept, staled: stale, added: fresh, inherited }
}

export function stats(edge, map = null) {
  const id = edgeId(edge)
  const m = map || loadEdge(id)
  const rows = [...m.values()]
  const decomposed = rows.filter(r => Array.isArray(r.reqs))
  const allReqs = decomposed.flatMap(r => r.reqs)
  const judged = allReqs.filter(q => q.verdict)
  const byVerdict = {}
  judged.forEach(q => byVerdict[q.verdict] = (byVerdict[q.verdict] || 0) + 1)
  const stale = rows.filter(r => r.staleFrom)
  // 「未判定 0 だから完了」ではない。一度も分解していない台帳も未判定 0 になる。
  // 着手前と完遂を区別しないと、セッション冒頭に自動注入される status で
  // 「台帳は済んでいる」と読めてしまう（偽の緑）。
  // humanJudged: true の段（要件 → 受入シナリオ）は、人が判定した記録が無い限り完了にしない。
  // 以前は humanJudged をラベル表示するだけで、AI の判定だけで「完了」に到達できた。
  // HOWTO の「最後の項目は AI が埋められません」が台帳側では嘘だった。
  // humanJudged の 2 段階。project.json に "partial" と書いてあるのに
  // ledger は === true しか見ておらず、bd->system は AI の判定だけで完了できていた。
  //   true    … 判定はすべて人が行う（要件 → 受入シナリオ）
  //   partial … AI が判定してよいが、**人が 1 件も見ていない段は完了にしない**
  const humanPending = edge.humanJudged === true
    ? judged.filter(q => q.by !== 'human').length
    : edge.humanJudged === 'partial'
      ? (judged.length && !judged.some(q => q.by === 'human') ? 1 : 0)
      : 0
  // 承認（③）。**既定では完了を止めない。**
  // 止めるかどうかは project.json の edge ごとの requireApproval で決める。
  // 最初から止めると、承認がどのくらい当たるかを測る前に作業が止まる。
  // まず全部に回して当たり方を測り、それから止める側に倒す——という順番にしている。
  const ap = approvalCounts(rows)
  const approvalPending = edge.requireApproval ? ap.unresolved : 0
  // 通し直したが、前の分解と見比べて「消えてよい」と確かめていない単位。
  // 実測（2026-09-23、turn 47）: req->bd は全件判定済みで「完了」と出ていたが、
  // 前の要求が消えたことを誰も確かめていない単位が 25 残っていた（うち要求が 0 件になったもの 3）。
  // **分母から要求が黙って落ちる**のを見つける仕組み（stale-diff）が、完了の条件に入っていなかった。
  const recutPending = rows.filter(r => Array.isArray(r.stalePrevReqs) && Array.isArray(r.reqs)).length
  // 順番に意味がある。**承認は判定より先。**
  //   分解が残っている        → 進行中（まず分母を固定する）
  //   承認が未解決            → 承認待ち（**判定より先に決着させる**）
  //   判定が残っている        → 進行中
  // 承認を判定の後ろに置くと、承認で落ちる断片を先に判定することになり、
  // その判定は捨てることになる。そのうえ**水増しされた分母の上に「判定済」が積み上がる**——
  // 数字が増えるほど直しにくくなる方向なので、先に決着させる。
  const state =
    rows.length === 0                              ? '未初期化'
    : decomposed.length === 0                       ? '未着手'
    : (rows.length - decomposed.length) > 0         ? '進行中'
    : approvalPending > 0                           ? '承認待ち'
    : (allReqs.length - judged.length) > 0          ? '進行中'
    : recutPending > 0                              ? '前後確認待ち'
    : humanPending > 0                              ? '人間判定待ち'
    : '完了'
  return {
    edge: id, kind: edge.kind, humanJudged: edge.humanJudged || false, state, humanPending, recutPending,
    requireApproval: edge.requireApproval === true, approval: ap, approvalPending,
    units: rows.length,
    unitsDecomposed: decomposed.length,
    unitsUndecomposed: rows.length - decomposed.length,
    requirements: allReqs.length,
    // 「要求ゼロ」と宣言された単位。**逃げ道は用意するが、必ず数える。**
    // これを数えないと、全単位を要求ゼロにした台帳が「完了」と表示される。
    unitsNoRequirement: decomposed.filter(r => r.reqs.length === 0).length,
    skips: decomposed.reduce((n, r) => n + ((r.skips || []).length), 0),
    judged: judged.length,
    unjudged: allReqs.length - judged.length,
    stale: stale.length,
    byVerdict,
    problems: (byVerdict['部分'] || 0) + (byVerdict['不一致'] || 0) + (byVerdict['陳腐化'] || 0)
            + (byVerdict['申し送り先が不在'] || 0) + (byVerdict['対応先が誤り'] || 0),
  }
}

export function allStats() {
  return (config().edges || []).map(e => {
    // 例外の中身を捨てて「split.mjs 未実行」と決め打ちしない。
    // stats() は units を読まない（loadEdge は台帳が無ければ空 Map を返し、
    // その場合は例外にならず「未初期化」になる）。つまりここへ来る時点で原因は
    // 別のもの——台帳 JSONL の破損など——であり、固定文言は必ず嘘になる。
    try { return stats(e) } catch (err) { return { edge: edgeId(e), state: '不明', error: `台帳を読めません: ${err.message}` } }
  })
}

// 表示用の記号と整形。
// **コマンド分岐より前に置くこと。** const は巻き上げられても TDZ に入るので、
// 分岐の中から fmt() を呼ぶと「Cannot access 'MARK' before initialization」で落ちる。
// `--json` を付けない `ledger.mjs stats` / `sync`——HOWTO が毎日打つコマンドとして
// 載せているもの——が、配布物のまま一度も動いていなかった。
export const MARK = { '未初期化': '!', '未着手': '!', '進行中': '·', '承認待ち': '!', '前後確認待ち': '!', '人間判定待ち': '!', '完了': '✓', '不明': '?' }

function fmt(s) {
  if (s.error) return `${s.edge.padEnd(14)} ${s.error}`
  const human = s.humanJudged === true ? ' [全件を人が判定]' : s.humanJudged === 'partial' ? ' [人の判定が最低1件必要]' : ''
  const inh = s.inherited ? `  同じ上位段から引き継ぎ ${s.inherited}` : ''
  const hint = s.state === '未初期化' ? '  ← split.mjs / ledger sync が未実行'
             : s.state === '未着手'   ? '  ← 一度も分解していない'
             : s.state === '承認待ち' ? `  ← 未承認・指摘・保留が ${s.approvalPending} 件。approve / rebut で決着させるまで完了にならない`
             : s.state === '前後確認待ち' ? `  ← 通し直した単位のうち、前の分解と見比べていないものが ${s.recutPending} 件。stale-diff で前後を読み、--ack するまで完了にならない`
             : s.state === '人間判定待ち' ? `  ← AI 判定のみ ${s.humanPending} 件。judge --human で人が記録するまで完了にならない`
             : ''
  // 「要求ゼロ」は逃げ道なので、**あるときは必ず目に入る位置に出す**。
  const none = s.unitsNoRequirement ? `  要求ゼロ ${s.unitsNoRequirement}` : ''
  // 承認は既定で完了を止めないので、**数字だけは必ず出す**。
  // 出さないと「機構はあるが誰も見ていない」状態が緑のまま続く。
  const a = s.approval
  const appr = !a || !a.entries ? ''
    : `  承認 ${a.ok}/${a.entries}` + (a.challenged ? `  指摘 ${a.challenged}` : '')
      + (a.deferred ? `  保留 ${a.deferred}` : '') + (a.heldOver ? `  反論で維持 ${a.heldOver}` : '')
  return `${MARK[s.state] || ' '} ${s.edge.padEnd(14)} ${String(s.state).padEnd(5)} 単位 ${String(s.units).padStart(5)}  要求 ${String(s.requirements).padStart(5)}  判定済 ${String(s.judged).padStart(5)}  未判定 ${String(s.unjudged).padStart(5)}  不一致等 ${String(s.problems).padStart(4)}${none}${appr}${inh}${s.stale ? `  陳腐化 ${s.stale}` : ''}${human}${hint}`
}

// ── コマンド（直接実行されたときだけ）───────────────────────────────────
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [, , cmd0, ...rest] = process.argv
const cmd = invokedDirectly ? cmd0 : undefined
const args = rest.filter(a => !a.startsWith('--'))
const opt = name => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : null }

// ── 本人のコマンドは、本人の端末からしか打てない ─────────────────────────
// 実測（2026-09-24、turn 54）: 承認のワークフローの書き戻し役が `concede` を打った。
// 「本人がターミナルで打つ」は約束でしかなく、止める仕組みが無かった。
// Claude Code のシェル（Bash ツール）は端末に繋がっていないので、stdin が TTY にならない。
// **本人が PowerShell / コマンドプロンプトで打てば TTY になる。** これで見分ける。
//   - uphold（承認を覆して要求として残す）は常に本人
//   - concede は「本人待ち」の断片に対してだけ本人（指摘への同意は分解した側の安い経路なので残す）
// smoke は非対話で回すので、環境変数で外す。**AI がこの変数を付けて打つのはゲートが止める。**
function requireHumanTerminal(what) {
  if (process.stdin && process.stdin.isTTY) return
  if (process.env.CLAUDE_LEDGER_ALLOW_NON_TTY === '1') return
  console.error(`${what} は本人のコマンドです。本人が端末（PowerShell / コマンドプロンプト）から打ってください。`)
  console.error('  Claude Code のシェルからは打てません（端末に繋がっていないため）。')
  console.error('  Git Bash（mintty）では端末と判定されないことがあります。その場合は PowerShell で打ってください。')
  process.exit(1)
}

// 範囲の絞り込み。既定は全件で、指示があったときだけ狭める。
function scopeFilter() {
  const file = opt('file'), section = opt('section')
  return r => (!file || r.file.includes(file)) && (!section || (r.section || '').includes(section))
}
function limitOf(raw) {
  if (raw === undefined || raw === null || raw === 'all' || raw === '') return Infinity
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : Infinity
}

const APPROVE_CRITERION = '下位の文書に書かれていなければ、不備といえること。'
const APPROVE_NOTE =
  '断片ごとに「これは要求か」だけを答える。下位の文書は開かない' +
  '（開くと「下位に無いから要求でない」という逆立ちした判断になり、漏れが漏れでなくなる）。' +
  ' 「要求」と答えるときは、その要求が満たされたとき下位に現れるはずの一文（expect）を書くこと。**書けないなら要求ではない。**' +
  ' 分解した側がどう扱ったかは見えているが、それに合わせる必要はない。食い違いは記録されるだけで、どちらも消えない。' +
  ' `with`（含む）が付いている断片は、span と with を**合わせて 1 つの要求**として 1 回だけ答える（前置き・理由の句・表の左列の見出し語を、それが支える要求に含めたもの）。' +
  ' **with の中に、この要求とは別の要求が入っていたら「判断できない」と答え、resolvesBy に「含むから外して別の要求にする」と書くこと。**'

function approvePayloadOf(r, en) {
  return {
    entryId: en.id, file: r.file, line: r.line, section: r.section, label: r.label,
    source: r.text, span: en.span,
    ...(en.with && en.with.length ? { with: en.with } : {}),
    wrote: en.kind === 'req' ? { as: '要求', text: en.text } : { as: '対象外', why: en.text },
  }
}

// entryId（"<unitId>#3" / "<unitId>#s0"）から断片を引く。
// **最後の # で割る。** unitId 自体に # が混ざっても壊れないようにする。
function findEntry(e, entryId, map = null) {
  const m = map || loadEdge(edgeId(e))
  const cut = String(entryId).lastIndexOf('#')
  if (cut < 0) { console.error(`entryId は "<unitId>#<番号>" の形式です: ${entryId}`); process.exit(1) }
  const unitId = String(entryId).slice(0, cut)
  const r = m.get(unitId)
  if (!r) { console.error(`unitId ${unitId} が台帳にありません`); process.exit(1) }
  if (!Array.isArray(r.reqs)) { console.error(`${unitId} はまだ分解されていません。先に分解してください。`); process.exit(1) }
  // 新しい形（#k<鍵>）と、古い形（#<番号> / #s<番号>）の両方を受ける。
  // **古い形は添字なので、他の断片が動いていれば別のものに当たる。**
  // 受けはするが、当たった断片が何かを必ず出す——黙って別のものを直させない。
  const all = entriesOf(r)
  const id = String(entryId)
  let entry = all.find(x => x.id === id)
  if (!entry) {
    entry = all.find(x => x.legacyId === id)
    if (entry) {
      console.error(`※ ${id} は**配列の添字**の形式です。当たった断片: ${JSON.stringify(String(entry.span).slice(0, 40))}`)
      console.error(`   これでよければそのまま進みます。違うなら中身の鍵で指定してください: ${entry.id}`)
    }
  }
  if (!entry) { console.error(`${entryId} が台帳にありません`); process.exit(1) }
  return { map: m, r, entry }
}

// 範囲が空振りしていないか。
//
// **0 件は「もう無い」ではなく「数えていない」ことがある。**
// `--file` / `--section` が当たるのは**上位側**の文書で、下位側の章名を渡しても 1 件も当たらない。
// たとえば req->bd の上位は要件定義書 1 本なので、基本設計の章名（04_editing）を
// --file に渡すと静かに 0 件が返る（実際にそうなった）。
// 台帳の他の場所では `単位 0` を「漏れなし」と読ませない検査を入れてあるのに、
// 一覧系のコマンドだけ黙って空の配列を返していた。同じ型なので同じ扱いにする。
function scopeWarning(e, m, inScope) {
  const all = [...m.values()]
  const f = opt('file'), sec = opt('section')
  if (!all.length) {
    return `この段の台帳に単位が 1 件もありません。**0 件は「漏れなし」ではありません。**\n` +
           `  先に: node .claude/scripts/split.mjs --all → node .claude/scripts/ledger.mjs sync ${JSON.stringify(edgeId(e))}`
  }
  if (!f && !sec) return null
  if (all.filter(inScope).length) return null
  const files = [...new Set(all.map(r => r.file))]
  return `**範囲が空振りしています。**（--file ${JSON.stringify(f)} / --section ${JSON.stringify(sec)}）\n` +
    `  --file と --section が当たるのは**上位側（${e.from}）**の文書です。下位側（${e.to}）の章名では 1 件も当たりません。\n` +
    `  この段の上位にあるファイル: ${files.slice(0, 8).join(' / ')}${files.length > 8 ? ` …他 ${files.length - 8} 本` : ''}\n` +
    `  **0 件は「もう無い」ではなく「数えていない」です。**`
}

function findEdge(id0) {
  const id = String(id0 || '').replace(':', '->')
  const e = (config().edges || []).find(e => edgeId(e) === id)
  if (!e) {
    const known = (config().edges || []).map(edgeId).join(' / ')
    if (/->?$/.test(id) || !id.includes('->')) {
      throw new Error(`edge "${id0}" は不完全です。シェルで "req->bd" のように**引用符で囲んで**ください（裸の > はリダイレクトになり、末尾が消えます）。定義済み: ${known}`)
    }
    throw new Error(`edge "${id0}" は project.json に定義されていません。定義済み: ${known}`)
  }
  return e
}

if (cmd === 'sync') {
  const rows = args[0] ? [sync(findEdge(args[0]))] : config().edges.map(e => { try { return sync(e) } catch (err) { return { edge: edgeId(e), error: err.message } } })
  console.log(json ? JSON.stringify(rows, null, 2) : rows.map(fmt).join('\n'))
}

else if (cmd === 'ops') {
  // 台帳に書いたコマンドの記録を出す。**ワークフローのあとに本体が読む。**
  //   ops [--since <ISO>] [--expect approve,settle] [--json]
  // --expect を付けると、そこに挙げたコマンド以外の書き込みが 1 件でもあれば終了コード 1。
  // 実測（2026-09-24、turn 54）: 承認のワークフローの間に、台本に無い rebut / concede が打たれていた。
  // ワークフローを回している間、本体は台帳に書かない。**だからその間の書き込みは全部、台本どおりのはず。**
  const since = String(opt('since') || '')
  const expect = String(opt('expect') || '').split(',').map(x => x.trim()).filter(Boolean)
  const all = readOps()
  // **時刻は数として比べる。** 実測（2026-09-24、turn 55）: 記録は UTC（…Z）、渡したのは PC の時計（+09:00）。
  // 文字列で比べていたので 1 件も拾わず、**空のまま「想定外 0」で通った。**
  const sinceMs = since ? Date.parse(since) : NaN
  if (since && Number.isNaN(sinceMs)) {
    console.error(`--since の時刻が読めません: ${JSON.stringify(since)}（例: 2026-09-24T01:57:56+09:00 か …Z）`)
    process.exit(2)
  }
  const rows = since ? all.filter(o => Date.parse(String(o.at || '')) >= sinceMs) : all
  const bad = expect.length ? rows.filter(o => !expect.includes(o.cmd)) : []
  if (json) console.log(JSON.stringify({ total: all.length, since: since || null, count: rows.length,
    expect: expect.length ? expect : null, unexpected: bad.length, rows: rows.slice(-500), unexpectedRows: bad }, null, 2))
  else {
    console.log(`台帳への書き込み ${rows.length} 件${since ? `（${since} 以降）` : ''}  記録の総数 ${all.length}`)
    const byCmd = {}
    rows.forEach(o => { byCmd[o.cmd] = (byCmd[o.cmd] || 0) + 1 })
    Object.entries(byCmd).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(5)}  ${k}`))
    if (expect.length) {
      if (bad.length) {
        console.log(`\n**想定外の書き込みが ${bad.length} 件あります**（想定: ${expect.join(' / ')}）。`)
        bad.slice(0, 20).forEach(o => console.log(`  ${o.at}  ${o.cmd} ${(o.args || []).join(' ').slice(0, 120)}`))
        console.log('  **台本に無いコマンドが台帳に書いています。** 中身を確かめ、本人に報告してください。')
      } else console.log(`\n想定外の書き込みはありません（想定: ${expect.join(' / ')}）。`)
    }
  }
  if (bad.length) process.exitCode = 1
  // **照合するものが 0 件なのに「想定外 0」で通さない。** 時刻の指定違いで空振りしている可能性がある。
  else if (expect.length && rows.length === 0) {
    if (!json) console.log('\n**照合する書き込みが 0 件です。** --since の時刻が合っているか確かめてください（本当に書き込みが無かったなら、それで正しい）。')
    process.exitCode = 2
  }
}

else if (cmd === 'stats') {
  const rows = allStats()
  console.log(json ? JSON.stringify(rows, null, 2) : rows.map(fmt).join('\n'))
}

else if (cmd === 'next') {
  // --ids-only: 識別子だけを返す。
  //   大量の本文をエージェント間で復唱させると、量が増えたときに欠落・改変が起きる。
  //   受け渡しは短い ID に限り、中身は各自が show で取りに行く。
  const idsOnly = rest.includes('--ids-only')
  // --phase judge: 未分解が残っていても判定の一覧を返す。
  // 既定（auto）は「未分解があるうちは分解の一覧」なので、分解に失敗した単位が
  // 1 件でも残ると判定フェーズが永久に始まらなかった（sim で判明）。
  const forced = opt('phase')
  const e = findEdge(args[0]); const n = limitOf(args[1]); const inScope = scopeFilter()
  const m = loadEdge(edgeId(e))
  const scopeWarn = scopeWarning(e, m, inScope)
  const undecomposed = forced === 'judge' ? []
    : [...m.values()].filter(r => inScope(r) && !Array.isArray(r.reqs)).slice(0, n === Infinity ? undefined : n)
  if (undecomposed.length || forced === 'decompose') {
    const payload = idsOnly
      ? { phase: 'decompose', edge: edgeId(e), count: undecomposed.length, ids: undecomposed.map(u => u.unitId), warning: scopeWarn || undefined }
      : { phase: 'decompose', edge: edgeId(e),
          note: '上位だけを見て、この単位が要求している事項を列挙する。下位は見ない。' +
                ' 要求ごとに、原文のどの部分から読み取ったか（from）を逐語で付ける。' +
                ' 要求ではない部分（出典・履歴・接続）は {"skip": "<原文の一部>", "why": "<理由>"} で外す。' +
                ' section はその行が属する章。**章を見て、そもそも要求を書く場所かを判断すること**' +
                '（変更履歴・リスク一覧・見積もりの章に要求は無い）。',
          format: '[{"text":"<要求>","from":"<原文の逐語>"}, {"skip":"<原文の逐語>","why":"<なぜ要求でないか>"}]',
          warning: scopeWarn || undefined,
          units: undecomposed.map(u => ({ unitId: u.unitId, file: u.file, line: u.line,
                   section: u.section, label: u.label, text: u.text, minReq: u.minReq, flags: u.flags })) }
    console.log(JSON.stringify(payload, null, 2))
    if (scopeWarn) console.error(`\n${scopeWarn}\n`)
  } else {
    const pending = []
    // **判定の一覧も中身の鍵（#k…）で配る。**
    // approve / settle / concede は中身の鍵へ移したのに、判定だけが配列の添字の
    // ままだった（実測 2026-09-17）。同じ台帳に指し方が 2 つ併存すると、片方を
    // 動かしたときにもう片方が黙って別のものを指す。**位置で照合して壊れたのは
    // これで 4 回目**（anchor の連鎖、書き戻しの出力、断片の識別子、これ）。
    //
    // あわせて、**指摘・保留のまま残っている要求を一覧から外す。**
    // 承認する側が「これは要求でない」と言っている断片を下位と突き合わせても
    // 意味がない。外した件数は payload に出す——黙って減らさない。
    let blocked = 0
    for (const r of m.values()) {
      if (!inScope(r)) continue
      const byIdx = new Map(entriesOf(r).filter(x => x.kind === 'req').map(x => [x.idx, x]))
      ;(r.reqs || []).forEach((q, i) => {
        if (q.verdict || pending.length >= n) return
        const en = byIdx.get(i)
        const st = en ? entryApproval(en).state : '未承認'
        if (st === '指摘' || st === '保留') { blocked++; return }
        pending.push({ reqId: en ? en.id : `${r.unitId}#${i}`, file: r.file, line: r.line, section: r.section, label: r.label, upper: r.text, requirement: q.text, from: q.from || null, ...(withOf(q).length ? { with: withOf(q) } : {}) })
      })
    }
    const blockedNote = blocked
      ? `指摘・保留のまま残っている要求 ${blocked} 件をこの一覧から外しました。concede / rebut で決着させてから判定してください。`
      : undefined
    const payload = idsOnly
      ? { phase: 'judge', edge: edgeId(e), targetTier: e.to, count: pending.length, ids: pending.map(q => q.reqId), blocked: blocked || undefined, blockedNote, warning: scopeWarn || undefined }
      : { phase: 'judge', edge: edgeId(e), targetTier: e.to, verdicts: VERDICTS, note: judgeNote(), blocked: blocked || undefined, blockedNote, warning: scopeWarn || undefined, requirements: pending }
    console.log(JSON.stringify(payload, null, 2))
    if (scopeWarn) console.error(`\n${scopeWarn}\n`)
  }
}

else if (cmd === 'show') {
  // 1 件だけ取り出す。ワークフローは ID を配るだけで済み、本文の復唱が要らない。
  const e = findEdge(args[0]); const id = args[1]
  const m = loadEdge(edgeId(e))
  // judge と同じく最後の # で割る（unitId に # が混ざっても壊れないように）
  const cut0 = String(id).lastIndexOf('#')
  const unitId = cut0 < 0 ? String(id) : String(id).slice(0, cut0)
  const idxStr = cut0 < 0 ? undefined : String(id).slice(cut0 + 1)
  const r = m.get(unitId)
  if (!r) { console.error(JSON.stringify({ error: `${unitId} が台帳にありません` })); process.exit(1) }
  if (idxStr === undefined) {
    console.log(JSON.stringify({ phase: 'decompose', edge: edgeId(e), unitId: r.unitId,
      file: r.file, line: r.line, section: r.section, label: r.label, text: r.text,
      minReq: r.minReq, flags: r.flags,
      entries: Array.isArray(r.reqs) ? entriesOf(r).map(x => {
        const a = entryApproval(x)
        return { entryId: x.id, as: x.kind === 'req' ? '要求' : '対象外', span: x.span, ...(x.with && x.with.length ? { with: x.with } : {}), text: x.text,
                 approval: a.state, ...(a.approval ? { verdict: a.approval.verdict, why: a.approval.why, kind: a.approval.kind, expect: a.approval.expect, resolvesBy: a.approval.resolvesBy } : {}) }
      }) : undefined,
      note: '上位の原文だけを見て要求を列挙する。下位のファイルを開かない。' }, null, 2))
  } else {
    // 承認の状態も出す。**指摘を受けたまま判定に進めてしまうのを防ぐ。**
    // ここに出さないと、show で 1 件だけ見て判定する経路から承認が見えない。
    //
    // 実測（2026-09-17）: 断片の識別子を中身の鍵に変えたとき、この照合が
    // `x.id === id` のままだったため、**判定側が配る添字の形では 1 件も当たらず、
    // 承認の状態が黙って落ちていた。** 指摘のままの断片が警告なしで「一致」と
    // 判定できる状態になっていた。検査が在るのではなく、**在るように見えていた**。
    const allSh = Array.isArray(r.reqs) ? entriesOf(r) : []
    const enShow = allSh.find(x => x.id === String(id)) || allSh.find(x => x.legacyId === String(id))
    if (enShow && enShow.kind !== 'req') {
      console.error(JSON.stringify({ error: `${id} は対象外の断片です。判定の対象は要求だけです。` })); process.exit(1)
    }
    const q = enShow ? r.reqs[enShow.idx] : (r.reqs || [])[Number(idxStr)]
    if (!q) { console.error(JSON.stringify({ error: `${id} が台帳にありません` })); process.exit(1) }
    const apShow = enShow ? entryApproval(enShow) : null
    const tagShow = enShow ? (edgeTags(m).byId.get(enShow.id)?.tag || undefined) : undefined
    console.log(JSON.stringify({ phase: 'judge', edge: edgeId(e), reqId: enShow ? enShow.id : id, targetTier: e.to,
      tag: tagShow,
      file: r.file, line: r.line, section: r.section, label: r.label,
      upper: r.text, requirement: q.text, from: q.from || null, ...(withOf(q).length ? { with: withOf(q) } : {}), verdicts: VERDICTS,
      plan: q.plan || undefined,
      approval: apShow ? { state: apShow.state, ...(apShow.approval || {}), rebuttal: apShow.rebuttal || undefined } : undefined,
      note: judgeNote(apShow && apShow.state === '指摘' ? ' **この要求は「要求でない」と指摘されています。** 判定より先に決着させてください。' : '') }, null, 2))
  }
}

else if (cmd === 'decompose') {
  // ── 入力の形 ──────────────────────────────────────────────────────────
  //   [ {"text": "<要求>",   "from": "<原文の逐語の一部>"},   … 要求
  //     {"skip": "<原文の逐語の一部>", "why": "<なぜ要求でないか>"} … 要求でない部分
  //   ]
  //
  // なぜ from を必須にしたか（実測で分かったこと、2026-09-15）:
  //   旧版は文字列の配列で、機械が見ていたのは「件数が下限以上か」「完全一致の重複が
  //   無いか」「原文の語を使っているか」の 3 つだけだった。**中身が原文のどこから
  //   来たのかを誰も見ていなかった。**
  //   実際に要件定義書で回したところ、**正直に分解すると 5/5 が弾かれ、数合わせを
  //   すると 5/5 が通った**。日付の行（要求ゼロ）にも架空の要求 2 件を書かされ、
  //   それが「判定済 2」として台帳に載った。
  //   弾かれた側は書き直す。書き直す方向は通る方なので、**この仕掛けは数合わせを
  //   正解として教えていた**。サボりを検出するための道具が、逆を教えていた。
  //
  //   from を必須にすると、言い換えを並べても**同じ区間を取り合って落ちる**。
  //   書ける件数は原文の長さで決まり、AI の裁量では増やせない。
  //   そして**どこにも割り当てられなかった区間**が残るので、飛ばしたことが見える。
  //   件数（minReq）は「要求の数の下限」から「**原文のうち説明すべき断片の数の下限**」
  //   へ意味が変わる。要求として書くか、理由つきで skip するかは選べるが、
  //   **黙って無視することはできない**。
  const e = findEdge(args[0]); const unitId = args[1]
  let entries
  try { entries = JSON.parse(args[2]) } catch { console.error('分解は JSON 配列で渡してください'); process.exit(1) }
  // **ここからロック。** 読んでから書くまでの間に他のコマンドが書くと、その変更が消える。
  const lock = lockEdge(edgeId(e))
  const m = loadEdge(edgeId(e)); const r = m.get(unitId)
  if (!r) { console.error(`unitId ${unitId} が台帳にありません`); process.exit(1) }
  const src = String(r.text)

  if (!Array.isArray(entries)) { console.error('分解は JSON 配列で渡してください'); process.exit(1) }
  if (entries.some(x => typeof x === 'string')) {
    console.error('分解の書式が変わりました。文字列の配列では受け取れません。')
    console.error('  要求ごとに、原文のどの部分から取ったか（from）を付けてください:')
    console.error('    [{"text":"<要求>","from":"<原文の逐語の一部>"},')
    console.error('     {"skip":"<原文の逐語の一部>","why":"<なぜ要求でないか>"}]')
    console.error(`  原文: ${src}`)
    process.exit(1)
  }
  const reqs = [], skips = []
  for (const x of entries) {
    if (!x || typeof x !== 'object') { console.error('分解の各要素はオブジェクトで渡してください'); process.exit(1) }
    if (typeof x.skip === 'string') {
      if (x.with !== undefined) { console.error('with（含む）は要求にだけ付けられます。対象外（skip）には付けられません。'); process.exit(1) }
      skips.push({ skip: String(x.skip), why: String(x.why || '') })
    } else {
      if (x.with !== undefined && (!Array.isArray(x.with) || x.with.some(w => typeof w !== 'string'))) {
        console.error('with（含む）は文字列の配列で渡してください: {"text":"…","from":"…","with":["<原文の逐語>"]}'); process.exit(1)
      }
      reqs.push({ text: String(x.text || ''), from: String(x.from || ''), with: withOf(x) })
    }
  }
  if (!reqs.length && !skips.length) {
    console.error('分解が空です。要求を書くか、要求でない部分を理由つきで skip してください。')
    process.exit(1)
  }

  // ① 要求の文は判定できる粒度か（旧版から継続）
  const short = reqs.filter(x => x.text.trim().length < 8)
  if (short.length) {
    console.error(`要求が短すぎます（8 文字以上）: ${short.slice(0, 3).map(x => JSON.stringify(x.text)).join(' ')}`)
    console.error('  上位が何を要求しているかを、判定できる粒度で書いてください。')
    process.exit(1)
  }
  const seen = new Set(), dup = []
  for (const x of reqs) { const k = x.text.trim(); if (seen.has(k)) dup.push(k); seen.add(k) }
  if (dup.length) {
    console.error(`同じ要求が重複しています: ${dup.slice(0, 3).map(x => JSON.stringify(x)).join(' ')}`)
    console.error('  件数の下限を満たすために同じ行を並べても、分母を固定したことにはなりません。')
    process.exit(1)
  }

  // ② from / skip は原文の逐語の一部か。**捏造できないのはここ。**
  const spans = []
  // **「含む」（with）も区間として数える。**（v30 T11）同じ単位の逐語に限り、ほかの断片と重なれない。
  // 前置き・理由の句・表の左列の見出し語を、それが支える要求に含めるためのもので、
  // 対象外（skip）として別に聞くと、確かめ役がどちらを見て答えるかで割れた（turn 71、01:84・01:60）。
  for (const x of [...reqs.map(q => ({ frag: q.from, kind: '要求', label: q.text })),
                   ...reqs.flatMap(q => q.with.map(w => ({ frag: w, kind: '含む', label: q.text }))),
                   ...skips.map(k => ({ frag: k.skip, kind: 'skip', label: k.why }))]) {
    const frag = x.frag.trim()
    if (!frag) {
      console.error(`${x.kind}「${String(x.label).slice(0, 30)}」に原文の引用（${x.kind === 'skip' ? 'skip' : 'from'}）がありません。`)
      console.error(`  原文: ${src}`)
      process.exit(1)
    }
    const at = src.indexOf(frag)
    if (at < 0) {
      console.error(`原文に無い文字列が指定されています: ${JSON.stringify(frag)}`)
      console.error(`  原文: ${src}`)
      console.error('  from / skip は、原文からそのまま切り出した文字列でなければなりません。')
      process.exit(1)
    }
    spans.push({ ...x, frag, at, end: at + frag.length })
  }

  // ③ 区間が重なっていないか。**言い換えの水増しはここで落ちる。**
  const sorted = [...spans].sort((a, b) => a.at - b.at)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].at < sorted[i - 1].end) {
      console.error('原文の同じ部分を 2 つの項目が取り合っています。')
      console.error(`  ${JSON.stringify(sorted[i - 1].frag)}  ←→  ${JSON.stringify(sorted[i].frag)}`)
      console.error(`  原文: ${src}`)
      console.error('  同じ内容を言い換えて件数を埋めることはできません。原文の別の部分を指してください。')
      process.exit(1)
    }
  }

  // ④ 要求の文と、その出どころが結びついているか（すり替え防止）
  //
  // **語に分けられない断片は、逐語で見る。**（2026-09-15、コードの段で判明）
  // tokensOf は英数字の識別子を 3 文字以上でしか拾わない。上位段がコードのエッジ
  // （impl->ut）では単位の本文がクラス名・メソッド名なので、`A` や `f` のような
  // 短い名前は**語が 1 つも取れず、どう書いても「1 語も共有していない」で落ちる**。
  // 実際にコードの単位を分解しようとして全件拒否された。
  // 語に分けられないときは、要求の文がその断片を逐語で含んでいるかで見る。
  const swapped = reqs.filter(q => {
    if (sharesToken(q.text, q.from)) return false
    if (tokensOf(q.from).size === 0) return !q.text.includes(q.from.trim())
    return true
  })
  if (swapped.length) {
    console.error(`要求の文と、その出どころ（from）が 1 語も共有していません（${swapped.length} 件）。`)
    swapped.slice(0, 3).forEach(q => console.error(`    要求 ${JSON.stringify(q.text)}\n    from ${JSON.stringify(q.from)}`))
    console.error('  道は 2 つあります。')
    console.error('  A) from がずれている … その要求が実際に読み取れる部分を指し直す')
    console.error('  B) **そもそも要求でない** … 要求にせず、理由をつけて外す')
    console.error(`       {"skip": ${JSON.stringify(swapped[0].from)}, "why": "<なぜ要求でないか>"}`)
    console.error('     ラベル・目的・経緯・出典・枠組みの句は要求ではありません。')
    console.error('     **要求文のほうを出どころの語に寄せて辻褄を合わせないこと。**')
    console.error('     それをやると、要求でないものが要求として台帳に残ります（実際に起きた）。')
    process.exit(1)
  }

  // ⑤ skip の理由は、この単位に固有のものか
  const thinWhy = skips.filter(k => k.why.trim().length < 15 || !touchesSource(k.why, src))
  if (thinWhy.length) {
    console.error(`skip の理由が不十分です（15 文字以上・原文の語を含むこと）: ${thinWhy.slice(0, 2).map(k => JSON.stringify(k.why)).join(' ')}`)
    console.error(`  原文: ${src}`)
    console.error('  なぜ**この部分が**要求でないのかを、原文に触れて書いてください。')
    if (tokensOf(src).size === 0) console.error(`  **この原文には語がありません。** 理由の中に原文そのもの（${JSON.stringify(src.trim())}）を逐語で含めてください（v30 T9）。`)
    process.exit(1)
  }

  // ⑥ 取り残しが無いか。**飛ばしたことが見えるのはここ。**
  // 助詞や接続詞まで割り当てを強制すると全件落ちるので、10 文字以上の連続区間だけを見る。
  // この閾値を外したときの症状は「skip の記録が少し増減する」だけで、
  // minReq と違って**水増しを強制する側には絶対に振れない**。
  const covered = new Array(src.length).fill(false)
  for (const s2 of spans) for (let i = s2.at; i < s2.end; i++) covered[i] = true
  const leftovers = []
  let run = ''
  for (let i = 0; i <= src.length; i++) {
    if (i < src.length && !covered[i]) { run += src[i]; continue }
    if (run.trim().length >= 10) leftovers.push(run.trim())
    run = ''
  }
  if (leftovers.length) {
    console.error(`原文のうち、どの要求にも割り当てられていない部分があります（${leftovers.length} 箇所）。`)
    leftovers.slice(0, 5).forEach(x => console.error(`    ${JSON.stringify(x)}`))
    console.error(`  原文: ${src}`)
    console.error('  ここに要求が書かれていませんか。書かれていないなら、理由をつけて外してください:')
    console.error(`    {"skip": ${JSON.stringify(leftovers[0].slice(0, 20))}, "why": "<なぜ要求でないか>"}`)
    process.exit(1)
  }

  // ⑦ 件数の下限。**要求 ＋ skip の合計**で見る。
  // 下限は「原文に実在する切れ目の数 + 1」なので、切れ目で切れば必ず満たせる。
  // 要求として書くか理由つきで外すかは選べるが、断片を黙って消すことはできない。
  // 原文の全体を 1 つの skip が覆っているとき（＝この行は丸ごと要求ではない）は免除する。
  const wholeSkip = skips.some(k => k.skip.trim() === src.trim())
  if (!wholeSkip && spans.length < r.minReq) {
    console.error(`説明された断片が足りません。この単位は最低 ${r.minReq} 個に分かれるはずですが ${spans.length} 個しかありません。`)
    console.error(`  検出根拠: ${r.flags.join(', ') || '(なし)'}`)
    console.error(`  原文: ${src}`)
    console.error('  要求として書けない断片は {"skip": …, "why": …} で外してください（記録に残ります）。')
    process.exit(1)
  }

  // 分解を書き直しても、**内容が変わっていない断片の承認は引き継ぐ。**
  // 引き継がないと、10 件のうち 1 件を直すたびに残り 9 件を承認し直すことになり、
  // 「指摘を受けたら直す」という正しい行動が一番高くつく。
  // 引き継ぎの鍵は断片の内容そのもの（種別＋出どころ＋本文）なので、
  // 1 文字でも変われば別物になり、承認は付いてこない。
  const carried = new Map()
  const bySpan = new Map()
  for (const e0 of entriesOf(r)) {
    if (!e0.node.approval) continue
    // **2 周目の答え・本人待ち・前の記録も一緒に引き継ぐ。**（v28 T3）
    // 実測（2026-09-24、turn 61）: 文を変えていない割れた断片が、同じ単位を分解し直しただけで
    // 2 周目の記録を失い、`settle-report` が「まだ 2 周目を回していない」に戻った。
    // 引き継いでいたのは承認と反論だけだった。2 周目は聞き直しになり、
    // **本人待ちも、分解し直すだけで外れる**——本人の判断を待つ断片から抜け出す道になっていた。
    carried.set(entryKeyOf(e0), { approval: e0.node.approval, rebuttal: e0.node.rebuttal,
      second: e0.node.second, hold: e0.node.hold, priorRecords: e0.node.priorRecords })
    bySpan.set(e0.span, e0.node.approval)
  }
  // **分解し直しで消える本人待ちを、黙って落とさない。**（v30 T10）
  // v28 T3 は「中身が同じ断片」の本人待ちを引き継ぐが、断片の区切りや文を変えると鍵が変わり、
  // 本人待ちが**本人を通らずに消える**（v29 T7 は上位の本文が変わったときだけを塞いでいた）。
  // 消える分は単位の staleHolds に移し、本人が release-hold で外すまで本人待ちとして数える。
  const heldBefore = (Array.isArray(r.reqs) ? entriesOf(r) : [])
    .filter(e0 => entryApproval(e0).state === '本人待ち')
    .map(e0 => ({ key: entryKeyOf(e0), rec: {
      holdId: hash12(`${r.unitId}\u0000${e0.id}\u0000${e0.node.hold?.at || ''}`), fromUnit: r.unitId, file: r.file, line: r.line,
      kind: e0.kind, span: e0.span, text: e0.text, ...(e0.with && e0.with.length ? { with: e0.with } : {}),
      hold: e0.node.hold, approval: e0.node.approval, second: e0.node.second,
      carriedAt: new Date().toISOString(), reason: '分解し直しで断片が変わった' } }))
  const revive = (kind, span, text, node, w = []) => {
    const prev = carried.get(entryKeyOf({ kind, span, text, with: w }))
    if (prev?.approval) {
      node.approval = prev.approval
      for (const k of ['rebuttal', 'second', 'hold', 'priorRecords']) if (prev[k]) node[k] = prev[k]
      return node
    }
    // **指摘に従って直した分は、承認し直させない。**
    // 「この断片は要求でない」と言われて要求から対象外へ移したのは、指摘への同意である。
    // それを「内容が変わったから未承認」に戻すと、指摘に従うことが一番高くつく——
    // 承認を通す最短経路が「反論して押し切る」になってしまう。**そこは絶対に逆にしない。**
    //
    // 逆向き（「要求である」と言われて対象外から要求へ移した）は引き継がない。
    // 承認する側は「その断片は要求だ」と言っただけで、**新しく書かれた要求文は見ていない。**
    // 見ていないものを承認済みにはできない。
    const byspan = bySpan.get(span)
    if (byspan && byspan.verdict === '要求でない' && kind === 'skip') {
      node.approval = { ...byspan, of: entryKeyOf({ kind, span, text, with: w }), viaCompliance: true }
    }
    return node
  }
  r.reqs = reqs.map(q => revive('req', q.from, q.text, { text: q.text, from: q.from, ...(q.with.length ? { with: q.with } : {}) }, q.with))
  if (skips.length) r.skips = skips.map(k => revive('skip', k.skip, k.why, { skip: k.skip, why: k.why })); else delete r.skips
  const heldNow = new Set(entriesOf(r).filter(e1 => entryApproval(e1).state === '本人待ち').map(e1 => entryKeyOf(e1)))
  const lostHolds = heldBefore.filter(h => !heldNow.has(h.key))
  if (lostHolds.length) {
    r.staleHolds = [...(Array.isArray(r.staleHolds) ? r.staleHolds : []), ...lostHolds.map(h => h.rec)]
    console.error(`△ 分解し直しで本人待ちの断片が ${lostHolds.length} 件変わりました。前の本人待ちとして単位に残しています（本人が release-hold で外すまで数えます）:`)
    lostHolds.forEach(h => console.error(`    ${h.rec.holdId}  ${JSON.stringify(String(h.rec.span).slice(0, 40))}`))
  }
  delete r.staleFrom
  saveEdge(edgeId(e), m)
  // 兄弟エッジへ書く前に**自分のロックを外す。** 2 つ持ったまま待つと、
  // 逆の順で取ろうとしている相手と睨み合いになる。
  unlockEdge(lock)
  const none = reqs.length === 0 ? '  ← **要求ゼロ**として記録しました' : ''
  console.log(`OK ${unitId} → 要求 ${reqs.length} 件 / skip ${skips.length} 件（下限 ${r.minReq}）${none}`)

  // ── 兄弟エッジへ同じ分解を書く ──────────────────────────────────────
  // 同じ上位段を持つエッジ（dd->impl と dd->it）で同じ作業を 2 回させない。
  // **同じでなければならないものを、2 回作らせない**のが目的で、
  // 費用が半分になるのはその結果にすぎない。
  const mine = decompositionOf(r)
  const wrote = [], diverged = []
  for (const sib of siblingEdges(e)) {
    const sid = edgeId(sib)
    let slock, sm
    try { slock = lockEdge(sid); sm = loadEdge(sid) } catch { unlockEdge(slock); continue }
    const sr = sm.get(unitId)
    if (!sr || sr.hash !== r.hash) { unlockEdge(slock); continue }   // 上位の本文が違うなら別物
    if (Array.isArray(sr.reqs)) {
      if (!sameDecomposition(decompositionOf(sr), mine)) diverged.push(sid)
      unlockEdge(slock)
      continue                                     // 既にあるものは黙って上書きしない
    }
    sr.reqs = mine.reqs.map(q => ({ ...q }))
    if (mine.skips.length) sr.skips = mine.skips.map(k => ({ ...k })); else delete sr.skips
    delete sr.staleFrom
    saveEdge(sid, sm)
    unlockEdge(slock)
    wrote.push(sid)
  }
  if (wrote.length) console.log(`  同じ上位段の ${wrote.join(' / ')} にも同じ分解を書きました（承認も引き継ぎ）`)
  if (diverged.length) {
    console.log(`  **${diverged.join(' / ')} には違う分解が入っています。**`)
    console.log('  分解は上位だけを見て行う作業なので、エッジによって変わることはありません。どちらかが誤りです:')
    diverged.forEach(x => console.log(`    node .claude/scripts/ledger.mjs show ${JSON.stringify(x)} ${JSON.stringify(unitId)}`))
  }
}

else if (cmd === 'judge') {
  const e = findEdge(args[0])
  const verdict = args[2]; const evidence = args[3] ? JSON.parse(args[3]) : null
  if (!VERDICTS.includes(verdict)) { console.error(`verdict は次のいずれか: ${VERDICTS.join(' / ')}`); process.exit(1) }
  const lock = lockEdge(edgeId(e))
  const m = loadEdge(edgeId(e))
  // **中身の鍵（#k…）と配列の添字の両方を受ける。** 判定だけが添字のままだった。
  // findEntry は古い形で引かれたとき、当たった断片を必ず表示する。
  const { r, entry } = findEntry(e, args[1], m)
  if (entry.kind !== 'req') {
    console.error(`${args[1]} は対象外の断片です。判定できるのは要求だけです。`)
    console.error(`  断片: ${JSON.stringify(String(entry.span).slice(0, 40))}`)
    unlockEdge(lock); process.exit(1)
  }
  const idx = entry.idx
  // **承認が食い違ったままの要求は判定しない。**
  // 承認する側が「これは要求でない」と言っている断片を下位と突き合わせても、
  // 一致と出ようが不一致と出ようが意味を持たない。show 側の警告文だけが
  // 頼りだったが、その警告は識別子の形が合わず**一度も出ていなかった**（実測）。
  const apJ = entryApproval(entry)
  if (apJ.state === '指摘' || apJ.state === '保留') {
    console.error(`この要求は「${apJ.state}」のままです。判定より先に決着させてください。`)
    console.error(`  断片: ${JSON.stringify(String(entry.span).slice(0, 40))}`)
    if (apJ.approval && apJ.approval.why) console.error(`  承認側の言い分: ${apJ.approval.why}`)
    console.error(`  同意する: node .claude/scripts/ledger.mjs concede ${JSON.stringify(edgeId(e))} ${JSON.stringify(entry.id)} --why "…"`)
    console.error(`  反論する: node .claude/scripts/ledger.mjs rebut ${JSON.stringify(edgeId(e))} ${JSON.stringify(entry.id)} '{"expect":"…","why":"…"}'`)
    unlockEdge(lock); process.exit(1)
  }
  // **本人待ちも判定しない。**
  // 実測（2026-09-23、turn 45）: 本人待ちの「拍子」の要求に judge を打ったら、拒まれずに
  // 「一致」が書き込まれた。上の条件が「指摘」「保留」しか見ていなかった。
  // 本人待ちは「要求かどうかを本人が決める」状態なので、判定を先に置くと
  // 本人が concede したときに捨てる判定になる——承認待ちを先に決着させるのと同じ理屈。
  if (apJ.state === '本人待ち') {
    console.error('この要求は「本人待ち」です。本人が決めるまで判定しません。')
    console.error(`  断片: ${JSON.stringify(String(entry.span).slice(0, 40))}`)
    if (apJ.hold && apJ.hold.why) console.error(`  本人へ回した理由: ${apJ.hold.why}`)
    console.error('  本人が決めるコマンド（本人がターミナルで打つ）:')
    console.error(`    要求から外す: node .claude/scripts/ledger.mjs concede ${JSON.stringify(edgeId(e))} ${JSON.stringify(entry.id)} --why "…"`)
    console.error(`    要求として残す: node .claude/scripts/ledger.mjs uphold ${JSON.stringify(edgeId(e))} ${JSON.stringify(entry.id)} --why "…"`)
    unlockEdge(lock); process.exit(1)
  }
  if (verdict !== '対象外' && !evidence) { console.error('「対象外」以外の判定には evidence が必須です'); unlockEdge(lock); process.exit(1) }
  if (verdict === '対象外') {
    const reason = String((evidence && evidence.reason) || '').trim()
    if (!reason) { console.error('「対象外」には evidence.reason（なぜ対象外か）が必須です'); process.exit(1) }
    if (reason.length < 8) {
      console.error(`「対象外」の理由が短すぎます（8 文字以上）: ${JSON.stringify(reason)}`)
      console.error('  v22 は {"reason":"."} が通っていました。どの単位にも貼れる文は理由ではありません。')
      process.exit(1)
    }
    if (!touchesSource(reason, r.text)) {
      console.error('「対象外」の理由が、この単位の原文と 1 語も共有していません。')
      console.error(`  原文: ${r.text}`)
      console.error(`  理由: ${reason}`)
      console.error('  なぜ**この単位が**対象外なのかを、原文に触れて書いてください。')
      process.exit(1)
    }
  }

  // ── evidence を実ファイルと照合してから書く ────────────────────────────
  // 判定プロンプトは「quote は後で実ファイルと機械照合される」と宣言しているが、
  // 照合する経路がどこにも無かった。照合されない主張は自己申告と同じで、
  // レビューに報告文を渡して PASS させていた F13 と同じ構造になる。
  // 「無い」ことを示す判定は引用を持てないので、その場合は method（無いことを
  // 確かめた方法）を必須にする。どちらも無い判定は受け取らない。
  if (verdict !== '対象外') {
    const items = Array.isArray(evidence) ? evidence : [evidence]
    const quoted = items.filter(x => x && typeof x.quote === 'string' && x.quote.trim())

    // 「在る」と主張する判定（一致 / 部分）は逐語引用でしか示せない。
    // v22 は method だけで通ったので、`judge 一致 '{"method":"x"}'` を全件に流すと
    // 25 要求が「完了」になった（実測）。method は「無い」ことの証拠でしかない。
    const ASSERTS_PRESENCE = ['一致', '部分']
    const needsQuote = ASSERTS_PRESENCE.includes(verdict)
    if (!quoted.length) {
      const method = items.map(x => x && x.method).filter(Boolean).join(' ')
      if (needsQuote) {
        console.error(`「${verdict}」は下位に降りていることの判定なので、逐語引用（quote）が必須です。`)
        console.error('  method は「無いことを確かめた方法」なので、在ることの証拠には使えません。')
        console.error(`  下位を実際に開き、要求が降りている本文を ${'12'} 文字以上そのまま引用してください。`)
        console.error('  降りていないなら、それは 不一致 / 部分 ではなく**自分の書き漏らし**です。書き足してから判定し直してください。')
        process.exit(1)
      }
      if (!method.trim()) {
        console.error('evidence には quote（逐語引用）か method（無いことを確かめた方法）のどちらかが必須です。')
        console.error('  「在る」と判定するなら quote を、「無い」と判定するなら grep した語と結果件数を method に書いてください。')
        process.exit(1)
      }
    }
    const allowFiles = allowFilesFor(e)
    const bad = []
    const warns = []
    for (const q of quoted) {
      const v = checkEvidence(q, {
        strict: true,
        requireQuote: needsQuote,
        allowFiles: needsQuote ? allowFiles : null,
        matchAny: matchesAny,
      })
      if (!v.ok) bad.push(`${q.file}:${q.line ?? '?'} → ${v.reason}`)
      else if (v.warn) warns.push(`${q.file}:${q.line ?? '?'} → ${v.warn}`)
    }
    if (bad.length) {
      console.error('evidence が実ファイルと一致しないため、この判定は記録しません。')
      bad.forEach(b => console.error(`  ✗ ${b}`))
      console.error('  quote は逐語です。要約・整形しないでください。該当箇所を開き直して引用し直してください。')
      process.exit(1)
    }
    warns.forEach(x => console.log(`△ ${x}`))
    r.reqs[idx].evidenceChecked = { at: new Date().toISOString(), quotes: quoted.length, warns: warns.length }
  }

  r.reqs[idx].verdict = verdict
  r.reqs[idx].evidence = evidence
  // 誰が判定したかを残す。humanJudged の段は by: 'human' が揃うまで完了にならない。
  r.reqs[idx].by = rest.includes('--human') ? 'human' : 'ai'
  r.reqs[idx].at = new Date().toISOString()
  saveEdge(edgeId(e), m)
  unlockEdge(lock)
  console.log(`OK ${entry.id} = ${verdict}${r.reqs[idx].by === 'human' ? '（人間判定）' : ''}`)
}

else if (cmd === 'plan') {
  // 判定のあと、「上位を直すのか下位を直すのか」を要求ごとに記録する。
  // **判定は動かさない。** ここが動かすのは分類だけ。
  const e = findEdge(args[0])
  const lock = lockEdge(edgeId(e))
  const m = loadEdge(edgeId(e))
  const { r, entry } = findEntry(e, args[1], m)
  if (entry.kind !== 'req') {
    console.error(`${args[1]} は対象外の断片です。分類できるのは要求だけです。`)
    unlockEdge(lock); process.exit(1)
  }
  const q = r.reqs[entry.idx]
  if (rest.includes('--clear')) {
    // **直す先が要るものから分類を外させない。**
    //
    // 実測（2026-09-22）: `judge ...; plan --clear` と 1 行に繋いで流したところ、
    // **judge が引用の検査で拒まれたのに、後段の `--clear` だけが通った。**
    // 判定は `部分` のまま、分類は無し——`plan-report` が即座に
    // 「一致以外なのに分類が無い」と数える状態が、誰も意図せずにできた。
    // 次の judge で解消したが、**気づいたのは報告を書いたからで、道具は止めていない。**
    //
    // `--clear` に正しい使い道があるのは、判定が `一致` か `対象外` になったときだけ。
    // 付け替えたいなら `plan <分類> --why` が上書きする。**2 手に分ける理由が無い。**
    if (q.verdict && q.verdict !== '一致' && q.verdict !== '対象外') {
      console.error(`${entry.id} の判定は「${q.verdict}」です。**直す先が要るものから分類を外せません。**`)
      console.error('  外してよいのは、判定が「一致」か「対象外」になったときだけです。')
      console.error('  分類を付け替えるなら、上書きしてください:')
      console.error(`    node .claude/scripts/ledger.mjs plan ${JSON.stringify(edgeId(e))} ${JSON.stringify(entry.id)} <分類> --why "…"`)
      unlockEdge(lock); process.exit(1)
    }
    delete q.plan
    saveEdge(edgeId(e), m); unlockEdge(lock)
    console.log(`OK ${entry.id} の分類を外しました`)
  } else {
    const raw = String(args[2] || '').trim()
    const kind = PLAN_ALIAS[raw] || raw
    if (!PLANS.includes(kind)) {
      console.error(`分類は次のいずれか: ${PLANS.join(' / ')}`)
      console.error(`  受け取った値: ${JSON.stringify(raw)}`)
      unlockEdge(lock); process.exit(1)
    }
    const why = String(opt('why') || '').trim()
    // 理由は短くてよいが、**その要求に触れていること**。
    // どの要求にも貼れる一文（「下位に無い」だけ）は、後から読んだ人が何も判断できない。
    if (why.length < 10) {
      console.error(`分類の理由が短すぎます（10 文字以上）: ${JSON.stringify(why)}`)
      console.error('  --why "<なぜ上位／下位を直すのか>" を付けてください。')
      unlockEdge(lock); process.exit(1)
    }
    if (!sharesToken(why, q.text || '') && !touchesSource(why, r.text || '')) {
      console.error('分類の理由が、この要求とも原文とも 1 語も共有していません。')
      console.error(`  要求: ${q.text}`)
      console.error(`  原文: ${r.text}`)
      console.error(`  理由: ${why}`)
      unlockEdge(lock); process.exit(1)
    }
    q.plan = { kind, why, at: new Date().toISOString() }
    saveEdge(edgeId(e), m); unlockEdge(lock)
    console.log(`OK ${entry.id} → ${kind}`)
  }
}

else if (cmd === 'plan-report') {
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e)); const inScope = scopeFilter()
  const byKind = {}; let planned = 0
  const missing = []   // 一致でない＝直す必要があるのに、分類が付いていないもの
  const stale = []     // 一致なのに分類が付いている（直したあとの消し忘れ）
  for (const r of m.values()) {
    if (!inScope(r)) continue
    const ents = entriesOf(r).filter(x => x.kind === 'req')
    for (const x of ents) {
      const q = r.reqs[x.idx]
      if (q.plan && q.plan.kind) { planned++; byKind[q.plan.kind] = (byKind[q.plan.kind] || 0) + 1 }
      if (!q.verdict) continue
      if (q.verdict !== '一致' && q.verdict !== '対象外' && !(q.plan && q.plan.kind)) {
        missing.push({ reqId: x.id, file: r.file, line: r.line, verdict: q.verdict, requirement: q.text })
      }
      // **`スコープ外` を例外にしていた。** その 1 語のせいで、この検査が
      // 一番効いてほしいところで効いていなかった。
      //
      // 実測（2026-09-22）: 判定を通し直して 15 件が `一致` へ動いたが、
      // 15 件とも `スコープ外` の分類を持ったまま残り、`plan-report` は **0 件**と出した。
      // 「この階層に降りている（一致）」と「この階層の担当ではない（スコープ外）」が
      // **同じ要求に同居していて、どこにも見えない。**
      //
      // 一致したものに「どちらを直すか」は要らない。**分類が残っているのは消し忘れ。**
      // 種類で例外を作らない。
      // **`対象外` も同じ。** 直す先が決まっている必要があるのは
      // 「この階層で直す」ものだけ。判定が `一致` か `対象外` なら分類は要らない。
      //
      // 実測（2026-09-22）: `スコープ外` の例外を外した直後、**その 1 つ隣に同じ穴が残っていた。**
      // `対象外` に分類が付いた 6 件は、`missing`（一致以外なのに分類が無い）にも
      // `stale`（一致なのに分類が残っている）にも出ず、**どちらからも見えなかった。**
      // 例外を 1 つ外したら、**同じ形が他に無いかをその場で見ること。**
      if ((q.verdict === '一致' || q.verdict === '対象外') && q.plan && q.plan.kind) {
        stale.push({ reqId: x.id, kind: q.plan.kind, verdict: q.verdict, requirement: q.text })
      }
    }
  }
  const out = { edge: edgeId(e), planned, byKind, missing: missing.length, staleCount: stale.length, missingList: missing, staleList: stale }
  if (json) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`${edgeId(e)}  分類 ${planned} 件`)
    console.log('  ' + PLANS.map(k => `${k} ${byKind[k] || 0}`).join(' / '))
    console.log(`  **一致以外なのに分類が無い ${missing.length} 件**`)
    if (missing.length) console.log('    ' + missing.slice(0, 10).map(x => `${x.verdict}  ${x.reqId}`).join('\n    '))
    if (stale.length) {
      // **表示も一緒に直す。** 中身を広げて文言を置き去りにすると、
      // 「一致なのに」と書いてある一覧に `対象外` が混ざって、読んだ人が数え直す。
      console.log(`  △ 判定が済んでいるのに分類が残っている ${stale.length} 件（一致・対象外。--clear で外す）`)
      console.log('    ' + stale.slice(0, 10).map(x => `${x.kind}  ${x.reqId}`).join('\n    '))
    }
  }
}

else if (cmd === 'hold') {
  // 割れた断片を、本人の判断へ回す。**決めない、という決め方を記録する。**
  const e = findEdge(args[0])
  const lock = lockEdge(edgeId(e))
  const m = loadEdge(edgeId(e))
  const { r, entry } = findEntry(e, args[1], m)
  const a = entryApproval(entry)
  if (rest.includes('--clear')) {
    delete entry.node.hold
    saveEdge(edgeId(e), m); unlockEdge(lock)
    console.log(`OK ${entry.id} の本人待ちを外しました（状態: ${entryApproval(entry).state}）`)
  } else {
    // **止めるための逃げ道にしない。** 食い違っているものだけが対象。
    // `反論で維持` も受ける。**反論は「決めた」記録だが、決め直してはいけないわけではない。**
    // 実測（2026-09-20）: ゲートに押されて置いた仮の判断が、ここで弾かれて戻せなかった。
    // 承認と食い違っていない（＝承認済み・未承認）ものだけを断る。
    if (a.state !== '指摘' && a.state !== '保留' && a.state !== '反論で維持' && a.state !== '本人待ち') {
      console.error(`この断片は「${a.state}」です。本人へ回すのは、承認と食い違ったもの（指摘・保留・反論で維持）だけです。`)
      unlockEdge(lock); process.exit(1)
    }
    // **2 周目を回す前には回せない。** 「割れた」と言うには、2 回見ていることが要る。
    if ((a.state === '指摘' || a.state === '反論で維持') && !secondOf(entry)) {
      console.error('この断片はまだ 2 周目（settle）を通っていません。')
      console.error('  **「割れた」と言うには、2 回見ていることが要ります。** 先に settle を回してください。')
      console.error(`    node .claude/scripts/ledger.mjs settle-next ${JSON.stringify(edgeId(e))}`)
      unlockEdge(lock); process.exit(1)
    }
    const why = String(opt('why') || '').trim()
    if (why.length < 15 || !touchesSource(why, r.text || '')) {
      console.error(`本人へ回す理由が不十分です（15 文字以上・原文の語を含むこと）: ${JSON.stringify(why)}`)
      console.error(`  原文: ${r.text}`)
      console.error('  **何が割れているのかを書いてください。** 本人はこれを読んで決めます。')
      unlockEdge(lock); process.exit(1)
    }
    if (tokensOf(entry.span).size && !sharesToken(why, entry.span)) {
      console.error(`理由が**この断片**に触れていません: ${JSON.stringify(why)}`)
      console.error(`  断片: ${JSON.stringify(entry.span)}`)
      unlockEdge(lock); process.exit(1)
    }
    entry.node.hold = { of: entryKeyOf(entry), why, at: new Date().toISOString() }
    saveEdge(edgeId(e), m); unlockEdge(lock)
    console.log(`OK ${entry.id} を本人の判断へ回しました`)
    console.log('  **決着していません。** approval-report に「本人待ち」として残り続けます。')
    if (entry.node.rebuttal && entry.node.rebuttal.of === entryKeyOf(entry)) {
      console.log('  ※ この断片には反論の記録が残っています（消していません）。')
      console.log(`     ${String(entry.node.rebuttal.why || '').slice(0, 60)}`)
    }
  }
}

else if (cmd === 'stale-diff') {
  // ── 通し直した単位で、前に在った要求が消えていないか ──────────────────
  //
  // 上位を直すとその単位は陳腐化し、分解からやり直しになる。**分解役は前回と違う人**なので、
  // 切り方が変わる。実測（2026-09-20）: 表の 1 行に限定を足して通し直したら、
  // 要求が 3 件 → 1 件になった。消えた 1 件は前回 `一致` が付いていたもので、
  // 新しい分解役はその部分を「ラベル・項目名」として対象外にした。
  // **文書は壊れていない。台帳の網が 1 目粗くなっただけ**——だから誰も気づかない。
  //
  // **どれが消えたかは機械には決められない。** 言い換えただけかもしれない。
  // だから判定はしない。**前と今を必ず並べて出す**ところまでを機械がやる。
  // 人が覚えていたら控える、では控え忘れる（実際、控えたのは指示があったときだけだった）。
  //
  // sync は陳腐化のときに前の分解を `stalePrevReqs` に残し、decompose はそれを消さない。
  // つまり材料はもう在る。使っていなかっただけ。
  const e = findEdge(args[0])
  if (rest.includes('--ack-batch')) {
    // ── 同じ sync の回にまとめて壊れたものを、まとめて畳む ──────────────
    //
    // 実測（2026-09-20）: 2026-09-16 の陳腐化の連鎖で **23 単位**の前の分解が
    // 隣の行のものになっていた。語の共有で付けた「疑い」の印は **16 件しか捕まえない**
    // （ずれた先と語を共有してしまうと付かない）。**当て推量は 7 件取りこぼした。**
    //
    // 一方 `staleAt` は**同じ sync の回なら完全に一致する**。当て推量ではない。
    // 事故は回ごとに起きるので、畳むのも回ごとが正しい。
    //
    // **ただし、まとめて畳むのは「中身を 1 件ずつ見ていない」ということ。**
    // だから記録に `batch` を残し、報告でも**まとめて畳んだ件数として別に数える**。
    // 1 件ずつの理由を求めると、同じ一文を 23 回書き写すだけになる——
    // それは考えた証拠ではなく、検査を通すための水増しになる。
    const at = String(opt('ack-batch') || '')
    const why = String(opt('why') || '').trim()
    if (!at) { console.error('--ack-batch <陳腐化した時刻> を指定してください'); process.exit(1) }
    if (why.length < 20 || !why.includes(at.slice(0, 10))) {
      console.error(`まとめて畳む理由が不十分です（20 文字以上・日付「${at.slice(0, 10)}」を含むこと）: ${JSON.stringify(why)}`)
      console.error('  **1 件ずつ見ていないことを、記録に残すための理由です。** 何の回だったかを書いてください。')
      process.exit(1)
    }
    const lock = lockEdge(edgeId(e)); const m = loadEdge(edgeId(e))
    let n = 0
    for (const r of m.values()) {
      // **秒まででそろえる。** 実測（2026-09-20）: 同じ sync の回なのに
      // `staleAt` が `.847Z` と `.848Z` に割れていた——単位ごとに時刻を取っているため。
      // ミリ秒で一致を求めると、1 回の事故が 2 つに見えて片方が残る。
      if (String(r.staleAt || '').slice(0, 19) !== String(at).slice(0, 19)) continue
      if (!Array.isArray(r.stalePrevReqs) || !Array.isArray(r.reqs)) continue
      r.recutAck = { at: new Date().toISOString(), why, batch: at,
        prev: r.stalePrevReqs.length, now: r.reqs.length }
      delete r.stalePrevReqs
      n++
    }
    saveEdge(edgeId(e), m); unlockEdge(lock)
    console.log(`OK ${n} 単位をまとめて確認済みにしました（陳腐化 ${at}）`)
    if (!n) console.log('  **0 件でした。** 時刻が違うか、まだ分解し直していません。')
  }

  else if (rest.includes('--ack')) {
    // 見たうえで「これでよい」と決めたら外す。**理由なしには外せない。**
    const unitId = String(opt('ack') || '')
    const why = String(opt('why') || '').trim()
    const lock = lockEdge(edgeId(e)); const m = loadEdge(edgeId(e))
    const r = m.get(unitId)
    if (!r) { console.error(`${unitId} が台帳にありません`); unlockEdge(lock); process.exit(1) }
    if (!Array.isArray(r.stalePrevReqs)) {
      console.error(`${unitId} には比べる前の分解がありません`); unlockEdge(lock); process.exit(1)
    }
    // **通し直す前に「確認済み」にはできない。** 先に外せてしまうと、
    // 前後を見ないまま前の分解が消え、何が減ったのか誰にも分からなくなる。
    if (!Array.isArray(r.reqs)) {
      console.error(`${unitId} はまだ分解し直していません。通し直してから確認してください。`)
      unlockEdge(lock); process.exit(1)
    }
    if (why.length < 10 || !touchesSource(why, r.text || '')) {
      console.error(`理由が不十分です（10 文字以上・原文の語を含むこと）: ${JSON.stringify(why)}`)
      console.error(`  原文: ${r.text}`)
      console.error('  **前に在った要求が消えたことを承知した、という記録です。** 何を確かめたかを書いてください。')
      unlockEdge(lock); process.exit(1)
    }
    r.recutAck = { at: new Date().toISOString(), why, prev: r.stalePrevReqs.length, now: (r.reqs || []).length }
    delete r.stalePrevReqs
    saveEdge(edgeId(e), m); unlockEdge(lock)
    console.log(`OK ${unitId} の通し直しを確認済みにしました`)
  } else {
    const m = loadEdge(edgeId(e)); const inScope = scopeFilter()
    let batched = 0
    for (const r of m.values()) { if (r.recutAck && r.recutAck.batch) batched++ }
    const rows = []
    for (const r of m.values()) {
      if (!inScope(r)) continue
      if (!Array.isArray(r.stalePrevReqs) || !Array.isArray(r.reqs)) continue
      const prev = r.stalePrevReqs.map(q => ({
        text: String(q.text || ''), verdict: q.verdict || null, plan: (q.plan && q.plan.kind) || null }))
      const now = r.reqs.map(q => ({ text: String(q.text || '') }))
      // ── 前の記録が「この単位のもの」かどうか ────────────────────────
      // 実測（2026-09-20）: 16 件のうち 8 件で、前の分解が**隣の行のもの**だった。
      // `staleAt` が 8 件とも 2026-09-16T23:45:57 で揃っている——
      // **陳腐化の連鎖を直す前日**で、表に 1 行増えて以降が 1 行ずつずれた事故の残り。
      // そのまま「消えた要求」と読むと数を多く見積もる。
      //
      // 見分けは、**陳腐化したときの本文といまの本文が 1 語も共有していないか**。
      // 本文を書き換えただけの通し直しなら主題の語は残る（「ミキサー画面」など）。
      // 主題ごと入れ替わっているなら、それは別の行の記録。
      // **当て推量の目印なので、落としも取りこぼしもする。** 数から外さず、印を付けるだけ。
      const suspect = !!r.staleText && !sharesToken(String(r.staleText), String(r.text || ''))
      // **数が減っていなくても、中身が入れ替わっていることがある。**
      // 実測（2026-09-23、turn 47）: 一覧に出たのは要求が減った 8 単位だけで、
      // 同じ数のまま文が入れ替わった単位（前 3 件 → 今 3 件など）は出なかった。
      // 前の文が今に 1 つも同じ形で無いものを数える。**言い換えかどうかは決めない**（人が読む）。
      const nowSet = new Set(now.map(q => q.text.trim()))
      const lost = prev.filter(q => !nowSet.has(q.text.trim())).length
      rows.push({ unitId: r.unitId, file: r.file, line: r.line, section: r.section,
        staleAt: r.staleAt || null, staleText: r.staleText ? String(r.staleText).slice(0, 60) : null,
        suspect,
        prevCount: prev.length, nowCount: now.length,
        dropped: Math.max(0, prev.length - now.length),
        lost,
        prevJudged: prev.filter(x => x.verdict).length,
        prevAgree: prev.filter(x => x.verdict === '一致').length,
        prev, now })
    }
    const shrunk = rows.filter(x => x.dropped > 0)
    const replaced = rows.filter(x => x.dropped === 0 && x.lost > 0)
    const out = { edge: edgeId(e), units: rows.length, shrunk: shrunk.length,
      replaced: replaced.length, lostInReplaced: replaced.reduce((a, x) => a + x.lost, 0),
      droppedTotal: shrunk.reduce((a, x) => a + x.dropped, 0),
      prevAgreeInShrunk: shrunk.reduce((a, x) => a + x.prevAgree, 0),
      suspect: rows.filter(x => x.suspect).length, batched, rows }
    if (json) console.log(JSON.stringify(out, null, 2))
    else {
      console.log(`${edgeId(e)}  通し直した単位 ${out.units} 件`)
      // **陳腐化した時刻ごとに並べる。** 同じ回にまとめて壊れたものは時刻が完全に一致する。
      // 語の共有で付けた「疑い」の印より、こちらのほうが確かな手がかり（実測で 23 対 16）。
      const byAt = new Map()
      for (const x of rows) { const k = x.staleAt || '(不明)'; byAt.set(k, (byAt.get(k) || 0) + 1) }
      if (byAt.size) {
        console.log('  陳腐化した回ごと:')
        // **秒でまとめて出す。** ミリ秒で分けると 1 回の事故が 2 行に見える（実測）。
        const bySec = new Map()
        for (const [k, v] of byAt.entries()) {
          const key = String(k).slice(0, 19)
          bySec.set(key, (bySec.get(key) || 0) + v)
        }
        for (const [k, v] of [...bySec.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`    ${k}  ${v} 単位${v >= 5 ? '  ← 同じ回。連鎖の疑い' : ''}`)
        }
      }
      console.log(`  **要求が減った単位 ${out.shrunk} 件（要求 ${out.droppedTotal} 件ぶん）**`)
      console.log(`  そのうち、前に「一致」が付いていた要求 ${out.prevAgreeInShrunk} 件`)
      console.log(`  **数は減っていないが、前の文が今に同じ形で無い単位 ${out.replaced} 件（前の要求 ${out.lostInReplaced} 件ぶん）**`)
      if (out.suspect) {
        console.log(`  **うち ${out.suspect} 件は、前の記録が別の行のものである疑いがあります**`)
        console.log('    （陳腐化したときの本文と、いまの本文が 1 語も共有していない）')
        console.log('    **この印は取りこぼします。** ずれた先と語を共有すると付きません')
        console.log('    （実測 2026-09-20: 事故は 23 単位、印が付いたのは 16 件）。')
        console.log('    **回ごとにまとめて見るなら、上の「陳腐化した回ごと」のほうが確かです。**')
      }
      if (batched) console.log(`  （別に、まとめて畳んだ単位が ${batched} 件あります。1 件ずつは見ていません）`)
      console.log('  **どれが消えたかは機械には決められません。下の前後を人が読んでください。**')
      // 減っていなくても、**前の記録が別の行のものなら読む価値がある**（畳んでよいか決まる）。
      for (const x of rows.filter(y => y.dropped > 0 || y.lost > 0 || y.suspect)) {
        console.log(`\n  ${x.unitId}  ${x.file}:${x.line}${x.suspect ? '  ← **前の記録が別の行のものである疑い**' : ''}`)
        if (x.suspect) {
          console.log(`    陳腐化したときの本文: ${JSON.stringify(x.staleText)}`)
          console.log(`    いまの本文          : ${JSON.stringify(String(m.get(x.unitId)?.text || '').slice(0, 60))}`)
          console.log('    **この 2 つが別の話なら、下の「前」はこの単位のものではありません。**')
        }
        console.log(`    前 ${x.prevCount} 件 → 今 ${x.nowCount} 件`)
        x.prev.forEach(q => console.log(`      前: ${q.text.slice(0, 70)}${q.verdict ? `  [${q.verdict}]` : ''}${q.plan ? ` (${q.plan})` : ''}`))
        x.now.forEach(q => console.log(`      今: ${q.text.slice(0, 70)}`))
        console.log(`    これでよければ: node .claude/scripts/ledger.mjs stale-diff ${JSON.stringify(edgeId(e))} --ack ${JSON.stringify(x.unitId)} --why "…"`)
      }
      const same = rows.filter(y => !(y.dropped > 0 || y.lost > 0 || y.suspect)).length
      if (same) console.log(`\n  （ほかの ${same} 単位は、前の文がすべて今にも同じ形で在ります。--ack するまで完了にはなりません）`)
      if (!shrunk.length && !replaced.length && !out.suspect && rows.length) console.log('  減った単位も、入れ替わった単位もありません。')
    }
  }
}

else if (cmd === 'approve-show') {
  // 1 断片だけを取り出す。**judge 向けの show とは別口にしてある。**
  // judge の show は「下位を開いて突き合わせろ」と書いた payload を返すので、
  // 承認する側にそれを渡すと、下位を開く経路をこちらから教えることになる。
  const e = findEdge(args[0]); const found = findEntry(e, args[1])
  const a = entryApproval(found.entry)
  console.log(JSON.stringify({
    phase: 'approve', edge: edgeId(e), verdicts: APPROVAL_VERDICTS, nonReqKinds: NON_REQ_KINDS,
    criterion: APPROVE_CRITERION, note: APPROVE_NOTE,
    state: a.state,
    ...approvePayloadOf(found.r, found.entry),
  }, null, 2))
}

else if (cmd === 'approve-next') {
  // 承認する側に渡す一覧。**まだ誰も見ていない断片だけ**を出す。
  //
  // 渡すもの: 原文・その断片・分解した側がどう扱ったか。
  // 渡さないもの: 分解した側の理屈（記録に無い）、語尾の型（仮説の検証を汚す）、
  //               他の断片の承認結果（前の答えに引きずられる）。
  const e = findEdge(args[0]); const n = limitOf(args[1]); const inScope = scopeFilter()
  const idsOnly = rest.includes('--ids-only')
  const m = loadEdge(edgeId(e))
  const todo = []
  for (const r of m.values()) {
    if (!inScope(r) || !Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      if (entryApproval(en).state !== '未承認') continue
      if (todo.length >= n) break
      todo.push(approvePayloadOf(r, en))
    }
  }
  const inS = [...m.values()].filter(inScope)
  const warn = scopeWarning(e, m, inScope)
    || (todo.length === 0 && inS.length && !inS.some(r => Array.isArray(r.reqs))
        ? `この範囲はまだ 1 件も分解されていません（単位 ${inS.length}）。**承認するものが無いのではなく、分解がまだです。**\n` +
          `  先に: node .claude/scripts/ledger.mjs next ${JSON.stringify(edgeId(e))} --phase decompose`
        : null)
  const counts = { unitsInScope: inS.length, decomposedInScope: inS.filter(r => Array.isArray(r.reqs)).length }
  const payload = idsOnly
    ? { phase: 'approve', edge: edgeId(e), ...counts, count: todo.length, ids: todo.map(x => x.entryId), warning: warn || undefined }
    : { phase: 'approve', edge: edgeId(e), verdicts: APPROVAL_VERDICTS, nonReqKinds: NON_REQ_KINDS,
        criterion: APPROVE_CRITERION, note: APPROVE_NOTE,
        ...counts, count: todo.length, entries: todo, warning: warn || undefined }
  console.log(JSON.stringify(payload, null, 2))
  // 警告は**標準エラーにも出す。** payload の中だけだと、人が読むときに本文に埋もれる。
  if (warn) console.error(`\n${warn}\n`)
}

else if (cmd === 'approve') {
  // 1 断片に 1 つの判定を記録する。
  const e = findEdge(args[0]); const entryId = args[1]; const verdict = args[2]
  let body
  try { body = args[3] ? JSON.parse(args[3]) : {} } catch { console.error('承認の内容は JSON オブジェクトで渡してください'); process.exit(1) }
  if (!APPROVAL_VERDICTS.includes(verdict)) { console.error(`承認の判定は次のいずれか: ${APPROVAL_VERDICTS.join(' / ')}`); process.exit(1) }
  const lock = lockEdge(edgeId(e))
  const found = findEntry(e, entryId, loadEdge(edgeId(e)))
  const { r, entry } = found
  const why = String(body.why || '').trim()
  if (why.length < 15 || !touchesSource(why, r.text)) {
    console.error('承認の理由が不十分です（15 文字以上・原文の語を含むこと）。')
    console.error(`  原文: ${r.text}`)
    console.error(`  理由: ${JSON.stringify(why)}`)
    console.error('  なぜ**この断片が**そうなのかを、原文に触れて書いてください。どの断片にも貼れる文は理由ではありません。')
    process.exit(1)
  }
  const rec = { verdict, why, of: entryKeyOf(entry), at: new Date().toISOString() }
  if (verdict === '要求') {
    // **ここが承認の本体。** 感想ではなく作文を課す。
    // 「（PC版）を対象とした利用シーンである」を満たす設計書の一文は書けない。
    // 書けないものは要求ではない、という定義をそのまま作業にしている。
    const expect = String(body.expect || '').trim()
    if (expect.length < 12) {
      console.error('「要求」と答えるときは expect（この要求が満たされたとき下位の文書に現れるはずの一文）が必須です（12 文字以上）。')
      console.error(`  断片: ${JSON.stringify(entry.span)}`)
      console.error('  **書けないなら要求ではありません。** その場合は「要求でない」を選んでください。')
      process.exit(1)
    }
    if (!sharesToken(expect, entry.span) && !sharesToken(expect, entry.text)) {
      console.error('expect が、この断片と 1 語も共有していません。別の断片の話になっています。')
      console.error(`  断片: ${JSON.stringify(entry.span)}`)
      console.error(`  expect: ${JSON.stringify(expect)}`)
      process.exit(1)
    }
    rec.expect = expect
    const hit = expectFoundBelow(e, expect)
    if (hit) {
      // 止めない。記録して数える。
      rec.expectVerbatimIn = `${hit.file}:${hit.line}`
      console.log(`△ expect が下位の文書と逐語一致しています（${hit.file}:${hit.line}）。`)
      console.log('  承認は**上位だけを見て**答える作業です。下位を開いて写していませんか。')
      console.log('  下位を見ると「下位に書いてあるから要求だ」という逆立ちした判断になり、**漏れが漏れでなくなります。**')
    }
  } else if (verdict === '要求でない') {
    const kind = String(body.kind || '').trim()
    if (!NON_REQ_KINDS.includes(kind)) {
      console.error(`「要求でない」と答えるときは kind が必須です。次のいずれか: ${NON_REQ_KINDS.join(' / ')}`)
      console.error('  どれにも当てはまらないなら、それは要求である可能性があります。')
      process.exit(1)
    }
    rec.kind = kind
  } else {
    const resolvesBy = String(body.resolvesBy || '').trim()
    if (resolvesBy.length < 10) {
      console.error('「判断できない」と答えるときは resolvesBy（何を確かめれば決着するか）が必須です（10 文字以上）。')
      console.error('  決着のしかたを書けない保留は、ただの棄権です。')
      process.exit(1)
    }
    rec.resolvesBy = resolvesBy
  }
  // **本人待ちの断片の承認を、承認の側から書き換えさせない。**（v28 T3）
  // 承認を置き換えると、答えが分解した側と合った瞬間に「承認」へ変わり、本人待ちから抜ける
  // （entryApproval は「合っているか」を本人待ちより先に見る）。決めるのは本人のコマンドだけ。
  const before = entryApproval(entry)
  if (before.state === '本人待ち') {
    console.error(`${entryId} は「本人待ち」です。承認し直すことはできません。本人が決めます。`)
    console.error(`  要求から外す: node .claude/scripts/ledger.mjs concede ${JSON.stringify(edgeId(e))} ${JSON.stringify(entry.id)} --why "…"`)
    console.error(`  分解した側の扱いのまま残す: node .claude/scripts/ledger.mjs uphold ${JSON.stringify(edgeId(e))} ${JSON.stringify(entry.id)} --why "…"`)
    unlockEdge(lock); process.exit(1)
  }
  entry.node.approval = rec
  delete entry.node.rebuttal
  // 新しい 1 周目は、前の 1 周目に対して聞いた 2 周目を無効にする（2 周目は 1 周目と対になって意味を持つ）。
  // 分解し直しで 2 周目を引き継ぐようにしたので、ここで外さないと古い 2 周目が新しい承認に付いて残る。
  if (entry.node.second) { entry.node.priorRecords = { ...(entry.node.priorRecords || {}), second: entry.node.second }; delete entry.node.second }
  saveEdge(edgeId(e), found.map)
  unlockEdge(lock)
  const st = entryApproval(entry).state
  console.log(`OK ${entryId} = ${verdict}  → ${st}`)
  if (st === '指摘') {
    console.log(`  分解した側は「${entry.kind === 'req' ? '要求' : '対象外'}」として扱っています。食い違いました。`)
    console.log('  **この断片は消えません。** 次のどちらかで決着させてください:')
    if (entry.kind === 'req') {
      console.log(`    同意する: node .claude/scripts/ledger.mjs concede ${JSON.stringify(edgeId(e))} ${JSON.stringify(entryId)}`)
    } else {
      console.log(`    直す    : node .claude/scripts/ledger.mjs decompose ${JSON.stringify(edgeId(e))} ${JSON.stringify(r.unitId)} '[…]'`)
    }
    console.log(`    反論する: node .claude/scripts/ledger.mjs rebut ${JSON.stringify(edgeId(e))} ${JSON.stringify(entryId)} '{"expect":"…","why":"…"}'`)
  }
}

else if (cmd === 'rebut') {
  // 指摘に反論して、分解した側の扱いを維持する。
  //
  // **反論にも同じ作文を課す。** 承認する側が「要求」と言うために
  // expect を書かされるのと同じものを、維持する側にも要求する。
  // そうしないと「反論」が無料になり、指摘を全部撥ねて終わりにできる。
  const e = findEdge(args[0]); const entryId = args[1]
  let body = {}
  // --clear のときは 3 つ目の引数が --why の値になるので、JSON として読まない
  if (!rest.includes('--clear')) {
    try { body = args[2] ? JSON.parse(args[2]) : {} } catch { console.error('反論は JSON オブジェクトで渡してください'); process.exit(1) }
  }
  const lock = lockEdge(edgeId(e))
  const found = findEntry(e, entryId, loadEdge(edgeId(e)))
  const { r, entry } = found
  const st = entryApproval(entry).state
  // ── 反論を取り消す（--clear）─────────────────────────────────────────
  // 実測（2026-09-24、turn 54）: 承認のワークフローの書き戻し役（判断する役ではない）が、
  // 承認役の言い分をそのまま写した「反論」を 4 件置いた。中身が逆向きで、実質は誰も決めていない。
  // 戻す道が無かった——concede は対象外の断片には使えず、hold は 2 周目の後でしか使えない。
  // **記録は消さない**（clearedRebuttals に残す）。状態だけを「指摘」に戻す。
  if (rest.includes('--clear')) {
    const cur = entry.node.rebuttal
    if (!cur || cur.of !== entryKeyOf(entry) || st !== '反論で維持') {
      console.error(`${entryId} には取り消せる反論がありません（いまの状態: ${st}）。`)
      process.exit(1)
    }
    const cwhy = String(opt('why') || '').trim()
    if (cwhy.length < 15) {
      console.error(`反論を取り消す理由が不十分です（15 文字以上）: ${JSON.stringify(cwhy)}`)
      console.error('  **誰が置いた反論を、なぜ無効とするか**を書いてください。記録に残ります。')
      process.exit(1)
    }
    entry.node.clearedRebuttals = [...(entry.node.clearedRebuttals || []),
      { ...cur, clearedAt: new Date().toISOString(), clearedWhy: cwhy }]
    delete entry.node.rebuttal
    saveEdge(edgeId(e), found.map)
    unlockEdge(lock)
    console.log(`OK ${entryId} の反論を取り消しました → 指摘に戻りました（前の反論は clearedRebuttals に残っています）`)
    process.exit(0)
  }
  if (st !== '指摘') {
    console.error(`${entryId} は「指摘」ではありません（いまの状態: ${st}）。反論できるのは指摘を受けた断片だけです。`)
    process.exit(1)
  }
  const why = String(body.why || '').trim()
  if (why.length < 20 || !touchesSource(why, r.text)) {
    console.error('反論が不十分です（20 文字以上・原文の語を含むこと）。')
    console.error(`  原文: ${r.text}`)
    process.exit(1)
  }
  // concede と同じ理由で、**その断片に触れていること**を求める（上のコメント参照）。
  if (tokensOf(entry.span).size && !sharesToken(why, entry.span)) {
    console.error(`反論が**この断片**に触れていません: ${JSON.stringify(why)}`)
    console.error(`  断片: ${JSON.stringify(entry.span)}`)
    console.error('  **指定した断片が思っているものと違う可能性もあります。** 上の断片を確かめてください。')
    process.exit(1)
  }
  const rec = { why, of: entryKeyOf(entry), at: new Date().toISOString() }
  if (entry.kind === 'req') {
    // 「要求でない」と指摘された要求を維持する側は、
    // 承認する側が「要求」と言うときと同じ一文を書けなければならない。
    const expect = String(body.expect || '').trim()
    if (expect.length < 12 || (!sharesToken(expect, entry.span) && !sharesToken(expect, entry.text))) {
      console.error('要求として維持するなら expect（この要求が満たされたとき下位の文書に現れるはずの一文）が必須です（12 文字以上・この断片の語を含むこと）。')
      console.error(`  断片: ${JSON.stringify(entry.span)}`)
      console.error('  **書けないなら、指摘のほうが正しいということです。** 分解を直してください。')
      process.exit(1)
    }
    rec.expect = expect
  }
  entry.node.rebuttal = rec
  saveEdge(edgeId(e), found.map)
  unlockEdge(lock)
  console.log(`OK ${entryId} → 反論で維持（記録に残ります）`)
  console.log('  **反論で通した件数は stats に別枠で出ます。** 多いときは、承認する側ではなく分解のほうを疑ってください。')
}

else if (cmd === 'concede') {
  // 指摘に同意して、要求を同じ断片の対象外へ移す。
  //
  // **なぜコマンドにしたか。**
  // 手でやるには分解をまるごと書き直すことになり、そのとき
  // **指摘を受けていない断片を 1 文字でも変えると、その承認まで消える。**
  // 直すのが一番高くつくと、承認を通す最短経路が「反論して押し切る」になる。
  // そこは絶対に逆にしない、というのがこの仕組みの土台なので、
  // **同意するのが一番安い**ようにしておく。
  //
  // 区間（span）は動かさないので、重なり・取り残し・下限の検査結果は変わらない。
  // 変わるのは「要求として数えるか、理由つきで外すか」だけ。
  const e = findEdge(args[0]); const entryId = args[1]
  const lock = lockEdge(edgeId(e))
  const found = findEntry(e, entryId, loadEdge(edgeId(e)))
  const { r, entry } = found
  const a = entryApproval(entry)
  // **「反論で維持」「本人待ち」からも同意できる。**
  //
  // 実測（2026-09-20 → 21）: 同じ型を 3 回踏んだ。
  //   1. Stop hook に「待つ」終わり方が無く、本人へ回すはずの判断が `rebut` で置かれた
  //   2. それを戻そうとしたら `hold` が「反論で維持」を受けなかった
  //   3. 本人が「1 周目が正しい」と決めたのに、`concede` が同じ理由で受けなかった
  //
  // **決めたことを取り消す道が、決めた状態からは通っていなかった。**
  // 反論は「決めた」記録だが、決め直してはいけないわけではない。
  // 記録（rebuttal）は消さずに残し、**状態だけを動かす**。
  //
  // 入口を足すときは、**同じ状態から入る他のコマンドも一緒に見ること。**
  // 1 つ直して隣が残っていると、同じところで 2 度止まる（実際に 2 度止めた）。
  if (a.state !== '指摘' && a.state !== '反論で維持' && a.state !== '本人待ち') {
    console.error(`${entryId} は「${a.state}」です。同意できるのは、承認と食い違った断片（指摘・反論で維持・本人待ち）だけです。`)
    process.exit(1)
  }
  if (a.state === '本人待ち') requireHumanTerminal('本人待ちの断片への concede（要求から外すと本人が決める）')
  if (entry.kind !== 'req') {
    // 逆向き（対象外にしたものを「要求である」と指摘された）は自動で直せない。
    // **要求の文は分解した側が書くものだから。** 機械が作文すると、
    // 誰も書いていない要求が台帳に載る。
    console.error(`${entryId} は対象外として書かれた断片で、「要求である」と指摘されています。`)
    console.error('  **要求の文は自動では作れません。** 分解し直して、その断片を要求として書いてください:')
    console.error(`    node .claude/scripts/ledger.mjs decompose ${JSON.stringify(edgeId(e))} ${JSON.stringify(r.unitId)} '[…]'`)
    process.exit(1)
  }
  const why = String(opt('why') || '').trim()
    || `${a.approval.kind}であり、${String(entry.span).slice(0, 20)} は下位へ降ろす要求を含まない`
  if (why.length < 15 || !touchesSource(why, r.text)) {
    console.error(`対象外にする理由が不十分です（15 文字以上・原文の語を含むこと）: ${JSON.stringify(why)}`)
    console.error(`  原文: ${r.text}`)
    console.error('  --why "<なぜこの部分が要求でないか>" で書き直してください。')
    process.exit(1)
  }
  // **理由は、その断片そのものに触れていること。**
  // 単位の原文に触れているだけだと、同じ単位のどの断片にも貼れてしまう。
  // 実測（2026-09-17）: 添字がずれて別の断片に当たったとき、
  // 「クリーンエレキ」についての理由が「歪みエレキ」に付いたまま通った。
  // 断片の語を要求していれば、そこで止まっていた。
  //
  // 断片が助詞や記号だけで語を持たないことがある（「＋」「を含む）」）。
  // そのときは**この検査を掛けない**——掛けると正当な同意まで通らなくなる。
  if (tokensOf(entry.span).size && !sharesToken(why, entry.span)) {
    console.error(`理由が**この断片**に触れていません: ${JSON.stringify(why)}`)
    console.error(`  断片: ${JSON.stringify(entry.span)}`)
    console.error('  同じ単位の別の断片にも貼れる理由は、その断片を落とす理由になりません。')
    console.error('  **指定した断片が思っているものと違う可能性もあります。** 上の断片を確かめてください。')
    process.exit(1)
  }
  // **決着したので、本人待ちは終わり。** 宙ぶらりんの記録を残さない。
  const wasWaiting = a.state === '本人待ち'
  const hadRebuttal = a.state === '反論で維持' || !!(a.rebuttal)
  applyConcede(r, entry, a, why)
  saveEdge(edgeId(e), found.map)
  unlockEdge(lock)
  console.log(`OK ${entryId} → 対象外へ移しました（要求 ${r.reqs.length} 件 / 対象外 ${r.skips.length} 件）`)
  console.log(`  理由: ${why}`)
  if (wasWaiting) console.log('  本人待ちは終わりです（決着したため）。')
  if (hadRebuttal) console.log('  ※ 反論の記録は priorRecords に残しました。**同意のほうが後の判断なので、こちらが結論です。**')
  if (!r.reqs.length) console.log('  ← この単位は**要求ゼロ**になりました。pending に件数が出ます。')
}

else if (cmd === 'uphold') {
  // 本人が「これは要求である」と決める。**concede の裏返し。**
  //
  // **入口は concede と同じ 3 つ。** 片方だけ直すと、同じところで 2 度止まる。
  // 実測で 3 回踏んだ型（Stop hook → hold → concede）の 4 つ目がここだった。
  const e = findEdge(args[0]); const entryId = args[1]
  const lock = lockEdge(edgeId(e))
  const found = findEntry(e, entryId, loadEdge(edgeId(e)))
  const { r, entry } = found
  const a = entryApproval(entry)
  requireHumanTerminal('uphold（承認を覆して、分解した側の扱いのまま残す）')
  if (a.state !== '指摘' && a.state !== '反論で維持' && a.state !== '本人待ち') {
    console.error(`${entryId} は「${a.state}」です。本人が決められるのは、承認と食い違った断片（指摘・反論で維持・本人待ち）だけです。`)
    unlockEdge(lock); process.exit(1)
  }
  // **対象外の断片にも使える**（本人が「対象外のままでよい」と決める）。
  // 逆に「対象外の断片を要求にする」と決めたときは、このコマンドではなく分解し直す。
  // **要求の文は分解した側が書くもの**で、機械が作文すると誰も書いていない要求が台帳に載るため。
  // **理由は本人が書く。既定値を置かない。**
  // concede には既定値があるが、あちらは「承認側の判定をそのまま採る」ので機械にも書ける。
  // こちらは承認側を覆すので、**何を見て覆したかが本人の言葉で要る。**
  const why = String(opt('why') || '').trim()
  if (why.length < 15 || !touchesSource(why, r.text)) {
    console.error(`分解した側の扱いのまま残す理由が不十分です（15 文字以上・原文の語を含むこと）: ${JSON.stringify(why)}`)
    console.error(`  原文: ${r.text}`)
    console.error('  --why "<なぜこれが要求なのか>" で書き直してください。')
    unlockEdge(lock); process.exit(1)
  }
  if (tokensOf(entry.span).size && !sharesToken(why, entry.span)) {
    console.error(`理由が**この断片**に触れていません: ${JSON.stringify(why)}`)
    console.error(`  断片: ${JSON.stringify(entry.span)}`)
    console.error('  同じ単位の別の断片にも貼れる理由は、この断片を残す理由になりません。')
    unlockEdge(lock); process.exit(1)
  }
  const wasWaiting = a.state === '本人待ち'
  const hadRebuttal = a.state === '反論で維持' || !!(a.rebuttal)
  const prevKind = a.approval && a.approval.kind
  applyUphold(entry, a, why)
  saveEdge(edgeId(e), found.map)
  unlockEdge(lock)
  console.log(`OK ${entryId} → **本人の判断で${entry.kind === 'req' ? '要求' : '対象外'}のまま残しました**（状態: ${entryApproval(entry).state}）`)
  console.log(`  理由: ${why}`)
  if (wasWaiting) console.log('  本人待ちは終わりです（決着したため）。')
  if (hadRebuttal) console.log('  ※ 反論の記録は priorRecords に残しました。**本人の判断のほうが後なので、こちらが結論です。**')
  if (prevKind) console.log(`  ※ 承認側の「要求でない（${prevKind}）」も priorRecords に残しました。**消していません。**`)
  // **判定済みのものに「未判定です」と出さない。**
  // uphold が動かすのは承認の側だけで、判定（verdict）には触れない。
  // 実測（2026-09-22）: 実物の台帳で試したら、判定済みの要求に「未判定です」と出た。
  if (entry.kind !== 'req') {
    console.log('  対象外の断片なので、判定（judge）の対象にはなりません。')
  } else if (!r.reqs[entry.idx] || !r.reqs[entry.idx].verdict) {
    console.log('  **判定（judge）はまだです。** この要求は未判定として pending に出ます。')
  } else {
    console.log(`  判定は「${r.reqs[entry.idx].verdict}」のままです。**uphold が動かすのは承認の側だけです。**`)
  }
}

else if (cmd === 'ask') {
  // 決着に**本人の判断が要る**ものを集めて、まとめて質問にする。
  //
  // なぜ 1 件ずつ聞かないか:
  //   分解や承認の途中で「等の中身は？」と 15 回割り込まれても答えられない。
  //   **最後にまとめて渡す**ほうが、同じ章のものを一度に決められる。
  //
  // なぜ AI に質問文を書かせないか:
  //   「よく質問してから書く」は規約にすると必ず形骸化する。
  //   何が未確定かは機械が本文から見つけ（lib/wording.mjs）、質問文も機械が作る。
  //   **聞くべきことを AI に当てさせない。**
  //
  // 集めるもの:
  //   保留（承認する側が「判断できない」と答えたもの）… 定義上ここに来る
  //   指摘のうち、原文に未確定点があるもの            … 同じ原因で止まっている
  const e = findEdge(args[0]); const inScope = scopeFilter()
  const answers = loadAnswers(edgeId(e))
  const all = rest.includes('--all')
  const { items: allItems, groups: allGroups } = askGroups(e, inScope)
  // **一度答えたものは既定で出さない。** セッションが切れて掛け直したときに
  // 同じ 14 件をもう一度聞かれると、どこまで答えたか分からなくなる。
  const groups = all ? allGroups : allGroups.filter(g => !answers.has(g.key))
  const answered = allGroups.length - groups.length
  const items = allItems.filter(x => groups.some(g => g.entryIds.includes(x.entryId)))

  if (json) { console.log(JSON.stringify({ edge: edgeId(e), count: groups.length, entries: items.length, groups }, null, 2)); }
  else if (!groups.length) {
    console.log('本人に聞くことは残っていません。')
    if (answered) {
      console.log(`（${answered} 件は答えを記録済みです。--all で全件出ます。`)
      console.log(`  何をどう直すかは ask-report ${JSON.stringify(edgeId(e))} に出ています。）`)
    } else {
      console.log('（保留と、断片に未閉鎖の列挙がある指摘だけをここに集めています。')
      console.log('  それ以外の指摘は concede / rebut で決着させてください。）')
    }
  } else {
    console.log(`# ${edgeId(e)} — 決めてほしいこと ${groups.length} 件（断片 ${items.length}）\n`)
    console.log('以下は**要件定義書の書き方が決まっていない**ために、下位へ何を降ろすか決まらない箇所です。')
    console.log('分解のしかたの問題ではないので、**原文を直さないと先へ進めません。**')
    console.log('（Claude Code からは `/ask` で、選択肢つきの質問として出せます。）\n')
    groups.forEach((g, i) => {
      console.log('─'.repeat(72))
      console.log(`## ${i + 1}. ${g.file}:${g.line}${g.section ? `  §${String(g.section).split(' > ').pop()}` : ''}`)
      console.log(`\n   原文:\n     ${String(g.source).slice(0, 200)}`)
      console.log(`\n   止まっている部分: ${JSON.stringify(g.span)}`)
      g.findings.forEach(f => {
        console.log(`\n   ${f.kind}${f.hits.length ? `  「${f.hits.join('」「')}」` : ''}`)
        console.log(`     ${f.why}`)
        console.log(`     **聞くこと: ${f.ask}**`)
      })
      if (g.resolvesBy) console.log(`\n   決着条件（承認する側の見立て）:\n     ${String(g.resolvesBy).slice(0, 220)}`)
      console.log(`\n   決め方は 2 通り:`)
      console.log(`     A) 列挙を書き足して閉じる → 足した分が新しい要求として台帳に載る`)
      console.log(`     B) 曖昧な語を消して言い切る（追加対応しない）→ この断片は要求でなくなる`)
      console.log(`   **どちらでもよいが、そのままにはできません。** 下位に何を書けばよいか決まらないので。`)
    })
    console.log('─'.repeat(72))
    console.log(`\n答えが返ったら、**その場で 1 件ずつ記録してください。**`)
    console.log(`    node .claude/scripts/ledger.mjs ask-record ${JSON.stringify(edgeId(e))} <key> --question "<聞いたこと>" --answer "<返ってきた答え>"`)
    console.log(`  まとめて最後に、は駄目です。**途中で切れたら全部消えます。**`)
    console.log(`  記録した答えに「等」「など」が入っていると拒否されます（閉じたつもりで閉じていないので）。`)
    console.log(`\n残りは ask-report で見られます:`)
    console.log(`    node .claude/scripts/ledger.mjs ask-report ${JSON.stringify(edgeId(e))}`)
    console.log(`\n**推測で埋めないこと。** ここに出ているのは、原文からは決められないと判定された箇所です。`)
  }
}

else if (cmd === 'ask-record') {
  // 本人の答えを残す。**AI が要件定義書に書き込む前に、ここを通す。**
  //
  // なぜ台帳（edges）ではなく別ファイルか:
  //   答えを適用すると原文が変わり、その単位は再分割で別物になる。
  //   台帳に書くと適用した瞬間に消える。**消えては記録の意味が無い。**
  //
  // なぜ AI が直接ファイルに書かないか:
  //   .claude/coverage/ は Edit/Write が禁止してある。検査される側が書けると
  //   「本人が答えた」と「AI がそう書いた」が区別できなくなる。
  const e = findEdge(args[0]); const key = args[1]
  const q = opt('question'), a = opt('answer')
  if (!key) { console.error('key がありません。ask --json の groups[].key を渡してください。'); process.exit(1) }
  const { groups } = askGroups(e, () => true)
  const g = groups.find(x => x.key === key)
  if (!g) {
    // **聞かれていないことに答えを付けさせない。** key は原文のハッシュなので、
    // 原文が既に直っていればここに来る＝もう聞く必要が無い。
    console.error(`key ${key} は、いま聞くことの一覧にありません。`)
    console.error('  原文が既に直っているか、key が違います。ask --json で取り直してください。')
    process.exit(1)
  }
  const bad = checkAnswer(g.source, q, a)
  if (bad.length) {
    console.error(`記録できません（${g.file}:${g.line}）:`)
    bad.forEach(b => console.error(`  - ${b}`))
    console.error('\n**聞き直してください。** 推測で埋めない。')
    process.exit(1)
  }
  const map = loadAnswers(edgeId(e))
  const prev = map.get(key)
  map.set(key, { key, file: g.file, line: g.line, section: g.section || null,
                 source: g.source, spans: g.spans, hits: g.findings.flatMap(f => f.hits),
                 question: String(q).trim(), answer: String(a).trim(),
                 entryIds: g.entryIds, at: new Date().toISOString(),
                 ...(prev ? { revisedFrom: prev.answer } : {}) })
  saveAnswers(edgeId(e), map)
  console.log(`OK ${g.file}:${g.line} の答えを記録しました（key ${key}）`)
  if (prev) console.log(`  上書きしました。前の答え: ${String(prev.answer).slice(0, 60)}`)
  const { groups: left } = askGroups(e, () => true)
  const remain = left.filter(x => !loadAnswers(edgeId(e)).has(x.key)).length
  console.log(`  残り ${remain} 件`)
  if (!remain) {
    console.log('\n**全件そろいました。** ここから先は要件定義書の編集です:')
    console.log(`    node .claude/scripts/ledger.mjs ask-report ${JSON.stringify(edgeId(e))}`)
    console.log('  で答えの一覧を出し、原文を直してから split → sync → stale。')
  }
}

else if (cmd === 'ask-report') {
  // 答えの一覧と、まだ聞けていないもの。**セッションが切れた後の再開口。**
  //
  // 「適用済み」は申告ではなく**原文が残っているかどうか**で決まる。
  // key は原文のハッシュなので、原文を直せば key は一覧から消える。
  const e = findEdge(args[0]); const id = edgeId(e)
  const answers = loadAnswers(id)
  const { groups } = askGroups(e, scopeFilter())
  const live = new Set(groups.map(g => g.key))
  const unanswered = groups.filter(g => !answers.has(g.key))
  const recorded = [...answers.values()].filter(r => live.has(r.key))     // 答えたが原文はそのまま
  const applied = [...answers.values()].filter(r => !live.has(r.key))     // 原文が消えた＝直した
  if (json) {
    console.log(JSON.stringify({ edge: id, unanswered: unanswered.length,
      recorded: recorded.length, applied: applied.length,
      groups: unanswered, answers: [...answers.values()] }, null, 2))
  } else {
    console.log(`# ${id} — 本人に聞くことの進み具合\n`)
    console.log(`  まだ聞いていない  ${unanswered.length}`)
    console.log(`  答えを記録した    ${recorded.length}  ← 要件定義書はまだ直していない`)
    console.log(`  原文を直した      ${applied.length}\n`)
    if (recorded.length) {
      console.log('─'.repeat(72))
      console.log('## 直すべき箇所（答えは出ている）\n')
      recorded.forEach((r, i) => {
        console.log(`${i + 1}. ${r.file}:${r.line}${r.section ? `  §${String(r.section).split(' > ').pop()}` : ''}`)
        console.log(`   原文: ${String(r.source).slice(0, 120)}`)
        console.log(`   聞いたこと: ${String(r.question).slice(0, 160)}`)
        console.log(`   **決定: ${r.answer}**`)
        if (r.revisedFrom) console.log(`   （前の答え: ${String(r.revisedFrom).slice(0, 60)}）`)
        console.log('')
      })
      console.log('─'.repeat(72))
      console.log('原文を直したら:')
      console.log('    node .claude/scripts/split.mjs --all')
      console.log(`    node .claude/scripts/ledger.mjs sync ${JSON.stringify(id)}`)
      console.log(`    node .claude/scripts/ledger.mjs stale ${JSON.stringify(id)}`)
      console.log('  直した行は原文が変わるので、この一覧から自動で「原文を直した」へ移ります。')
      console.log('  **移らなければ直っていません。** 申告ではなく原文で見ています。')
    }
    if (unanswered.length) {
      console.log(`\nまだ聞いていない ${unanswered.length} 件は ask で出せます:`)
      console.log(`    node .claude/scripts/ledger.mjs ask ${JSON.stringify(id)}`)
    }
  }
}

else if (cmd === 'settle-next') {
  // 指摘を決着させるために、**同じ問いを盲でもう一度**投げる一覧。
  //
  // なぜ承認側の判定を見せないか:
  //   「この断片は根拠・前提の説明です。同意しますか」と聞けば、まず同意が返る。
  //   **同意 86 件は、判断ではなく聞き方の結果になる。**
  //
  // 何を測っているか:
  //   多数決ではなく**判断の安定性**。同じ材料で同じ問いを投げて、
  //   答えが変わらなかったものは落としてよい。変わったものは**割れている**ので、
  //   機械が決めずに本人へ回す。**2 対 1 を真実と呼ばない。**
  const e = findEdge(args[0]); const n = limitOf(args[1]); const inScope = scopeFilter()
  const idsOnly = rest.includes('--ids-only')
  const m = loadEdge(edgeId(e))
  const todo = []
  for (const r of m.values()) {
    if (!inScope(r) || !Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      if (entryApproval(en).state !== '指摘') continue
      if (secondOf(en)) continue                       // 2 周目が済んでいる
      if (todo.length >= n) break
      todo.push(approvePayloadOf(r, en))               // **承認側の判定は入っていない**
    }
  }
  const inS = [...m.values()].filter(inScope)
  const warn = scopeWarning(e, m, inScope)
  const counts = { unitsInScope: inS.length }
  const payload = idsOnly
    ? { phase: 'settle', edge: edgeId(e), ...counts, count: todo.length, ids: todo.map(x => x.entryId), warning: warn || undefined }
    : { phase: 'settle', edge: edgeId(e), verdicts: APPROVAL_VERDICTS, nonReqKinds: NON_REQ_KINDS,
        criterion: APPROVE_CRITERION, note: SETTLE_NOTE,
        ...counts, count: todo.length, entries: todo, warning: warn || undefined }
  console.log(JSON.stringify(payload, null, 2))
  if (warn) console.error(`\n${warn}\n`)
}

else if (cmd === 'settle') {
  // 2 周目の答えを 1 つ記録し、**機械が行き先を決める。**
  //
  // 答える側は concede / rebut を選べない。選べると「同意しておけば終わる」が
  // 最短経路になる。答えるのは 1 周目とまったく同じ問い——**この断片は要求か**——だけで、
  // 落とすか残すかは**一致したかどうか**から機械が導く。
  const e = findEdge(args[0]); const entryId = args[1]; const verdict = args[2]
  let body
  try { body = args[3] ? JSON.parse(args[3]) : {} } catch { console.error('内容は JSON オブジェクトで渡してください'); process.exit(1) }
  if (!APPROVAL_VERDICTS.includes(verdict)) { console.error(`判定は次のいずれか: ${APPROVAL_VERDICTS.join(' / ')}`); process.exit(1) }
  const lock = lockEdge(edgeId(e))
  const found = findEntry(e, entryId, loadEdge(edgeId(e)))
  const { r, entry } = found
  const a = entryApproval(entry)
  if (a.state !== '指摘') {
    unlockEdge(lock)
    console.error(`${entryId} は「指摘」ではありません（いまの状態: ${a.state}）。2 周目が要るのは指摘だけです。`)
    process.exit(1)
  }
  if (secondOf(entry)) {
    unlockEdge(lock)
    console.error(`${entryId} は 2 周目が済んでいます（${secondOf(entry).verdict}）。**二度目は聞きません。**`)
    process.exit(1)
  }
  const why = String(body.why || '').trim()
  if (why.length < 15 || !touchesSource(why, r.text)) {
    unlockEdge(lock)
    console.error(`理由が不十分です（15 文字以上・原文の語を含むこと）: ${JSON.stringify(why)}`)
    console.error(`  原文: ${r.text}`)
    process.exit(1)
  }
  if (verdict === '要求' && String(body.expect || '').trim().length < 10) {
    unlockEdge(lock)
    console.error('「要求」と答えるなら expect（満たされたとき下位に現れるはずの一文）が要ります。**書けないなら要求ではありません。**')
    process.exit(1)
  }
  if (verdict === '判断できない' && String(body.resolvesBy || '').trim().length < 10) {
    unlockEdge(lock)
    console.error('「判断できない」と答えるなら resolvesBy（何が決まれば決着するか）が要ります。')
    process.exit(1)
  }
  const second = { of: entryKeyOf(entry), verdict, why, at: new Date().toISOString(),
                   ...(body.expect ? { expect: String(body.expect).trim() } : {}),
                   ...(body.resolvesBy ? { resolvesBy: String(body.resolvesBy).trim() } : {}) }
  const agrees = settleAgrees(entry, a.approval, verdict)
  let action
  if (agrees === true && entry.kind === 'req') {
    // 1 周目も 2 周目も「要求でない」。**落とす。**
    entry.node.second = second
    const moved = applyConcede(r, entry, a, why)
    // **2 周目の記録も一緒に運ぶ。** 運ばないと、落とした断片は台帳から
    // 「誰が 2 周目を回したか」が消え、settle-report が 0 件と言う。
    moved.second = { ...second, of: entryKeyOf({ kind: 'skip', span: entry.span, text: why }) }
    action = 'conceded'
  } else if (agrees === true && entry.kind === 'skip') {
    // どちらも「要求である」。**機械では直せない**——要求の文は分解した側が書くもので、
    // 機械が作文すると誰も書いていない要求が台帳に載る。再分解へ回す。
    entry.node.second = second
    action = 'needsDecompose'
  } else {
    // 割れた、またはどちらかが判断できない。**落とさない。本人へ回す。**
    entry.node.second = second
    action = 'split'
  }
  saveEdge(edgeId(e), found.map)
  unlockEdge(lock)
  const LABEL = { conceded: '一致（要求でない）→ 対象外へ移しました',
                  needsDecompose: '一致（要求である）→ 再分解が要ります',
                  split: '**割れました** → 落とさずに残します。本人の判断へ回します' }
  console.log(`OK ${entryId}  ${LABEL[action]}`)
  console.log(`  1 周目: ${a.approval?.verdict}   2 周目: ${verdict}`)
  console.log(`  理由: ${why}`)
}

else if (cmd === 'settle-report') {
  // 2 周目の結果。**割れたものが本体。**
  const e = findEdge(args[0]); const id = edgeId(e); const inScope = scopeFilter()
  const m = loadEdge(id)
  const todo = [], split = [], needs = []
  let conceded = 0
  for (const r of [...m.values()].filter(inScope)) {
    if (!Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      const t = secondOf(en)
      if (en.kind === 'skip' && t && en.node.concededFrom) { conceded++; continue }
      if (entryApproval(en).state !== '指摘') continue
      if (!t) { todo.push({ entryId: en.id, file: r.file, line: r.line, span: en.span }); continue }
      const row = { entryId: en.id, file: r.file, line: r.line, section: r.section,
                    source: r.text, span: en.span, wrote: en.text,
                    first: entryApproval(en).approval?.verdict, second: t.verdict,
                    kind: entryApproval(en).approval?.kind || null,
                    expect: t.expect || null, why: t.why }
      if (settleAgrees(en, entryApproval(en).approval, t.verdict) === true) needs.push(row)
      else split.push(row)
    }
  }
  if (json) { console.log(JSON.stringify({ edge: id, conceded, split: split.length, needsDecompose: needs.length, todo: todo.length, splitRows: split, needsRows: needs }, null, 2)); }
  else {
    console.log(`# ${id} — 指摘の決着（2 周目）\n`)
    console.log(`  まだ 2 周目を回していない   ${todo.length}`)
    console.log(`  一致して落とした             ${conceded}`)
    console.log(`  一致したが再分解が要る       ${needs.length}`)
    console.log(`  **割れた（本人の判断へ）**   ${split.length}\n`)
    if (split.length) {
      console.log('─'.repeat(72))
      console.log('## 判断が割れた断片\n')
      console.log('1 周目と 2 周目で答えが違いました。**同じ材料で同じ問いを投げて、違う答えが出た**')
      console.log('ということなので、落とすか残すかを機械では決めません。\n')
      split.forEach((x, i) => {
        console.log(`${i + 1}. ${x.file}:${x.line}  ${x.entryId}`)
        console.log(`   原文: ${String(x.source).slice(0, 140)}`)
        console.log(`   断片: ${JSON.stringify(x.span)}`)
        console.log(`   分解が書いた要求: ${String(x.wrote).slice(0, 120)}`)
        console.log(`   1 周目: ${x.first}${x.kind ? `（${x.kind}）` : ''}   2 周目: ${x.second}`)
        if (x.expect) console.log(`   2 周目が挙げた expect: ${String(x.expect).slice(0, 140)}`)
        console.log(`   2 周目の理由: ${String(x.why).slice(0, 140)}`)
        console.log('')
      })
      console.log('─'.repeat(72))
      console.log('決め方:')
      console.log(`    要求として残す: node .claude/scripts/ledger.mjs rebut ${JSON.stringify(id)} <entryId> '{"expect":"…","why":"…"}'`)
      console.log(`    落とす:         node .claude/scripts/ledger.mjs concede ${JSON.stringify(id)} <entryId> --why "…"`)
    }
    if (needs.length) {
      console.log(`\n再分解が要る ${needs.length} 件（対象外にした断片を、両方が「要求である」と答えた）:`)
      needs.slice(0, 10).forEach(x => console.log(`  ${x.file}:${x.line}  ${x.entryId}  ${JSON.stringify(String(x.span).slice(0, 40))}`))
      console.log(`    node .claude/scripts/ledger.mjs decompose ${JSON.stringify(id)} <unitId> '[…]'`)
      console.log('  **要求の文は分解した側が書くものです。** 機械が作文すると、誰も書いていない要求が載ります。')
    }
    if (todo.length) {
      console.log(`\nまだ 2 周目を回していない ${todo.length} 件:`)
      console.log(`    node .claude/scripts/ledger.mjs settle-next ${JSON.stringify(id)} 20`)
    }
  }
}

else if (cmd === 'refs') {
  // 「出典・参照」として落とした断片の**参照先が実在するか**を見る。
  //
  // **落とした判断そのものは疑っていない。** 疑うのは、その判断が前提にしている
  // 「実体は別の場所に在る」が本当かどうか。前提が崩れていれば、
  // 正しい判定のまま中身が分母から消える。
  const e = findEdge(args[0]); const id = edgeId(e); const inScope = scopeFilter()
  const m = loadEdge(id)
  const bodies = tierBodies(e.from)
  // **ファイル参照の探し先は全段。** 参照先は下位の成果物なので、
  // 上位側だけを見ていると全部「見つからない」になる（初版がそうだった）。
  const allFiles = (config().tiers || []).flatMap(t => { try { return tierFiles(t.id) } catch { return [] } })
  const rows = []
  for (const r of [...m.values()].filter(inScope)) {
    if (!Array.isArray(r.skips)) continue
    for (const en of entriesOf(r)) {
      if (en.kind !== 'skip') continue
      const a = entryApproval(en)
      if (a.approval?.kind !== '出典・参照') continue
      // (1) 「例：…」で挙げられている名前
      for (const item of exampleItems(r.text)) {
        const got = resolveItem(bodies, item, r.file, r.line)
        if (got.state === '実体あり') continue
        rows.push({ entryId: en.id, file: r.file, line: r.line, kind: '例示', target: item, ...got })
      }
      // (2) 名指しされたファイル。
      //
      // **初版は全件が誤検出だった（実測 2026-09-17、23 件中 23 件）。**
      // 探し先を `tierBodies(e.from)` ＝ 上位側の本文だけにしていたので、
      // 参照先である下位（`docs/basic_design/*.md`）が視界に入っていなかった。
      // 逃がしの条件も、tier の sources がグロブ 1 本（`docs/basic_design/*.md`）なので
      // 名前の部分一致では成立しなかった。
      //
      // **当たっていない指摘しか出ない検査は、当たっている指摘まで読まれなくする。**
      // いまは**すべての段の成果物**を実ファイルに展開して、その中に在るかを見る。
      for (const fm of String(r.text).matchAll(/([0-9A-Za-z_\-]+\.md)/g)) {
        const name = fm[1]
        if (!allFiles.some(f => f === name || f.endsWith(`/${name}`))) {
          rows.push({ entryId: en.id, file: r.file, line: r.line, kind: 'ファイル参照', target: name, state: '見つからない', at: [] })
        }
      }
    }
  }
  const missing = rows.filter(x => x.state === '見つからない')
  const fuzzy = rows.filter(x => x.state === '表記ゆれの疑い')
  if (json) { console.log(JSON.stringify({ edge: id, missing: missing.length, fuzzy: fuzzy.length, rows }, null, 2)); }
  else {
    console.log(`# ${id} — 「出典・参照」として落とした断片の参照先\n`)
    console.log(`  参照先が見つからない  ${missing.length}`)
    console.log(`  表記ゆれの疑い        ${fuzzy.length}\n`)
    if (missing.length) {
      console.log('─'.repeat(72))
      console.log('## 参照先が見つからない\n')
      console.log('**落とした判断そのものは疑っていません。** 疑っているのは、その判断が前提にしている')
      console.log('「実体は別の場所に在る」が本当かどうかです。前提が崩れていれば、')
      console.log('**正しい判定のまま中身が分母から消えます。**\n')
      missing.forEach((x, i) => {
        console.log(`${i + 1}. ${x.file}:${x.line}  ${x.entryId}`)
        console.log(`   ${x.kind}: ${JSON.stringify(x.target)}`)
        console.log(`   この名前は、この行以外のどこにも出てきません。\n`)
      })
      console.log('─'.repeat(72))
      console.log('決め方は 2 通り:')
      console.log('  A) 実体を書く  → 参照文の記述が事実になり、その分が分母に戻る')
      console.log('  B) 参照文から名前を外す → 「そう判定した」という事実自体が文書から消える')
      console.log('**どちらでもよいが、そのままにはできません。** 参照文が事実と食い違ったままになるので。')
    }
    if (fuzzy.length) {
      console.log(`\n表記ゆれの疑い ${fuzzy.length} 件（かたまりは見つかったが、丸ごとは一致しない）:`)
      fuzzy.slice(0, 15).forEach(x => console.log(`  ${x.file}:${x.line}  ${JSON.stringify(x.target)}  ← ${x.at.join(' / ')}`))
      console.log('  **これは指摘ではありません。** 言い換えかどうかは読まないと決まりません。')
    }
    if (!rows.length) console.log('参照先はすべて実在しています。')
  }
}

else if (cmd === 'approval-report') {
  // 承認が当たっているかを**あとから**測るための集計。
  // 語尾の型（規範形 / 説明形）は承認する側に一切渡していないので、
  // ここでの突き合わせは「仮説が結果と合っているか」の検証になる。
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e)); const inScope = scopeFilter()
  const rows = [...m.values()].filter(inScope)
  const c = approvalCounts(rows)
  const orphans = readOrphanHolds(edgeId(e)).filter(x => { const f = opt('file'); return !f || String(x.file || '').includes(f) })
  if (orphans.length) { c.waiting += orphans.length; c.waitingCarried = (c.waitingCarried || 0) + orphans.length }
  const carriedHolds = [...rows.flatMap(r => (r.staleHolds || []).map(h => ({ ...h, nowUnit: r.unitId }))), ...orphans]
  const cross = {}
  const kinds = {}
  for (const r of rows) {
    if (!Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      const a = entryApproval(en)
      if (a.state === '未承認') continue
      if (en.kind !== 'req') continue
      const k = endingKind(en.text)
      cross[k] ??= { 要求: 0, 要求でない: 0, 判断できない: 0 }
      cross[k][a.approval.verdict]++
      if (a.approval.verdict === '要求でない') kinds[a.approval.kind] = (kinds[a.approval.kind] || 0) + 1
    }
  }
  let peeked = 0, viaCompliance = 0, conceded = 0, upheld = 0
  for (const r of rows) {
    if (!Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      const a = en.node.approval
      if (!a || a.of !== entryKeyOf(en)) continue
      if (a.expectVerbatimIn) peeked++
      if (a.viaCompliance) viaCompliance++
      if (a.viaOwner) upheld++
      if (en.node.concededFrom) conceded++
    }
  }
  const out = { edge: edgeId(e), counts: c, endingVsVerdict: cross, nonReqKinds: kinds, expectVerbatimBelow: peeked, carriedByCompliance: viaCompliance, conceded, upheld,
    carriedHolds: carriedHolds.map(h => ({ holdId: h.holdId, fromUnit: h.fromUnit, nowUnit: h.nowUnit, lost: !!h.lostAt, file: h.file, span: h.span, why: h.hold?.why })) }
  if (json) { console.log(JSON.stringify(out, null, 2)); }
  else {
    console.log(`${out.edge}  断片 ${c.entries}  承認 ${c.ok}  指摘 ${c.challenged}  保留 ${c.deferred}  反論で維持 ${c.heldOver}  未承認 ${c.unseen}${c.waiting ? `  **本人待ち ${c.waiting}**` : ''}${c.waitingCarried ? `（うち前の版から引き継いだもの ${c.waitingCarried}）` : ''}`)
    if (carriedHolds.length) {
      console.log('\n前の版から引き継いだ本人待ち（上位の本文が変わった・単位が消えたため、今の断片には付いていない）:')
      carriedHolds.forEach(h => console.log(`  ${h.holdId}  ${h.lostAt ? '[単位が消えた]' : `[今の単位 ${h.nowUnit}]`}  ${String(h.span).slice(0, 50)}`))
      console.log('  本人が見て、今の断片で決め直したら外す（本人のコマンド）:')
      console.log(`    node .claude/scripts/ledger.mjs release-hold ${JSON.stringify(out.edge)} <holdId> --why "…"`)
    }
    if (!Object.keys(cross).length) { console.log('\n承認済みの要求がまだありません。'); }
    else {
      console.log('\n要求として書かれた断片の語尾 × 承認の判定（語尾は承認する側に見せていない）')
      for (const [k, v] of Object.entries(cross)) {
        const tot = v['要求'] + v['要求でない'] + v['判断できない']
        console.log(`  ${k.padEnd(4)}  計 ${String(tot).padStart(4)}   要求 ${String(v['要求']).padStart(4)}   要求でない ${String(v['要求でない']).padStart(4)}   判断できない ${String(v['判断できない']).padStart(3)}`)
      }
      console.log('\n  説明形の「要求でない」率が高いなら、語尾で先に絞り込める（＝承認を全件に回さなくてよい）。')
      console.log('  差が出ないなら、語尾は使えない。**その場合は全件に回し続けること。**')
    }
    if (peeked) {
      console.log(`\n  expect が下位の文書と逐語一致したもの: ${peeked} 件`)
      console.log('  **多いなら、承認する側が下位を開いています。** その場合この承認は当てになりません（下位に無いものだけが「要求でない」に落ちる）。')
    }
    if (viaCompliance) console.log(`\n  指摘に従って直したため承認を引き継いだもの: ${viaCompliance} 件`)
    if (conceded) console.log(`  うち concede で対象外へ移したもの: ${conceded} 件`)
    // **本人が覆した数は別に出す。** 多いなら、承認する側の基準がずれている。
    if (upheld) console.log(`\n  本人の判断で分解した側の扱いのまま残したもの（uphold）: ${upheld} 件`)
    if (Object.keys(kinds).length) {
      console.log('\n「要求でない」の内訳')
      Object.entries(kinds).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`))
      // **「出典・参照」だけは、判定が正しくても中身が消えることがある。**
      // 「実体は別の場所に在る」を前提に落としているので、参照先が無ければ
      // 正しい判定のまま分母から消える。実測で 3 件そうなった（2026-09-16）。
      if (kinds['出典・参照']) {
        console.log(`\n  「出典・参照」${kinds['出典・参照']} 件は**参照先が実在する前提**で落としています。`)
        console.log(`  前提が崩れていれば、判定は正しいまま中身が分母から消えます:`)
        console.log(`    node .claude/scripts/ledger.mjs refs ${JSON.stringify(edgeId(e))}`)
      }
    }
  }
}

else if (cmd === 'pending') {
  // 担当範囲の「未分解」「未判定」を数える。Stop hook と /wp がこれを見る。
  //
  // なぜ要るか:
  //   台帳は事後監査の位置に置かれていて、**ブレイクダウンしている最中**には効いていなかった。
  //   分母が固定されないまま書くから漏れる。書く前に分解が済んでいることを機械が要求する。
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e)); const inScope = scopeFilter()
  const rows = [...m.values()].filter(inScope)
  const undecomposed = rows.filter(r => !Array.isArray(r.reqs))
  const reqs = rows.filter(r => Array.isArray(r.reqs)).flatMap(r => r.reqs)
  const unjudged = reqs.filter(q => !q.verdict)
  const judgedAll = reqs.filter(q => q.verdict)
  const humanPending = e.humanJudged === true
    ? judgedAll.filter(q => q.by !== 'human').length
    : e.humanJudged === 'partial'
      ? (judgedAll.length && !judgedAll.some(q => q.by === 'human') ? 1 : 0)
      : 0
  const ap = approvalCounts(rows)
  { const f = opt('file'); const o = readOrphanHolds(edgeId(e)).filter(x => !f || String(x.file || '').includes(f)).length
    if (o) { ap.waiting += o; ap.waitingCarried = (ap.waitingCarried || 0) + o } }
  const challengedIds = []
  for (const r of rows) {
    if (!Array.isArray(r.reqs)) continue
    for (const en of entriesOf(r)) {
      const st = entryApproval(en).state
      if ((st === '指摘' || st === '保留') && challengedIds.length < 20) challengedIds.push(en.id)
    }
  }
  const out = {
    edge: edgeId(e), scope: { file: opt('file') || null, section: opt('section') || null },
    requireApproval: e.requireApproval === true,
    approval: ap, approvalUnresolved: ap.unresolved, challengedIds,
    units: rows.length, undecomposed: undecomposed.length,
    unitsNoRequirement: rows.filter(r => Array.isArray(r.reqs) && r.reqs.length === 0).length,
    noRequirementIds: rows.filter(r => Array.isArray(r.reqs) && r.reqs.length === 0).slice(0, 20).map(r => r.unitId),
    requirements: reqs.length, unjudged: unjudged.length, humanPending,
    problems: reqs.filter(q => q.verdict && q.verdict !== '一致' && q.verdict !== '対象外').length,
    undecomposedIds: undecomposed.slice(0, 20).map(r => r.unitId),
  }
  if (json) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`${out.edge}${out.scope.file ? ` / ${out.scope.file}` : ''}${out.scope.section ? ` / §${out.scope.section}` : ''}`)
    console.log(`  単位 ${out.units}  未分解 ${out.undecomposed}  要求 ${out.requirements}  未判定 ${out.unjudged}  不一致等 ${out.problems}${out.unitsNoRequirement ? `  要求ゼロ ${out.unitsNoRequirement}` : ''}${out.humanPending ? `  人間判定待ち ${out.humanPending}` : ''}`)
    if (out.unitsNoRequirement) {
      // 逃げ道は用意するが、使ったことは必ず目に入る場所に出す。
      console.log(`\n  ${out.unitsNoRequirement} 単位が「要求ゼロ」として記録されています。`)
      console.log(`  **この分は分母に入っていません。** 妥当かどうかは人が見てください:`)
      out.noRequirementIds.slice(0, 5).forEach(x => console.log(`    node .claude/scripts/ledger.mjs show ${JSON.stringify(out.edge)} ${JSON.stringify(x)}`))
    }
    if (out.approval.entries) {
      console.log(`  承認 ${out.approval.ok}/${out.approval.entries}  未承認 ${out.approval.unseen}  指摘 ${out.approval.challenged}  保留 ${out.approval.deferred}  反論で維持 ${out.approval.heldOver}${out.approval.waiting ? `  **本人待ち ${out.approval.waiting}**` : ''}`)
    }
    if (out.approval.challenged || out.approval.deferred) {
      // **指摘は消さない。** だから、見えるところに出し続けるしかない。
      console.log(`\n  承認する側と食い違った断片が ${out.approval.challenged + out.approval.deferred} 件あります。`)
      console.log('  同意する（concede）か、反論する（rebut）かで決着させてください。**同意のほうが安く済みます**:')
      console.log(`  そのうち**本人の判断が要るもの**（「等」など原文が未確定なもの）はまとめて質問にできます:`)
      console.log(`    node .claude/scripts/ledger.mjs ask ${JSON.stringify(out.edge)}`)
      challengedIds.slice(0, 5).forEach(x => console.log(`    node .claude/scripts/ledger.mjs show ${JSON.stringify(out.edge)} ${JSON.stringify(x)}`))
    }
    if (out.approval.unseen) {
      console.log(`\n  まだ承認を通していない断片が ${out.approval.unseen} 件あります。`)
      console.log(`    node .claude/scripts/ledger.mjs approve-next ${JSON.stringify(out.edge)}${out.scope.file ? ` --file ${JSON.stringify(out.scope.file)}` : ''}`)
      if (!out.requireApproval) console.log('  （この段は requireApproval が立っていないので、未承認でも完了にはなります）')
    }
    if (out.undecomposed) {
      console.log(`\n  未分解が ${out.undecomposed} 件あります。**分母が固定されていない状態です。**`)
      console.log(`  先に分解してください: node .claude/scripts/ledger.mjs next ${JSON.stringify(out.edge)} --phase decompose${out.scope.file ? ` --file ${JSON.stringify(out.scope.file)}` : ''}`)
    }
  }
  process.exit(0)
}

else if (cmd === 'scope') {
  // どこまで絞れるかを見るための一覧（章ごとの未処理件数）
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e))
  const byFile = {}
  for (const r of m.values()) {
    const k = r.file
    byFile[k] ??= { units: 0, undecomposed: 0, reqs: 0, unjudged: 0, sections: new Set() }
    const b = byFile[k]
    b.units++; if (r.section) b.sections.add(String(r.section).split(' > ')[0])
    if (!Array.isArray(r.reqs)) b.undecomposed++
    else { b.reqs += r.reqs.length; b.unjudged += r.reqs.filter(q => !q.verdict).length }
  }
  const rows = Object.entries(byFile).map(([file, b]) => ({ file, ...b, sections: [...b.sections] }))
  console.log(json ? JSON.stringify(rows, null, 2)
    : rows.map(r => `${String(r.undecomposed || r.unjudged).padStart(5)} 未処理  ${r.file}  （単位 ${r.units} / 要求 ${r.reqs}）`).join('\n')
      + `\n\n一部だけ回すなら: node .claude/scripts/ledger.mjs next ${edgeId(e)} --file <ファイル名の一部>`)
}

else if (cmd === 'stale') {
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e))
  const rows = [...m.values()].filter(r => r.staleFrom)
  if (json) { console.log(JSON.stringify(rows, null, 2)) }
  else if (!rows.length) { console.log('陳腐化した単位はありません。') }
  else {
    console.log(`上位の本文が変わった単位が ${rows.length} 件あります。分解と判定をやり直してください。\n`)
    for (const r of rows) {
      console.log(`${r.unitId}`)
      console.log(`  ${r.file}:${r.line}${r.label ? ` [${r.label}]` : ''}`)
      if (r.staleText) console.log(`  変更前: ${String(r.staleText).slice(0, 100)}`)
      console.log(`  変更後: ${String(r.text).slice(0, 100)}`)
      if (r.stalePrevReqs?.length) {
        console.log(`  以前の分解 ${r.stalePrevReqs.length} 件（参照用。そのまま使い回さないこと）:`)
        r.stalePrevReqs.slice(0, 5).forEach(q => console.log(`    - ${String(q.text).slice(0, 80)}${q.verdict ? `  [${q.verdict}]` : ''}`))
      }
      console.log('')
    }
    console.log(`  node .claude/scripts/ledger.mjs next ${JSON.stringify(edgeId(e))} --phase decompose`)
  }
}

// ── 前の版から引き継いだ本人待ちを外す（v29 T7。本人のコマンド）──────────────
//   release-hold <edge> <holdId> --why "…"
// 本人が前の本人待ちの中身を見て、今の断片で決め直した（または決める必要が無くなった）ときに外す。
// **AI が打てないように端末からだけ。** 記録は消さずに、単位の releasedHolds（消えた単位ならファイルの released）に残す。
else if (cmd === 'release-hold') {
  const e = findEdge(args[0]); const holdId = String(args[1] || '')
  requireHumanTerminal('release-hold（前の版から引き継いだ本人待ちを外す）')
  const why = String(opt('why') || '').trim()
  if (why.length < 15) { console.error('外す理由が短すぎます（15 文字以上）。何を見てどう決めたかを書いてください。'); process.exit(1) }
  const lock = lockEdge(edgeId(e))
  const m = loadEdge(edgeId(e))
  let done = false
  for (const r of m.values()) {
    const i = (r.staleHolds || []).findIndex(h => h.holdId === holdId)
    if (i < 0) continue
    const [h] = r.staleHolds.splice(i, 1)
    r.releasedHolds = [...(r.releasedHolds || []), { ...h, releasedAt: new Date().toISOString(), releasedWhy: why }]
    if (!r.staleHolds.length) delete r.staleHolds
    saveEdge(edgeId(e), m); done = true; break
  }
  if (!done) {
    const all = readOrphanHolds(null)
    const j = all.findIndex(x => x.edge === edgeId(e) && x.holdId === holdId)
    if (j >= 0) {
      all[j] = { ...all[j], released: { at: new Date().toISOString(), why } }
      writeOrphanHolds(all.filter(x => !x.released))
      appendFileSync(ORPHAN_HOLDS.replace(/\.jsonl$/, '.released.jsonl'), JSON.stringify(all[j]) + '\n')
      recordOp(edgeId(e)); done = true
    }
  }
  unlockEdge(lock)
  if (!done) { console.error(`${holdId} は前の版から引き継いだ本人待ちにありません（approval-report で確かめる）`); process.exit(1) }
  console.log(`OK ${holdId} の本人待ちを外しました（記録は残っています）`)
}

// ── 要求 ID の印（v28 T4）──────────────────────────────────────────────
//   tags <edge> [--file X] [--section Y] [--json]
//     範囲の要求と、その印（<!-- req … --> に書く短い ID）を並べる。書く前に使う
//   tag-check <edge> [--file X] [--section Y] [--json]
//     下位の文書を走査して、(1) 印の無い要求 (2) 行き先の無い印 (3) 形の壊れた印 を数える。
//     1 件でもあれば終了コード 1。**分類が「スコープ外」の要求は数えない**（別枠で件数だけ出す）
else if (cmd === 'tags' || cmd === 'tag-check') {
  const e = findEdge(args[0]); const m = loadEdge(edgeId(e)); const inScope = scopeFilter()
  const scopeWarn = scopeWarning(e, m, inScope)
  const { rows, byTag } = edgeTags(m)
  const inRows = rows.filter(w => inScope(w.r))
  if (cmd === 'tags') {
    const out = inRows.map(w => ({ entryId: w.x.id, tag: w.tag, file: w.r.file, line: w.r.line,
      requirement: w.x.text, plan: w.r.reqs[w.x.idx]?.plan?.kind || undefined }))
    if (json) console.log(JSON.stringify({ edge: edgeId(e), count: out.length, warning: scopeWarn || undefined, tags: out }, null, 2))
    else {
      if (scopeWarn) console.error(scopeWarn)
      out.forEach(o => console.log(`<!-- req ${o.tag} -->  ${o.file}:${o.line}  ${String(o.requirement).slice(0, 60)}${o.plan ? `  [${o.plan}]` : ''}`))
      console.log(`\n${out.length} 件（${edgeId(e)}）`)
    }
  } else {
    const files = tierFiles(e.to)
    const { found, broken } = scanTags(files)
    const present = new Set(found.map(f => f.tag))
    const excluded = inRows.filter(w => w.r.reqs[w.x.idx]?.plan?.kind === 'スコープ外')
    const target = inRows.filter(w => w.r.reqs[w.x.idx]?.plan?.kind !== 'スコープ外')
    const untagged = target.filter(w => !present.has(w.tag))
    // 行き先の無い印は**段の全体**で見る（範囲の外の要求を指す印は、行き先が在る）
    const orphan = found.filter(f => !byTag.has(f.tag))
    const res = { edge: edgeId(e), lowerFiles: files.length, requirements: target.length,
      tagged: target.length - untagged.length, untagged: untagged.length, excludedScopeOut: excluded.length,
      orphan: orphan.length, broken: broken.length, warning: scopeWarn || undefined,
      untaggedList: untagged.slice(0, 200).map(w => ({ entryId: w.x.id, tag: w.tag, file: w.r.file, line: w.r.line, requirement: w.x.text })),
      orphanList: orphan.slice(0, 200), brokenList: broken.slice(0, 200) }
    if (json) console.log(JSON.stringify(res, null, 2))
    else {
      if (scopeWarn) console.error(scopeWarn)
      console.log(`tag-check ${edgeId(e)}：要求 ${res.requirements}（スコープ外 ${res.excludedScopeOut} は数えない）  印あり ${res.tagged}  **印なし ${res.untagged}**  行き先の無い印 ${res.orphan}  形の壊れた印 ${res.broken}  （下位 ${files.length} ファイル）`)
      untagged.slice(0, 30).forEach(w => console.log(`  印なし  <!-- req ${w.tag} -->  ${w.r.file}:${w.r.line}  ${String(w.x.text).slice(0, 60)}`))
      orphan.slice(0, 30).forEach(o => console.log(`  行き先なし  ${o.file}:${o.line}  ${o.tag}`))
      broken.slice(0, 30).forEach(o => console.log(`  形が壊れている  ${o.file}:${o.line}  ${o.raw}`))
      if (res.untagged) console.log('  **印の無い要求は、下位のどこにも「満たすつもりの場所」が無い。** 書き漏れか、分類（スコープ外）の付け忘れ')
    }
    process.exit(res.untagged || res.orphan || res.broken ? 1 : 0)
  }
}

// ── 古い詳細設計からの拾い上げ（v28 T5）─────────────────────────────────
// 本人決定（turn 68→69）: 古い詳細設計は消して git の履歴だけに残す。決定・教訓は
// 章ごとに履歴の版から拾い、行ごとに「行き先」を付ける。**行き先の無い行 0**を機械で数える。
//   harvest scan --ref <コミット> [--dir docs/detailed_design]   履歴の版から拾う行を洗い出す（1 回だけ）
//   harvest list [--file X] [--pending] [--limit N] [--json]
//   harvest set <id> <new|bd|drop> --why "…" [--in <ファイル> --quote "<逐語>"]
//       new  … 新しい詳細設計に書いた（--in はスキャンしたフォルダの中のファイル、--quote はその逐語）
//       bd   … 基本設計に在る（--in は基本設計のファイル、--quote はその逐語）
//       drop … 要らない（--why はその行の語を含むこと）
//   harvest report [--file X] [--json] [--strict]    引用が今も在るかを照合し直す。--strict は残り・無効で終了コード 1
else if (cmd === 'harvest') {
  const { execFileSync } = await import('node:child_process')
  const HFILE = join(COVERAGE, 'harvest.jsonl')
  const load = () => existsSync(HFILE) ? readFileSync(HFILE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
  const save = rows => { mkdirSync(COVERAGE, { recursive: true }); writeFileSync(HFILE, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); recordOp('harvest') }
  const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n?/g, '\n')
  const norm = t => String(t || '').replace(/\s+/g, ' ').trim()
  const PICK = /(?<![A-Za-z0-9_])[ABCG]\d{1,3}(?![0-9])|確定|本人|是正|発見|教訓|実測/
  const TO = { new: '新しい詳細設計', '新しい詳細設計': '新しい詳細設計', bd: '基本設計', '基本設計': '基本設計', drop: '要らない', '要らない': '要らない' }
  const sub = args[0]
  if (sub === 'scan') {
    const ref0 = opt('ref'); const dir = String(opt('dir') || 'docs/detailed_design').replace(/\/+$/, '')
    if (!ref0) { console.error('--ref <コミット> が必要です（古い詳細設計が残っている最後のコミット）'); process.exit(1) }
    let ref
    try { ref = git('rev-parse', '--verify', `${ref0}^{commit}`).trim() } catch { console.error(`コミット ${ref0} が見つかりません`); process.exit(1) }
    const old = load()
    if (old.length && old.some(r => r.ref !== ref || r.dir !== dir)) {
      console.error(`拾い上げの記録はすでに別の版（${old[0].ref.slice(0, 7)} ${old[0].dir}）で作られています。混ぜません。`)
      process.exit(1)
    }
    const prev = new Map(old.map(r => [r.id, r]))
    const files = git('ls-tree', '-r', '--name-only', ref, '--', dir).split('\n').filter(f => /\.md$/i.test(f))
    if (!files.length) { console.error(`${ref.slice(0, 7)} の ${dir} に .md がありません`); process.exit(1) }
    const rows = [], seen = new Map()
    for (const f of files) {
      const lines = git('show', `${ref}:${f}`).split('\n')
      lines.forEach((ln, i) => {
        if (!PICK.test(ln) || !norm(ln)) return
        const base = `${f}:${hash12(f + '\u0000' + norm(ln)).slice(0, 8)}`
        const n = seen.get(base) || 0; seen.set(base, n + 1)
        const id = n ? `${base}.${n}` : base
        rows.push({ ...(prev.get(id) || {}), id, ref, dir, file: f, line: i + 1, text: ln.trim() })
      })
    }
    save(rows)
    const per = {}
    rows.forEach(r => { per[r.file] = (per[r.file] || 0) + 1 })
    console.log(`OK 拾う行 ${rows.length}（${ref.slice(0, 7)} の ${dir}、${files.length} ファイル）`)
    Object.entries(per).forEach(([f, n]) => console.log(`  ${f}  ${n}`))
  } else if (sub === 'list') {
    const f = opt('file'); const lim = limitOf(opt('limit'))
    let rows = load().filter(r => !f || r.file.includes(f))
    if (rest.includes('--pending')) rows = rows.filter(r => !r.to)
    rows = rows.slice(0, lim === Infinity ? undefined : lim)
    if (json) console.log(JSON.stringify(rows, null, 2))
    else rows.forEach(r => console.log(`${r.id}  ${r.to ? `[${r.to}]` : '[未]'}  ${r.file}:${r.line}  ${String(r.text).slice(0, 80)}`))
  } else if (sub === 'set') {
    const id = args[1]; const to = TO[String(args[2] || '')]
    if (!to) { console.error('行き先は new / bd / drop のどれかです'); process.exit(1) }
    const rows = load(); const r = rows.find(x => x.id === id)
    if (!r) { console.error(`${id} は拾い上げの記録にありません（harvest list で確かめる）`); process.exit(1) }
    const why = String(opt('why') || '').trim()
    if (why.length < 10) { console.error('--why が短すぎます（10 文字以上）'); process.exit(1) }
    const rec = { to, why, at: new Date().toISOString() }
    if (to === '要らない') {
      if (why.length < 15 || !touchesSource(why, r.text)) {
        console.error('要らないとする理由は 15 文字以上で、その行の語を含むこと。どの行にも貼れる理由は理由ではありません。')
        console.error(`  行: ${r.text}`); process.exit(1)
      }
    } else {
      const inF = String(opt('in') || '').replace(/\\/g, '/'); const quote = String(opt('quote') || '')
      if (!inF || norm(quote).length < 12) { console.error('--in <ファイル> と --quote "<12 文字以上の逐語>" が必要です'); process.exit(1) }
      const okPlace = to === '新しい詳細設計' ? inF.startsWith(r.dir + '/')
        : (() => { try { return tierFiles('bd').includes(inF) } catch { return inF.startsWith('docs/') } })()
      if (!okPlace) { console.error(`${inF} は「${to}」の置き場所ではありません`); process.exit(1) }
      if (!existsRel(inF)) { console.error(`${inF} がありません`); process.exit(1) }
      if (!norm(readRel(inF)).includes(norm(quote))) {
        console.error(`引用が ${inF} に逐語で見つかりません。要約・整形しないでください。`); process.exit(1)
      }
      rec.in = inF; rec.quote = quote
    }
    for (const k of ['to', 'why', 'in', 'quote', 'at']) delete r[k]
    Object.assign(r, rec)
    save(rows)
    console.log(`OK ${id} → ${to}`)
  } else if (sub === 'report') {
    const f = opt('file')
    const rows = load().filter(r => !f || r.file.includes(f))
    if (!rows.length) { console.error('拾い上げの記録がありません（先に harvest scan）'); process.exit(1) }
    const per = {}; const invalid = []
    for (const r of rows) {
      const p = per[r.file] ||= { total: 0, pending: 0, '新しい詳細設計': 0, '基本設計': 0, '要らない': 0, invalid: 0 }
      p.total++
      if (!r.to) { p.pending++; continue }
      p[r.to]++
      if (r.to !== '要らない' && !(existsRel(r.in) && norm(readRel(r.in)).includes(norm(r.quote)))) { p.invalid++; invalid.push(r) }
    }
    const pending = rows.filter(r => !r.to).length
    const out = { ref: rows[0].ref, dir: rows[0].dir, total: rows.length, pending, invalid: invalid.length, perFile: per,
      invalidList: invalid.slice(0, 100).map(r => ({ id: r.id, in: r.in, quote: r.quote })) }
    if (json) console.log(JSON.stringify(out, null, 2))
    else {
      console.log(`拾い上げ（${out.ref.slice(0, 7)} の ${out.dir}）：${out.total} 行  **残り ${pending}**  引用が見つからない ${invalid.length}`)
      Object.entries(per).forEach(([k, v]) => console.log(`  ${k}  ${v.total}（残り ${v.pending} / 新 ${v['新しい詳細設計']} / 基本 ${v['基本設計']} / 要らない ${v['要らない']} / 無効 ${v.invalid}）`))
      invalid.slice(0, 20).forEach(r => console.log(`  無効  ${r.id} → ${r.in}`))
    }
    if (rest.includes('--strict') && (pending || invalid.length)) process.exit(1)
  } else {
    console.error('使い方: harvest scan --ref <コミット> [--dir …] | list [--file X] [--pending] | set <id> <new|bd|drop> --why … [--in … --quote …] | report [--file X] [--strict]')
    process.exit(1)
  }
}

else if (cmd) {
  console.log('使い方: ledger.mjs sync|stats|ops|pending|next|show|decompose|judge|plan|plan-report|hold|stale|stale-diff|scope|approve-next|approve-show|approve|concede|uphold|rebut|approval-report|ask|ask-record|ask-report|settle-next|settle|settle-report|refs|tags|tag-check|harvest|release-hold')
  console.log('  next の既定は全件。--file <部分一致> / --section <部分一致> / 件数 で絞れる。')
}

