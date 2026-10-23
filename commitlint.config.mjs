// Conventional Commits の形と接頭辞を、commit-msg のフックと CI で機械で強制する（基本設計 15_development_process.md 3.2 節、web-core-foundation.md 15.3 節）。
// <!-- req webcorefoundation:2cad1099.b3e5 --> <!-- req webcorefoundation:2cad1099.7490 --> <!-- req webcorefoundation:2cad1099.c01f -->
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 接頭辞は feat・fix・refactor・test・docs・chore の 6 つだけにする（config-conventional の既定は build・ci・perf・revert・style も通す）。
    // git revert の「Revert "…"」は commitlint の既定で検査の外になる。
    'type-enum': [2, 'always', ['feat', 'fix', 'refactor', 'test', 'docs', 'chore']], // <!-- req webcorefoundation:7e108aa0.631f --> <!-- req webcorefoundation:7e108aa0.ec6b --> <!-- req webcorefoundation:7e108aa0.c43e --> <!-- req webcorefoundation:7e108aa0.a632 --> <!-- req webcorefoundation:7e108aa0.33a9 --> <!-- req webcorefoundation:7e108aa0.1dd4 --> <!-- req webcorefoundation:7e108aa0.89f5 --> <!-- req webcorefoundation:7e108aa0.3a91 -->
    'body-max-line-length': [0, 'always', Infinity],
    'footer-max-line-length': [0, 'always', Infinity],
  },
};
