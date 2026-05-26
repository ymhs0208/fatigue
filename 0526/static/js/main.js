// static/js/main.js

const socket = io();
let myChart = null;

// ==========================================
// 🔊 全域變數與音效設定
// ==========================================
const alertSound = document.getElementById('alert-sound');
let isMuted = true;     // 預設靜音 (符合剛進網頁的圖示狀態)
let isAlerting = false; // 追蹤目前是否處於警告狀態
let lastAlertMsg = "";  // 追蹤目前的警告文字，避免重複發送系統通知
let prevStates = { eyes: "OPEN", distance: "GOOD", shoulders: "BALANCED", mode: "CALIBRATION", light: "GOOD" };

// ==========================================
// 🤖 TTS 語音合成助理
// ==========================================
function speak(text) {
    if (isMuted || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); // 中斷前面的語音，避免排隊卡頓
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 1.15;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
}

// ==========================================
// 🔘 音效與語音總開關 (加入記憶功能)
// ==========================================
function toggleVoice() {
    isMuted = !isMuted;
    localStorage.setItem('pulseai_voice_muted', isMuted); // 🌟 將狀態存入瀏覽器記憶
    
    updateVoiceUI(); // 呼叫 UI 更新函數
    
    if (!isMuted) {
        // 測試播放音效 (解除瀏覽器限制)
        if (alertSound) {
            alertSound.volume = 0;
            alertSound.play().then(() => {
                alertSound.pause();
                alertSound.volume = 1; 
            }).catch(e => console.log("音效測試失敗", e));
        }
        speak("Pulse AI 語音助理已啟動");
    } else {
        window.speechSynthesis.cancel();
        if (alertSound && !alertSound.paused) alertSound.pause();
    }
}

// 負責切換按鈕外觀的獨立函數
function updateVoiceUI() {
    const btn = document.getElementById('btn-voice');
    const icon = document.getElementById('icon-voice');
    const text = document.getElementById('text-voice');
    
    if (isMuted) {
        btn.classList.remove('border-emerald-300', 'bg-emerald-50'); 
        btn.classList.add('border-transparent');
        icon.className = "fa-solid fa-volume-xmark text-slate-400 group-hover:text-slate-600 transition-colors";
        text.innerText = "靜音"; 
        text.classList.replace('text-emerald-700', 'text-slate-500');
    } else {
        btn.classList.add('border-emerald-300', 'bg-emerald-50'); 
        btn.classList.remove('border-transparent');
        icon.className = "fa-solid fa-volume-high text-emerald-600";
        text.innerText = "語音開啟"; 
        text.classList.replace('text-slate-500', 'text-emerald-700');
    }
}

// ==========================================
// 📷 畫面顯示開關 (加入記憶與中斷串流功能以省效能)
// ==========================================
let isCameraHidden = false;

function toggleCameraDisplay() {
    isCameraHidden = !isCameraHidden;
    localStorage.setItem('pulseai_camera_hidden', isCameraHidden);
    updateCameraUI();
}

function updateCameraUI() {
    const btn = document.getElementById('btn-camera');
    const icon = document.getElementById('icon-camera');
    const text = document.getElementById('text-camera');
    const videoStream = document.getElementById('video-stream');
    const overlayHidden = document.getElementById('overlay-hidden');

    if (isCameraHidden) {
        // 更新按鈕樣式為「關閉」
        btn.classList.remove('border-emerald-300', 'bg-emerald-50'); 
        btn.classList.add('border-transparent');
        icon.className = "fa-solid fa-video-slash text-slate-400 group-hover:text-slate-600 transition-colors";
        text.innerText = "畫面隱藏"; 
        text.classList.replace('text-emerald-700', 'text-slate-500');

        // 顯示隱藏遮罩，隱藏真正的 img
        if(videoStream) videoStream.classList.add('hidden');
        if(overlayHidden) overlayHidden.classList.remove('hidden');

        // 💡 關鍵效能優化：把 src 清空，讓瀏覽器停止下載 MJPEG 影像串流
        if (videoStream && videoStream.src && videoStream.src.includes('/video_feed')) {
            videoStream.setAttribute('data-src', videoStream.src); // 記住網址
            videoStream.src = "";
        }
    } else {
        // 更新按鈕樣式為「開啟」
        btn.classList.add('border-emerald-300', 'bg-emerald-50'); 
        btn.classList.remove('border-transparent');
        icon.className = "fa-solid fa-video text-emerald-600";
        text.innerText = "畫面開啟"; 
        text.classList.replace('text-slate-500', 'text-emerald-700');

        // 隱藏遮罩，顯示 img
        if(videoStream) videoStream.classList.remove('hidden');
        if(overlayHidden) overlayHidden.classList.add('hidden');

        // 💡 恢復影像串流
        if (videoStream && (!videoStream.src || videoStream.src === window.location.href)) {
            videoStream.src = videoStream.getAttribute('data-src') || "/video_feed";
        }
    }
}

// ==========================================
// 網頁載入初始化 (讀取所有記憶)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    // 讀取 Webhook 網址
    const savedUrl = localStorage.getItem("discordWebhookUrl");
    if (savedUrl) {
        const input = document.getElementById("discord-webhook-input");
        if (input) input.value = savedUrl;
        socket.emit('update_discord_webhook', { url: savedUrl });
    }
    
    // 🌟 讀取語音開關記憶
    const savedMutedState = localStorage.getItem("pulseai_voice_muted");
    if (savedMutedState !== null) {
        isMuted = (savedMutedState === 'true');
        updateVoiceUI(); // 根據記憶恢復按鈕外觀
    }

    // 🌟 讀取畫面隱藏開關記憶
    const savedCameraState = localStorage.getItem("pulseai_camera_hidden");
    if (savedCameraState !== null) {
        isCameraHidden = (savedCameraState === 'true');
        updateCameraUI();
    }

    // 🚀 請求瀏覽器系統通知權限
    if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    console.log("✅ 系統通知權限已開啟");
                }
            });
        }
    }
});

// ==========================================
// 📡 核心邏輯：接收後端 AI 視覺狀態 (無網頁彈窗版)
// ==========================================
socket.on('state_update', function (state) {
    
    // --- 1. 判斷目前是否有任何不良狀態 ---
    let currentAlert = "";
    
    // 💡 只有在「工作專注模式 (WORK)」時，才允許觸發不良狀態警報！
    if (state.mode === "WORK") {
        if (state.eyes === "CLOSED") {
            currentAlert = "偵測到眼部疲勞，請閉眼休息一下。";
        } else if (state.mouth === "YAWN/COVER") {
            currentAlert = "您似乎有點想睡，要不要站起來喝口水？";
        } else if (state.shoulders === "UNEVEN") {
            currentAlert = "請注意高低肩，幫我調整一下坐姿喔。";
        } else if (state.distance === "TOO CLOSE") {
            currentAlert = "距離螢幕太近囉，請稍微往後退。";
        } else if (state.light === "TOO DARK") {
            currentAlert = "環境光線不足，請打開檯燈保護眼睛。";
        }
    }

    if (currentAlert !== "") {
        // 如果是新的警告內容，才發送系統通知
        if (!isAlerting || lastAlertMsg !== currentAlert) {
            isAlerting = true;
            lastAlertMsg = currentAlert;
            
            // 🚀 發送作業系統層級通知
            if ("Notification" in window && Notification.permission === "granted") {
                const sysNotification = new Notification("PulseAI 健康提醒 🛡️", {
                    body: currentAlert,
                    requireInteraction: false // 系統預設幾秒後會自動隱藏
                });
                
                // 點擊通知後自動將網頁叫回最上層
                sysNotification.onclick = function() {
                    window.focus();
                    this.close();
                };
            }
        }
        
        // 【聽覺】只要有不良狀態，就一直響鈴 + 一直碎碎唸！
        if (!isMuted) {
            // 1. 持續播放警告音效
            if (alertSound && alertSound.paused) {
                alertSound.play().catch(e => console.log("音效被阻擋", e));
            }
            
            // 2. 持續 TTS 碎碎唸 (只要 AI 嘴巴空下來，就立刻再唸一次)
            if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
                speak(currentAlert);
            }
        } else {
            // 如果在發出警告時，使用者按下了靜音，立刻強制閉嘴並停止音效
            window.speechSynthesis.cancel();
            if (alertSound && !alertSound.paused) {
                alertSound.pause();
                alertSound.currentTime = 0;
            }
        }

    } else {
        // --- 恢復正常狀態：停止所有聲音與系統通知旗標 ---
        isAlerting = false;
        lastAlertMsg = ""; // 清空紀錄

        if (alertSound && !alertSound.paused) {
            alertSound.pause();
            alertSound.currentTime = 0;
        }
        window.speechSynthesis.cancel(); // 只要一坐好，立刻停止未說完的警告
    }

    // --- 2. 運動休息時間提醒 (這部分維持只講一次，避免干擾運動) ---
    if (state.mode === "EXERCISE_HAND" && prevStates.mode === "WORK" && !isMuted) {
        speak("專注時間結束，請起立活動一下身體吧。");
    }
    prevStates.mode = state.mode; // 更新狀態快取供運動判斷使用

    // --- 3. 更新 UI 介面數字與進度條 ---
    const tr = Math.max(0, state.target_work_time - state.work_time);
    document.getElementById('timer').innerText = `${Math.floor(tr / 60).toString().padStart(2, '0')}:${Math.floor(tr % 60).toString().padStart(2, '0')}`;
    document.getElementById('work-bar').style.width = Math.min((state.work_time / state.target_work_time) * 100, 100) + "%";

    const container = document.getElementById('tomato-container');
    if (state.pomodoro_count > 0 && container.children.length !== state.pomodoro_count) {
        container.innerHTML = Array(state.pomodoro_count).fill('<span class="text-xl">🍅</span>').join('');
    } else if (state.pomodoro_count === 0) container.innerHTML = '';

    document.getElementById('overlay-absent').classList.toggle('hidden', !state.user_absent);
    document.getElementById('overlay-calib').classList.toggle('hidden', state.mode !== "CALIBRATION");
    
    // 運動畫面雙語邏輯
    const isEx = state.mode.startsWith("EXERCISE");
    document.getElementById('overlay-exercise').classList.toggle('hidden', !isEx);
    if (isEx) {
        let rawTask = state.exercise_task;
        let enText = rawTask;
        let zhText = "伸展運動"; 

        if (rawTask && rawTask.includes('(') && rawTask.includes(')')) {
            let parts = rawTask.split('(');
            enText = parts[0].trim();                         
            zhText = parts[1].replace(')', '').trim();        
        }
        document.getElementById('ex-title-zh').innerText = zhText;
        document.getElementById('ex-title-en').innerText = enText;
        document.getElementById('ex-progress').innerText = state.exercise_progress.split("/")[0].trim();
        document.getElementById('ex-status').innerText = state.exercise_status;
    }

    // 狀態卡片更新
    function update(cid, vid, isAlert, text) {
        const c = document.getElementById(cid), v = document.getElementById(vid);
        if (isAlert) {
            c.classList.add('alert-pulse', 'border-red-300', 'bg-red-50'); 
            v.className = "font-bold text-xl text-red-600"; v.innerText = text;
        } else {
            c.classList.remove('alert-pulse', 'border-red-300', 'bg-red-50'); 
            v.className = "font-bold text-xl text-slate-800"; v.innerText = text;
        }
    }

    update('card-shoulders', 'val-shoulders', state.shoulders === "UNEVEN", state.shoulders === "UNEVEN" ? "高低肩！" : "平衡");
    update('card-eyes', 'val-eyes', state.eyes === "CLOSED", state.eyes === "CLOSED" ? "疲勞！" : "正常");
    update('card-mouth', 'val-mouth', state.mouth === "YAWN/COVER", state.mouth === "YAWN/COVER" ? "打哈欠！" : "無");
    update('card-dist', 'val-dist', state.distance === "TOO CLOSE", state.distance === "TOO CLOSE" ? "太近！" : "適中");
    update('card-light', 'val-light', state.light === "TOO DARK", state.light === "TOO DARK" ? "太暗！" : "明亮");
});

// ==========================================
// ⚙️ 其他 UI 與設定邏輯
// ==========================================
function openSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function saveSettings(btnElement) {
    const url = document.getElementById('discord-webhook-input').value.trim();
    localStorage.setItem("discordWebhookUrl", url);
    socket.emit('update_discord_webhook', { url: url });
    
    const originalText = btnElement.innerText;
    btnElement.innerText = "已儲存！";
    btnElement.classList.replace('bg-cyan-500', 'bg-emerald-500');
    btnElement.classList.replace('hover:bg-cyan-600', 'hover:bg-emerald-600');
    
    setTimeout(() => {
        btnElement.innerText = originalText;
        btnElement.classList.replace('bg-emerald-500', 'bg-cyan-500');
        btnElement.classList.replace('hover:bg-emerald-600', 'hover:bg-cyan-600');
    }, 1000);
}

function setPomodoro(seconds, btn, isHeader = false) {
    const modalButtons = document.querySelectorAll('#timer-buttons button');
    modalButtons.forEach(b => {
        b.className = "text-sm font-bold text-slate-600 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-all flex-grow text-center";
        const span = b.querySelector('span');
        if(span) span.className = "text-[10px] text-slate-400 font-normal";
    });

    const headerButtons = document.querySelectorAll('#header-timer-buttons button');
    headerButtons.forEach(b => {
        b.className = "text-xs font-bold text-slate-500 px-4 py-2 rounded-full hover:bg-white transition-all border border-transparent";
    });
    
    if (btn) {
        if (isHeader) {
            btn.className = "btn-active text-xs font-bold text-slate-600 px-4 py-2 rounded-full transition-all border border-transparent";
            if (seconds === 1500) {
                const modal25 = document.getElementById('btn-mode-25');
                if (modal25) {
                    modal25.className = "btn-active text-sm font-bold text-cyan-700 px-4 py-2.5 rounded-xl border border-cyan-200 transition-all flex-grow text-center shadow-sm";
                    const span = modal25.querySelector('span');
                    if(span) span.className = "text-[10px] text-cyan-600/80 font-normal";
                }
            }
        } else {
            btn.className = "btn-active text-sm font-bold text-cyan-700 px-4 py-2.5 rounded-xl border border-cyan-200 transition-all flex-grow text-center shadow-sm";
            const span = btn.querySelector('span');
            if(span) span.className = "text-[10px] text-cyan-600/80 font-normal";
            if (seconds === 1500) {
                const header25 = document.getElementById('btn-header-25m');
                if (header25) header25.className = "btn-active text-xs font-bold text-slate-600 px-4 py-2 rounded-full transition-all border border-transparent";
            }
        }
        document.getElementById('custom-work-mins').value = '';
    }
    socket.emit('set_pomodoro_time', { seconds: seconds });
}

function applyCustomTimer() {
    const minsInput = document.getElementById('custom-work-mins').value;
    const mins = parseInt(minsInput);
    if (isNaN(mins) || mins <= 0) { alert("請輸入有效的專注時間！"); return; }
    
    setPomodoro(mins * 60, null, false);
    
    const btnElement = document.getElementById('btn-apply-time');
    const originalText = btnElement.innerText;
    btnElement.innerText = "已套用！";
    btnElement.classList.replace('bg-indigo-500', 'bg-emerald-500');
    btnElement.classList.replace('hover:bg-indigo-600', 'hover:bg-emerald-600');
    setTimeout(() => {
        btnElement.innerText = originalText;
        btnElement.classList.replace('bg-emerald-500', 'bg-indigo-500');
        btnElement.classList.replace('hover:bg-emerald-600', 'hover:bg-indigo-600');
        closeSettings();
    }, 800);
}

// ==========================================
// 📊 雲端儀表板與報表邏輯
// ==========================================
function openDashboard() {
    const modal = document.getElementById('dashboard-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    document.getElementById('chart-loading').classList.remove('hidden');
    document.getElementById('chart-container').classList.add('hidden');
    socket.emit('request_cloud_data');
}

function closeDashboard() {
    const modal = document.getElementById('dashboard-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

socket.on('cloud_data_response', function(res) {
    document.getElementById('chart-loading').classList.add('hidden');
    document.getElementById('chart-container').classList.remove('hidden');
    if(res.error) { alert("獲取雲端資料失敗：" + res.error); return; }

    const data = res.data;
    if(!data || data.length === 0) { alert("雲端資料為空！"); return; }

    const labels = data.map(row => { let d = new Date(row['日期']); return (d.getMonth()+1) + '/' + d.getDate(); });
    const workTimes = data.map(row => (row['專注時長(秒)'] / 60).toFixed(1)); 
    const alertEyes = data.map(row => row['閉眼次數'] || 0);
    const alertShoulders = data.map(row => row['高低肩次數'] || 0);
    const alertLight = data.map(row => row['太暗次數'] || 0);

    const ctx = document.getElementById('healthChart').getContext('2d');
    if(myChart) myChart.destroy(); 

    myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: '專注時間 (分鐘)', data: workTimes, type: 'line', borderColor: '#06b6d4', backgroundColor: '#06b6d4', borderWidth: 3, tension: 0.3, yAxisID: 'y' },
                { label: '閉眼警告', data: alertEyes, backgroundColor: 'rgba(239, 68, 68, 0.5)', yAxisID: 'y1' },
                { label: '高低肩警告', data: alertShoulders, backgroundColor: 'rgba(245, 158, 11, 0.5)', yAxisID: 'y1' },
                { label: '光線太暗', data: alertLight, backgroundColor: 'rgba(234, 179, 8, 0.5)', yAxisID: 'y1' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { type: 'linear', display: true, position: 'left' }, y1: { type: 'linear', display: true, position: 'right', grid: {drawOnChartArea: false} } } }
    });
});

function sendReport(type) {
    document.getElementById('report-text-' + type).innerText = "發送中..."; 
    document.getElementById('btn-report-' + type).classList.add('opacity-50');
    socket.emit('request_discord_report', { type: type });
}

socket.on('report_status', function (data) {
    const rtype = data.type || 'daily', btn = document.getElementById('btn-report-' + rtype);
    document.getElementById('report-text-' + rtype).innerText = data.success ? "成功！" : "失敗";
    setTimeout(() => { document.getElementById('report-text-' + rtype).innerText = rtype === 'daily' ? "發日報" : "發週報"; btn.classList.remove('opacity-50'); }, 3000);
});

function recalibrate() { socket.emit('request_recalibrate'); }