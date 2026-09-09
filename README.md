# 2026 제2회 성남×KAIST AI 경진대회

대회 자료, 분석, 코드와 제출물을 관리하는 작업 공간입니다.

GitHub: [LSB-afk/-2026-2nd-Seongnam-KAIST-AI-Competition](https://github.com/LSB-afk/-2026-2nd-Seongnam-KAIST-AI-Competition)

## 폴더 구조

```text
.
├── docs/                    # 대회 안내, 기획, 참고 문서
├── data/
│   ├── raw/                 # 원본 데이터 (로컬 보관)
│   └── processed/           # 전처리 데이터 (로컬 보관)
├── notebooks/               # 탐색 및 실험 노트북
├── src/                     # 프로젝트 소스 코드
├── outputs/                 # 모델, 로그, 실행 결과 (로컬 보관)
├── submissions/             # 제출 파일 (로컬 보관)
├── .gitignore
└── seongnam-kaist.code-workspace
```

## 작업 공간 열기

이 저장소 폴더를 편집기에서 열어 작업합니다. VS Code 또는 Cursor에서는
`seongnam-kaist.code-workspace` 파일을 열어도 됩니다. 워크스페이스는 현재
폴더를 상대 경로로 참조하므로 다른 위치에 복제해도 사용할 수 있습니다.

아직 실행 코드나 의존성은 없습니다. 개발 환경과 실행 방법은 사용할 기술을
정한 뒤 추가합니다.

## GitHub와 동기화

로컬 `main` 브랜치는 원격 `origin/main`을 추적합니다.
파일을 저장하는 것만으로 GitHub에 자동 업로드되지는 않습니다.

작업 전 원격 변경 사항 가져오기:

```bash
git pull --ff-only
```

작업 후 변경 사항을 확인하고, 공유할 파일만 골라 커밋하고 올리기:

```bash
git status
git diff
git add <공유할-파일-경로>
git commit
git push
```

커밋 메시지의 첫 줄에는 변경 이유를 적고, 필요한 경우 `Constraint:`,
`Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`,
`Not-tested:` 트레일러로 결정 배경과 검증 결과를 기록합니다.

## 로컬 보관 파일

- `.omx/`, `.env` 등 로컬 실행 상태와 비밀 설정은 Git에서 제외합니다.
- `data/`, `outputs/`, `submissions/`의 내용은 Git에서 제외하며, 폴더 구조를
  유지하는 `.gitkeep` 파일만 추적합니다.
- 가상환경, Python 캐시, 노트북 체크포인트도 Git에서 제외합니다.
- `docs/`, `notebooks/`, `src/`에 추가한 파일은 커밋 대상으로 관리합니다.

다른 컴퓨터에서 복제할 때 로컬 보관 데이터와 결과물은 별도로 옮겨야 합니다.
