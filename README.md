# 지영의 개인 비서 앱 🤘

> 처음 세팅할 때 뭘 했는지 기록해둔 문서.
> 나중에 다시 볼 때, 또는 뭔가 고칠 때 참고용.

---

## 뭘 만들었냐

할 일 + 일정 관리 비서 앱 + 매일 아침 텔레그램 알림 시스템.

```
앱에서 할 일 입력
    ↓
GitHub에 동기화 (🐙 버튼)
    ↓
매일 오전 8시 GitHub Actions 자동 실행
    ↓
텔레그램으로 오늘 할 일 알림 📱
```

---

## 파일 구조

```
개인비서/
├── assistant.jsx          ← 비서 앱 본체 (React, 네오펑키 다크 스타일)
├── morning_alert.py       ← 텔레그램 알림 스크립트
├── tasks.json             ← 할 일 데이터 (앱에서 GitHub 동기화 시 생성)
├── .github/
│   └── workflows/
│       └── morning_alert.yml  ← GitHub Actions 스케줄러
├── setup_alert.sh         ← Mac 로컬 알림 설치 스크립트 (백업용)
└── com.jy.morning_alert.plist ← Mac launchd 설정 (백업용)
```

---

## 핵심 기술 스택

| 역할 | 기술 |
|------|------|
| 비서 앱 UI | React JSX (Cowork에서 바로 열림) |
| 데이터 저장 | localStorage (브라우저) |
| 클라우드 동기화 | GitHub API (앱 → GitHub) |
| 아침 알림 스케줄 | GitHub Actions (매일 23:00 UTC = 오전 8시 KST) |
| 알림 채널 | Telegram Bot API |

---

## 앱 사용법

### 할 일 추가
1. `assistant.jsx` 열기
2. **+ 할 일 추가** 클릭
3. 제목, 날짜, 시간, 우선순위, 카테고리 입력
4. Enter 또는 **추가하기** 클릭

### GitHub 동기화 (아침 알림 연동)
1. 앱 하단 **🐙 GitHub 동기화** 클릭
2. 처음엔 토큰/레포 입력 창이 뜸:
   - Token: `github_pat_11AR7AK2I08ninxUWppvk2_...` (저장됨)
   - Repo: `eseseo/morning-assistant`
3. 저장 후엔 버튼 한 번만 누르면 자동 동기화

### 아침 알림 수동 테스트
GitHub → `github.com/eseseo/morning-assistant/actions`
→ **🌅 아침 텔레그램 알림** → **Run workflow** → **Run workflow**

---

## GitHub 설정 정보

| 항목 | 값 |
|------|-----|
| 레포 | `github.com/eseseo/morning-assistant` (Private) |
| 알림 시간 | 매일 오전 8시 KST |
| Cron 표현식 | `0 23 * * *` (UTC 기준) |

### GitHub Secrets (레포 → Settings → Secrets → Actions)
| Secret 이름 | 설명 |
|-------------|------|
| `TELEGRAM_BOT_TOKEN` | 텔레그램 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 내 텔레그램 채팅 ID: `1824348185` |

---

## 텔레그램 봇 정보

| 항목 | 값 |
|------|-----|
| 봇 토큰 | `8626100506:AAHDbxZy852sO2g4Z9olAqyurkIlue4gQwA` |
| 채팅 ID | `1824348185` |
| 봇 설정 | @BotFather 에서 발급 |

> ⚠️ 토큰은 절대 공개 레포에 올리지 말 것. 현재 GitHub Secrets로 안전하게 저장됨.

---

## 나중에 하고 싶은 것

- [ ] 앱 스타일 추가 수정
- [ ] 반복 일정 기능 (매주 월요일 등)
- [ ] 완료율 통계 화면
- [ ] Seoulfi 프로젝트 마무리

---

## 문제 해결 기록

### GitHub Actions workflow 파일 push 안 될 때
Fine-grained PAT은 workflow 파일 push에 별도 권한 필요.
→ 해결: GitHub 웹 UI에서 직접 `.github/workflows/morning_alert.yml` 생성

### Mac에서 테스트할 때
```bash
python3 ~/Documents/Claude/Projects/개인비서/morning_alert.py
```

### GitHub Actions 수동 실행
`Actions` 탭 → 워크플로우 선택 → `Run workflow`

---

*마지막 업데이트: 2026년 4월*
