# turn 69 §5: 古い詳細設計へのリンクを、リンクでない「旧版の文字」に書き換える。
#
#   python _bridge/relink69.py --root <docs/ を含むフォルダ> --commit <旧版のコミット 7 桁> --log <json> [--verify <元のフォルダ>]
#
# 対象と残すもの（本人決定、turn 69）:
#   - 基本設計（docs/basic_design/）とレビュー記録（docs/review/）から ../detailed_design/ へのリンク
#       … 00_reference.md#8.1（G 台帳。中身をそのまま新しいファイルへ写した）だけリンクのまま残す
#   - 新しい詳細設計（docs/detailed_design/）の下書きに写した文の中のリンク
#       … 新しいファイルに実在する節を指すもの（写した節どうし）と、全体を写した
#         error-logging-foundation.md のファイルだけを指すものを残す。ほかは旧版の文字にする
#   - コードスパン（`…`）とコードブロック（``` … ```）の中は書き換えない（リンクとして扱われていない）
#
# 書き換えの形: 旧詳細設計 `<ファイル>` §<節>（`<コミット>` 時点）。節の無いリンクは § を付けない。
#
# --verify を付けると、書き換えの記録を逆に当てて元に戻し、元のフォルダの内容とバイト単位で一致するかを確かめる
# （書き換えた箇所のほかが変わっていないことの確認）。
import argparse, json, os, re, sys

p = argparse.ArgumentParser()
p.add_argument('--root', required=True)
p.add_argument('--commit', required=True)
p.add_argument('--log', required=True)
p.add_argument('--verify')
a = p.parse_args()

DDDIR = 'docs/detailed_design'
LINK = re.compile(r'\[\[([^\]#|]*)(#[^\]|]*)?\]\]')
CODE = re.compile(r'(`[^`\n]*`)')
HEAD = re.compile(r'^#{1,6}\s+§?(\d+(?:\.\d+)*)')


def rel(*xs):
    return os.path.join(a.root, *xs)


dd_names = sorted(n for n in os.listdir(rel(DDDIR)) if n.endswith('.md'))
heads = {}
for n in dd_names:
    hs = set()
    fence = False
    for l in open(rel(DDDIR, n), encoding='utf-8').read().split('\n'):
        if l.startswith('```'):
            fence = not fence
            continue
        m = None if fence else HEAD.match(l)
        if m:
            hs.add(m.group(1).rstrip('.'))
    heads[n] = hs


def target_of(src_dir, path):
    """リンクの行き先が詳細設計のファイルなら、そのファイル名を返す。"""
    if path == '':
        return None
    norm = os.path.normpath(os.path.join(src_dir, path)).replace('\\', '/')
    d, base = os.path.split(norm)
    if d == DDDIR and base in dd_names:
        return base
    return None


def keep(src_dir, name, anchor):
    if src_dir != DDDIR:                       # 基本設計・レビュー記録から
        return name == '00_reference.md' and anchor == '8.1'
    if anchor:                                 # 新しい詳細設計の中から
        return anchor in heads.get(name, set())
    return name == 'error-logging-foundation.md'


def text_of(name, anchor):
    sec = f' §{anchor}' if anchor else ''
    return f'旧詳細設計 `{name}`{sec}（`{a.commit}` 時点）'


files = [f'{DDDIR}/{n}' for n in dd_names]
for d in ('docs/basic_design', 'docs/review'):
    files += [f'{d}/{n}' for n in sorted(os.listdir(rel(d))) if n.endswith('.md')]

log = {'commit': a.commit, 'changes': [], 'kept': [], 'byFile': {}}
for f in files:
    src_dir = os.path.dirname(f)
    raw = open(rel(f), 'rb').read()
    lines = raw.decode('utf-8').split('\n')
    fence = False
    changed = 0
    for i, l in enumerate(lines):
        if l.startswith('```'):
            fence = not fence
            continue
        if fence or '[[' not in l:
            continue
        parts = CODE.split(l)
        for j in range(0, len(parts), 2):          # 偶数番目がコードスパンの外
            def sub(m):
                path, anc = m.group(1), (m.group(2) or '')[1:]
                name = (os.path.basename(f) if (path == '' and src_dir == DDDIR) else target_of(src_dir, path))
                if name is None:
                    return m.group(0)
                if keep(src_dir, name, anc):
                    log['kept'].append({'file': f, 'line': i + 1, 'link': m.group(0)})
                    return m.group(0)
                new = text_of(name, anc)
                log['changes'].append({'file': f, 'line': i + 1, 'old': m.group(0), 'new': new})
                return new
            parts[j] = LINK.sub(sub, parts[j])
        nl = ''.join(parts)
        if nl != l:
            changed += 1
            lines[i] = nl
    out = '\n'.join(lines).encode('utf-8')
    if out != raw:
        open(rel(f), 'wb').write(out)
    n = sum(1 for c in log['changes'] if c['file'] == f)
    k = sum(1 for c in log['kept'] if c['file'] == f)
    if n or k:
        log['byFile'][f] = {'changed': n, 'kept': k, 'lines': changed}

json.dump(log, open(a.log, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"書き換え {len(log['changes'])}・リンクのまま {len(log['kept'])}")
for f, v in log['byFile'].items():
    print(f"  {f}  書き換え {v['changed']}（{v['lines']} 行）・残す {v['kept']}")

if a.verify:
    bad = 0
    for f in files:
        cur = open(rel(f), 'rb').read().decode('utf-8').split('\n')   # 改行を変換せずに読む（CRLF の行が混ざるため）
        for c in reversed([c for c in log['changes'] if c['file'] == f]):
            l = cur[c['line'] - 1]
            k = l.rfind(c['new'])
            cur[c['line'] - 1] = l[:k] + c['old'] + l[k + len(c['new']):]
        if '\n'.join(cur).encode('utf-8') != open(os.path.join(a.verify, f), 'rb').read():
            bad += 1
            print('  元に戻すと一致しない:', f)
    print(f'逆に当てた照合: 不一致 {bad} / {len(files)} ファイル')
    sys.exit(1 if bad else 0)
