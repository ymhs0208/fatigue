import os
import time
import math
import cv2
import numpy as np
import threading
import traceback
import datetime      
import requests      
import mediapipe as mp
from openai import OpenAI
from flask import Flask, render_template, Response
from flask_socketio import SocketIO
from dotenv import load_dotenv # 🚀 引入 dotenv 套件

# 🚀 載入 .env 檔案中的環境變數
load_dotenv()

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

global_frame = None
frame_lock = threading.Lock()

# ==========================================
# 💡 Webhook 與 API 設定區
# ==========================================
# Discord Webhook 改為空字串，由前端設定傳入
DISCORD_WEBHOOK_URL = "" 
GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxCrhnTksMeiIdJbw9o3ks7HsNwxIjSz5qWwhTRFANWMSnVznCU6rjHK89AgoThLfV7/exec" 

# 🔒 透過 os.getenv 安全讀取環境變數，不再寫死在程式碼裡
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")  

DAILY_REPORT_TIME = "18:00"  

# 🚀 初始化 NVIDIA API Client
if NVIDIA_API_KEY:
    nvidia_client = OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=NVIDIA_API_KEY
    )
else:
    print("⚠️ [警告] 找不到 NVIDIA_API_KEY，AI 建議功能將被停用。請檢查 .env 檔案。")
    nvidia_client = None

system_state = {
    "mode": "CALIBRATION", "work_time": 0.0, "target_work_time": 1500, "pomodoro_count": 0,      
    "daily_total_time": 0.0, "user_absent": False, "eyes": "OPEN", "mouth": "NORMAL", "distance": "GOOD",
    "light": "GOOD", "posture": "GOOD", "shoulders": "BALANCED", "calibration_progress": 0,
    "exercise_task": "", "exercise_progress": "", "exercise_status": "",
    "alert_counts": {"eyes": 0, "shoulders": 0, "dist": 0, "mouth": 0, "light": 0}
}

force_recalibrate = False
has_sent_report_today = False 
weekly_history = [] 

# ==========================================
# 幾何計算函數
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

# ==========================================
# 🚀 AI 健康建議生成器 (NVIDIA)
# ==========================================
def get_ai_advice(time_str, alerts):
    if not nvidia_client:
        return "💡 *系統提示：設定 NVIDIA API Key 後，即可解鎖專屬 AI 改善建議！*"
    try:
        prompt = f"""
        你是一位專業的辦公室健康與人體工學教練。請根據以下使用者今天的健康追蹤數據，給予一段約 50 到 80 字的個人化改善建議。
        請使用繁體中文，語氣要親切、鼓勵，並針對數據中最嚴重的問題給予具體建議。
        
        【今日數據】
        - 專注工作時間：{time_str}
        - 閉眼/疲勞次數：{alerts['eyes']} 次
        - 肩膀歪斜/高低肩次數：{alerts['shoulders']} 次
        - 距離螢幕太近次數：{alerts['dist']} 次
        - 打哈欠/精神不濟次數：{alerts['mouth']} 次
        - 環境光線太暗次數：{alerts['light']} 次
        """
        
        # 呼叫 NVIDIA API
        completion = nvidia_client.chat.completions.create(
            model="google/gemma-4-31b-it",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=150
        )
        
        advice_text = completion.choices[0].message.content.strip()
        return f"🤖 **PulseAI (Powered by NVIDIA) 專屬教練建議：**\n> {advice_text}"
        
    except Exception as e:
        print(f"❌ NVIDIA AI 建議生成失敗: {e}")
        return "💡 *AI 建議產生中發生錯誤，請稍後再試。*"

# ==========================================
# 雲端報告與資料同步
# ==========================================
def send_discord_report(report_type="daily", is_manual=False):
    print(f"\n👉 [系統提示] 準備發送 {report_type} 報告至 Discord...")
    
    if not DISCORD_WEBHOOK_URL.startswith("http"):
        print("❌ [錯誤] Discord 發送失敗：尚未設定 DISCORD_WEBHOOK_URL 網址！請至網頁前端設定。")
        return False
    
    try:
        if report_type == "daily":
            hours, remainder = divmod(int(system_state["daily_total_time"]), 3600)
            minutes, seconds = divmod(remainder, 60)
            time_str = f"{hours} 小時 {minutes} 分鐘 {seconds} 秒"
            alerts = system_state["alert_counts"]
            
            # 產生 AI 建議
            ai_advice = get_ai_advice(time_str, alerts)
            
            title = "📊 PulseAI 今日健康報告" if not is_manual else "🧪 PulseAI 系統測試 (日報)"
            desc = (f"您今日的總專注工作時長為：\n### **{time_str}**\n"
                    f"🎯 完成番茄鐘：**{system_state['pomodoro_count']}** 顆\n\n"
                    f"**【今日健康狀態分析】**\n👀 眼部疲勞：`{alerts['eyes']}` 次\n⚖️ 高低肩：`{alerts['shoulders']}` 次\n"
                    f"🖥️ 距離過近：`{alerts['dist']}` 次\n🥱 哈欠次數：`{alerts['mouth']}` 次\n"
                    f"💡 光線太暗：`{alerts['light']}` 次\n\n"
                    f"{ai_advice}") 
            color = 5814783
        else:
            total_time, total_pomos, total_alerts = system_state["daily_total_time"], system_state["pomodoro_count"], system_state["alert_counts"].copy()
            for day in weekly_history:
                total_time += day["time"]
                total_pomos += day["pomodoros"]
                for k in total_alerts: total_alerts[k] += day["alerts"][k]
                    
            hours, remainder = divmod(int(total_time), 3600)
            time_str = f"{hours} 小時 {remainder//60} 分鐘"
            
            # 產生週報 AI 建議
            ai_advice = get_ai_advice(time_str, total_alerts)
            
            title = "📅 PulseAI 一週健康總結報告" if not is_manual else "🧪 PulseAI 系統測試 (週報)"
            desc = (f"本週總專注工作時長：\n### **{time_str}**\n🎯 累計番茄鐘：**{total_pomos}** 顆\n\n"
                    f"**【本週健康警報累計】**\n👀 疲勞：`{total_alerts['eyes']}` 次\n⚖️ 高低肩：`{total_alerts['shoulders']}` 次\n"
                    f"🖥️ 過近：`{total_alerts['dist']}` 次\n🥱 哈欠：`{total_alerts['mouth']}` 次\n"
                    f"💡 光線太暗：`{total_alerts['light']}` 次\n\n"
                    f"{ai_advice}")
            color = 10181046 

        payload = {"username": "PulseAI 助理", "embeds": [{"title": title, "description": desc, "color": color}]}
        response = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        
        if response.status_code == 204:
            print("✅ [成功] Discord 報告發送完畢！")
            return True
        else:
            print(f"❌ [錯誤] Discord 拒絕接收。狀態碼: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ [錯誤] 發送 Discord 發生異常：{e}")
        return False

def sync_to_cloud():
    print("👉 [系統提示] 準備同步資料至 Google Sheets...")
    if not GAS_WEBHOOK_URL.startswith("http"): 
        print("⚠️ [警告] 尚未設定 GAS_WEBHOOK_URL，跳過雲端同步。")
        return
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
        res = requests.post(GAS_WEBHOOK_URL, json=payload, timeout=5)
        if res.status_code == 200: print("✅ [成功] 雲端資料庫同步完成！")
        else: print(f"❌ [錯誤] Google Sheets 同步失敗。狀態碼: {res.status_code}")
    except Exception as e:
        print(f"❌ [錯誤] 雲端同步連線異常：{e}")

def schedule_worker():
    global has_sent_report_today, weekly_history
    while True:
        now = datetime.datetime.now()
        now_str = now.strftime("%H:%M")
        
        if now_str == DAILY_REPORT_TIME and not has_sent_report_today:
            send_discord_report(report_type="daily")
            sync_to_cloud() 
            has_sent_report_today = True
            
            weekly_history.append({"time": system_state["daily_total_time"], "pomodoros": system_state["pomodoro_count"], "alerts": system_state["alert_counts"].copy()})
            if now.weekday() == 4: 
                time.sleep(5)
                send_discord_report(report_type="weekly")
                weekly_history = []
                
        if now_str == "00:00":
            has_sent_report_today = False
            system_state["daily_total_time"], system_state["pomodoro_count"] = 0.0, 0
            system_state["alert_counts"] = {k: 0 for k in system_state["alert_counts"]}
        time.sleep(30)

# ==========================================
# AI 背景推論引擎 
# ==========================================
def ai_worker():
    global global_frame, system_state, force_recalibrate
    mp_drawing, mp_face_mesh, mp_hands, mp_pose = mp.solutions.drawing_utils, mp.solutions.face_mesh, mp.solutions.hands, mp.solutions.pose
    LEFT_EYE, RIGHT_EYE, MOUTH = [33, 160, 158, 133, 153, 144], [362, 385, 387, 263, 373, 380], [78, 13, 308, 14]
    FACE_LEFT, FACE_RIGHT = 234, 454

    MAR_THRESHOLD, FACE_RATIO_THRESHOLD, LIGHT_THRESHOLD = 0.50, 0.35, 60
    SHOULDER_SLOPE_THRESHOLD = 0.08  
    CALIBRATION_FRAMES = 60 
    TIME_LIMIT_EYES, TIME_LIMIT_SHOULDER, TIME_LIMIT_DIST, TIME_LIMIT_MOUTH = 1.0, 1.5, 1.5, 0.8
    
    while True:
        try:
            cap = cv2.VideoCapture(0)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1) 
            cap.set(cv2.CAP_PROP_FPS, 30) 
            
            if not cap.isOpened():
                time.sleep(3)
                continue

            frame_count, hand_reps, neck_reps, arm_reps = 0, 0, 0, 0
            timer_eyes, timer_posture, timer_shoulder, timer_dist, timer_mouth = 0.0, 0.0, 0.0, 0.0, 0.0
            prev_alert_states = {"eyes": "OPEN", "shoulders": "BALANCED", "dist": "GOOD", "mouth": "NORMAL", "light": "GOOD"}
            
            calib_ear_data, calib_shoulder_data = [], []
            personalized_ear_threshold, personalized_shoulder_baseline = 0.2, 0.0 
            
            fist_state, head_state, arms_up_state = False, "CENTER", False
            last_time, last_emit_time = time.time(), time.time()

            with mp_face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True) as face_mesh, \
                 mp_hands.Hands(max_num_hands=2, min_detection_confidence=0.5) as hands, \
                 mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5) as pose:
                 
                while cap.isOpened():
                    if force_recalibrate:
                        system_state["mode"], force_recalibrate = "CALIBRATION", False
                        timer_eyes, timer_posture, timer_shoulder, timer_dist, timer_mouth = 0.0, 0.0, 0.0, 0.0, 0.0
                        calib_ear_data, calib_shoulder_data = [], []

                    success, image = cap.read()
                    if not success:
                        time.sleep(0.01)
                        continue

                    image = cv2.resize(image, (480, 360))
                    dt = time.time() - last_time
                    last_time = time.time()

                    gray_image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                    system_state["light"] = "GOOD" if np.mean(gray_image) >= LIGHT_THRESHOLD else "TOO DARK"
                    if system_state["light"] == "TOO DARK" and prev_alert_states["light"] != "TOO DARK": system_state["alert_counts"]["light"] += 1
                    prev_alert_states["light"] = system_state["light"]

                    image.flags.writeable = False
                    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                    
                    current_mode = system_state["mode"]
                    face_results = face_mesh.process(image_rgb)
                    hand_results = hands.process(image_rgb) if current_mode in ["WORK", "EXERCISE_HAND"] else None
                    pose_results = pose.process(image_rgb) if current_mode in ["WORK", "CALIBRATION", "EXERCISE_ARM"] else None
                    
                    image.flags.writeable = True
                    ih, iw = image.shape[:2]

                    avg_ear, mar, face_ratio, is_covering_mouth = 0.0, 0.0, 0.0, False
                    mouth_center, cover_threshold, head_direction, raw_shoulder_slope = (0, 0), 0, "CENTER", 0.0 

                    if face_results and face_results.multi_face_landmarks:
                        system_state["user_absent"] = False
                        for face_landmarks in face_results.multi_face_landmarks:
                            if current_mode in ["WORK", "CALIBRATION"]: mp_drawing.draw_landmarks(image, face_landmarks, mp_face_mesh.FACEMESH_CONTOURS, None, mp.solutions.drawing_styles.get_default_face_mesh_contours_style())
                            
                            l_eye = [(face_landmarks.landmark[i].x * iw, face_landmarks.landmark[i].y * ih) for i in LEFT_EYE]
                            r_eye = [(face_landmarks.landmark[i].x * iw, face_landmarks.landmark[i].y * ih) for i in RIGHT_EYE]
                            m_pts = [(face_landmarks.landmark[i].x * iw, face_landmarks.landmark[i].y * ih) for i in MOUTH]
                            
                            avg_ear = (calculate_ear(l_eye) + calculate_ear(r_eye)) / 2.0
                            mar = calculate_mar(m_pts)
                            f_left, f_right = (face_landmarks.landmark[FACE_LEFT].x * iw, face_landmarks.landmark[FACE_LEFT].y * ih), (face_landmarks.landmark[FACE_RIGHT].x * iw, face_landmarks.landmark[FACE_RIGHT].y * ih)
                            
                            face_ratio = calculate_distance(f_left, f_right) / iw
                            mouth_center = ((m_pts[0][0] + m_pts[2][0]) // 2, (m_pts[0][1] + m_pts[2][1]) // 2)
                            cover_threshold = calculate_distance(m_pts[0], m_pts[2]) * 1.5
                            head_direction = get_head_turn_direction(face_landmarks, iw, ih)
                    else: system_state["user_absent"] = True

                    if hand_results and hand_results.multi_hand_landmarks and face_results and face_results.multi_face_landmarks:
                        for hand_landmarks in hand_results.multi_hand_landmarks:
                            for tip_idx in [8, 12, 16, 20]:
                                if calculate_distance((hand_landmarks.landmark[tip_idx].x * iw, hand_landmarks.landmark[tip_idx].y * ih), mouth_center) < cover_threshold: is_covering_mouth = True

                    if pose_results and pose_results.pose_landmarks and current_mode in ["WORK", "CALIBRATION"]:
                        mp_drawing.draw_landmarks(image, pose_results.pose_landmarks, mp_pose.POSE_CONNECTIONS)
                        ls_x, ls_y = pose_results.pose_landmarks.landmark[11].x * iw, pose_results.pose_landmarks.landmark[11].y * ih
                        rs_x, rs_y = pose_results.pose_landmarks.landmark[12].x * iw, pose_results.pose_landmarks.landmark[12].y * ih
                        shoulder_width = calculate_distance((ls_x, ls_y), (rs_x, rs_y))
                        if shoulder_width > 0: raw_shoulder_slope = (ls_y - rs_y) / shoulder_width

                    if not system_state["user_absent"]:
                        if current_mode == "CALIBRATION":
                            calib_ear_data.append(avg_ear)
                            if shoulder_width > 0: calib_shoulder_data.append(raw_shoulder_slope)
                            
                            calib_idx = len(calib_ear_data)
                            system_state["calibration_progress"] = int((calib_idx / CALIBRATION_FRAMES) * 100)

                            if calib_idx >= CALIBRATION_FRAMES:
                                personalized_ear_threshold, personalized_shoulder_baseline = np.mean(calib_ear_data) * 0.75, np.mean(calib_shoulder_data) if calib_shoulder_data else 0.0
                                system_state["mode"], system_state["work_time"] = "WORK", 0.0

                        elif current_mode == "WORK":
                            system_state["work_time"] += dt
                            system_state["daily_total_time"] += dt 

                            if avg_ear < personalized_ear_threshold:
                                timer_eyes += dt
                                if timer_eyes >= TIME_LIMIT_EYES: system_state["eyes"] = "CLOSED"
                            else: timer_eyes, system_state["eyes"] = 0.0, "OPEN"
                            if system_state["eyes"] == "CLOSED" and prev_alert_states["eyes"] != "CLOSED": system_state["alert_counts"]["eyes"] += 1
                            prev_alert_states["eyes"] = system_state["eyes"]

                            if abs(raw_shoulder_slope - personalized_shoulder_baseline) > SHOULDER_SLOPE_THRESHOLD:
                                timer_shoulder += dt
                                if timer_shoulder >= TIME_LIMIT_SHOULDER: system_state["shoulders"] = "UNEVEN"
                            else: timer_shoulder, system_state["shoulders"] = 0.0, "BALANCED"
                            if system_state["shoulders"] == "UNEVEN" and prev_alert_states["shoulders"] != "UNEVEN": system_state["alert_counts"]["shoulders"] += 1
                            prev_alert_states["shoulders"] = system_state["shoulders"]
                                
                            if face_ratio > FACE_RATIO_THRESHOLD:
                                timer_dist += dt
                                if timer_dist >= TIME_LIMIT_DIST: system_state["distance"] = "TOO CLOSE"
                            else: timer_dist, system_state["distance"] = 0.0, "GOOD"
                            if system_state["distance"] == "TOO CLOSE" and prev_alert_states["dist"] != "TOO CLOSE": system_state["alert_counts"]["dist"] += 1
                            prev_alert_states["dist"] = system_state["distance"]

                            if mar > MAR_THRESHOLD or is_covering_mouth:
                                timer_mouth += dt
                                if timer_mouth >= TIME_LIMIT_MOUTH: system_state["mouth"] = "YAWN/COVER"
                            else: timer_mouth, system_state["mouth"] = 0.0, "NORMAL"
                            if system_state["mouth"] == "YAWN/COVER" and prev_alert_states["mouth"] != "YAWN/COVER": system_state["alert_counts"]["mouth"] += 1
                            prev_alert_states["mouth"] = system_state["mouth"]

                            if system_state["work_time"] >= system_state["target_work_time"]:
                                system_state["mode"], system_state["pomodoro_count"] = "EXERCISE_HAND", system_state["pomodoro_count"] + 1
                                hand_reps, fist_state = 0, False
                                timer_eyes, timer_posture, timer_shoulder, timer_dist, timer_mouth = 0.0, 0.0, 0.0, 0.0, 0.0

                        elif current_mode == "EXERCISE_HAND":
                            system_state["exercise_task"], system_state["exercise_progress"] = "Knuckle Stretch (雙手握拳伸展)", f"{hand_reps} / 5"
                            if hand_results and hand_results.multi_hand_landmarks:
                                fist_count, open_count = 0, 0
                                for hand_landmarks in hand_results.multi_hand_landmarks:
                                    mp_drawing.draw_landmarks(image, hand_landmarks, mp_hands.HAND_CONNECTIONS)
                                    if is_fist(hand_landmarks, iw, ih): fist_count += 1
                                    else: open_count += 1
                                
                                if len(hand_results.multi_hand_landmarks) == 2:
                                    if fist_count == 2: system_state["exercise_status"], fist_state = "BOTH FISTS (現在請張開!)", True
                                    elif open_count == 2:
                                        system_state["exercise_status"] = "BOTH OPEN"
                                        if fist_state: hand_reps, fist_state = hand_reps + 1, False
                                else: system_state["exercise_status"] = "請將雙手舉起放入畫面"
                            else: system_state["exercise_status"] = "等待雙手..."
                            if hand_reps >= 5: system_state["mode"], neck_reps, head_state = "EXERCISE_NECK", 0, "CENTER"

                        elif current_mode == "EXERCISE_NECK":
                            system_state["exercise_task"], system_state["exercise_progress"] = "Neck Stretch (頭部左右轉動)", f"{neck_reps} / 3"
                            if head_direction == "TURNED": system_state["exercise_status"], head_state = "TURNED (現在轉回正前方!)", "TURNED"
                            else:
                                system_state["exercise_status"] = "CENTER"
                                if head_state == "TURNED": neck_reps, head_state = neck_reps + 1, "CENTER"
                            if neck_reps >= 3: system_state["mode"], arm_reps, arms_up_state = "EXERCISE_ARM", 0, False
                        
                        elif current_mode == "EXERCISE_ARM":
                            system_state["exercise_task"], system_state["exercise_progress"] = "Arm Stretch (雙手向上伸展)", f"{arm_reps} / 3"
                            if pose_results and pose_results.pose_landmarks:
                                landmarks = pose_results.pose_landmarks.landmark
                                if landmarks[15].y < landmarks[11].y and landmarks[16].y < landmarks[12].y: system_state["exercise_status"], arms_up_state = "ARMS UP (現在請放下!)", True
                                else:
                                    system_state["exercise_status"] = "ARMS DOWN"
                                    if arms_up_state: arm_reps, arms_up_state = arm_reps + 1, False
                            else: system_state["exercise_status"] = "請將上半身放入畫面"
                            if arm_reps >= 3: system_state["mode"], system_state["work_time"] = "WORK", 0.0

                    current_time = time.time()
                    if current_time - last_emit_time >= 0.1:
                        socketio.emit('state_update', system_state)
                        last_emit_time = current_time
                    
                    image = cv2.flip(image, 1) 
                    ret, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 50])
                    if ret:
                        with frame_lock: global_frame = buffer.tobytes()
                    time.sleep(0.005) 
                    
        except Exception as e:
            traceback.print_exc()
            time.sleep(2) 
        finally:
            if 'cap' in locals() and cap.isOpened(): cap.release()

# ==========================================
# 網路路由與 Socket API
# ==========================================
@socketio.on('request_recalibrate')
def handle_recalibrate(): global force_recalibrate; force_recalibrate = True

@socketio.on('set_pomodoro_time')
def handle_set_time(data): system_state["target_work_time"], system_state["work_time"] = data.get("seconds", 1500), 0.0

@socketio.on('request_discord_report')
def handle_manual_report(data):
    rtype = data.get("type", "daily") if data else "daily"
    print(f"\n📥 收到前端請求：手動發送 {rtype} 報告")
    success = send_discord_report(report_type=rtype, is_manual=True)
    if rtype == "daily" and success: sync_to_cloud()
    socketio.emit('report_status', {"success": success, "type": rtype})

@socketio.on('request_cloud_data')
def handle_fetch_cloud():
    if not GAS_WEBHOOK_URL.startswith("http"): 
        socketio.emit('cloud_data_response', {"error": "尚未設定 GAS Webhook 網址"})
        return
    try:
        res = requests.get(GAS_WEBHOOK_URL, timeout=10)
        socketio.emit('cloud_data_response', {"data": res.json()})
    except Exception as e:
        socketio.emit('cloud_data_response', {"error": str(e)})

# 接收前端設定的 Webhook 網址
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
    socketio.run(app, debug=True, host='0.0.0.0', port=5001, use_reloader=False)