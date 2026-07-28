# CLAUDE.md — YORR 작업 규칙 (1인 프로젝트, 가볍게)

혼자 하는 탐색용 프로젝트라 무거운 컨벤션은 두지 않는다.
**커밋 메시지 규칙과 브랜치 전략 정도만** 지킨다. 나머지는 상황에 맞게.

## 커밋 메시지 규칙

형식(Conventional Commits 축약):

```
<type>: <한 줄 요약 (한국어 OK, 명령형/현재형, 마침표 없음)>

<본문 — 왜 이렇게 했는지 (선택). 필요할 때만>
```

- **type** 목록
  - `feat`   새 기능 (예: 게임 추가)
  - `fix`    버그 수정
  - `refactor` 동작 변화 없는 구조 개선
  - `style`  포맷·주석·네이밍 등 (로직 변화 없음)
  - `docs`   문서 (README, 이 파일 등)
  - `chore`  빌드·설정·의존성 잡일
- 요약은 **50자 이내** 목표, 무엇을 했는지 한눈에.
- 한 커밋 = 한 가지 일. 게임 하나 추가처럼 큰 작업은 논리 단위로 나눠도 됨.
- `develop` 에 합칠 때 커밋이 여러 개(3개 이상)면 squash 로 하나로 묶는다.
  1~2개면 그냥 merge. squash 커밋 제목도 `<type>: 제목` 형식.

예시:
```
feat: 기술스택 슬래셔 미니게임 추가
fix: 리듬탭 키보드 안내 누락 수정
docs: README에 미니게임 목록 추가
```

형식이 헷갈리면 저장소 루트의 `.gitmessage` 템플릿을 쓴다. 로컬에서 한 번만 등록하면 됨:

```
git config commit.template .gitmessage
```

## 브랜치 전략 (가볍게)

- `main` — 배포/안정본. 항상 동작하는 상태.
- `develop` — 평소 작업·통합 기준 브랜치.
- 큰 작업이나 실험은 `feature/<설명>` · `chore/<설명>` 브랜치를 파서 `develop` 에 합친다(선택).
  사소한 수정은 `develop` 에 바로 커밋해도 된다.
- 흐름: `feature`·`chore` → `develop` 에 합쳐 확인 → 검증되면 `main` 에 반영.
- 접두어는 커밋 type 에 맞춘다: `feature/` · `fix/` · `refactor/` · `docs/` · `chore/`
  (소문자·하이픈·영문, 번호 없음. 커밋 type 은 `feat:` 이지만 브랜치는 관례상 `feature/`.
  `style` 은 단독 브랜치를 만들지 않는다.)

예시: `feature/yacht-3d-board`, `chore/git-convention`

## 그 외 (강제 아님, 지향점)

- 프론트는 기존 컨벤션을 따른다: `client/src/games/<게임>/`, 상태관리 라이브러리 없이
  게임 루프는 `useRef`, UI 노출값만 `useState`. Zustand·라우터 도입하지 않음.
- 외부 이미지/폰트 에셋 다운로드 금지 — 로고 등은 인라인(SVG/Canvas)으로 직접 그린다.
- `push` / 원격 반영은 **작업자가 직접** (도구가 임의로 push 하지 않음).
