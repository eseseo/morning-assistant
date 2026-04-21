#!/usr/bin/env python3
"""
지영의 아침 텔레그램 알림
매일 아침 오늘의 할 일을 텔레그램으로 보내줍니다.
"""

import json
import os
import urllib.request
import urllib.parse
from datetime import datetime

# .env 파일 로드 (로컬 테스트용)
_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_path):
    for line in open(_env_path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

BOT_TOKEN  = os.environ["BOT_TOKEN"]
CHAT_ID    = os.environ["CHAT_ID"]
TASKS_FILE = os.environ.get("TASKS_FILE", os.path.expanduser("~/Documents/Claude/Projects/개인비서/tasks.json"))

PRIORITY_EMOJI = {"high": "🔴", "medium": "🟡", "low": "🔵"}
WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]


def send_telegram(text: str):
    url  = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    body = urllib.parse.urlencode({
        "chat_id": CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def main():
    now      = datetime.now()
    today    = now.strftime("%Y-%m-%d")
    date_str = now.strftime("%Y년 %m월 %d일")
    day_str  = WEEKDAYS[now.weekday()]

    # tasks.json 읽기
    today_tasks = []
    try:
        with open(TASKS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        today_tasks = [
            t for t in data.get("tasks", [])
            if t.get("date") and t.get("date") >= today and not t.get("completed", False)
        ]
        today_tasks.sort(key=lambda t: t.get("date", "") + (t.get("time") or ""))
    except FileNotFoundError:
        pass  # 파일 없으면 할 일 없는 것으로

    # 메시지 구성
    lines = [
        f"🌅 <b>좋은 아침, 지영씨! 🤘</b>",
        f"",
        f"📅 {date_str} ({day_str})",
        f"",
    ]

    if today_tasks:
        lines.append(f"진행 중인 할 일 <b>{len(today_tasks)}개</b>")
        lines.append("")
        for t in today_tasks:
            emoji  = PRIORITY_EMOJI.get(t.get("priority", "medium"), "🟡")
            cat    = f" <i>#{t['category']}</i>" if t.get("category") else ""
            d      = t.get("date", "")
            diff   = (datetime.strptime(d, "%Y-%m-%d") - datetime.strptime(today, "%Y-%m-%d")).days
            d_tag  = "<b>D-day</b>" if diff == 0 else f"D-{diff}"
            lines.append(f"{emoji} [{d_tag}] {t['title']}{cat}")
    else:
        lines += [
            "오늘 등록된 할 일이 없어요! 🎉",
            "앱에서 추가해보세요.",
        ]

    lines += ["", "💪 <b>오늘도 화이팅!</b>", "", "📱 <a href=\"https://eseseo.github.io/morning-assistant\">할 일 앱 열기</a>"]
    message = "\n".join(lines)

    result = send_telegram(message)
    if result.get("ok"):
        print("✅ 텔레그램 전송 완료!")
    else:
        print(f"❌ 전송 실패: {result}")


if __name__ == "__main__":
    main()
