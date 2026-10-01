#!/bin/sh
# turn 106 §6：確かめをまとめて回す（読むだけ）。cwd はリポジトリ。引数 1 はこのターンの始まり（UTC）
node .claude/scripts/split.mjs drift 2>&1 | tail -1
node .claude/scripts/check-docs-links.mjs 2>&1 | grep check-docs
echo "要確認: $(grep -rn '【要確認】' docs/ | wc -l)"
echo "先の日付: $(grep -rnoE '2026-(10-0[2-9]|10-[1-3][0-9]|1[12]-[0-9]{2})|2027-' docs/ | wc -l)"
echo "行番号の形: $(grep -rnoE '要件 ?L[0-9]+|tab_app_requirements\.md:[0-9]+|要件定義書[^。]{0,6}[0-9]+ ?行' docs/basic_design docs/detailed_design | wc -l)"
echo "基本設計の行数（HEAD~5 と今）:"; for f in 02_data_model 03_screens_ui_pc; do echo "  $f $(git show cd04652:docs/basic_design/$f.md | wc -l) → $(wc -l < docs/basic_design/$f.md)"; done
node _bridge/recheck-evidence.mjs "req->bd" 2>&1 | sed -n 2p
node .claude/scripts/ledger.mjs stats 2>&1 | head -2
for f in 01_architecture 02_data_model 09_nonfunctional; do node .claude/scripts/ledger.mjs tag-check "bd->dd" --file $f 2>&1 | head -1; done
for f in 01_architecture 02_data_model 08_error_logging 09_nonfunctional; do node .claude/scripts/ledger.mjs approval-report "bd->dd" --file $f 2>&1 | head -1; done
node .claude/scripts/ledger.mjs plan-report "req->bd" 2>&1 | grep '分類が無い'
node .claude/scripts/ledger.mjs plan-report "bd->dd" 2>&1 | grep '分類が無い'
node .claude/scripts/ledger.mjs ops --since "$1" --expect judge,plan,sync,decompose,stale-diff,approve,harvest 2>&1 | tail -12
ls .claude/coverage/edges/
