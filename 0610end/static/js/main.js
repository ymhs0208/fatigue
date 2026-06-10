const socket = io();
let myChart = null;
let currentTargetTime = 1500; // 預設 25 分鐘

// ==========================================
// 🔊 全域變數與音效設定
// ==========================================
const alertSound = document.getElementById("alert-sound");
const warningSound = document.getElementById("warning-sound");
let isMuted = true;
let isAlerting = false;
let lastAlertMsg = "";
let prevStates = {
	eyes: "OPEN",
	distance: "GOOD",
	shoulders: "BALANCED",
	mode: "CALIBRATION",
	light: "GOOD",
};

let isCameraError = false;
let lastDataTime = Date.now();
let consecutiveBlackFrames = 0;
let currentSystemLevel = "NORMAL";
let currentWarningMsg = "";

// ==========================================
// ⏸️ 暫停偵測與結算狀態控制
// ==========================================
let isPaused = false;
let isSettled = false; // 🌟 結算狀態標記

function togglePause() {
	isPaused = !isPaused;

	// 🌟 當使用者點擊「繼續偵測」時，解除結算狀態
	if (!isPaused) {
		isSettled = false;
	}

	const btn = document.getElementById("btn-pause");
	const icon = document.getElementById("icon-pause");
	const text = document.getElementById("text-pause");

	if (isPaused) {
		// 切換為暫停狀態 (黃色)
		btn.classList.remove("btn-glass");
		btn.classList.add("btn-glass-warning");

		icon.className = "fa-solid fa-play pl-1 text-lg";
		text.innerText = "繼續偵測與計時";
		socket.emit("request_pause", { paused: true });
	} else {
		// 恢復正常狀態 (紫色)
		btn.classList.remove("btn-glass-warning");
		btn.classList.add("btn-glass");

		icon.className = "fa-solid fa-pause text-lg";
		text.innerText = "暫停偵測與計時";
		socket.emit("request_pause", { paused: false });
	}
}

// ==========================================
// ⚠️ 系統三階段狀態控制 (正常/黃色警告/紅色錯誤)
// ==========================================
function setSystemStatus(level, msg = "") {
	if (currentSystemLevel === level && currentWarningMsg === msg) return;

	currentSystemLevel = level;
	currentWarningMsg = msg;

	const errorMsgEl = document.getElementById("sys-error-msg");
	const dot = document.getElementById("status-indicator");
	const text = document.getElementById("conn-status-text");

	if (level === "ERROR") {
		if (errorMsgEl) {
			errorMsgEl.innerText = msg;
			errorMsgEl.className =
				"text-xs font-bold transition-all tracking-widest px-3 py-1 rounded-full absolute left-1/2 -translate-x-1/2 shadow-sm text-red-500 bg-red-50 animate-error-blink";
		}
		if (dot)
			dot.className =
				"w-2.5 h-2.5 rounded-full bg-red-500 breathing-light-red";
		if (text) {
			text.innerText = "異常狀態";
			text.className = "text-xs font-bold text-red-500";
		}
		if (!isMuted && warningSound && warningSound.paused) {
			warningSound.play().catch((e) => console.log("警告音效被阻擋", e));
		}
	} else if (level === "WARNING") {
		if (errorMsgEl) {
			errorMsgEl.innerText = msg;
			errorMsgEl.className =
				"text-xs font-bold transition-all tracking-widest px-3 py-1 rounded-full absolute left-1/2 -translate-x-1/2 shadow-sm text-amber-500 bg-amber-50 animate-pulse";
		}
		if (dot)
			dot.className =
				"w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse";
		if (text) {
			text.innerText = "連線確認中...";
			text.className = "text-xs font-bold text-amber-500";
		}
		if (warningSound && !warningSound.paused) {
			warningSound.pause();
			warningSound.currentTime = 0;
		}
	} else {
		// NORMAL
		if (errorMsgEl) errorMsgEl.className = "hidden";
		if (dot)
			dot.className =
				"w-2.5 h-2.5 rounded-full bg-emerald-400 breathing-light";
		if (text) {
			text.innerText = "系統運作中";
			text.className = "text-xs font-bold text-purple-400";
		}
		if (warningSound && !warningSound.paused) {
			warningSound.pause();
			warningSound.currentTime = 0;
		}
	}
}

function handleCameraError(customMsg) {
	if (isCameraHidden && typeof customMsg !== "string") return;

	isCameraError = true;
	const msg =
		typeof customMsg === "string" ? customMsg : "⚠️ 相機讀取失敗或尚未授權";
	setSystemStatus("ERROR", msg);

	if (alertSound && !alertSound.paused) {
		alertSound.pause();
		alertSound.currentTime = 0;
	}
}

function handleCameraSuccess() {
	if (isCameraError) {
		isCameraError = false;
		setSystemStatus("NORMAL");

		const videoStream = document.getElementById("video-stream");
		if (videoStream && !isCameraHidden) {
			videoStream.src = "/video_feed?" + new Date().getTime();
		}
	}
}

// 🌟 全域監控計時器 (每半秒檢查一次是否沒有收到後端封包)
setInterval(() => {
	if (isCameraError || isCameraHidden) return;

	let timeSinceLastData = Date.now() - lastDataTime;

	if (timeSinceLastData > 1000 && timeSinceLastData <= 4000) {
		let countdown = Math.ceil((4000 - timeSinceLastData) / 1000);
		setSystemStatus("WARNING", `⚠️ 訊號延遲，重新連線中... ${countdown}s`);
	} else if (timeSinceLastData > 4000) {
		handleCameraError("⚠️ 畫面訊號中斷或相機已拔除");
	}
}, 500);

// ==========================================
// 🔌 Socket 連線狀態控制
// ==========================================
socket.on("connect", () => {
	lastDataTime = Date.now();
	setSystemStatus("NORMAL");
});

socket.on("disconnect", () => {
	handleCameraError("⚠️ 已與伺服器斷線");
});

function triggerRecalibrate(btn) {
	socket.emit("request_recalibrate");
	const span = btn.querySelector("span");
	const icon = btn.querySelector("i");
	const originalText = span.innerText;

	span.innerText = "校正中...";
	span.classList.replace("text-slate-600", "text-purple-600");
	icon.classList.add("fa-spin");

	setTimeout(() => {
		span.innerText = originalText;
		span.classList.replace("text-purple-600", "text-slate-600");
		icon.classList.remove("fa-spin");
	}, 3000);
}

// ==========================================
// 🔘 音效開關 (加入記憶功能)
// ==========================================
function toggleVoice() {
	isMuted = !isMuted;
	localStorage.setItem("pulseai_voice_muted", isMuted);

	updateVoiceUI();

	if (!isMuted) {
		if (alertSound) {
			alertSound.volume = 0;
			alertSound
				.play()
				.then(() => {
					alertSound.pause();
					alertSound.volume = 1;
				})
				.catch((e) => console.log("音效測試失敗", e));
		}

		if (isCameraError && warningSound && warningSound.paused) {
			warningSound
				.play()
				.catch((e) => console.log("警告音效播放失敗", e));
		}
	} else {
		if (alertSound && !alertSound.paused) alertSound.pause();
		if (warningSound && !warningSound.paused) warningSound.pause();
	}
}

function updateVoiceUI() {
	const btn = document.getElementById("btn-voice");
	const icon = document.getElementById("icon-voice");
	const text = document.getElementById("text-voice");

	if (isMuted) {
		btn.classList.remove("border-purple-300", "bg-purple-50");
		icon.className =
			"fa-solid fa-volume-xmark text-slate-400 group-hover:text-slate-600 transition-colors";
		text.innerText = "靜音";
		text.className = "text-slate-500";
	} else {
		btn.classList.add("border-purple-300", "bg-purple-50");
		icon.className = "fa-solid fa-volume-high text-purple-600";
		text.innerText = "音效開啟";
		text.className = "text-purple-700 font-bold";
	}
}

// ==========================================
// 📷 畫面顯示開關 (加入記憶與中斷串流功能)
// ==========================================
let isCameraHidden = false;

function toggleCameraDisplay() {
	isCameraHidden = !isCameraHidden;
	localStorage.setItem("pulseai_camera_hidden", isCameraHidden);
	updateCameraUI();
}

function updateCameraUI() {
	const btn = document.getElementById("btn-camera");
	const icon = document.getElementById("icon-camera");
	const text = document.getElementById("text-camera");
	const videoStream = document.getElementById("video-stream");
	const overlayHidden = document.getElementById("overlay-hidden");

	if (isCameraHidden) {
		btn.classList.remove("border-purple-300", "bg-purple-50");
		icon.className =
			"fa-solid fa-video-slash text-slate-400 group-hover:text-slate-600 transition-colors";
		text.innerText = "畫面隱藏";
		text.className = "text-slate-500";

		if (videoStream) videoStream.classList.add("hidden");
		if (overlayHidden) overlayHidden.classList.remove("hidden");

		if (
			videoStream &&
			videoStream.src &&
			videoStream.src.includes("/video_feed")
		) {
			videoStream.setAttribute("data-src", videoStream.src);
			videoStream.src = "";
		}
	} else {
		btn.classList.add("border-purple-300", "bg-purple-50");
		icon.className = "fa-solid fa-video text-purple-600 transition-colors";
		text.innerText = "畫面開啟";
		text.className = "text-purple-700 font-bold";

		if (videoStream) videoStream.classList.remove("hidden");
		if (overlayHidden) overlayHidden.classList.add("hidden");

		if (
			videoStream &&
			(!videoStream.src || videoStream.src === window.location.href)
		) {
			videoStream.src =
				videoStream.getAttribute("data-src") || "/video_feed";
		}

		lastDataTime = Date.now(); // 重置看門狗
	}

	const ghostOverlay = document.getElementById("overlay-absent");
	if (ghostOverlay && isCameraHidden) ghostOverlay.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
	const savedUrl = localStorage.getItem("discordWebhookUrl");
	if (savedUrl) {
		const input = document.getElementById("discord-webhook-input");
		if (input) input.value = savedUrl;
		socket.emit("update_discord_webhook", { url: savedUrl });
	}

	isMuted = true;
	localStorage.setItem("pulseai_voice_muted", "true");
	updateVoiceUI();

	const savedCameraState = localStorage.getItem("pulseai_camera_hidden");
	if (savedCameraState !== null) {
		isCameraHidden = savedCameraState === "true";
		updateCameraUI();
	}

	if ("Notification" in window) {
		if (
			Notification.permission !== "granted" &&
			Notification.permission !== "denied"
		) {
			Notification.requestPermission().then((permission) => {
				if (permission === "granted")
					console.log("✅ 系統通知權限已開啟");
			});
		}
	}
	// 🌟 初始化液態玻璃滑塊寬度
	setTimeout(() => {
		const header25 = document.getElementById("btn-header-25m");
		const slider = document.getElementById("liquid-slider");
		if (header25 && slider)
			slider.style.width = header25.offsetWidth + "px";
	}, 100);
});

// ==========================================
// 📡 核心邏輯：接收後端 AI 視覺狀態
// ==========================================
socket.on("state_update", function (state) {
	currentTargetTime = state.target_work_time;
	lastDataTime = Date.now();

	// 🏃 運動介面切換邏輯
	const defaultSidebar = document.getElementById("sidebar-default-content");
	const exerciseSidebar = document.getElementById("sidebar-exercise-content");
	const guideImg = document.getElementById("exercise-guide-img");
	const guideName = document.getElementById("exercise-guide-name");

	const isExMode = state.mode.startsWith("EXERCISE");
	const isShowingEx = exerciseSidebar.classList.contains("flex");

	if (isExMode) {
		if (!isShowingEx) {
			defaultSidebar.classList.add("hidden");
			defaultSidebar.classList.remove("flex", "animate-pop-bounce");
			exerciseSidebar.classList.remove("hidden");
			exerciseSidebar.classList.add("flex");
			exerciseSidebar.classList.remove("animate-pop-bounce");
			void exerciseSidebar.offsetWidth;
			exerciseSidebar.classList.add("animate-pop-bounce");
		}

		if (state.mode === "EXERCISE_HAND") {
			guideImg.src = "/static/img/exercise1.png";
			guideName.innerText = "雙手握拳伸展";
		} else if (state.mode === "EXERCISE_NECK") {
			guideImg.src = "/static/img/exercise2.png";
			guideName.innerText = "頭部左右轉動";
		} else if (state.mode === "EXERCISE_ARM") {
			guideImg.src = "/static/img/exercise3.png";
			guideName.innerText = "雙手向上伸展";
		}
	} else {
		if (isShowingEx) {
			exerciseSidebar.classList.add("hidden");
			exerciseSidebar.classList.remove("flex", "animate-pop-bounce");
			defaultSidebar.classList.remove("hidden");
			defaultSidebar.classList.add("flex");
			defaultSidebar.classList.remove("animate-pop-bounce");
			void defaultSidebar.offsetWidth;
			defaultSidebar.classList.add("animate-pop-bounce");
		}
	}

	// 黑畫面偵測機制
	if (state.light === "TOO DARK" && state.user_absent && !isCameraHidden) {
		consecutiveBlackFrames++;
		let secondsPassed = consecutiveBlackFrames * 0.1;

		if (secondsPassed > 1.0 && secondsPassed <= 4.0) {
			let countdown = Math.ceil(4.0 - secondsPassed);
			setSystemStatus(
				"WARNING",
				`⚠️ 畫面異常，確認相機中... ${countdown}s`,
			);
		} else if (secondsPassed > 4.0) {
			handleCameraError("⚠️ 畫面無訊號或環境過暗，請檢查相機");
		}
	} else {
		consecutiveBlackFrames = 0;
		if (isCameraError) {
			handleCameraSuccess();
		} else if (currentSystemLevel === "WARNING") {
			setSystemStatus("NORMAL");
		}
	}

	let currentAlert = "";
	let alertDetails = [];

	if (state.mode === "WORK") {
		if (state.eyes === "CLOSED") alertDetails.push("眼部疲勞");
		if (state.shoulders === "UNEVEN") alertDetails.push("高低肩狀態");
		if (state.distance === "TOO CLOSE") alertDetails.push("螢幕距離太近");
		if (state.light === "TOO DARK" && !isCameraError)
			alertDetails.push("環境光源不足");
		if (state.mouth === "YAWN/COVER")
			alertDetails.push("精神不濟 (打哈欠)");

		if (alertDetails.length > 0) {
			currentAlert =
				"偵測到：" +
				alertDetails.join("、") +
				"！請調整您的姿勢或稍作休息。";
		}
	}

	if (currentAlert !== "") {
		if (!isAlerting || lastAlertMsg !== currentAlert) {
			isAlerting = true;
			lastAlertMsg = currentAlert;

			if (
				"Notification" in window &&
				Notification.permission === "granted"
			) {
				const sysNotification = new Notification("小企鵝 健康提醒 🛡️", {
					body: currentAlert,
					requireInteraction: false,
				});
				sysNotification.onclick = function () {
					window.focus();
					this.close();
				};
			}
		}

		if (!isMuted && !isCameraError && currentSystemLevel !== "WARNING") {
			if (alertSound && alertSound.paused)
				alertSound.play().catch((e) => console.log("音效被阻擋", e));
		} else {
			if (alertSound && !alertSound.paused) {
				alertSound.pause();
				alertSound.currentTime = 0;
			}
		}
	} else {
		isAlerting = false;
		lastAlertMsg = "";
		if (alertSound && !alertSound.paused) {
			alertSound.pause();
			alertSound.currentTime = 0;
		}
	}

	if (state.mode === "EXERCISE_HAND" && prevStates.mode === "WORK") {
		if ("Notification" in window && Notification.permission === "granted") {
			const exNotification = new Notification("小企鵝 休息時間 ☕", {
				body: "專注時間結束，請起立活動一下身體吧！",
				requireInteraction: true,
			});
			exNotification.onclick = function () {
				window.focus();
				this.close();
			};
		}
		if (!isMuted && alertSound && !isCameraError) {
			alertSound.play().catch((e) => console.log("音效被阻擋", e));
			setTimeout(() => {
				alertSound.pause();
				alertSound.currentTime = 0;
			}, 1500);
		}
	}

	prevStates.mode = state.mode;

	// ========================================================
	// ⏱️ 計時器渲染與結算溫暖提示
	// ========================================================
	const tr = Math.max(0, state.target_work_time - state.work_time);
	const timerEl = document.getElementById("timer");

	if (timerEl) {
		if (isSettled) {
			// 🌟 結算狀態：顯示溫暖慰勞字樣
			timerEl.innerText = "今日圓滿 ☕";
			timerEl.classList.add("text-5xl", "text-emerald-500");
			timerEl.classList.remove("text-6xl", "text-slate-700", "font-mono");
		} else {
			// 恢復正常倒數顯示
			timerEl.innerText = `${Math.floor(tr / 60)
				.toString()
				.padStart(2, "0")}:${Math.floor(tr % 60)
				.toString()
				.padStart(2, "0")}`;
			timerEl.classList.add("text-6xl", "text-slate-700", "font-mono");
			timerEl.classList.remove("text-5xl", "text-emerald-500");
		}
	}

	const workBar = document.getElementById("work-bar");
	if (workBar) {
		workBar.style.width =
			Math.min((state.work_time / state.target_work_time) * 100, 100) +
			"%";
	}

	// 🐧 企鵝生長歷程核心區塊
	const container = document.getElementById("tomato-container");
	if (container) {
		let count = state.pomodoro_count;
		let currentRenderedCount = parseInt(
			container.getAttribute("data-count") || "-1",
		);

		if (currentRenderedCount !== count) {
			if (count === 0) {
				container.innerHTML = "";
			} else {
				let adultCount = Math.floor(count / 6);
				let remainder = count % 6;
				let imagesHTML = "";

				for (let i = 0; i < adultCount; i++) {
					imagesHTML += `<img src="/static/img/6.png" class="w-14 h-14 object-contain hover:scale-110 transition-transform duration-300 drop-shadow-md bubble-hover" alt="成年企鵝">`;
				}
				for (let i = 1; i <= remainder; i++) {
					imagesHTML += `<img src="/static/img/${i}.png" class="w-10 h-10 object-contain hover:scale-110 transition-transform duration-300 drop-shadow-sm bubble-hover" alt="企鵝階段 ${i}">`;
				}
				container.innerHTML = `<div class="flex items-center space-x-3 flex-wrap gap-y-2">${imagesHTML}</div>`;
			}
			container.setAttribute("data-count", count);
		}
	}

	// 主人不在覆蓋層
	document
		.getElementById("overlay-absent")
		?.classList.toggle(
			"hidden",
			!state.user_absent || isCameraHidden || isCameraError,
		);

	// ========================================================
	// 🛡️ 校正模式：嚴格防呆與 UI 互動引導
	// ========================================================
	const calibOverlay = document.getElementById("overlay-calib");

	if (state.mode === "CALIBRATION" && !isCameraHidden && !isCameraError) {
		calibOverlay.classList.remove("hidden");

		const calibIcon = document.getElementById("calib-icon");
		const calibTitle = document.getElementById("calib-title");
		const calibDesc = document.getElementById("calib-desc");
		const calibBar = document.getElementById("calib-progress-bar");

		if (calibBar) calibBar.style.width = state.calibration_progress + "%";

		if (state.calibration_status === "POSTURE_BAD") {
			calibOverlay.classList.replace("bg-purple-50/95", "bg-red-50/95");
			if (calibIcon)
				calibIcon.className =
					"fa-solid fa-triangle-exclamation text-6xl text-red-500 mb-8 animate-bounce";
			if (calibTitle) {
				calibTitle.innerText = "⚠️ 姿勢不良，校正暫停";
				calibTitle.classList.replace("text-slate-800", "text-red-600");
			}
			if (calibDesc) {
				calibDesc.innerText = "請挺直腰背，確保雙肩水平！";
				calibDesc.classList.replace("text-slate-500", "text-red-400");
			}
			if (calibBar)
				calibBar.classList.replace("bg-purple-400", "bg-red-400");

			if (!isMuted && warningSound && warningSound.paused) {
				warningSound
					.play()
					.catch((e) => console.log("警告音效被阻擋", e));
			}
		} else {
			calibOverlay.classList.replace("bg-red-50/95", "bg-purple-50/95");
			if (calibIcon)
				calibIcon.className =
					"fa-solid fa-crosshairs text-6xl text-purple-400 mb-8 animate-spin";
			if (calibTitle) {
				calibTitle.innerText = "特徵校正中";
				calibTitle.classList.replace("text-red-600", "text-slate-800");
			}
			if (calibDesc) {
				calibDesc.innerText = "請正對鏡頭，保持雙肩水平並坐正";
				calibDesc.classList.replace("text-red-400", "text-slate-500");
			}
			if (calibBar)
				calibBar.classList.replace("bg-red-400", "bg-purple-400");

			if (warningSound && !warningSound.paused) {
				warningSound.pause();
				warningSound.currentTime = 0;
			}
		}
	} else {
		calibOverlay?.classList.add("hidden");
	}
	// ========================================================

	const isEx = state.mode.startsWith("EXERCISE");
	document
		.getElementById("overlay-exercise")
		?.classList.toggle("hidden", !isEx);
	if (isEx) {
		let rawTask = state.exercise_task;
		let enText = rawTask;
		let zhText = "伸展運動";

		if (rawTask && rawTask.includes("(") && rawTask.includes(")")) {
			let parts = rawTask.split("(");
			enText = parts[0].trim();
			zhText = parts[1].replace(")", "").trim();
		}
		const zht = document.getElementById("ex-title-zh");
		if (zht) zht.innerText = zhText;
		const ent = document.getElementById("ex-title-en");
		if (ent) ent.innerText = enText;
		const pgr = document.getElementById("ex-progress");
		if (pgr) pgr.innerText = state.exercise_progress.split("/")[0].trim();
		const sts = document.getElementById("ex-status");
		if (sts) sts.innerText = state.exercise_status;
	}

	function update(cid, vid, isAlert, text) {
		if (isCameraError || currentSystemLevel === "WARNING") isAlert = false;

		const c = document.getElementById(cid);
		const v = document.getElementById(vid);
		if (!c || !v) return;
		const icon = c.querySelector("i");

		if (isAlert) {
			c.classList.add("alert-pulse", "bubble-alert");
			v.classList.remove("text-slate-700");
			v.classList.add("text-red-500");
			v.innerText = text;
			if (icon) {
				icon.classList.remove("text-purple-300");
				icon.classList.add("text-red-400");
			}
		} else {
			c.classList.remove("alert-pulse", "bubble-alert");
			v.classList.remove("text-red-500");
			v.classList.add("text-slate-700");

			v.innerText =
				isCameraError || currentSystemLevel === "WARNING"
					? "---"
					: text;
			if (icon) {
				icon.classList.remove("text-red-400");
				icon.classList.add("text-purple-300");
			}
		}
	}

	update(
		"card-shoulders",
		"val-shoulders",
		state.shoulders === "UNEVEN",
		state.shoulders === "UNEVEN" ? "高低肩！" : "平衡",
	);
	update(
		"card-eyes",
		"val-eyes",
		state.eyes === "CLOSED",
		state.eyes === "CLOSED" ? "疲勞！" : "正常",
	);
	update(
		"card-mouth",
		"val-mouth",
		state.mouth === "YAWN/COVER",
		state.mouth === "YAWN/COVER" ? "打哈欠！" : "無",
	);
	update(
		"card-dist",
		"val-dist",
		state.distance === "TOO CLOSE",
		state.distance === "TOO CLOSE" ? "太近！" : "適中",
	);
	update(
		"card-light",
		"val-light",
		state.light === "TOO DARK",
		state.light === "TOO DARK" ? "太暗！" : "明亮",
	);
});

// ==========================================
// ⚙️ 其他 UI 與設定邏輯
// ==========================================
function openSettings() {
	const modal = document.getElementById("settings-modal");
	modal.classList.remove("hidden");
	setTimeout(() => modal.classList.remove("opacity-0"), 10);
}

function closeSettings() {
	const modal = document.getElementById("settings-modal");
	modal.classList.add("opacity-0");
	setTimeout(() => modal.classList.add("hidden"), 300);
}

function saveSettings(btnElement) {
	const url = document.getElementById("discord-webhook-input").value.trim();
	localStorage.setItem("discordWebhookUrl", url);
	socket.emit("update_discord_webhook", { url: url });

	const originalText = btnElement.innerText;
	btnElement.innerText = "已儲存！";
	btnElement.classList.replace("bg-purple-400", "bg-purple-500");

	setTimeout(() => {
		btnElement.innerText = originalText;
		btnElement.classList.replace("bg-purple-500", "bg-purple-400");
	}, 1000);
}

function setPomodoro(seconds, btn, isHeader = false) {
	isSettled = false;
	if (isPaused) togglePause();

	// 1. 更新「設定選單」內的按鈕 (維持原狀)
	const modalButtons = document.querySelectorAll("#timer-buttons button");
	modalButtons.forEach((b) => {
		b.className =
			"text-sm font-bold text-slate-600 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-all flex-grow text-center bubble-hover";
		const span = b.querySelector("span");
		if (span) span.className = "text-[10px] text-slate-400 font-normal";
	});

	if (seconds === 1500) {
		const modal25 = document.getElementById("btn-mode-25");
		if (modal25) {
			modal25.className =
				"btn-active text-sm font-bold text-purple-700 px-4 py-2.5 rounded-xl border border-purple-200 transition-all flex-grow text-center shadow-sm bubble-hover";
			const span = modal25.querySelector("span");
			if (span)
				span.className = "text-[10px] text-purple-600/80 font-normal";
		}
	} else if (seconds === 10) {
		const modal10 = document.getElementById("btn-mode-10");
		if (modal10) {
			modal10.className =
				"btn-active text-sm font-bold text-purple-700 px-4 py-2.5 rounded-xl border border-purple-200 transition-all flex-grow text-center shadow-sm bubble-hover";
			const span = modal10.querySelector("span");
			if (span)
				span.className = "text-[10px] text-purple-600/80 font-normal";
		}
	}

	// 2. 🌟 更新上方導覽列的「液態玻璃滑塊」與文字顏色
	const slider = document.getElementById("liquid-slider");
	const header25 = document.getElementById("btn-header-25m");
	const header10 = document.getElementById("btn-header-10s");

	if (slider && header25 && header10) {
		// 確保先清除顏色類別
		header25.classList.remove("text-white", "text-slate-500");
		header10.classList.remove("text-white", "text-slate-500");

		if (seconds === 1500) {
			// 滑塊歸位到左邊
			slider.style.width = header25.offsetWidth + "px";
			slider.style.transform = "translateX(0px)";
			// 變更文字顏色
			header25.classList.add("text-white");
			header10.classList.add("text-slate-500");
		} else if (seconds === 10) {
			// 滑塊滑動到右邊 (動態抓取左邊按鈕的寬度作為位移距離)
			slider.style.width = header10.offsetWidth + "px";
			slider.style.transform = `translateX(${header25.offsetWidth}px)`;
			// 變更文字顏色
			header10.classList.add("text-white");
			header25.classList.add("text-slate-500");
		}
	}

	document.getElementById("custom-work-mins").value = "";
	socket.emit("set_pomodoro_time", { seconds: seconds });
}

function applyCustomTimer() {
	const minsInput = document.getElementById("custom-work-mins").value;
	const mins = parseInt(minsInput);
	if (isNaN(mins) || mins <= 0) {
		alert("請輸入有效的專注時間！");
		return;
	}

	setPomodoro(mins * 60, null, false);

	const btnElement = document.getElementById("btn-apply-time");
	const originalText = btnElement.innerText;
	btnElement.innerText = "已套用！";
	btnElement.classList.replace("bg-purple-500", "bg-blue-400");
	setTimeout(() => {
		btnElement.innerText = originalText;
		btnElement.classList.replace("bg-blue-400", "bg-purple-500");
		closeSettings();
	}, 800);
}

// ==========================================
// 📊 雲端儀表板與報表邏輯
// ==========================================
function openDashboard() {
	const modal = document.getElementById("dashboard-modal");
	modal.classList.remove("hidden");
	setTimeout(() => modal.classList.remove("opacity-0"), 10);
	document.getElementById("chart-loading").classList.remove("hidden");
	document.getElementById("chart-container").classList.add("hidden");
	socket.emit("request_cloud_data");
}

function closeDashboard() {
	const modal = document.getElementById("dashboard-modal");
	modal.classList.add("opacity-0");
	setTimeout(() => modal.classList.add("hidden"), 300);
}

socket.on("cloud_data_response", function (res) {
	document.getElementById("chart-loading").classList.add("hidden");
	const container = document.getElementById("chart-container");
	container.classList.remove("hidden");

	if (res.error) {
		alert("獲取雲端資料失敗：" + res.error);
		return;
	}

	const rawData = res.data;
	if (!rawData || rawData.length === 0) {
		container.innerHTML =
			"<p class='text-center text-slate-500 mt-10 font-bold'>目前沒有任何雲端資料喔！</p>";
		return;
	}

	const aggregatedData = {};
	rawData.forEach((row) => {
		let dateKey = row.date.split("T")[0];

		if (!aggregatedData[dateKey]) {
			aggregatedData[dateKey] = {
				date: row.date,
				work_time: 0,
				eyes: 0,
				shoulders: 0,
				light: 0,
			};
		}
		aggregatedData[dateKey].work_time += row.work_time || 0;
		aggregatedData[dateKey].eyes += row.eyes || 0;
		aggregatedData[dateKey].shoulders += row.shoulders || 0;
		aggregatedData[dateKey].light += row.light || 0;
	});

	const mergedArray = Object.values(aggregatedData).sort(
		(a, b) => new Date(a.date) - new Date(b.date),
	);
	container.innerHTML = "";
	let htmlContent = `<div class="flex flex-col space-y-4 h-full pr-2 pb-4">`;
	const reversedData = mergedArray.reverse();

	reversedData.forEach((row) => {
		let d = new Date(row.date);
		let dateStr = d.getMonth() + 1 + "/" + d.getDate();
		let workMins = Math.round(row.work_time / 60);

		let batteryCount = Math.floor(workMins / 30);
		let batteryStr =
			batteryCount > 0
				? "🔋".repeat(Math.min(batteryCount, 12)) +
					(batteryCount > 12 ? "+" : "")
				: "🪫 <span class='text-xs text-slate-400'>(不到半小時)</span>";

		let starbucksCount = Math.floor(workMins / 60);
		let starbucksStr =
			starbucksCount > 0
				? "☕".repeat(Math.min(starbucksCount, 12)) +
					(starbucksCount > 12 ? "+" : "")
				: "💸 <span class='text-xs text-slate-400'>(還不夠買一杯)</span>";

		let eyesStr =
			row.eyes > 0
				? "💧".repeat(Math.min(row.eyes, 12)) +
					(row.eyes > 12 ? "+" : "")
				: "✨ <span class='text-xs text-emerald-500'>(無疲勞)</span>";

		let shouldersStr =
			row.shoulders > 0
				? "🧱".repeat(Math.min(row.shoulders, 12)) +
					(row.shoulders > 12 ? "+" : "")
				: "✨ <span class='text-xs text-emerald-500'>(姿勢端正)</span>";

		let lightStr =
			row.light > 0
				? "🕯️".repeat(Math.min(row.light, 12)) +
					(row.light > 12 ? "+" : "")
				: "✨ <span class='text-xs text-emerald-500'>(光線充足)</span>";

		htmlContent += `
			<div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 hover:border-purple-200 hover:shadow-md transition-all shrink-0">
				<div class="flex justify-between items-end mb-3 border-b border-slate-100 pb-2">
					<span class="font-bold text-purple-700 text-lg flex items-center gap-2">
						📅 ${dateStr}
					</span>
					<span class="text-xs text-slate-400 font-bold bg-slate-100 px-2 py-1 rounded-md">總計 ${workMins} 分鐘</span>
				</div>
				
				<div class="flex flex-col space-y-3">
					<div class="flex items-center">
						<span class="w-24 text-xs font-bold text-slate-500 shrink-0">⚡ 專注能量</span>
						<span class="text-lg tracking-[0.2em] break-all">${batteryStr}</span>
					</div>
					<div class="flex items-center">
						<span class="w-24 text-xs font-bold text-slate-500 shrink-0">☕ 星巴克產值</span>
						<span class="text-lg tracking-[0.2em] break-all">${starbucksStr}</span>
					</div>
					<div class="flex items-center">
						<span class="w-24 text-xs font-bold text-slate-500 shrink-0">👀 疲勞眼藥水</span>
						<span class="text-lg tracking-[0.2em] break-all">${eyesStr}</span>
					</div>
					<div class="flex items-center">
						<span class="w-24 text-xs font-bold text-slate-500 shrink-0">⚖️ 歪斜積木</span>
						<span class="text-lg tracking-[0.2em] break-all">${shouldersStr}</span>
					</div>
					<div class="flex items-center">
						<span class="w-24 text-xs font-bold text-slate-500 shrink-0">💡 摸黑點蠟燭</span>
						<span class="text-lg tracking-[0.2em] break-all">${lightStr}</span>
					</div>
				</div>
			</div>
		`;
	});

	htmlContent += `</div>`;
	container.innerHTML = htmlContent;
});

function sendReport(type) {
	const currentWebhook = localStorage.getItem("discordWebhookUrl") || "";
	if (!currentWebhook.startsWith("http")) {
		openWebhookPromptModal(
			type === "daily" ? "report_daily" : "report_weekly",
		);
		return;
	}

	document.getElementById("report-text-" + type).innerText = "發送中...";
	document.getElementById("btn-report-" + type).classList.add("opacity-50");
	socket.emit("request_discord_report", { type: type });
}

socket.on("report_status", function (data) {
	const rtype = data.type || "daily",
		btn = document.getElementById("btn-report-" + rtype);
	document.getElementById("report-text-" + rtype).innerText = data.success
		? "成功！"
		: "失敗";
	setTimeout(() => {
		document.getElementById("report-text-" + rtype).innerText =
			rtype === "daily" ? "發日報" : "發週報";
		btn.classList.remove("opacity-50");
	}, 3000);
});

function recalibrate() {
	socket.emit("request_recalibrate");
}

// ==========================================
// 🔄 重置計時器邏輯
// ==========================================
function openResetModal() {
	const modal = document.getElementById("reset-modal");
	modal.classList.remove("hidden");
	setTimeout(() => modal.classList.remove("opacity-0"), 10);
}

function closeResetModal() {
	const modal = document.getElementById("reset-modal");
	modal.classList.add("opacity-0");
	setTimeout(() => modal.classList.add("hidden"), 300);
}

function confirmReset() {
	socket.emit("set_pomodoro_time", { seconds: currentTargetTime });
	if (isPaused) {
		togglePause();
	}
	closeResetModal();
}

// ==========================================
// 🏁 結束結算邏輯
// ==========================================
function openSettleModal() {
	const modal = document.getElementById("settle-modal");
	document.getElementById("discord-sync-checkbox").checked = true;
	modal.classList.remove("hidden");
	setTimeout(() => modal.classList.remove("opacity-0"), 10);
}

function closeSettleModal() {
	const modal = document.getElementById("settle-modal");
	modal.classList.add("opacity-0");
	setTimeout(() => modal.classList.add("hidden"), 300);
}

function confirmSettle() {
	const syncDiscord = document.getElementById(
		"discord-sync-checkbox",
	).checked;
	const currentWebhook = localStorage.getItem("discordWebhookUrl") || "";

	if (syncDiscord && !currentWebhook.startsWith("http")) {
		closeSettleModal();
		openWebhookPromptModal("settle");
		return;
	}

	executeSettle(syncDiscord);
}

function executeSettle(syncDiscord) {
	if (syncDiscord) {
		sendReport("daily");
	}

	isSettled = true;

	if (!isPaused) {
		togglePause();
	}

	closeSettleModal();
	socket.emit("request_daily_settlement");
}

socket.on("daily_settlement_response", function (summary) {
	const evaluation = summary.evaluation;
	const alertTotal = Object.values(summary.alerts).reduce(
		(total, count) => total + count,
		0,
	);

	loadSettlementImage(evaluation.image_url);
	document.getElementById("settlement-title").innerText = evaluation.title;
	document.getElementById("settlement-comment").innerText = evaluation.comment;
	document.getElementById("settlement-advice").innerText = evaluation.advice;
	document.getElementById("settlement-work-time").innerText =
		summary.work_time.formatted;
	document.getElementById("settlement-pomodoros").innerText =
		summary.pomodoro_count;
	document.getElementById("settlement-cyber-time").innerText =
		summary.cyberloafing_minutes;
	document.getElementById("settlement-alerts").innerText = alertTotal;
	document.getElementById("settlement-starbucks-cups").innerText =
		summary.starbucks.cups;

	const detail = document.getElementById("settlement-starbucks-detail");
	if (summary.starbucks.cups > 0) {
		detail.innerText = `累積產值約 ${summary.starbucks.exact} 杯，每專注 60 分鐘換算 1 杯。`;
	} else if (summary.starbucks.remaining_minutes > 0) {
		detail.innerText = `再專注 ${summary.starbucks.remaining_minutes} 分鐘，就能解鎖第 1 杯。`;
	} else {
		detail.innerText = "每專注 60 分鐘換算 1 杯。";
	}

	openSettlementResult();
});

function loadSettlementImage(imageUrl) {
	const image = document.getElementById("settlement-image");
	const fallbackUrl = "/static/img/my_logo.png";
	image.src = imageUrl;

	setTimeout(() => {
		if (image.src === imageUrl && (!image.complete || image.naturalWidth === 0)) {
			image.src = fallbackUrl;
		}
	}, 1500);
}

function openSettlementResult() {
	const modal = document.getElementById("settlement-result-modal");
	const card = document.getElementById("settlement-result-card");
	createSettlementConfetti();
	modal.classList.remove("hidden");
	modal.classList.add("flex");
	requestAnimationFrame(() => {
		modal.classList.remove("opacity-0");
		card.classList.add("is-visible");
	});
}

function closeSettlementResult() {
	const modal = document.getElementById("settlement-result-modal");
	const card = document.getElementById("settlement-result-card");
	modal.classList.add("opacity-0");
	card.classList.remove("is-visible");
	setTimeout(() => {
		modal.classList.add("hidden");
		modal.classList.remove("flex");
		document.getElementById("settlement-confetti").innerHTML = "";
	}, 350);
}

function createSettlementConfetti() {
	const container = document.getElementById("settlement-confetti");
	const colors = ["#c084fc", "#818cf8", "#34d399", "#fbbf24", "#fb7185"];
	container.innerHTML = "";

	for (let i = 0; i < 36; i++) {
		const piece = document.createElement("span");
		piece.style.left = `${Math.random() * 100}%`;
		piece.style.backgroundColor = colors[i % colors.length];
		piece.style.animationDelay = `${Math.random() * 0.8}s`;
		piece.style.animationDuration = `${2.4 + Math.random() * 1.8}s`;
		piece.style.transform = `rotate(${Math.random() * 180}deg)`;
		container.appendChild(piece);
	}
}

// ==========================================
// 🔗 快速補填 Webhook 邏輯
// ==========================================
let pendingActionAfterWebhook = null;

function openWebhookPromptModal(actionType) {
	pendingActionAfterWebhook = actionType;
	const modal = document.getElementById("webhook-prompt-modal");
	document.getElementById("quick-webhook-input").value = "";

	const descText = document.getElementById("webhook-desc-text");
	const cancelBtn = document.getElementById("webhook-cancel-btn");
	const submitBtn = document.getElementById("webhook-submit-btn");

	if (actionType === "settle") {
		descText.innerText =
			"您勾選了發送報告，但尚未設定 Discord Webhook 網址喔！請在此補填：";
		cancelBtn.innerText = "取消結算";
		submitBtn.innerText = "儲存並結算";
	} else {
		const reportName = actionType === "report_daily" ? "日報" : "週報";
		descText.innerText = `您想要手動發送${reportName}，但尚未設定 Discord Webhook 網址喔！請在此補填：`;
		cancelBtn.innerText = "取消發送";
		submitBtn.innerText = "儲存並發送";
	}

	modal.classList.remove("hidden");
	setTimeout(() => modal.classList.remove("opacity-0"), 10);
}

function closeWebhookPromptModal() {
	const modal = document.getElementById("webhook-prompt-modal");
	modal.classList.add("opacity-0");
	setTimeout(() => modal.classList.add("hidden"), 300);
	setTimeout(() => {
		pendingActionAfterWebhook = null;
	}, 300);
}

function submitQuickWebhook() {
	const url = document.getElementById("quick-webhook-input").value.trim();

	if (!url.startsWith("http")) {
		alert("請輸入有效的 Discord Webhook 網址喔！");
		return;
	}

	localStorage.setItem("discordWebhookUrl", url);
	socket.emit("update_discord_webhook", { url: url });
	const settingsInput = document.getElementById("discord-webhook-input");
	if (settingsInput) {
		settingsInput.value = url;
	}

	closeWebhookPromptModal();

	if (pendingActionAfterWebhook === "settle") {
		executeSettle(true);
	} else if (pendingActionAfterWebhook === "report_daily") {
		sendReport("daily");
	} else if (pendingActionAfterWebhook === "report_weekly") {
		sendReport("weekly");
	}
}

// ==========================================
// 🔊 音量控制與記憶邏輯 (含測試音效播放)
// ==========================================
const volumeSlider = document.getElementById("volume-slider");
const volumeDisplay = document.getElementById("volume-display");
const testSound = document.getElementById("test-sound");
let currentVolume = 1.0;

const savedVolume = localStorage.getItem("pulseai_volume");
if (savedVolume !== null) {
	currentVolume = parseFloat(savedVolume);
	if (volumeSlider) volumeSlider.value = currentVolume;
	applyVolume(currentVolume);
}

function stopTestSound() {
	if (testSound && !testSound.paused) {
		testSound.pause();
		testSound.currentTime = 0;
	}
}

if (volumeSlider) {
	volumeSlider.addEventListener("input", function () {
		currentVolume = parseFloat(this.value);
		applyVolume(currentVolume);
		localStorage.setItem("pulseai_volume", currentVolume);

		if (!isMuted && testSound && testSound.paused) {
			testSound.play().catch((e) => console.log("測試音效播放失敗", e));
		}
	});

	volumeSlider.addEventListener("change", stopTestSound);
	volumeSlider.addEventListener("mouseup", stopTestSound);
	volumeSlider.addEventListener("touchend", stopTestSound);
}

function applyVolume(vol) {
	if (alertSound) alertSound.volume = vol;
	if (warningSound) warningSound.volume = vol;
	if (testSound) testSound.volume = vol;
	if (volumeDisplay) volumeDisplay.innerText = Math.round(vol * 100) + "%";
}

const originalToggleVoice = toggleVoice;
toggleVoice = function () {
	originalToggleVoice();
	stopTestSound();
	if (!isMuted) {
		applyVolume(currentVolume);
	}
};
