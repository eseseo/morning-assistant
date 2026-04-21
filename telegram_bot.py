"""
텔레그램 양방향 봇 - GitHub Actions 폴링 방식
tasks.json을 GitHub API로 읽고 쓰는 방식으로 동작합니다.
이미지 처리: Claude Vision API 사용
"""

import os
import json
import re
import uuid
import base64
import requests
from datetime import datetime, timedelta, timezone

# ── 환경변수 ──────────────────────────────────────────────
TELEGRAM_TOKEN    = os.environ["TELEGRAM_TOKEN"]
TELEGRAM_CHAT_ID  = os.environ["TELEGRAM_CHAT_ID"]
GITHUB_TOKEN      = os.environ["GH_TOKEN"]
GITHUB_REPO       = os.environ["GITHUB_REPO"]
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
TASKS_FILE_PATH   = os.environ.get("TASKS_FILE_PATH", "tasks.json")

# offset를 GitHub에 저장해 폴링 중복 방지
OFFSET_FILE_PATH = os.environ.get("OFFSET_FILE_PATH", "telegram_offset.json")

TELEGRAM_API = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
GITHUB_API   = "https://api.github.com"
KST = timezone(timedelta(hours=9))

CATEGORY_KEYWORDS = {
    "미팅": ["미팅", "회의", "mtg", "meeting"],
    "공부": ["공부", "학습", "스터디", "study"],
    "업무": ["업무", "보고서", "제출", "발표", "기획", "검토"],
    "개인": ["병원", "약속", "운동", "청소", "쇼핑", "개인"],
}

PRIORITY_KEYWORDS = {
    "high":   ["긴급", "중요", "꼭", "반드시", "!!", "urgent"],
    "low":    ["나중에", "여유", "틈나면", "low"],
}

# ── GitHub API 헬퍼 ──────────────────────────────────────
def gh_get(path: str) -> dict:
    r = requests.get(
        f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{path}",
        headers={
            "Authorization": f"token {GITHUB_TOKEN}",
            "Accept": "application/vnd.github.v3+json",
        },
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def gh_put(path: str, content_bytes: bytes, sha: str | None, message: str) -> None:
    import base64
    payload = {
        "message": message,
        "content": base64.b64encode(content_bytes).decode(),
    }
    if sha:
        payload["sha"] = sha
    r = requests.put(
        f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{path}",
        headers={
            "Authorization": f"token {GITHUB_TOKEN}",
            "Accept": "application/vnd.github.v3+json",
        },
        json=payload,
        timeout=15,
    )
    r.raise_for_status()


def load_json_from_github(path: str) -> tuple[dict, str | None]:
    """파일 내용과 sha 반환. 파일 없으면 ({}, None)."""
    import base64
    try:
        info = gh_get(path)
        data = json.loads(base64.b64decode(info["content"]).decode())
        return data, info["sha"]
    except requests.HTTPError as e:
        if e.response.status_code == 404:
            return {}, None
        raise


def save_json_to_github(path: str, data: dict, sha: str | None, message: str) -> None:
    content = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    gh_put(path, content, sha, message)


# ── Telegram 헬퍼 ────────────────────────────────────────
def tg_get_updates(offset: int) -> list[dict]:
    r = requests.get(
        f"{TELEGRAM_API}/getUpdates",
        params={"offset": offset, "timeout": 5},
        timeout=20,
    )
    r.raise_for_status()
    return r.json().get("result", [])


def tg_send(text: str) -> None:
    requests.post(
        f"{TELEGRAM_API}/sendMessage",
        json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"},
        timeout=10,
    )


# ── 날짜 파싱 ─────────────────────────────────────────────
def parse_date(text: str) -> str:
    """텍스트에서 날짜를 추출해 YYYY-MM-DD 반환. 없으면 오늘."""
    today = datetime.now(KST).date()

    patterns = [
        (r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", lambda m: f"{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}"),
        (r"(\d{1,2})[.\-/](\d{1,2})",               lambda m: f"{today.year}-{int(m[1]):02d}-{int(m[2]):02d}"),
    ]
    for pat, fmt in patterns:
        m = re.search(pat, text)
        if m:
            return fmt(m)

    relative = {
        "오늘": 0, "today": 0,
        "내일": 1, "tomorrow": 1,
        "모레": 2,
        "글피": 3,
    }
    for word, delta in relative.items():
        if word in text:
            return str(today + timedelta(days=delta))

    weekdays_ko = ["월", "화", "수", "목", "금", "토", "일"]
    for i, wd in enumerate(weekdays_ko):
        if f"{wd}요일" in text or (len(wd) == 1 and f"{wd}요" in text):
            diff = (i - today.weekday()) % 7
            if diff == 0:
                diff = 7  # 이번 주 같은 요일이면 다음 주로
            return str(today + timedelta(days=diff))

    return str(today)


def parse_time(text: str) -> str | None:
    """HH:MM 형식 반환. 없으면 None."""
    m = re.search(r"오전\s*(\d{1,2})시", text)
    if m:
        return f"{int(m[1]):02d}:00"
    m = re.search(r"오후\s*(\d{1,2})시", text)
    if m:
        hour = int(m[1])
        return f"{hour + 12 if hour < 12 else hour:02d}:00"
    m = re.search(r"(\d{1,2}):(\d{2})", text)
    if m:
        return f"{int(m[1]):02d}:{m[2]}"
    m = re.search(r"(\d{1,2})시\s*(\d{2}분)?", text)
    if m:
        hour = int(m[1])
        minute = int(m[2].replace("분", "")) if m[2] else 0
        return f"{hour:02d}:{minute:02d}"
    return None


def guess_category(text: str) -> str:
    text_lower = text.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                return cat
    return "기타"


def guess_priority(text: str) -> str:
    text_lower = text.lower()
    for priority, keywords in PRIORITY_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                return priority
    return "medium"


# ── 할 일 추가 ────────────────────────────────────────────
def add_task(title: str, date: str, time_str: str | None,
             priority: str, category: str) -> dict:
    return {
        "id": str(uuid.uuid4())[:8],
        "title": title,
        "date": date,
        "time": time_str,
        "priority": priority,
        "category": category,
        "completed": False,
    }


def clean_command_prefix(text: str) -> str:
    """커맨드 접두사 제거."""
    return re.sub(r"^/\S+\s*", "", text).strip()


# ── 이미지 분석 (Claude Vision) ───────────────────────────
def analyze_image_with_claude(file_id: str) -> str:
    """Telegram file_id로 이미지를 받아 Claude로 분석 후 할 일 텍스트 반환."""
    # 1. Telegram에서 파일 URL 가져오기
    r = requests.get(f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/getFile",
                     params={"file_id": file_id}, timeout=15)
    r.raise_for_status()
    file_path = r.json()["result"]["file_path"]
    file_url  = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}/{file_path}"

    # 2. 이미지 다운로드
    img_r = requests.get(file_url, timeout=30)
    img_r.raise_for_status()
    img_b64 = base64.standard_b64encode(img_r.content).decode()

    # 3. Claude Vision으로 분석
    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 512,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64}
                },
                {
                    "type": "text",
                    "text": (
                        "이 이미지에서 할 일이나 일정 관련 정보를 추출해줘. "
                        "날짜, 시간, 내용, 마감일 등이 있으면 포함해서 "
                        "한국어로 한 줄 요약만 해줘. 예: '4월 28일 오후 2시 파트너사 미팅'. "
                        "할 일과 관계없는 이미지면 '관련없음'이라고만 답해."
                    )
                }
            ]
        }]
    }
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        },
        json=payload,
        timeout=30
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"].strip()


# ── 메시지 핸들러 ─────────────────────────────────────────
def handle_message(text: str, tasks_data: dict) -> str:
    """메시지를 처리하고 응답 문자열을 반환. tasks_data를 in-place로 변경."""
    text = text.strip()

    # /목록 커맨드
    if text.startswith("/목록") or text == "목록":
        today = str(datetime.now(KST).date())
        remaining = [
            t for t in tasks_data.get("tasks", [])
            if not t.get("completed") and t.get("date", "") >= today
        ]
        if not remaining:
            return "남은 할 일이 없습니다. 여유로운 하루 보내세요!"

        remaining.sort(key=lambda t: (t["date"], t.get("time") or "99:99"))
        lines = ["📋 *남은 할 일 목록*\n"]
        for t in remaining:
            time_str = f" {t['time']}" if t.get("time") else ""
            pri_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(t["priority"], "⚪")
            lines.append(f"{pri_icon} [{t['date']}{time_str}] {t['title']}")
        return "\n".join(lines)

    # /완료 커맨드
    if text.startswith("/완료"):
        keyword = clean_command_prefix(text)
        if not keyword:
            return "완료할 할 일의 키워드를 입력해주세요.\n예: /완료 보고서"
        matched = [t for t in tasks_data.get("tasks", []) if keyword in t["title"]]
        if not matched:
            return f"'{keyword}'이(가) 포함된 할 일을 찾을 수 없습니다."
        for t in matched:
            t["completed"] = True
        names = "\n".join(f"✅ {t['title']}" for t in matched)
        return f"완료 처리했습니다!\n{names}"

    # /삭제 커맨드
    if text.startswith("/삭제"):
        keyword = clean_command_prefix(text)
        if not keyword:
            return "삭제할 할 일의 키워드를 입력해주세요.\n예: /삭제 보고서"
        before = len(tasks_data.get("tasks", []))
        tasks_data["tasks"] = [
            t for t in tasks_data.get("tasks", []) if keyword not in t["title"]
        ]
        deleted = before - len(tasks_data["tasks"])
        if deleted == 0:
            return f"'{keyword}'이(가) 포함된 할 일을 찾을 수 없습니다."
        return f"🗑️ {deleted}개의 할 일을 삭제했습니다."

    # /도움말 또는 /help
    if text.startswith("/도움말") or text.startswith("/help"):
        return (
            "📖 *사용 가능한 명령어*\n\n"
            "• 자연어 입력 → 자동으로 할 일 추가\n"
            "  예) `내일 오전 10시 미팅 준비`\n"
            "  예) `목요일 보고서 제출`\n\n"
            "• `/추가 [내용]` → 할 일 추가\n"
            "• `/목록` → 남은 할 일 보기\n"
            "• `/완료 [키워드]` → 완료 처리\n"
            "• `/삭제 [키워드]` → 삭제\n"
            "• `/도움말` → 이 도움말"
        )

    # 할 일 추가 (/추가 또는 자연어)
    if text.startswith("/추가"):
        title_raw = clean_command_prefix(text)
    else:
        title_raw = text

    if not title_raw:
        return "추가할 내용을 입력해주세요."

    date_str  = parse_date(title_raw)
    time_str  = parse_time(title_raw)
    category  = guess_category(title_raw)
    priority  = guess_priority(title_raw)

    # 제목에서 날짜/시간 관련 단어 정리 (선택적, 간단하게)
    title_clean = title_raw

    task = add_task(title_clean, date_str, time_str, priority, category)
    tasks_data.setdefault("tasks", []).append(task)

    time_display = f" {time_str}" if time_str else ""
    pri_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(priority, "⚪")
    return (
        f"✅ 할 일이 추가되었습니다!\n\n"
        f"{pri_icon} *{title_clean}*\n"
        f"📅 {date_str}{time_display}\n"
        f"🏷️ {category} | 우선순위: {priority}"
    )


# ── 메인 ──────────────────────────────────────────────────
def main():
    print("텔레그램 봇 폴링 시작")

    # offset 로드
    offset_data, offset_sha = load_json_from_github(OFFSET_FILE_PATH)
    current_offset = offset_data.get("offset", 0)
    print(f"현재 offset: {current_offset}")

    # 새 메시지 가져오기
    updates = tg_get_updates(current_offset)
    if not updates:
        print("새 메시지 없음")
        return

    # tasks.json 로드
    tasks_data, tasks_sha = load_json_from_github(TASKS_FILE_PATH)
    if not tasks_data:
        tasks_data = {"tasks": [], "syncedAt": ""}

    tasks_changed = False
    new_offset = current_offset

    for update in updates:
        new_offset = max(new_offset, update["update_id"] + 1)

        message = update.get("message") or update.get("edited_message")
        if not message:
            continue

        # 허용된 채팅 ID만 처리
        chat_id = str(message["chat"]["id"])
        if chat_id != TELEGRAM_CHAT_ID:
            print(f"허용되지 않은 채팅 ID: {chat_id}")
            continue

        text  = message.get("text", "").strip()
        photo = message.get("photo")

        # 이미지 메시지 처리
        if photo and ANTHROPIC_API_KEY:
            print("이미지 수신, Claude Vision으로 분석 중...")
            file_id = photo[-1]["file_id"]  # 가장 큰 해상도
            try:
                extracted = analyze_image_with_claude(file_id)
                print(f"추출된 내용: {extracted}")
                if extracted == "관련없음":
                    tg_send("이미지에서 할 일 관련 내용을 찾지 못했어요 🤔")
                else:
                    text = extracted  # 추출된 텍스트를 일반 메시지처럼 처리
            except Exception as e:
                print(f"이미지 분석 실패: {e}")
                tg_send("이미지 분석 중 오류가 발생했어요 😢")
                continue

        if not text:
            continue

        print(f"메시지 수신: {text}")

        # 메시지 처리
        before_snapshot = json.dumps(tasks_data, ensure_ascii=False, sort_keys=True)
        response = handle_message(text, tasks_data)
        tg_send(response)
        if json.dumps(tasks_data, ensure_ascii=False, sort_keys=True) != before_snapshot:
            tasks_changed = True

    # tasks.json 저장 (변경된 경우)
    if tasks_changed:
        tasks_data["syncedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        save_json_to_github(
            TASKS_FILE_PATH,
            tasks_data,
            tasks_sha,
            "bot: tasks.json 업데이트 (텔레그램 봇)",
        )
        print("tasks.json 저장 완료")

    # offset 저장
    if new_offset != current_offset:
        save_json_to_github(
            OFFSET_FILE_PATH,
            {"offset": new_offset},
            offset_sha,
            f"bot: telegram offset 업데이트 ({new_offset})",
        )
        print(f"offset 저장: {new_offset}")

    print("완료")


if __name__ == "__main__":
    main()
