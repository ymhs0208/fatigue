# PulseAI | 智能辦公健康助理 🛡️

![Status](https://img.shields.io/badge/Status-Active-success)
![Python](https://img.shields.io/badge/Python-3.8+-blue)
![Flask](https://img.shields.io/badge/Framework-Flask-lightgrey)
![AI](https://img.shields.io/badge/AI-MediaPipe%20%7C%20NVIDIA%20NIM-green)

**PulseAI** 是一款結合邊緣運算（Edge AI）、物聯網推播與生成式 AI 的全端健康管理系統，專為長時間久坐的上班族、遠距工作者及學生設計。透過電腦視覺即時監測坐姿與疲勞狀態，搭配番茄鐘與 AI 健康教練，打造零穿戴設備的智慧健康防護系統。

---

# ✨ 核心功能

## 🍅 智能番茄鐘與防摸魚機制

* 支援 25 分鐘標準模式
* 52 分鐘護眼模式
* 90 分鐘深度工作模式
* 自訂工作時間

### 離席偵測

若專注期間離開鏡頭超過 120 秒：

* 自動判定番茄鐘失敗
* 記錄摸魚時間
* 加入每日報告
* AI 教練進行嚴厲評語

---

## 👁️ Edge AI 即時健康偵測

### 剛性特徵測距（IOD）

利用雙眼瞳孔間距（Inter-Pupillary Distance）估算與螢幕距離，相較臉部寬高比更不受表情影響。

### 疲勞監測

#### Eye Aspect Ratio (EAR)

偵測：

* 長時間閉眼
* 頻繁眨眼
* 疲勞狀態

#### Mouth Aspect Ratio (MAR)

結合嘴巴高度與寬度比例：

* 打哈欠
* 摀嘴動作
* 過濾講話誤判

#### 高低肩監測

利用 MediaPipe Pose：

* 計算肩膀水平斜率
* 偵測姿勢歪斜

#### 環境亮度監測

利用灰階平均值：

* 光線過暗提醒
* 保護視力

---

## 🤸 AI 運動引導

完成番茄鐘後進入強制休息：

### 1. 手部伸展

* 握拳
* 張開

### 2. 頸部伸展

* 左轉
* 右轉

### 3. 肩臂伸展

* 雙手高舉
* 舒展肩頸

---

## 🧠 NVIDIA GenAI 毒舌教練

串接：

* NVIDIA NIM
* Llama 3.1 8B
* Llama 3.1 70B

根據：

* 專注時數
* 摸魚時間
* 高低肩次數
* 疲勞狀況

生成客製化健康分析與毒舌評語。

---

## ☁️ 雲端同步

### Supabase

儲存：

* 健康資料
* 番茄鐘紀錄
* 使用者統計

### Discord Webhook

每日自動推播：

* 日報
* 週報
* 成就稱號

例如：

* 薪水小偷
* 過勞社畜
* 入定高僧
* 超級卷王

---

# 🏗 系統架構

```text
WebCam
   ↓
OpenCV + MediaPipe
   ↓
健康特徵分析
(EAR、MAR、IOD、Pose)
   ↓
EMA + IQR Filter
   ↓
system_state
   ↓
Flask-SocketIO
   ↓
Dashboard
   ↓
Supabase
   ↓
Discord
   ↓
NVIDIA NIM
```

---

# 🛠 技術架構

## 後端

* Python 3
* Flask
* Flask-SocketIO
* Threading

## 前端

* HTML5
* Tailwind CSS
* JavaScript
* Chart.js

## AI 與影像處理

* OpenCV
* MediaPipe Face Mesh
* MediaPipe Hands
* MediaPipe Pose
* NumPy

## 資料處理

* EMA Filter
* IQR Filter

## 雲端服務

* Supabase PostgreSQL
* Discord Webhook
* NVIDIA NIM API

---

# 📂 專案目錄

```text
PulseAI/
│
├── app.py
├── README.md
├── .env
├── requirements.txt
│
├── templates/
│     └── index.html
│
├── static/
│     ├── css/
│     │     └── style.css
│     │
│     ├── js/
│     │     └── main.js
│     │
│     ├── img/
│     │     ├── logo.png
│     │     ├── dashboard.png
│     │     └── exercise.png
│     │
│     └── audio/
│           ├── alert.wav
│           └── finish.wav
│
├── models/
├── reports/
├── logs/
└── data/
```

---

# 🚀 Quick Start

## 安裝需求

Python 3.8+

需要：

* Webcam
* 喇叭（選配）

---

## 安裝套件

```bash
pip install opencv-python mediapipe numpy requests flask flask-socketio python-dotenv supabase
```

---

## 建立 .env

```env
NVIDIA_API_KEY=your_nvidia_api_key

SUPABASE_URL=your_project_url
SUPABASE_KEY=your_anon_key

DISCORD_WEBHOOK=your_webhook_url
```

---

## 啟動系統

```bash
python app.py
```

預設網址：

```text
http://127.0.0.1:5001
```

---

# 🧪 核心演算法

## EAR

```text
EAR =
(||p2-p6|| + ||p3-p5||)
/ 2||p1-p4||
```

用途：

* 疲勞
* 閉眼

---

## MAR

```text
MAR =
mouth_height
/
mouth_width
```

用途：

* 打哈欠
* 摀嘴

---

## EMA Filter

```python
ema = alpha * current + (1-alpha) * previous
```

降低感測抖動。

---

## IQR Filter

移除異常值：

```python
Q1 = percentile(data,25)
Q3 = percentile(data,75)

IQR = Q3-Q1

lower = Q1 - 1.5*IQR
upper = Q3 + 1.5*IQR
```

---

# 💡 Engineering Highlights

## Thread Safe

多執行緒：

* Flask Server
* AI Detection
* Discord Report
* Scheduler

使用：

```python
state_lock
frame_lock
```

避免 Race Condition。

---

## EMA + IQR

提升穩定性：

* 距離偵測
* 肩膀斜率
* EAR
* MAR

降低誤判。

---

## 嚴格校正

校正時要求：

✅ 坐正

✅ 光線充足

✅ 不遮擋嘴巴

✅ 面向鏡頭

否則拒絕建立基準值。

---

# 📊 Dashboard

顯示：

* 專注時數
* 摸魚時間
* 高低肩次數
* 疲勞指數
* 歷史趨勢
* 成功番茄鐘數

---

# 🔮 Future Work

* YOLOv11 姿勢辨識
* 多使用者模式
* 手機 APP
* Telegram Bot
* Line Notify
* Gemini / GPT 教練模式
* RAG 健康知識庫
* LangChain Agent

---

# 👥 開發團隊

| 組員編號 | 姓名 | 負責核心領域與詳細貢獻 |
| :---: | :--- | :--- |
| 14 | 曾仁宥 | **【專注產值量化與遊戲化機制】**<br><ul><li>**產值轉換演算法：** 設計「時間價值量化」邏輯，將使用者的專注總時長（每累積滿 1 小時，約等於 2.4 個標準番茄鐘）換算為「賺到 1 杯星巴克☕」等實體價值指標，並於每週報告中結算，大幅提升使用者的成就感與維持專注的動力。</li></ul> |
| 15 | 吳承誼 | **【前端架構與 UI/UX 互動設計】**<br><ul><li>**現代化介面開發：** 採用 HTML5 與 Tailwind CSS 打造高質感的「膠囊/玻璃擬物化 (Glassmorphism)」響應式使用者介面。</li><li>**即時狀態綁定：** 實作 WebSocket 客戶端，無延遲接收後端 AI 辨識結果，並動態渲染健康警示卡片與視訊串流。</li><li>**互動元件實作：** 開發動態番茄鐘計時器、運動姿勢引導彈窗、Chart.js 雲端數據視覺化圖表及系統設定面板。</li><li>**沉浸式體驗：** 整合系統狀態音效 (警告音、提示音) 與流暢的 CSS 動畫過場效果。</li></ul> |
| 22 | 章惟善 | **【後端架構、邊緣 AI 視覺與雲端整合】**<br><ul><li>**核心後端引擎：** 基於 Python Flask 與 Flask-SocketIO 建構非同步即時通訊伺服器，並導入嚴謹的多執行緒鎖 (Thread Lock) 確保系統穩定。</li><li>**邊緣 AI 視覺演算法：** 整合 OpenCV 與 MediaPipe 開發 IOD 剛性特徵測距、EAR (眼部)、MAR (嘴部) 及 Pose (肩頸) 疲勞偵測，並加入 EMA 濾波演算法消除雜訊。</li><li>**生成式 AI 整合：** 串接 NVIDIA NIM (Llama 3.1) API，根據使用者健康與摸魚數據，動態生成「毒舌生產力教練」專屬點評。</li><li>**雲端與物聯網推播：** 建置 Supabase 資料庫進行歷史數據同步，並開發 Discord Webhook 機器人自動結算與推播圖文日報/週報。</li></ul> |
| 33 | 林冠廷 | **【摸魚判定演算法與視覺資產設計】**<br><ul><li>**防摸魚機制 (Cyberloafing Logic)：** 制定離席與專注力不足的嚴格判定標準。當系統偵測到使用者離開鏡頭畫面連續超過 120 秒，即判定為「摸魚狀態」，不僅會將該段時間計入摸魚總時長，更會自動中斷當前進度，計入「失敗番茄鐘」。</li><li>**視覺資產生成：** 運用 AI 製作趣味圖像素材（如：企鵝摸魚圖），並整合於系統報告與前端介面中，強化整體的遊戲化與互動體驗。</li></ul> |

# 📄 License

NUTC

Copyright © 2026 Group 5
