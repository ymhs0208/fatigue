(() => {
	"use strict";

	const LEFT_EYE = [33, 160, 158, 133, 153, 144];
	const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
	const MOUTH = [78, 13, 308, 14];
	const CALIBRATION_FRAMES = 60;
	const LIGHT_THRESHOLD = 60;

	const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
	const ratio = (points, verticalA, verticalB, horizontalA, horizontalB) => {
		const horizontal = distance(points[horizontalA], points[horizontalB]);
		return horizontal ? distance(points[verticalA], points[verticalB]) / horizontal : 0;
	};
	const eyeRatio = (landmarks, indexes) => {
		const points = indexes.map((index) => landmarks[index]);
		const horizontal = distance(points[0], points[3]);
		return horizontal
			? (distance(points[1], points[5]) + distance(points[2], points[4])) /
					(2 * horizontal)
			: 0;
	};
	const average = (values) =>
		values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
	const stats = (values) => {
		const mean = average(values);
		const variance = average(values.map((value) => (value - mean) ** 2));
		return [mean, Math.sqrt(variance)];
	};
	const ema = (value, previous, alpha = 0.3) =>
		previous == null ? value : alpha * value + (1 - alpha) * previous;

	class PulseVision {
		constructor(socket) {
			this.socket = socket;
			this.video = document.getElementById("camera-source");
			this.canvas = document.getElementById("video-stream");
			this.context = this.canvas.getContext("2d", { alpha: false });
			this.running = false;
			this.processing = false;
			this.lastFrameAt = performance.now();
			this.lastEmitAt = 0;
			this.faceResult = null;
			this.poseResult = null;
			this.handResult = null;
			this.resetRuntime();
			this.bindRoomEvents();
		}

		resetRuntime() {
			this.state = {
				mode: "CALIBRATION", work_time: 0, target_work_time: 1500,
				pomodoro_count: 0, daily_total_time: 0, user_absent: false,
				eyes: "OPEN", mouth: "NORMAL", distance: "GOOD", light: "GOOD",
				posture: "GOOD", shoulders: "BALANCED", calibration_progress: 0,
				calibration_status: "COLLECTING", exercise_task: "",
				exercise_progress: "", exercise_status: "",
				alert_counts: { eyes: 0, shoulders: 0, dist: 0, mouth: 0, light: 0 },
				is_paused: false, current_absent_time: 0, total_cyberloafing_time: 0,
				failed_pomodoros: 0, current_dark_time: 0, max_dark_time: 0,
			};
			this.calibration = { ear: [], mar: [], dist: [], shoulder: [], mouthWidth: [] };
			this.thresholds = { ear: 0.2, mar: 0.5, dist: 0.35, shoulder: 0, shoulderDev: 0.08, mouthWidth: 0.4 };
			this.ema = { ear: null, mar: null, dist: null, shoulder: null, mouthWidth: null };
			this.timers = { eyes: 0, shoulder: 0, dist: 0, mouth: 0 };
			this.previousAlerts = { eyes: "OPEN", shoulders: "BALANCED", dist: "GOOD", mouth: "NORMAL", light: "GOOD" };
			this.reps = { hand: 0, neck: 0, arm: 0 };
			this.motion = { fist: false, head: false, arms: false };
		}

		bindRoomEvents() {
			this.socket.on("recalibrate", () => this.recalibrate());
			this.socket.on("pomodoro_time_changed", ({ seconds }) => {
				this.state.target_work_time = seconds;
				this.state.work_time = 0;
			});
			this.socket.on("pause_changed", ({ paused }) => {
				this.state.is_paused = paused;
			});
		}

		async start() {
			if (!window.FaceMesh || !window.Hands || !window.Pose) {
				throw new Error("MediaPipe scripts failed to load");
			}
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
				audio: false,
			});
			this.video.srcObject = stream;
			await this.video.play();
			this.canvas.width = this.video.videoWidth || 640;
			this.canvas.height = this.video.videoHeight || 480;
			this.createModels();
			this.running = true;
			window.handleCameraSuccess?.();
			requestAnimationFrame(() => this.loop());
		}

		createModels() {
			const locate = (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
			this.faceMesh = new FaceMesh({ locateFile: locate });
			this.faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
			this.faceMesh.onResults((result) => { this.faceResult = result; });

			this.hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
			this.hands.setOptions({ maxNumHands: 2, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
			this.hands.onResults((result) => { this.handResult = result; });

			this.pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
			this.pose.setOptions({ modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
			this.pose.onResults((result) => { this.poseResult = result; });
		}

		async loop() {
			if (!this.running) return;
			if (!this.processing) {
				this.processing = true;
				try {
					await this.processFrame();
				} catch (error) {
					console.error("MediaPipe frame failed", error);
				} finally {
					this.processing = false;
				}
			}
			setTimeout(() => requestAnimationFrame(() => this.loop()), 80);
		}

		async processFrame() {
			const now = performance.now();
			const dt = Math.min((now - this.lastFrameAt) / 1000, 0.5);
			this.lastFrameAt = now;
			await this.faceMesh.send({ image: this.video });
			if (["WORK", "CALIBRATION", "EXERCISE_ARM"].includes(this.state.mode)) {
				await this.pose.send({ image: this.video });
			} else {
				this.poseResult = null;
			}
			if (this.state.mode === "EXERCISE_HAND") {
				await this.hands.send({ image: this.video });
			} else {
				this.handResult = null;
			}
			this.drawFrame();
			this.updateState(dt);
			window.lastDataTime = Date.now();
			if (now - this.lastEmitAt >= 100) {
				this.socket.emit("vision_state", this.state);
				this.lastEmitAt = now;
			}
		}

		drawFrame() {
			const ctx = this.context;
			ctx.save();
			ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			ctx.translate(this.canvas.width, 0);
			ctx.scale(-1, 1);
			ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
			if (this.faceResult?.multiFaceLandmarks?.[0]) {
				drawConnectors(ctx, this.faceResult.multiFaceLandmarks[0], FACEMESH_CONTOURS, { color: "#c084fc", lineWidth: 1 });
			}
			if (this.poseResult?.poseLandmarks) {
				drawConnectors(ctx, this.poseResult.poseLandmarks, POSE_CONNECTIONS, { color: "#a78bfa", lineWidth: 2 });
			}
			for (const hand of this.handResult?.multiHandLandmarks || []) {
				drawConnectors(ctx, hand, HAND_CONNECTIONS, { color: "#818cf8", lineWidth: 2 });
			}
			ctx.restore();
		}

		readLight() {
			const sample = document.createElement("canvas");
			sample.width = 32;
			sample.height = 24;
			const ctx = sample.getContext("2d", { willReadFrequently: true });
			ctx.drawImage(this.video, 0, 0, 32, 24);
			const pixels = ctx.getImageData(0, 0, 32, 24).data;
			let total = 0;
			for (let index = 0; index < pixels.length; index += 4) {
				total += 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
			}
			return total / (pixels.length / 4);
		}

		updateState(dt) {
			const face = this.faceResult?.multiFaceLandmarks?.[0];
			const pose = this.poseResult?.poseLandmarks;
			const light = this.readLight() >= LIGHT_THRESHOLD ? "GOOD" : "TOO DARK";
			this.transitionAlert("light", light, "TOO DARK");
			this.state.light = light;
			if (light === "TOO DARK") {
				this.state.current_dark_time += dt;
				this.state.max_dark_time = Math.max(this.state.max_dark_time, this.state.current_dark_time);
			} else {
				this.state.current_dark_time = 0;
			}

			this.state.user_absent = !face;
			if (!face) {
				this.state.current_absent_time += dt;
				if (this.state.current_absent_time > 120) {
					this.state.total_cyberloafing_time += dt;
					if (this.state.mode === "WORK" && this.state.work_time > 0) {
						this.state.work_time = 0;
						this.state.failed_pomodoros += 1;
					}
				}
				return;
			}
			this.state.current_absent_time = 0;

			const ear = (eyeRatio(face, LEFT_EYE) + eyeRatio(face, RIGHT_EYE)) / 2;
			const mouthPoints = MOUTH.map((index) => face[index]);
			const mar = ratio(mouthPoints, 1, 3, 0, 2);
			const iod = distance(face[33], face[263]);
			const mouthWidth = iod ? distance(mouthPoints[0], mouthPoints[2]) / iod : 0;
			const noseLeft = distance(face[1], face[234]);
			const noseRight = distance(face[1], face[454]);
			const headTurned = noseLeft && noseRight && (noseLeft / noseRight > 1.8 || noseLeft / noseRight < 0.55);
			let shoulder = 0;
			let validShoulders = false;
			if (pose) {
				const width = distance(pose[11], pose[12]);
				validShoulders = width > 0 && pose[11].visibility > 0.5 && pose[12].visibility > 0.5;
				shoulder = validShoulders ? (pose[11].y - pose[12].y) / width : 0;
			}

			if (this.state.mode === "CALIBRATION") {
				this.calibrate({ ear, mar, iod, shoulder, mouthWidth, headTurned, validShoulders });
			} else if (this.state.mode === "WORK") {
				this.work(dt, { ear, mar, iod, shoulder, mouthWidth });
			} else {
				this.exercise({ face, pose, headTurned });
			}
		}

		calibrate(data) {
			const valid = !data.headTurned && data.validShoulders && this.state.light === "GOOD" && Math.abs(data.shoulder) < 0.05;
			this.state.calibration_status = valid ? "COLLECTING" : "POSTURE_BAD";
			if (!valid) return;
			this.calibration.ear.push(data.ear);
			this.calibration.mar.push(data.mar);
			this.calibration.dist.push(data.iod);
			this.calibration.shoulder.push(data.shoulder);
			this.calibration.mouthWidth.push(data.mouthWidth);
			this.state.calibration_progress = Math.min(100, Math.round(this.calibration.ear.length / CALIBRATION_FRAMES * 100));
			if (this.calibration.ear.length < CALIBRATION_FRAMES) return;

			const [earMean, earStd] = stats(this.calibration.ear);
			const [marMean, marStd] = stats(this.calibration.mar);
			const [distMean, distStd] = stats(this.calibration.dist);
			const [shoulderMean, shoulderStd] = stats(this.calibration.shoulder);
			const [mouthMean, mouthStd] = stats(this.calibration.mouthWidth);
			this.thresholds = {
				ear: earMean - Math.max(4 * earStd, 0.05),
				mar: marMean + Math.max(5 * marStd, 0.35),
				dist: distMean + Math.max(5 * distStd, distMean * 0.15),
				shoulder: shoulderMean,
				shoulderDev: Math.max(3 * shoulderStd, 0.05),
				mouthWidth: mouthMean + Math.max(4 * mouthStd, 0.04),
			};
			this.state.mode = "WORK";
			this.state.work_time = 0;
		}

		work(dt, values) {
			if (this.state.is_paused) {
				this.resetHealthStatus();
				return;
			}
			this.state.work_time += dt;
			this.state.daily_total_time += dt;
			for (const key of ["ear", "mar", "shoulder", "mouthWidth"]) {
				this.ema[key] = ema(values[key], this.ema[key]);
			}
			this.ema.dist = ema(values.iod, this.ema.dist, 0.15);
			this.timedStatus("eyes", this.ema.ear < this.thresholds.ear, dt, 2, "CLOSED", "OPEN");
			this.timedStatus("shoulders", Math.abs(this.ema.shoulder - this.thresholds.shoulder) > this.thresholds.shoulderDev, dt, 1.5, "UNEVEN", "BALANCED");
			this.timedStatus("distance", this.ema.dist > this.thresholds.dist, dt, 1.5, "TOO CLOSE", "GOOD", "dist");
			this.timedStatus("mouth", this.ema.mar > this.thresholds.mar && this.ema.mouthWidth <= this.thresholds.mouthWidth, dt, 1.5, "YAWN/COVER", "NORMAL");
			if (this.state.work_time >= this.state.target_work_time) {
				this.state.mode = "EXERCISE_HAND";
				this.state.pomodoro_count += 1;
				this.reps.hand = 0;
				this.motion.fist = false;
			}
		}

		timedStatus(field, condition, dt, limit, alertValue, normalValue, timerKey = field) {
			this.timers[timerKey] = condition ? this.timers[timerKey] + dt : 0;
			const value = this.timers[timerKey] >= limit ? alertValue : normalValue;
			this.state[field] = value;
			this.transitionAlert(timerKey, value, alertValue);
		}

		transitionAlert(key, value, alertValue) {
			if (value === alertValue && this.previousAlerts[key] !== alertValue) {
				this.state.alert_counts[key] += 1;
			}
			this.previousAlerts[key] = value;
		}

		exercise({ face, pose, headTurned }) {
			if (this.state.mode === "EXERCISE_HAND") {
				this.state.exercise_task = "Knuckle Stretch (雙手握拳伸展)";
				this.state.exercise_progress = `${this.reps.hand} / 5`;
				const hands = this.handResult?.multiHandLandmarks || [];
				const fists = hands.filter((hand) => this.isFist(hand)).length;
				if (hands.length === 2 && fists === 2) {
					this.state.exercise_status = "BOTH FISTS (現在請張開!)";
					this.motion.fist = true;
				} else if (hands.length === 2 && fists === 0) {
					this.state.exercise_status = "BOTH OPEN (現在請闔上!)";
					if (this.motion.fist) this.reps.hand += 1;
					this.motion.fist = false;
				} else {
					this.state.exercise_status = "請將雙手舉起放入畫面";
				}
				if (this.reps.hand >= 5) this.state.mode = "EXERCISE_NECK";
			} else if (this.state.mode === "EXERCISE_NECK") {
				this.state.exercise_task = "Neck Stretch (頭部左右轉動)";
				this.state.exercise_progress = `${this.reps.neck} / 5`;
				this.state.exercise_status = headTurned ? "TURNED (現在轉回正前方!)" : "CENTER (請左右轉動頭部!)";
				if (headTurned) this.motion.head = true;
				else if (this.motion.head) {
					this.reps.neck += 1;
					this.motion.head = false;
				}
				if (this.reps.neck >= 5) this.state.mode = "EXERCISE_ARM";
			} else if (this.state.mode === "EXERCISE_ARM") {
				this.state.exercise_task = "Arm Stretch (雙手向上伸展)";
				this.state.exercise_progress = `${this.reps.arm} / 5`;
				const armsUp = pose && pose[15].y < pose[11].y && pose[16].y < pose[12].y;
				this.state.exercise_status = armsUp ? "ARMS UP (現在請放下!)" : "ARMS DOWN (現在請雙手舉起!)";
				if (armsUp) this.motion.arms = true;
				else if (this.motion.arms) {
					this.reps.arm += 1;
					this.motion.arms = false;
				}
				if (this.reps.arm >= 5) {
					this.state.mode = "WORK";
					this.state.work_time = 0;
				}
			}
		}

		isFist(hand) {
			const wrist = hand[0];
			return [8, 12, 16, 20].filter((tip, index) =>
				distance(hand[tip], wrist) < distance(hand[[5, 9, 13, 17][index]], wrist)
			).length >= 3;
		}

		resetHealthStatus() {
			Object.assign(this.state, { eyes: "OPEN", shoulders: "BALANCED", distance: "GOOD", mouth: "NORMAL" });
			Object.assign(this.timers, { eyes: 0, shoulder: 0, dist: 0, mouth: 0 });
		}

		recalibrate() {
			const preserved = {
				target_work_time: this.state.target_work_time,
				daily_total_time: this.state.daily_total_time,
				pomodoro_count: this.state.pomodoro_count,
				alert_counts: this.state.alert_counts,
				total_cyberloafing_time: this.state.total_cyberloafing_time,
				failed_pomodoros: this.state.failed_pomodoros,
				max_dark_time: this.state.max_dark_time,
			};
			this.resetRuntime();
			Object.assign(this.state, preserved);
		}
	}

	window.startPulseVision = async (socket) => {
		if (window.pulseVision) return;
		window.pulseVision = new PulseVision(socket);
		await window.pulseVision.start();
	};
})();
