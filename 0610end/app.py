import os
import time
import math
import cv2
import numpy as np
import threading
import traceback
import datetime      
import requests      
import copy
import mediapipe as mp
from openai import OpenAI
from flask import Flask, render_template, Response
from flask_socketio import SocketIO
import webbrowser
from dotenv import load_dotenv
from supabase import create_client, Client

# 🚀 載入 .env 檔案中的環境變數
load_dotenv()

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

global_frame = None
frame_lock = threading.Lock()
state_lock = threading.Lock() # 🌟 新增：保護系統狀態的執行緒鎖 (Thread Lock)

# ==========================================
# 💡 Webhook 與 API 設定區
# ==========================================
DISCORD_WEBHOOK_URL = "" 

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")  
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
DAILY_REPORT_TIME = "18:00"  
STARBUCKS_SECONDS_PER_CUP = 3600

# 🚀 初始化 NVIDIA API Client
if NVIDIA_API_KEY:
    nvidia_client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=NVIDIA_API_KEY
    )
else:
    print("⚠️ [警告] 找不到 NVIDIA_API_KEY，AI 建議功能將被停用。請檢查 .env 檔案。")
    nvidia_client = None

# 🚀 初始化 Supabase Client
if SUPABASE_URL and SUPABASE_KEY:
    supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    print("⚠️ [警告] 找不到 Supabase 參數，雲端同步功能將被停用。請檢查 .env 檔案。")
    supabase_client = None

# 🌟 初始化系統狀態
system_state = {
    "mode": "CALIBRATION", "work_time": 0.0, "target_work_time": 1500, "pomodoro_count": 0,       
    "daily_total_time": 0.0, "user_absent": False, "eyes": "OPEN", "mouth": "NORMAL", "distance": "GOOD",
    "light": "GOOD", "posture": "GOOD", "shoulders": "BALANCED", "calibration_progress": 0,
    "calibration_status": "COLLECTING", # 🌟 嚴格校正把關狀態
    "exercise_task": "", "exercise_progress": "", "exercise_status": "",
    "alert_counts": {"eyes": 0, "shoulders": 0, "dist": 0, "mouth": 0, "light": 0},
    "is_paused": False,
    "current_absent_time": 0.0, "total_cyberloafing_time": 0.0, "failed_pomodoros": 0,
    "current_dark_time": 0.0, "max_dark_time": 0.0 
}

force_recalibrate = False
has_sent_report_today = False 
weekly_history = [] 


def get_daily_evaluation(state):
    work_time_hrs = state["daily_total_time"] / 3600.0
    expected_time = state["daily_total_time"] + state["total_cyberloafing_time"]
    cyber_ratio = state["total_cyberloafing_time"] / expected_time if expected_time > 0 else 0
    alerts = state["alert_counts"]

    if cyber_ratio > 0.4:
        return {"title": "🥷 薪水小偷 / 摸魚大師", "comment": "「你的椅子上是長釘子了嗎？攝影機表示它很想念你。」", "advice": "對策：請嘗試縮短休息週期。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513214183666094120/touchfish.png"}
    elif state["daily_total_time"] > 7200 and (alerts["eyes"] + alerts["mouth"]) > 5:
        return {"title": "🧟 過勞社畜 / 燃燒生命的肝鐵人", "comment": "「靈魂已經登出，只剩肉體還在敲鍵盤。請立刻去睡覺。」", "advice": "對策：建議開啟強制鎖定螢幕休息機制。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513214765269520535/image.png"}
    elif work_time_hrs > 0 and (alerts["shoulders"] + alerts["dist"]) > (15 * work_time_hrs):
        return {"title": "🦍 進化失敗的猿人 / 脊椎終結者", "comment": "「你整個人快要鑽進螢幕裡了，再不坐正，明天就準備去復健科報到。」", "advice": "對策：請執行系統引導的肩頸伸展動作。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513214908919976028/image.png"}
    elif state["max_dark_time"] > 60:
        return {"title": "🦇 夜行性穴居生物", "comment": "「不開燈工作是為了省電還是為了氣氛？你的散光度數準備增加了。」", "advice": "對策：請立即開啟室內光源以保護視力。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513215045683908799/image.png"}
    elif state["pomodoro_count"] > 0 and all(v < 3 for v in alerts.values()):
        return {"title": "🧘 入定高僧 / 模範生企鵝", "comment": "「完美的人體工學模範生，請收下我的膝蓋！」", "advice": "對策：已解鎖企鵝最終進化形態！", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513215225523081406/image.png"}
    else:
        return {"title": "🧑‍💻 我們還不夠熟，所以還在觀察模式", "comment": "「保持良好的工作節奏，繼續加油！」", "advice": "對策：繼續維持當前的專注循環。", "image_url": "https://media.discordapp.net/attachments/1501988640878759957/1513215835332808875/content.png"}


def build_daily_settlement(state):
    total_seconds = int(state["daily_total_time"])
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    starbucks_exact = total_seconds / STARBUCKS_SECONDS_PER_CUP

    return {
        "evaluation": get_daily_evaluation(state),
        "work_time": {
            "seconds": total_seconds,
            "formatted": f"{hours} 小時 {minutes} 分鐘 {seconds} 秒",
        },
        "pomodoro_count": state["pomodoro_count"],
        "failed_pomodoros": state["failed_pomodoros"],
        "cyberloafing_minutes": int(state["total_cyberloafing_time"] // 60),
        "alerts": state["alert_counts"].copy(),
        "starbucks": {
            "cups": int(starbucks_exact),
            "exact": round(starbucks_exact, 1),
            "remaining_minutes": max(0, math.ceil(
                (STARBUCKS_SECONDS_PER_CUP - (total_seconds % STARBUCKS_SECONDS_PER_CUP)) / 60
            )) if total_seconds % STARBUCKS_SECONDS_PER_CUP else 0,
        },
    }

# ==========================================
# 幾何計算輔助函數
# ==========================================
def calculate_distance(p1, p2): return math.hypot(p2[0] - p1[0], p2[1] - p1[1])
def calculate_ear(eye_points):
    v1, v2, h = calculate_distance(eye_points[1], eye_points[5]), calculate_distance(eye_points[2], eye_points[4]), calculate_distance(eye_points[0], eye_points[3])
    return (v1 + v2) / (2.0 * h) if h != 0 else 0.0
def calculate_mar(mouth_points):
    v, h = calculate_distance(mouth_points[1], mouth_points[3]), calculate_distance(mouth_points[0], mouth_points[2])
    return v / h if h != 0 else 0.0
def is_fist(hand_landmarks, iw, ih):
    wrist = (hand_landmarks.landmark[0].x * iw, hand_landmarks.landmark[0].y * ih)
    tips, mcps = [8, 12, 16, 20], [5, 9, 13, 17]
    folded = sum(1 for t, m in zip(tips, mcps) if calculate_distance((hand_landmarks.landmark[t].x * iw, hand_landmarks.landmark[t].y * ih), wrist) < 
                 calculate_distance((hand_landmarks.landmark[m].x * iw, hand_landmarks.landmark[m].y * ih), wrist))
    return folded >= 3 
def get_head_turn_direction(face_landmarks, iw, ih):
    nose = (face_landmarks.landmark[1].x * iw, face_landmarks.landmark[1].y * ih)
    l_cheek = (face_landmarks.landmark[234].x * iw, face_landmarks.landmark[234].y * ih)
    r_cheek = (face_landmarks.landmark[454].x * iw, face_landmarks.landmark[454].y * ih)
    dl, dr = calculate_distance(nose, l_cheek), calculate_distance(nose, r_cheek)
    if dr == 0 or dl == 0: return "CENTER"
    return "TURNED" if (dl / dr) > 1.8 or (dl / dr) < 0.55 else "CENTER"

def get_robust_stats(data_list):
    if not data_list or len(data_list) < 5: return 0.0, 0.0
    q1, q3 = np.percentile(data_list, [25, 75])
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr
    filtered_data = [x for x in data_list if lower_bound <= x <= upper_bound]
    if not filtered_data:  
        filtered_data = data_list
    return np.mean(filtered_data), np.std(filtered_data)

def apply_ema(current_val, previous_ema, alpha=0.3):
    if previous_ema is None: return current_val
    return alpha * current_val + (1 - alpha) * previous_ema

# ==========================================
# 🚀 深度 AI 數據洞察生成器 (NVIDIA) - 已加入生產力分析與嚴格教練模式
# ==========================================
def get_ai_advice(time_str, alerts, pomo_done=0, pomo_fail=0, cyber_time=0, history=None):
    if not nvidia_client:
        return "💡 *系統提示：設定 NVIDIA API Key 後，即可解鎖專屬 AI 深度分析功能！*"
    try:
        # 抓出最嚴重的健康問題
        sorted_alerts = sorted(alerts.items(), key=lambda x: x[1], reverse=True)
        top_issue_1 = sorted_alerts[0][0] if len(sorted_alerts) > 0 else "無"
        
        issue_map = {"eyes": "眼部疲勞", "shoulders": "坐姿歪斜/高低肩", "dist": "距離螢幕過近", "mouth": "頻繁打哈欠", "light": "工作環境太暗"}
        top_1_zh = issue_map.get(top_issue_1, top_issue_1)

        trend_context = "無歷史數據。"
        if history and len(history) > 0:
            trend_context = "【歷史趨勢】\n"
            for i, day in enumerate(history[-3:]): 
                trend_context += f"前 {len(history)-i} 天: 專注 {int(day['time']//60)} 分，番茄鐘 {day['pomodoros']} 顆\n"

        cyber_mins = int(cyber_time // 60)
        
        prompt = f"""
        你是一位毒舌、嚴格但非常專業的「生產力與人體工學教練」。
        請根據使用者的今日數據，給出 50~100 字的「具體改善指令」。
        
        ⚠️ 嚴格限制：
        1. 絕對不准重複報數據！直接講重點。
        2. 必須同時點評「生產力（專注與摸魚狀況）」與「健康（不良姿勢）」。
        3. 如果摸魚時間過長或失敗番茄鐘大於 0，請嚴厲斥責其分心行為，並給出收心策略（如：把手機放另一個房間）。
        4. 今日最嚴重的健康問題是【{top_1_zh}】，請給出具體的硬體或環境調整建議。
        5. 語氣要像嚴格的教練，一針見血。
        6. 請務必確保回答精簡，並給出「完整的結尾句」，絕不能話說一半。

        {trend_context}

        【今日綜合數據】
        - 總專注時長：{time_str}
        - 成功番茄鐘：{pomo_done} 顆
        - 失敗番茄鐘（摸魚離席中斷）：{pomo_fail} 顆
        - 總摸魚時間：{cyber_mins} 分鐘
        - 健康警報：眼部 {alerts['eyes']}次, 歪斜 {alerts['shoulders']}次, 過近 {alerts['dist']}次, 哈欠 {alerts['mouth']}次
        """
        
        completion = nvidia_client.chat.completions.create(
            # 🚀 速度優化：如果 70b 模型反應太慢，強烈建議改為 8b 模型 (例如 "meta/llama-3.1-8b-instruct")
            # 8b 模型的推理速度通常快上 3~5 倍，對於短評任務非常足夠。
            model="meta/llama-3.1-70b-instruct", 
            messages=[{"role": "user", "content": prompt}],
            temperature=0.6, 
            # 🚀 防切斷優化：將 max_tokens 從 250 提升至 512
            max_tokens=512,
            # 🚀 減少廢話：加入一點 presence_penalty 讓模型更傾向直接給重點
            presence_penalty=0.2 
        )
        
        advice_text = completion.choices[0].message.content.strip()
        return f"🧠 **PulseAI 毒舌教練分析 (Powered by NVIDIA)：**\n> {advice_text}"
        
    except Exception as e:
        print(f"AI Error: {e}")
        return "💡 *AI 洞察分析產生中發生錯誤，請檢查連線或 API Key。*"

# ==========================================
# ☁️ 雲端報告與資料同步
# ==========================================
def _discord_task(report_type, is_manual):
    global DISCORD_WEBHOOK_URL, weekly_history
    if not DISCORD_WEBHOOK_URL.startswith("http"):
        return

    # 安全地複製狀態，避免請求中途佔用鎖
    with state_lock:
        state_snap = copy.deepcopy(system_state)
        hist_snap = copy.deepcopy(weekly_history)

    try:
        if report_type == "daily":
            # 💡 日報保持簡潔，且不呼叫 NVIDIA API
            hours, remainder = divmod(int(state_snap["daily_total_time"]), 3600)
            minutes, seconds = divmod(remainder, 60)
            time_str = f"{hours} 小時 {minutes} 分鐘 {seconds} 秒"
            alerts = state_snap["alert_counts"]
            
            eval_data = get_daily_evaluation(state_snap)
            
            title = "📊 PulseAI 今日健康與專注報告" if not is_manual else "🧪 PulseAI 系統測試 (日報)"
            desc = (f"### 🏆 今日結算稱號：【 {eval_data['title']} 】\n"
                    f"> **{eval_data['comment']}**\n"
                    f"> 💡 *{eval_data['advice']}*\n\n"
                    f"**【專注數據】**\n"
                    f"⏱️ 總專注時長：**{time_str}**\n"
                    f"🎯 完成番茄鐘：**{state_snap['pomodoro_count']}** 顆\n"
                    f"❌ 失敗番茄鐘：**{state_snap['failed_pomodoros']}** 顆 (因摸魚中斷)\n"
                    f"🐟 總摸魚時間：**{int(state_snap['total_cyberloafing_time'] // 60)} 分鐘**\n\n"
                    f"**【健康警報分析】**\n"
                    f"👀 眼部疲勞：`{alerts['eyes']}` 次 ｜ 🥱 哈欠次數：`{alerts['mouth']}` 次\n"
                    f"⚖️ 高低肩：`{alerts['shoulders']}` 次 ｜ 🖥️ 距離過近：`{alerts['dist']}` 次\n"
                    f"💡 光線太暗：`{alerts['light']}` 次\n") 
            
            embed_payload = {
                "title": title, 
                "description": desc, 
                "color": 5814783,
                "thumbnail": {"url": eval_data["image_url"]} 
            }
            
        else: 
            # 💡 週報區域：彙整資料、生成表格、並呼叫 NVIDIA API
            total_time, total_pomos, total_alerts = state_snap["daily_total_time"], state_snap["pomodoro_count"], state_snap["alert_counts"].copy()
            for day in hist_snap:
                total_time += day["time"]
                total_pomos += day["pomodoros"]
                for k in total_alerts: total_alerts[k] += day["alerts"][k]
                    
            hours, remainder = divmod(int(total_time), 3600)
            time_str = f"{hours} 小時 {remainder//60} 分鐘"
            
            starbucks_count = int(total_time // 3600)
            
            days_count = len(hist_snap) if len(hist_snap) > 0 else 1
            avg_time = int(total_time / days_count)
            avg_h, avg_r = divmod(avg_time, 3600)
            avg_str = f"{avg_h} 小時 {avg_r//60} 分鐘"

            # 🌟 動態生成每日生產力分析表格 (Markdown Code Block 格式)
            if hist_snap:
                table_str = "```text\n"
                table_str += "天數   | 專注時間 | 番茄鐘 | 健康警報\n"
                table_str += "----------------------------------\n"
                for i, day in enumerate(hist_snap):
                    d_h, d_r = divmod(int(day["time"]), 3600)
                    d_m = d_r // 60
                    time_f = f"{d_h:02d}h {d_m:02d}m"
                    pomo_f = f"{day['pomodoros']:02d}"
                    alerts_sum = sum(day["alerts"].values())
                    alerts_f = f"{alerts_sum:02d}"
                    table_str += f"Day {i+1} | {time_f}  |  {pomo_f} 顆 |  {alerts_f} 次\n"
                table_str += "```\n"
            else:
                table_str = "```text\n無本週歷史數據\n```\n"
            
            # 只有週報才呼叫 NVIDIA API 分析
            ai_advice = get_ai_advice(
                time_str, 
                total_alerts, 
                total_pomos, 
                0, 
                0, 
                history=hist_snap
            )
            
            if starbucks_count >= 20:
                w_title = "🏆 本週 MVP / 產值印鈔機"
                w_comment = "太狂了！這週的星巴克疊起來可以當塔了，但週末請務必去放假。"
                w_img = "https://media.discordapp.net/attachments/1501988640878759957/1513215225523081406/image.png"
            elif (total_alerts["eyes"] + total_alerts["shoulders"] + total_alerts["dist"]) > 50:
                w_title = "🏥 復健科 VIP 候選人"
                w_comment = "你的身體在哀嚎，這週末請遠離所有帶螢幕的物體！"
                w_img = "https://media.discordapp.net/attachments/1501988640878759957/1513214908919976028/image.png"
            elif total_pomos >= 15:
                w_title = "🌟 穩定輸出的時間管理大師"
                w_comment = "節奏掌控得宜！保持這個步調，效率極高。"
                w_img = "https://media.discordapp.net/attachments/1501988640878759957/1513215835332808875/content.png"
            else:
                w_title = "🌱 正在暖身的小企鵝"
                w_comment = "這週算是輕鬆度過，下週準備好迎接新的挑戰了嗎？"
                w_img = "https://media.discordapp.net/attachments/1501988640878759957/1513215835332808875/content.png"
            
            title = "📅 PulseAI 一週健康與產值總結報告" if not is_manual else "🧪 PulseAI 系統測試 (週報)"
            # 將 table_str 加入到 Embed 的敘述當中
            desc = (f"### {w_title}\n"
                    f"> **{w_comment}**\n\n"
                    f"**【本週專注與產值】**\n"
                    f"⏱️ 總專注時長：**{time_str}**\n"
                    f"📊 平均每日專注：**{avg_str}**\n"
                    f"🎯 累計番茄鐘：**{total_pomos}** 顆\n"
                    f"☕ **本週創造產值：相當於賺到 {starbucks_count} 杯星巴克！**\n\n"
                    f"**【本週健康警報累計】**\n"
                    f"👀 疲勞：`{total_alerts['eyes']}` 次 ｜ 🥱 哈欠：`{total_alerts['mouth']}` 次\n"
                    f"⚖️ 高低肩：`{total_alerts['shoulders']}` 次 ｜ 🖥️ 過近：`{total_alerts['dist']}` 次\n"
                    f"💡 光線太暗：`{total_alerts['light']}` 次\n\n"
                    f"**【📊 每日生產力分析表】**\n"
                    f"{table_str}\n"
                    f"{ai_advice}")
            
            embed_payload = {"title": title, "description": desc, "color": 10181046, "thumbnail": {"url": w_img}}

        payload = {"username": "PulseAI 助理", "embeds": [embed_payload]}
        response = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        
        if response.status_code == 204:
            if is_manual: socketio.emit('report_status', {"success": True, "type": report_type})
        else:
            if is_manual: socketio.emit('report_status', {"success": False, "type": report_type})
            
    except Exception as e:
        if is_manual: socketio.emit('report_status', {"success": False, "type": report_type})

def send_discord_report(report_type="daily", is_manual=False):
    threading.Thread(target=_discord_task, args=(report_type, is_manual), daemon=True).start()
    return True 

def _cloud_task():
    if not supabase_client: return
    
    with state_lock:
        payload = {
            "date": datetime.datetime.now().strftime("%Y-%m-%d"),
            "work_time": int(system_state["daily_total_time"]),
            "pomodoros": system_state["pomodoro_count"],
            "eyes": system_state["alert_counts"]["eyes"],
            "shoulders": system_state["alert_counts"]["shoulders"],
            "dist": system_state["alert_counts"]["dist"],
            "mouth": system_state["alert_counts"]["mouth"],
            "light": system_state["alert_counts"]["light"]
        }
    
    try: 
        response = supabase_client.table("health_data").insert(payload).execute()
    except Exception as e: pass

def sync_to_cloud():
    threading.Thread(target=_cloud_task, daemon=True).start()

def schedule_worker():
    global has_sent_report_today, weekly_history
    while True:
        now = datetime.datetime.now()
        now_str = now.strftime("%H:%M")
        
        if now_str == DAILY_REPORT_TIME and not has_sent_report_today:
            send_discord_report(report_type="daily")
            sync_to_cloud() 
            has_sent_report_today = True
            
            with state_lock:
                weekly_history.append({"time": system_state["daily_total_time"], "pomodoros": system_state["pomodoro_count"], "alerts": system_state["alert_counts"].copy()})
                
            if now.weekday() == 4: 
                time.sleep(5)
                send_discord_report(report_type="weekly")
                with state_lock:
                    weekly_history = []
                
        if now_str == "00:00":
            with state_lock:
                has_sent_report_today = False
                system_state["daily_total_time"], system_state["pomodoro_count"] = 0.0, 0
                system_state["alert_counts"] = {k: 0 for k in system_state["alert_counts"]}
                system_state["total_cyberloafing_time"], system_state["failed_pomodoros"], system_state["max_dark_time"] = 0.0, 0, 0.0
                system_state["current_absent_time"], system_state["current_dark_time"] = 0.0, 0.0
        time.sleep(30)

# ==========================================
# 🤖 AI 背景推論引擎
# ==========================================
def ai_worker():
    global global_frame, system_state, force_recalibrate
    
    mp_drawing = mp.solutions.drawing_utils
    mp_face_mesh = mp.solutions.face_mesh
    mp_hands = mp.solutions.hands
    mp_pose = mp.solutions.pose
    mp_drawing_styles = mp.solutions.drawing_styles

    LEFT_EYE, RIGHT_EYE, MOUTH = [33, 160, 158, 133, 153, 144], [362, 385, 387, 263, 373, 380], [78, 13, 308, 14]
    EYE_OUTER_LEFT, EYE_OUTER_RIGHT = 33, 263 # 🌟 剛性特徵點索引 (計算 IOD 使用)
    FACE_LEFT, FACE_RIGHT = 234, 454
    FACE_TOP, FACE_BOTTOM = 10, 152

    LIGHT_THRESHOLD = 60
    CALIBRATION_FRAMES = 60 
    
    # 🌟 延長閉眼(2.0秒)與打哈欠(1.5秒)的判定時間
    TIME_LIMIT_EYES, TIME_LIMIT_SHOULDER, TIME_LIMIT_DIST, TIME_LIMIT_MOUTH = 2.0, 1.5, 1.5, 1.5
    STRICT_SHOULDER_TOLERANCE = 0.05 # 🌟 嚴格防呆水平檢測閾值
    
    TARGET_FPS = 12 
    frame_interval = 1.0 / TARGET_FPS 
    ENABLE_HANDS_IN_WORK = False

    while True:
        try:
            cap = cv2.VideoCapture(0)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1) 
            
            if not cap.isOpened():
                time.sleep(3)
                continue
            
            frame_count, hand_reps, neck_reps, arm_reps = 0, 0, 0, 0
            timer_eyes, timer_posture, timer_shoulder, timer_dist, timer_mouth = 0.0, 0.0, 0.0, 0.0, 0.0
            prev_alert_states = {"eyes": "OPEN", "shoulders": "BALANCED", "dist": "GOOD", "mouth": "NORMAL", "light": "GOOD"}
            
            calib_data = {"ear": [], "mar": [], "dist": [], "shoulder": [], "mouth_w": []}
            thresholds = {"ear": 0.2, "mar": 0.5, "dist_max": 0.35, "shoulder_base": 0.0, "shoulder_dev": 0.08, "mouth_w_max": 0.4}
            ema_values = {"ear": None, "mar": None, "dist": None, "shoulder": None, "mouth_w": None}
            
            fist_state, head_state, arms_up_state = False, "CENTER", False
            last_time, last_emit_time = time.time(), time.time()

            consecutive_fails = 0

            with mp_face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True) as face_mesh, \
                 mp_hands.Hands(max_num_hands=2, min_detection_confidence=0.5) as hands, \
                 mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5) as pose:
                 
                while cap.isOpened():
                    loop_start_time = time.time()
                    
                    with state_lock:
                        if force_recalibrate:
                            system_state["mode"], force_recalibrate = "CALIBRATION", False
                            timer_eyes, timer_posture, timer_shoulder, timer_dist, timer_mouth = 0.0, 0.0, 0.0, 0.0, 0.0
                            calib_data = {"ear": [], "mar": [], "dist": [], "shoulder": [], "mouth_w": []}
                            ema_values = {"ear": None, "mar": None, "dist": None, "shoulder": None, "mouth_w": None}
                            system_state["calibration_status"] = "COLLECTING"
                            system_state["calibration_progress"] = 0
                        current_mode = system_state["mode"]

                    success, image = cap.read()
                    if not success:
                        consecutive_fails += 1
                        if consecutive_fails > 30: break 
                        time.sleep(0.01)
                        continue
                    
                    consecutive_fails = 0
                    image = cv2.resize(image, (480, 360))
                    dt = time.time() - last_time
                    last_time = time.time()

                    gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                    current_light = "GOOD" if np.mean(gray_image) >= LIGHT_THRESHOLD else "TOO DARK"
                    
                    with state_lock:
                        system_state["light"] = current_light
                        if system_state["light"] == "TOO DARK" and prev_alert_states["light"] != "TOO DARK": 
                            system_state["alert_counts"]["light"] += 1
                        prev_alert_states["light"] = system_state["light"]

                        if system_state["light"] == "TOO DARK":
                            system_state["current_dark_time"] += dt
                            if system_state["current_dark_time"] > system_state["max_dark_time"]:
                                system_state["max_dark_time"] = system_state["current_dark_time"]
                        else:
                            system_state["current_dark_time"] = 0.0

                    image.flags.writeable = False
                    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                    
                    face_results = face_mesh.process(image_rgb)
                    
                    if current_mode == "EXERCISE_HAND" or (current_mode == "WORK" and ENABLE_HANDS_IN_WORK):
                        hand_results = hands.process(image_rgb)
                    else:
                        hand_results = None
                        
                    pose_results = pose.process(image_rgb) if current_mode in ["WORK", "CALIBRATION", "EXERCISE_ARM"] else None
                    
                    image.flags.writeable = True
                    ih, iw = image.shape[:2]

                    avg_ear, mar, iod_ratio, is_covering_mouth, current_mw = 0.0, 0.0, 0.0, False, 0.0
                    mouth_center, cover_threshold, head_direction, raw_shoulder_slope, shoulder_width = (0, 0), 0, "CENTER", 0.0, 0.0 

                    if face_results and face_results.multi_face_landmarks:
                        with state_lock: system_state["user_absent"] = False
                        for face_landmarks in face_results.multi_face_landmarks:
                            if current_mode in ["WORK", "CALIBRATION", "EXERCISE_NECK"]: 
                                mp_drawing.draw_landmarks(image, face_landmarks, mp_face_mesh.FACEMESH_CONTOURS, None, mp_drawing_styles.get_default_face_mesh_contours_style())
                            
                            l_eye = [(face_landmarks.landmark[i].x * iw, face_landmarks.landmark[i].y * ih) for i in LEFT_EYE]
                            r_eye = [(face_landmarks.landmark[i].x * iw, face_landmarks.landmark[i].y * ih) for i in RIGHT_EYE]
                            m_pts = [(face_landmarks.landmark[i].x * iw, face_landmarks.landmark[i].y * ih) for i in MOUTH]
                            
                            avg_ear = (calculate_ear(l_eye) + calculate_ear(r_eye)) / 2.0
                            mar = calculate_mar(m_pts)
                            
                            # 🌟 核心防護：使用剛性特徵 (雙眼瞳孔間距 IOD) 取代臉部寬高
                            l_eye_outer = (face_landmarks.landmark[EYE_OUTER_LEFT].x * iw, face_landmarks.landmark[EYE_OUTER_LEFT].y * ih)
                            r_eye_outer = (face_landmarks.landmark[EYE_OUTER_RIGHT].x * iw, face_landmarks.landmark[EYE_OUTER_RIGHT].y * ih)
                            current_iod = calculate_distance(l_eye_outer, r_eye_outer)
                            iod_ratio = current_iod / iw if iw > 0 else 0
                            
                            mouth_width = calculate_distance(m_pts[0], m_pts[2])
                            current_mw = mouth_width / current_iod if current_iod > 0 else 0 # 比例基於 IOD
                            
                            mouth_center = ((m_pts[0][0] + m_pts[2][0]) // 2, (m_pts[0][1] + m_pts[2][1]) // 2)
                            cover_threshold = mouth_width * 1.5
                            head_direction = get_head_turn_direction(face_landmarks, iw, ih)
                    else: 
                        with state_lock: system_state["user_absent"] = True

                    if hand_results and hand_results.multi_hand_landmarks and face_results and face_results.multi_face_landmarks:
                        for hand_landmarks in hand_results.multi_hand_landmarks:
                            if current_mode == "EXERCISE_HAND":
                                mp_drawing.draw_landmarks(image, hand_landmarks, mp_hands.HAND_CONNECTIONS)
                            for tip_idx in [8, 12, 16, 20]:
                                if calculate_distance((hand_landmarks.landmark[tip_idx].x * iw, hand_landmarks.landmark[tip_idx].y * ih), mouth_center) < cover_threshold: is_covering_mouth = True

                    if pose_results and pose_results.pose_landmarks and current_mode in ["WORK", "CALIBRATION", "EXERCISE_ARM"]:
                        mp_drawing.draw_landmarks(image, pose_results.pose_landmarks, mp_pose.POSE_CONNECTIONS)
                        ls_x, ls_y = pose_results.pose_landmarks.landmark[11].x * iw, pose_results.pose_landmarks.landmark[11].y * ih
                        rs_x, rs_y = pose_results.pose_landmarks.landmark[12].x * iw, pose_results.pose_landmarks.landmark[12].y * ih
                        shoulder_width = calculate_distance((ls_x, ls_y), (rs_x, rs_y))
                        if shoulder_width > 0: raw_shoulder_slope = (ls_y - rs_y) / shoulder_width

                    with state_lock:
                        if system_state["user_absent"]:
                            system_state["current_absent_time"] += dt
                            if system_state["current_absent_time"] > 120:
                                system_state["total_cyberloafing_time"] += dt
                                if current_mode == "WORK" and system_state["work_time"] > 0:
                                    system_state["work_time"] = 0.0 
                                    system_state["failed_pomodoros"] += 1
                        else:
                            system_state["current_absent_time"] = 0.0

                            if current_mode == "CALIBRATION":
                                # 🌟 校正優化：嚴格過濾不良姿勢與歪斜的基準幀
                                is_valid_calib = (
                                    head_direction == "CENTER" 
                                    and not is_covering_mouth 
                                    and shoulder_width > 0 
                                    and system_state["light"] == "GOOD"
                                    and abs(raw_shoulder_slope) < STRICT_SHOULDER_TOLERANCE 
                                )

                                if is_valid_calib:
                                    calib_data["ear"].append(avg_ear)
                                    calib_data["mar"].append(mar)
                                    calib_data["dist"].append(iod_ratio) # 存入 IOD
                                    calib_data["shoulder"].append(raw_shoulder_slope)
                                    calib_data["mouth_w"].append(current_mw) 
                                    system_state["calibration_status"] = "COLLECTING"
                                else:
                                    system_state["calibration_status"] = "POSTURE_BAD" # 通知前端：退回防呆並警告
                                
                                if is_valid_calib:
                                    calib_idx = len(calib_data["ear"])
                                    system_state["calibration_progress"] = int((calib_idx / CALIBRATION_FRAMES) * 100)

                                    if calib_idx >= CALIBRATION_FRAMES:
                                        m_ear, s_ear = get_robust_stats(calib_data["ear"])
                                        m_mar, s_mar = get_robust_stats(calib_data["mar"])
                                        m_dist, s_dist = get_robust_stats(calib_data["dist"])
                                        m_sh, s_sh = get_robust_stats(calib_data["shoulder"])
                                        m_mw, s_mw = get_robust_stats(calib_data["mouth_w"])

                                        # 🌟 提高閉眼檢測與打哈欠的嚴格容忍度
                                        thresholds["ear"] = m_ear - max(4 * s_ear, 0.05) 
                                        thresholds["mar"] = m_mar + max(5 * s_mar, 0.35) 
                                        thresholds["dist_max"] = m_dist + max(5 * s_dist, m_dist * 0.15) # 基於剛性 IOD 的距離閾值
                                        thresholds["shoulder_base"] = m_sh
                                        thresholds["shoulder_dev"] = max(3 * s_sh, 0.05)
                                        thresholds["mouth_w_max"] = m_mw + max(4 * s_mw, 0.04) 
                                        
                                        system_state["mode"], system_state["work_time"] = "WORK", 0.0
                                        ema_values = {"ear": None, "mar": None, "dist": None, "shoulder": None, "mouth_w": None}

                            elif current_mode == "WORK":
                                if not system_state.get("is_paused", False):
                                    system_state["work_time"] += dt
                                    system_state["daily_total_time"] += dt 

                                    ema_values["ear"] = apply_ema(avg_ear, ema_values["ear"])
                                    ema_values["mar"] = apply_ema(mar, ema_values["mar"])
                                    ema_values["dist"] = apply_ema(iod_ratio, ema_values["dist"], alpha=0.15) # 使用 IOD
                                    ema_values["shoulder"] = apply_ema(raw_shoulder_slope, ema_values["shoulder"])
                                    ema_values["mouth_w"] = apply_ema(current_mw, ema_values["mouth_w"])

                                    if ema_values["ear"] < thresholds["ear"]:
                                        timer_eyes += dt
                                        if timer_eyes >= TIME_LIMIT_EYES: system_state["eyes"] = "CLOSED"
                                    else: timer_eyes, system_state["eyes"] = 0.0, "OPEN"
                                    if system_state["eyes"] == "CLOSED" and prev_alert_states["eyes"] != "CLOSED": system_state["alert_counts"]["eyes"] += 1
                                    prev_alert_states["eyes"] = system_state["eyes"]

                                    if abs(ema_values["shoulder"] - thresholds["shoulder_base"]) > thresholds["shoulder_dev"]:
                                        timer_shoulder += dt
                                        if timer_shoulder >= TIME_LIMIT_SHOULDER: system_state["shoulders"] = "UNEVEN"
                                    else: timer_shoulder, system_state["shoulders"] = 0.0, "BALANCED"
                                    if system_state["shoulders"] == "UNEVEN" and prev_alert_states["shoulders"] != "UNEVEN": system_state["alert_counts"]["shoulders"] += 1
                                    prev_alert_states["shoulders"] = system_state["shoulders"]
                                        
                                    if ema_values["dist"] > thresholds["dist_max"]:
                                        timer_dist += dt
                                        if timer_dist >= TIME_LIMIT_DIST: system_state["distance"] = "TOO CLOSE"
                                    else: timer_dist, system_state["distance"] = 0.0, "GOOD"
                                    if system_state["distance"] == "TOO CLOSE" and prev_alert_states["dist"] != "TOO CLOSE": system_state["alert_counts"]["dist"] += 1
                                    prev_alert_states["dist"] = system_state["distance"]

                                    is_yawning = (ema_values["mar"] > thresholds["mar"]) and (ema_values["mouth_w"] <= thresholds["mouth_w_max"])
                                    
                                    if is_yawning or is_covering_mouth:
                                        timer_mouth += dt
                                        if timer_mouth >= TIME_LIMIT_MOUTH: system_state["mouth"] = "YAWN/COVER"
                                    else: timer_mouth, system_state["mouth"] = 0.0, "NORMAL"
                                    if system_state["mouth"] == "YAWN/COVER" and prev_alert_states["mouth"] != "YAWN/COVER": system_state["alert_counts"]["mouth"] += 1
                                    prev_alert_states["mouth"] = system_state["mouth"]

                                    if system_state["work_time"] >= system_state["target_work_time"]:
                                        system_state["mode"], system_state["pomodoro_count"] = "EXERCISE_HAND", system_state["pomodoro_count"] + 1
                                        hand_reps, fist_state = 0, False
                                        timer_eyes, timer_posture, timer_shoulder, timer_dist, timer_mouth = 0.0, 0.0, 0.0, 0.0, 0.0
                                else:
                                    system_state["eyes"] = "OPEN"
                                    system_state["shoulders"] = "BALANCED"
                                    system_state["distance"] = "GOOD"
                                    system_state["mouth"] = "NORMAL"
                                    system_state["light"] = "GOOD"
                                    timer_eyes, timer_posture, timer_shoulder, timer_dist, timer_mouth = 0.0, 0.0, 0.0, 0.0, 0.0

                            elif current_mode == "EXERCISE_HAND":
                                system_state["exercise_task"], system_state["exercise_progress"] = "Knuckle Stretch (雙手握拳伸展)", f"{hand_reps} / 5"
                                if hand_results and hand_results.multi_hand_landmarks:
                                    fist_count, open_count = 0, 0
                                    for hand_landmarks in hand_results.multi_hand_landmarks:
                                        if is_fist(hand_landmarks, iw, ih): fist_count += 1
                                        else: open_count += 1
                                    
                                    if len(hand_results.multi_hand_landmarks) == 2:
                                        if fist_count == 2: system_state["exercise_status"], fist_state = "BOTH FISTS (現在請張開!)", True
                                        elif open_count == 2:
                                            system_state["exercise_status"] = "BOTH OPEN (現在請闔上!)"
                                            if fist_state: hand_reps, fist_state = hand_reps + 1, False
                                    else: system_state["exercise_status"] = "HANDS UP 請將雙手舉起放入畫面"
                                else: system_state["exercise_status"] = "WAITING 等待雙手..."
                                if hand_reps >= 5: system_state["mode"], neck_reps, head_state = "EXERCISE_NECK", 0, "CENTER"

                            elif current_mode == "EXERCISE_NECK":
                                system_state["exercise_task"], system_state["exercise_progress"] = "Neck Stretch (頭部左右轉動)", f"{neck_reps} / 3"
                                if head_direction == "TURNED": system_state["exercise_status"], head_state = "TURNED (現在轉回正前方!)", "TURNED"
                                else:
                                    system_state["exercise_status"] = "CENTER (請左右轉動頭部!)"
                                    if head_state == "TURNED": neck_reps, head_state = neck_reps + 1, "CENTER (請左右轉動頭部!)"
                                if neck_reps >= 5: system_state["mode"], arm_reps, arms_up_state = "EXERCISE_ARM", 0, False
                            
                            elif current_mode == "EXERCISE_ARM":
                                system_state["exercise_task"], system_state["exercise_progress"] = "Arm Stretch (雙手向上伸展)", f"{arm_reps} / 3"
                                if pose_results and pose_results.pose_landmarks:
                                    landmarks = pose_results.pose_landmarks.landmark
                                    if landmarks[15].y < landmarks[11].y and landmarks[16].y < landmarks[12].y: system_state["exercise_status"], arms_up_state = "ARMS UP (現在請放下!)", True
                                    else:
                                        system_state["exercise_status"] = "ARMS DOWN (現在請雙手舉起!)"
                                        if arms_up_state: arm_reps, arms_up_state = arm_reps + 1, False
                                else: system_state["exercise_status"] = "請將上半身放入畫面"
                                if arm_reps >= 5: system_state["mode"], system_state["work_time"] = "WORK", 0.0

                    current_time = time.time()
                    if current_time - last_emit_time >= 0.1:
                        with state_lock: 
                            current_state_copy = copy.deepcopy(system_state) # 安全讀取並發送給前端
                        socketio.emit('state_update', current_state_copy)
                        last_emit_time = current_time
                    
                    image = cv2.flip(image, 1) 
                    ret, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 50])
                    if ret:
                        with frame_lock: global_frame = buffer.tobytes()
                    
                    process_time = time.time() - loop_start_time
                    if process_time < frame_interval:
                        time.sleep(frame_interval - process_time)
            
            if 'cap' in locals() and cap.isOpened(): cap.release()
            
        except Exception as e:
            traceback.print_exc()
            time.sleep(2) 
        finally:
            if 'cap' in locals() and cap.isOpened(): cap.release()

# ==========================================
# 網路路由與 Socket API
# ==========================================
@socketio.on('request_recalibrate')
def handle_recalibrate(): 
    global force_recalibrate
    with state_lock: 
        force_recalibrate = True

@socketio.on('set_pomodoro_time')
def handle_set_time(data): 
    with state_lock:
        system_state["target_work_time"] = data.get("seconds", 1500)
        system_state["work_time"] = 0.0

@socketio.on('request_pause')
def handle_pause(data): 
    with state_lock: 
        system_state["is_paused"] = data.get("paused", False)

@socketio.on('request_daily_settlement')
def handle_daily_settlement():
    with state_lock:
        system_state["is_paused"] = True
        settlement = build_daily_settlement(copy.deepcopy(system_state))
    socketio.emit('daily_settlement_response', settlement)

@socketio.on('request_discord_report')
def handle_manual_report(data):
    rtype = data.get("type", "daily") if data else "daily"
    send_discord_report(report_type=rtype, is_manual=True)
    if rtype == "daily": sync_to_cloud()

@socketio.on('request_cloud_data')
def handle_fetch_cloud():
    if not supabase_client: 
        socketio.emit('cloud_data_response', {"error": "尚未設定 Supabase 連線網址與金鑰"})
        return
    try:
        response = supabase_client.table("health_data").select("*").order("date", desc=False).execute()
        socketio.emit('cloud_data_response', {"data": response.data})
    except Exception as e:
        socketio.emit('cloud_data_response', {"error": str(e)})

@socketio.on('update_discord_webhook')
def handle_update_webhook(data):
    global DISCORD_WEBHOOK_URL
    DISCORD_WEBHOOK_URL = data.get("url", "")
    print(f"🔗 [系統提示] Discord Webhook 已更新: {DISCORD_WEBHOOK_URL}")

def generate_video_stream():
    global global_frame
    while True:
        try:
            with frame_lock: frame = global_frame
            if frame is not None: yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
            time.sleep(0.03)
        except: break

@app.route('/')
def index(): return render_template('index.html')

@app.route('/video_feed')
def video_feed(): return Response(generate_video_stream(), mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    threading.Thread(target=ai_worker, daemon=True).start()
    threading.Thread(target=schedule_worker, daemon=True).start()
    print(f"🚀 [PulseAI] 系統已啟動。")
    
    def open_browser():
        webbrowser.open_new("http://127.0.0.1:5001")
        
    threading.Timer(1.5, open_browser).start()
    socketio.run(app, debug=True, host='0.0.0.0', port=5001, use_reloader=False)
