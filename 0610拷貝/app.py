import copy
import datetime
import math
import os
import re
import threading
from typing import Optional

import requests
from dotenv import load_dotenv
from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room
from openai import OpenAI
from supabase import Client, create_client

load_dotenv()

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
STARBUCKS_SECONDS_PER_CUP = 3600

nvidia_client = (
    OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=NVIDIA_API_KEY)
    if NVIDIA_API_KEY
    else None
)
supabase_client: Optional[Client] = (
    create_client(SUPABASE_URL, SUPABASE_KEY)
    if SUPABASE_URL and SUPABASE_KEY
    else None
)

sessions = {}
sid_rooms = {}
sessions_lock = threading.RLock()


def default_state():
    return {
        "mode": "CALIBRATION",
        "work_time": 0.0,
        "target_work_time": 1500,
        "pomodoro_count": 0,
        "daily_total_time": 0.0,
        "user_absent": False,
        "eyes": "OPEN",
        "mouth": "NORMAL",
        "distance": "GOOD",
        "light": "GOOD",
        "posture": "GOOD",
        "shoulders": "BALANCED",
        "calibration_progress": 0,
        "calibration_status": "COLLECTING",
        "exercise_task": "",
        "exercise_progress": "",
        "exercise_status": "",
        "alert_counts": {"eyes": 0, "shoulders": 0, "dist": 0, "mouth": 0, "light": 0},
        "is_paused": False,
        "current_absent_time": 0.0,
        "total_cyberloafing_time": 0.0,
        "failed_pomodoros": 0,
        "current_dark_time": 0.0,
        "max_dark_time": 0.0,
    }


def get_session(room_id):
    with sessions_lock:
        return sessions.setdefault(
            room_id,
            {
                "state": default_state(),
                "discord_webhook": "",
                "weekly_history": [],
                "last_seen": datetime.datetime.now(),
            },
        )


def current_room():
    return sid_rooms.get(request.sid)


def sanitize_room_id(value):
    value = str(value or "")
    return value if re.fullmatch(r"[A-Za-z0-9_-]{12,80}", value) else None


def get_daily_evaluation(state):
    total = state["daily_total_time"] + state["total_cyberloafing_time"]
    cyber_ratio = state["total_cyberloafing_time"] / total if total > 0 else 0
    alerts = state["alert_counts"]
    work_hours = state["daily_total_time"] / 3600

    if cyber_ratio > 0.4:
        return {"title": "🥷 薪水小偷 / 摸魚大師", "comment": "「你的椅子上是長釘子了嗎？攝影機表示它很想念你。」", "advice": "對策：請嘗試縮短休息週期。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513214183666094120/touchfish.png"}
    if state["daily_total_time"] > 7200 and alerts["eyes"] + alerts["mouth"] > 5:
        return {"title": "🧟 過勞社畜 / 燃燒生命的肝鐵人", "comment": "「靈魂已經登出，只剩肉體還在敲鍵盤。請立刻去睡覺。」", "advice": "對策：建議開啟強制鎖定螢幕休息機制。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513214765269520535/image.png"}
    if work_hours > 0 and alerts["shoulders"] + alerts["dist"] > 15 * work_hours:
        return {"title": "🦍 進化失敗的猿人 / 脊椎終結者", "comment": "「你整個人快要鑽進螢幕裡了，再不坐正，明天就準備去復健科報到。」", "advice": "對策：請執行系統引導的肩頸伸展動作。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513214908919976028/image.png"}
    if state["max_dark_time"] > 60:
        return {"title": "🦇 夜行性穴居生物", "comment": "「不開燈工作是為了省電還是為了氣氛？你的散光度數準備增加了。」", "advice": "對策：請立即開啟室內光源以保護視力。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513215045683908799/image.png"}
    if state["pomodoro_count"] > 0 and all(value < 3 for value in alerts.values()):
        return {"title": "🧘 入定高僧 / 模範生企鵝", "comment": "「完美的人體工學模範生，請收下我的膝蓋！」", "advice": "對策：已解鎖企鵝最終進化形態！", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513215225523081406/image.png"}
    return {"title": "🧑‍💻 我們還不夠熟，所以還在觀察模式", "comment": "「保持良好的工作節奏，繼續加油！」", "advice": "對策：繼續維持當前的專注循環。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513215835332808875/content.png"}


def build_daily_settlement(state):
    total_seconds = int(state["daily_total_time"])
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    exact = total_seconds / STARBUCKS_SECONDS_PER_CUP
    return {
        "evaluation": get_daily_evaluation(state),
        "work_time": {"seconds": total_seconds, "formatted": f"{hours} 小時 {minutes} 分鐘 {seconds} 秒"},
        "pomodoro_count": state["pomodoro_count"],
        "failed_pomodoros": state["failed_pomodoros"],
        "cyberloafing_minutes": int(state["total_cyberloafing_time"] // 60),
        "alerts": state["alert_counts"].copy(),
        "starbucks": {
            "cups": int(exact),
            "exact": round(exact, 1),
            "remaining_minutes": max(0, math.ceil((3600 - total_seconds % 3600) / 60)) if total_seconds % 3600 else 0,
        },
    }


def get_ai_advice(state, history):
    if not nvidia_client:
        return "設定 NVIDIA API Key 後，即可解鎖專屬 AI 深度分析功能。"
    alerts = state["alert_counts"]
    prompt = (
        "你是嚴格但專業的生產力與人體工學教練。請用 50 到 100 字，"
        "同時針對專注、離席、眼部、肩膀、距離、哈欠及光線數據提出具體改善指令，"
        f"不要重複報數據。今日狀態：{state}；近期香港資料：{history[-3:]}"
    )
    try:
        completion = nvidia_client.chat.completions.create(
            model="meta/llama-3.1-70b-instruct",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=512,
        )
        return completion.choices[0].message.content.strip()
    except Exception:
        return f"請優先改善警報最多的項目：{max(alerts, key=alerts.get)}。"


def build_discord_embed(report_type, state, history):
    alerts = state["alert_counts"]
    hours, remainder = divmod(int(state["daily_total_time"]), 3600)
    time_text = f"{hours} 小時 {remainder // 60} 分鐘"
    evaluation = get_daily_evaluation(state)
    description = (
        f"### {evaluation['title']}\n> **{evaluation['comment']}**\n"
        f"> {evaluation['advice']}\n\n"
        f"專注：**{time_text}** ｜ 番茄鐘：**{state['pomodoro_count']}** 顆\n"
        f"失敗番茄鐘：**{state['failed_pomodoros']}** 顆 ｜ 摸魚：**{int(state['total_cyberloafing_time'] // 60)}** 分鐘\n\n"
        f"眼部 `{alerts['eyes']}` ｜ 哈欠 `{alerts['mouth']}` ｜ "
        f"高低肩 `{alerts['shoulders']}` ｜ 過近 `{alerts['dist']}` ｜ 光線 `{alerts['light']}`"
    )
    if report_type == "weekly":
        description += f"\n\n**AI 教練建議**\n{get_ai_advice(state, history)}"
    return {
        "title": "PulseAI 今日健康與專注報告" if report_type == "daily" else "PulseAI 一週健康與產值總結報告",
        "description": description,
        "color": 5814783,
        "thumbnail": {"url": evaluation["image_url"]},
    }


def send_discord_report(room_id, report_type):
    with sessions_lock:
        session = get_session(room_id)
        webhook = session["discord_webhook"]
        state = copy.deepcopy(session["state"])
        history = copy.deepcopy(session["weekly_history"])

    success = False
    if webhook.startswith("http"):
        try:
            response = requests.post(
                webhook,
                json={"username": "PulseAI 助理", "embeds": [build_discord_embed(report_type, state, history)]},
                timeout=10,
            )
            success = response.status_code == 204
        except requests.RequestException:
            pass
    socketio.emit("report_status", {"success": success, "type": report_type}, to=room_id)


def sync_to_cloud(room_id):
    if not supabase_client:
        return
    with sessions_lock:
        state = copy.deepcopy(get_session(room_id)["state"])
    payload = {
        "date": datetime.datetime.now().strftime("%Y-%m-%d"),
        "work_time": int(state["daily_total_time"]),
        "pomodoros": state["pomodoro_count"],
        **state["alert_counts"],
    }
    try:
        supabase_client.table("health_data").insert(payload).execute()
    except Exception:
        pass


@app.route("/")
def index():
    return render_template("index.html")


@socketio.on("connect")
def handle_connect(auth):
    room_id = sanitize_room_id((auth or {}).get("roomId"))
    if not room_id:
        return False
    sid_rooms[request.sid] = room_id
    join_room(room_id)
    session = get_session(room_id)
    session["last_seen"] = datetime.datetime.now()
    emit("state_update", copy.deepcopy(session["state"]))


@socketio.on("disconnect")
def handle_disconnect():
    sid_rooms.pop(request.sid, None)


@socketio.on("vision_state")
def handle_vision_state(data):
    room_id = current_room()
    if not room_id or not isinstance(data, dict):
        return
    allowed = set(default_state())
    clean = {key: value for key, value in data.items() if key in allowed}
    with sessions_lock:
        session = get_session(room_id)
        session["state"].update(clean)
        session["last_seen"] = datetime.datetime.now()
        state = copy.deepcopy(session["state"])
    emit("state_update", state, to=room_id)


@socketio.on("request_recalibrate")
def handle_recalibrate():
    room_id = current_room()
    if room_id:
        emit("recalibrate", to=room_id)


@socketio.on("set_pomodoro_time")
def handle_set_time(data):
    room_id = current_room()
    if room_id:
        emit("pomodoro_time_changed", {"seconds": max(1, int((data or {}).get("seconds", 1500)))}, to=room_id)


@socketio.on("request_pause")
def handle_pause(data):
    room_id = current_room()
    if room_id:
        emit("pause_changed", {"paused": bool((data or {}).get("paused", False))}, to=room_id)


@socketio.on("request_daily_settlement")
def handle_daily_settlement():
    room_id = current_room()
    if not room_id:
        return
    with sessions_lock:
        state = copy.deepcopy(get_session(room_id)["state"])
    emit("daily_settlement_response", build_daily_settlement(state), to=room_id)


@socketio.on("request_discord_report")
def handle_manual_report(data):
    room_id = current_room()
    if not room_id:
        return
    report_type = (data or {}).get("type", "daily")
    threading.Thread(target=send_discord_report, args=(room_id, report_type), daemon=True).start()
    if report_type == "daily":
        threading.Thread(target=sync_to_cloud, args=(room_id,), daemon=True).start()


@socketio.on("request_cloud_data")
def handle_fetch_cloud():
    room_id = current_room()
    if not room_id:
        return
    if not supabase_client:
        emit("cloud_data_response", {"error": "尚未設定 Supabase 連線網址與金鑰"}, to=room_id)
        return
    try:
        response = supabase_client.table("health_data").select("*").order("date", desc=False).execute()
        emit("cloud_data_response", {"data": response.data}, to=room_id)
    except Exception as exc:
        emit("cloud_data_response", {"error": str(exc)}, to=room_id)


@socketio.on("update_discord_webhook")
def handle_update_webhook(data):
    room_id = current_room()
    if room_id:
        with sessions_lock:
            get_session(room_id)["discord_webhook"] = str((data or {}).get("url", ""))


if __name__ == "__main__":
    print("PulseAI 已啟動：鏡頭與 MediaPipe 推論由瀏覽器執行。")
    socketio.run(app, debug=True, host="0.0.0.0", port=5001, use_reloader=False)
