const STORAGE_KEY = 'study-pulse-state-v1';
let timerInterval = null;
let alarmInterval = null;
let currentRange = 'day';
let currentLogFilter = 'all';
let pendingReflection = null;
let alarmSequenceCount = 0;
let alarmStopRequested = false;

const defaultState = {
  settings: {
    studyMinutes: 25,
    breakMinutes: 5,
    alarmType: 'beep',
    customSoundUrl: '',
    alarmVideoUrl: '',
  },
  timer: {
    mode: 'study',
    remainingSeconds: 25 * 60,
    running: false,
    startedAt: null,
    lastUpdatedAt: Date.now(),
  },
  tasks: [
    { id: crypto.randomUUID(), text: '英単語 10個', done: false, createdAt: Date.now() },
    { id: crypto.randomUUID(), text: '数学 1問復習', done: true, createdAt: Date.now() },
  ],
  routines: [
    { id: crypto.randomUUID(), name: '英語', start: '19:00', end: '19:25', type: 'daily', enabled: true },
    { id: crypto.randomUUID(), name: '数学', start: '20:00', end: '20:25', type: 'today', enabled: true },
  ],
  logs: [],
  reflections: [],
};

const state = loadState();
const els = {
  modeBadge: document.getElementById('modeBadge'),
  timerDisplay: document.getElementById('timerDisplay'),
  studyMinutesInput: document.getElementById('studyMinutesInput'),
  breakMinutesInput: document.getElementById('breakMinutesInput'),
  startPauseButton: document.getElementById('startPauseButton'),
  switchModeButton: document.getElementById('switchModeButton'),
  resetButton: document.getElementById('resetButton'),
  alarmStopButton: document.getElementById('alarmStopButton'),
  focusInput: document.getElementById('focusInput'),
  taskPresetSelector: document.getElementById('taskPresetSelector'),
  pickTaskButton: document.getElementById('pickTaskButton'),
  taskForm: document.getElementById('taskForm'),
  taskInput: document.getElementById('taskInput'),
  taskList: document.getElementById('taskList'),
  routineList: document.getElementById('routineList'),
  addRoutineButton: document.getElementById('addRoutineButton'),
  summaryStats: document.getElementById('summaryStats'),
  logList: document.getElementById('logList'),
  chartCanvas: document.getElementById('chartCanvas'),
  alarmType: document.getElementById('alarmType'),
  customSoundUrl: document.getElementById('customSoundUrl'),
  audioFileInput: document.getElementById('audioFileInput'),
  videoFileInput: document.getElementById('videoFileInput'),
  videoUrlInput: document.getElementById('videoUrlInput'),
  alarmPreview: document.getElementById('alarmPreview'),
  testAlarmButton: document.getElementById('testAlarmButton'),
  clearDataButton: document.getElementById('clearDataButton'),
  reflectionModal: document.getElementById('reflectionModal'),
  reflectionForm: document.getElementById('reflectionForm'),
  completionStatus: document.getElementById('completionStatus'),
  nextMinutes: document.getElementById('nextMinutes'),
  nextSubject: document.getElementById('nextSubject'),
  reflectionNote: document.getElementById('reflectionNote'),
  closeReflectionButton: document.getElementById('closeReflectionButton'),
  installButton: document.getElementById('installButton'),
};

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(defaultState);

  try {
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...(parsed.settings || {}) },
      timer: { ...defaultState.timer, ...(parsed.timer || {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : defaultState.tasks,
      routines: Array.isArray(parsed.routines) ? parsed.routines : defaultState.routines,
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      reflections: Array.isArray(parsed.reflections) ? parsed.reflections : [],
    };
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function applyModeStyles() {
  const isStudy = state.timer.mode === 'study';
  document.body.classList.toggle('mode-study', isStudy);
  document.body.classList.toggle('mode-break', !isStudy);

  els.modeBadge.textContent = isStudy ? '勉強中' : '休憩中';
  els.modeBadge.classList.toggle('mode-study', isStudy);
  els.modeBadge.classList.toggle('mode-break', !isStudy);

  els.switchModeButton.textContent = isStudy ? '休憩へ' : '勉強へ';
  document.documentElement.style.setProperty('--theme-color', isStudy ? '#d94747' : '#2aae74');

  if (navigator?.vibrate) {
    navigator.vibrate(isStudy ? [120, 60, 120] : [80, 40, 80]);
  }

  updateAlarmControls();
}

function updateTimerDisplay() {
  els.timerDisplay.textContent = formatTime(state.timer.remainingSeconds);
  els.startPauseButton.textContent = state.timer.running ? '一時停止' : '開始';
}

function syncSettingsInputs() {
  els.studyMinutesInput.value = state.settings.studyMinutes;
  els.breakMinutesInput.value = state.settings.breakMinutes;
  els.alarmType.value = state.settings.alarmType;
  els.customSoundUrl.value = state.settings.customSoundUrl;
  els.videoUrlInput.value = state.settings.alarmVideoUrl;

  if (state.settings.alarmVideoUrl) {
    els.alarmPreview.src = state.settings.alarmVideoUrl;
    els.alarmPreview.classList.remove('hidden');
  } else {
    els.alarmPreview.classList.add('hidden');
  }
}

function ensureTimerRemainingMatchesMode() {
  const minutes = state.timer.mode === 'study' ? state.settings.studyMinutes : state.settings.breakMinutes;
  state.timer.remainingSeconds = Math.max(0, minutes * 60);
}

function setTimerState(mode) {
  state.timer.mode = mode;
  state.timer.running = false;
  clearInterval(timerInterval);
  timerInterval = null;
  state.timer.lastUpdatedAt = Date.now();
  ensureTimerRemainingMatchesMode();
  updateTimerDisplay();
  applyModeStyles();
  saveState();
}

function notifyUser(message) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Study Pulse', { body: message, icon: './manifest.json' });
  }
}

function playTone(freq = 880, duration = 220) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  const context = new AudioCtx();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = freq;
  gain.gain.value = 0.18;

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration / 1000);

  setTimeout(() => context.close(), duration + 60);
}

function updateAlarmControls() {
  const active = !!alarmInterval;
  const shouldShow = active && alarmSequenceCount < 5;
  els.alarmStopButton.classList.toggle('hidden', !shouldShow);
}

function stopAlarmSequence() {
  alarmStopRequested = true;
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  alarmSequenceCount = 0;
  updateAlarmControls();
}

function playAlarmVideo() {
  const videoUrl = state.settings.alarmVideoUrl;
  if (!videoUrl) return;

  const overlay = document.getElementById('alarmVideoOverlay') || document.createElement('video');
  overlay.id = 'alarmVideoOverlay';
  overlay.src = videoUrl;
  overlay.playsInline = true;
  overlay.muted = false;
  overlay.loop = true;
  overlay.autoplay = true;
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.objectFit = 'cover';
  overlay.style.zIndex = '90';
  overlay.style.background = '#000';

  if (!overlay.parentNode) {
    document.body.appendChild(overlay);
  }

  overlay.play().catch(() => {});
  setTimeout(() => {
    overlay.remove();
  }, 3500);
}

function playAlarmSound() {
  const type = state.settings.alarmType;
  if (type === 'custom' && state.settings.customSoundUrl) {
    const audio = new Audio(state.settings.customSoundUrl);
    audio.volume = 1;
    audio.play().catch(() => {});
  }

  playAlarmVideo();

  const pattern = [880, 660, 880, 660];
  let index = 0;
  const interval = setInterval(() => {
    playTone(pattern[index % pattern.length], 220);
    index += 1;
    if (index >= 12) clearInterval(interval);
  }, 260);
}

function startAlarmSequence() {
  alarmStopRequested = false;
  alarmSequenceCount = 0;
  if (alarmInterval) clearInterval(alarmInterval);

  const trigger = () => {
    if (alarmStopRequested) return;
    alarmSequenceCount += 1;
    playAlarmSound();
    updateAlarmControls();

    if (alarmSequenceCount >= 5) {
      const continueLoop = setInterval(() => {
        if (alarmStopRequested) {
          clearInterval(continueLoop);
          return;
        }
        playAlarmSound();
      }, 30000);
      if (alarmInterval) clearInterval(alarmInterval);
      alarmInterval = continueLoop;
      updateAlarmControls();
    }
  };

  trigger();
  alarmInterval = setInterval(() => {
    if (alarmStopRequested) {
      clearInterval(alarmInterval);
      alarmInterval = null;
      updateAlarmControls();
      return;
    }
    trigger();
  }, 5000);
  updateAlarmControls();
}

function startTimer() {
  if (state.timer.running) {
    state.timer.running = false;
    clearInterval(timerInterval);
    timerInterval = null;
    state.timer.lastUpdatedAt = Date.now();
    updateTimerDisplay();
    saveState();
    return;
  }

  state.timer.running = true;
  state.timer.lastUpdatedAt = Date.now();
  timerInterval = setInterval(() => {
    if (!state.timer.running) return;

    const before = state.timer.remainingSeconds;
    state.timer.remainingSeconds = Math.max(0, state.timer.remainingSeconds - 1);
    state.timer.lastUpdatedAt = Date.now();
    updateTimerDisplay();
    saveState();

    if (before > 0 && state.timer.remainingSeconds === 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      state.timer.running = false;
      handleTimerComplete();
    }
  }, 1000);

  updateTimerDisplay();
  saveState();
}

function handleTimerComplete() {
  startAlarmSequence();
  notifyUser(state.timer.mode === 'study' ? '勉強時間が終了しました。振り返りを残してください。' : '休憩時間が終了しました。');

  const mode = state.timer.mode;
  const subject = state.tasks[0]?.text || '学習';

  state.logs.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    title: mode === 'study' ? '勉強' : '休憩',
    durationMinutes: mode === 'study' ? state.settings.studyMinutes : state.settings.breakMinutes,
    subject,
    status: 'pending',
    mode,
  });

  saveState();

  if (mode === 'study') {
    pendingReflection = {
      startedAt: Date.now(),
      subject,
    };
    els.reflectionModal.classList.remove('hidden');
    els.nextMinutes.value = state.settings.studyMinutes;
    els.nextSubject.value = subject;
  } else {
    setTimerState('study');
  }

  renderAll();
}

function closeReflection() {
  els.reflectionModal.classList.add('hidden');
  pendingReflection = null;
  stopAlarmSequence();
}

function registerReflection(event) {
  event.preventDefault();

  const selected = document.querySelector('input[name="understanding"]:checked');
  const status = els.completionStatus.value;
  const note = els.reflectionNote.value.trim();
  const minutes = Number(els.nextMinutes.value) || state.settings.studyMinutes;
  const subject = els.nextSubject.value.trim() || '未設定';

  const lastLog = [...state.logs].reverse().find((entry) => entry.mode === 'study' && entry.status === 'pending');
  if (lastLog) {
    lastLog.status = status === 'yes' ? 'yes' : 'no';
    lastLog.reflect = {
      understanding: selected ? Number(selected.value) : 2,
      note,
      nextMinutes: minutes,
      nextSubject: subject,
      savedAt: Date.now(),
    };
  }

  state.reflections.push({
    id: crypto.randomUUID(),
    status,
    understanding: selected ? Number(selected.value) : 2,
    note,
    nextMinutes: minutes,
    nextSubject: subject,
    createdAt: Date.now(),
  });

  saveState();
  closeReflection();
  setTimerState('break');
  renderAll();
}

function addTask(text, forceChecked = false) {
  const value = text.trim();
  if (!value) return;

  const existing = state.tasks.find((task) => task.text === value);
  if (existing) {
    existing.done = forceChecked || existing.done;
    saveState();
    renderAll();
    return;
  }

  state.tasks.unshift({
    id: crypto.randomUUID(),
    text: value,
    done: forceChecked,
    createdAt: Date.now(),
  });
  saveState();
  renderAll();
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.done = !task.done;
  saveState();
  renderTasks();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((item) => item.id !== id);
  saveState();
  renderTasks();
}

function renderTasks() {
  els.taskList.innerHTML = '';

  state.tasks.forEach((task) => {
    const item = document.createElement('li');
    item.className = `task-item ${task.done ? 'checked' : ''}`;
    item.innerHTML = `
      <input type="checkbox" ${task.done ? 'checked' : ''} />
      <span class="task-text">${escapeHtml(task.text)}</span>
      <button type="button" class="mini-btn delete-task" data-id="${task.id}">削除</button>
    `;

    const checkbox = item.querySelector('input');
    checkbox.addEventListener('change', () => toggleTask(task.id));

    item.querySelector('.delete-task').addEventListener('click', () => deleteTask(task.id));
    els.taskList.appendChild(item);
  });

  renderPresetSelector();
}

function renderPresetSelector() {
  els.taskPresetSelector.innerHTML = '<option value="">今日のやることから選ぶ</option>';

  state.tasks.forEach((task) => {
    const option = document.createElement('option');
    option.value = task.text;
    option.textContent = task.text;
    els.taskPresetSelector.appendChild(option);
  });
}

function addRoutine() {
  const name = prompt('ルーティン名を入力してください', '読書');
  if (!name) return;

  state.routines.push({
    id: crypto.randomUUID(),
    name: name.trim(),
    start: '09:00',
    end: '09:25',
    type: 'daily',
    enabled: true,
  });
  saveState();
  renderRoutines();
}

function deleteRoutine(id) {
  state.routines = state.routines.filter((routine) => routine.id !== id);
  saveState();
  renderRoutines();
}

function toggleRoutine(id) {
  const routine = state.routines.find((item) => item.id === id);
  if (!routine) return;
  routine.enabled = !routine.enabled;
  saveState();
  renderRoutines();
}

function changeRoutine(id, field, value) {
  const routine = state.routines.find((item) => item.id === id);
  if (!routine) return;
  routine[field] = value;
  saveState();
  renderRoutines();
}

function renderRoutines() {
  els.routineList.innerHTML = '';
  state.routines.forEach((routine) => {
    const item = document.createElement('li');
    item.className = 'routine-item';
    item.innerHTML = `
      <div class="routine-top">
        <div>
          <strong>${escapeHtml(routine.name)}</strong>
          <div class="routine-meta">${escapeHtml(routine.start)} - ${escapeHtml(routine.end)}</div>
        </div>
        <div class="routine-actions">
          <button type="button" class="mini-btn toggle-routine" data-id="${routine.id}">${routine.enabled ? '有効' : '無効'}</button>
          <button type="button" class="mini-btn delete-routine" data-id="${routine.id}">削除</button>
        </div>
      </div>
      <div class="routine-meta">
        <label>種類
          <select data-field="type" data-id="${routine.id}">
            <option value="daily" ${routine.type === 'daily' ? 'selected' : ''}>毎日</option>
            <option value="today" ${routine.type === 'today' ? 'selected' : ''}>今日だけ</option>
            <option value="weekly" ${routine.type === 'weekly' ? 'selected' : ''}>曜日ごと</option>
          </select>
        </label>
      </div>
      <div class="routine-meta">
        <label>開始 <input type="time" value="${routine.start}" data-field="start" data-id="${routine.id}" /></label>
        <label>終了 <input type="time" value="${routine.end}" data-field="end" data-id="${routine.id}" /></label>
      </div>
    `;

    item.querySelector('.toggle-routine').addEventListener('click', () => toggleRoutine(routine.id));
    item.querySelector('.delete-routine').addEventListener('click', () => deleteRoutine(routine.id));

    item.querySelectorAll('input, select').forEach((control) => {
      control.addEventListener('change', (event) => {
        const field = event.target.dataset.field;
        const id = event.target.dataset.id;
        changeRoutine(id, field, event.target.value);
      });
    });

    els.routineList.appendChild(item);
  });
}

function getRangeDates() {
  const now = new Date();
  const start = new Date(now);

  if (currentRange === 'day') {
    start.setHours(0, 0, 0, 0);
  }
  if (currentRange === 'week') {
    const day = start.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);
  }
  if (currentRange === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  if (currentRange === 'quarter') {
    start.setMonth(start.getMonth() - 2);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  return { start, end: new Date() };
}

function renderStats() {
  const { start, end } = getRangeDates();
  const logs = state.logs.filter((entry) => {
    const at = new Date(entry.at);
    return at >= start && at <= end;
  });

  const totalMinutes = logs
    .filter((entry) => entry.mode === 'study')
    .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);

  const bySubject = {};
  logs.filter((entry) => entry.mode === 'study').forEach((entry) => {
    const subject = entry.subject || '未分類';
    bySubject[subject] = (bySubject[subject] || 0) + Number(entry.durationMinutes || 0);
  });

  const successful = logs.filter((entry) => entry.status === 'yes').length;
  const failed = logs.filter((entry) => entry.status === 'no').length;
  const averageMinutes = logs.length ? Math.round(totalMinutes / Math.max(1, (logs.filter((entry) => entry.mode === 'study')).length)) : 0;

  const cards = [
    { label: '総勉強時間', value: `${totalMinutes}分` },
    { label: '1日平均', value: `${averageMinutes}分` },
    { label: '達成', value: `${successful}件` },
    { label: '未達成', value: `${failed}件` },
  ];

  els.summaryStats.innerHTML = cards
    .map((card) => `<div class="stat-card"><span>${card.label}</span><strong>${card.value}</strong></div>`)
    .join('');

  drawChart(bySubject, logs, totalMinutes);
}

function drawChart(bySubject, logs, totalMinutes) {
  const canvas = els.chartCanvas;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  const colorMap = ['#d94747', '#f39c12', '#3b82f6', '#2aae74', '#8b5cf6', '#ff70a6'];
  const subjectNames = Object.keys(bySubject);

  if (currentRange === 'day' && subjectNames.length > 0) {
    let startAngle = -Math.PI / 2;
    subjectNames.forEach((subject, index) => {
      const ratio = bySubject[subject] / Math.max(totalMinutes, 1);
      const endAngle = startAngle + ratio * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(width / 2, height / 2);
      ctx.arc(width / 2, height / 2, 58, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = colorMap[index % colorMap.length];
      ctx.fill();
      startAngle = endAngle;
    });

    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    return;
  }

  const days = [];
  const lastSeven = currentRange === 'week' ? 7 : currentRange === 'month' ? 30 : 90;
  for (let i = 0; i < lastSeven; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.unshift(d);
  }

  const dayTotals = days.map((day) => {
    let total = 0;
    logs.forEach((entry) => {
      if (entry.mode === 'study') {
        const date = new Date(entry.at);
        if (date.toDateString() === day.toDateString()) total += Number(entry.durationMinutes || 0);
      }
    });
    return total;
  });

  const chartMax = Math.max(...dayTotals, 1);
  const chartWidth = width - 30;
  const step = chartWidth / Math.max(dayTotals.length, 1);

  dayTotals.forEach((value, index) => {
    const barHeight = (value / chartMax) * 110;
    const x = 18 + index * step + 4;
    const y = 145 - barHeight;
    ctx.fillStyle = '#4f7bf7';
    ctx.fillRect(x, y, Math.max(8, step - 10), barHeight);
  });
}

function renderLogs() {
  const logs = [...state.logs].reverse();
  const filtered = logs.filter((log) => {
    if (currentLogFilter === 'yes') return log.status === 'yes';
    if (currentLogFilter === 'no') return log.status === 'no';
    return true;
  });

  els.logList.innerHTML = '';
  filtered.slice(0, 20).forEach((log) => {
    const item = document.createElement('li');
    item.className = 'log-item';
    item.dataset.status = log.status === 'yes' ? 'yes' : log.status === 'no' ? 'no' : 'pending';
    item.innerHTML = `
      <div><strong>${escapeHtml(log.title)}</strong> · ${escapeHtml(log.subject || '未分類')}</div>
      <div class="log-meta">${new Date(log.at).toLocaleString()} · ${Number(log.durationMinutes || 0)}分</div>
      <div class="log-meta">${log.status === 'yes' ? 'Yes' : log.status === 'no' ? 'No' : '未回答'}</div>
    `;
    els.logList.appendChild(item);
  });
}

function renderAll() {
  renderTasks();
  renderRoutines();
  renderStats();
  renderLogs();
  syncSettingsInputs();
  updateTimerDisplay();
  applyModeStyles();
}

function resetTimer() {
  clearInterval(timerInterval);
  state.timer.running = false;
  timerInterval = null;
  state.timer.remainingSeconds = state.timer.mode === 'study' ? state.settings.studyMinutes * 60 : state.settings.breakMinutes * 60;
  updateTimerDisplay();
  saveState();
}

function adjustSettingsFromInputs() {
  state.settings.studyMinutes = Number(els.studyMinutesInput.value) || 25;
  state.settings.breakMinutes = Number(els.breakMinutesInput.value) || 5;
  state.settings.alarmType = els.alarmType.value;
  state.settings.customSoundUrl = els.customSoundUrl.value.trim();
  state.settings.alarmVideoUrl = els.videoUrlInput.value.trim();

  if (state.timer.mode === 'study') {
    state.timer.remainingSeconds = state.settings.studyMinutes * 60;
  } else {
    state.timer.remainingSeconds = state.settings.breakMinutes * 60;
  }

  saveState();
  renderAll();
}

function clearAllData() {
  const ok = window.confirm('すべてのデータを削除しますか？');
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  Object.assign(state, structuredClone(defaultState));
  renderAll();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function registerInstallPrompt() {
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    els.installButton.classList.remove('hidden');
  });

  els.installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.installButton.classList.add('hidden');
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

function bindEvents() {
  els.startPauseButton.addEventListener('click', startTimer);
  els.resetButton.addEventListener('click', resetTimer);
  els.switchModeButton.addEventListener('click', () => {
    const nextMode = state.timer.mode === 'study' ? 'break' : 'study';
    setTimerState(nextMode);
  });

  els.taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = els.focusInput.value.trim() || els.taskInput.value.trim();
    if (value) {
      addTask(value, true);
    }
    els.taskInput.value = '';
    els.focusInput.value = '';
  });

  els.pickTaskButton.addEventListener('click', () => {
    const selected = els.taskPresetSelector.value;
    if (!selected) return;
    addTask(selected, true);
    els.taskPresetSelector.value = '';
  });

  els.alarmStopButton.addEventListener('click', () => {
    stopAlarmSequence();
  });

  els.addRoutineButton.addEventListener('click', addRoutine);

  document.querySelectorAll('.range-btn').forEach((button) => {
    button.addEventListener('click', () => {
      currentRange = button.dataset.range;
      document.querySelectorAll('.range-btn').forEach((btn) => btn.classList.toggle('active', btn === button));
      renderStats();
    });
  });

  document.querySelectorAll('.log-btn').forEach((button) => {
    button.addEventListener('click', () => {
      currentLogFilter = button.dataset.logFilter;
      document.querySelectorAll('.log-btn').forEach((btn) => btn.classList.toggle('active', btn === button));
      renderLogs();
    });
  });

  els.studyMinutesInput.addEventListener('change', adjustSettingsFromInputs);
  els.breakMinutesInput.addEventListener('change', adjustSettingsFromInputs);
  els.alarmType.addEventListener('change', adjustSettingsFromInputs);
  els.customSoundUrl.addEventListener('change', adjustSettingsFromInputs);
  els.videoUrlInput.addEventListener('change', adjustSettingsFromInputs);

  els.audioFileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const dataUrl = await fileToDataUrl(file);
    state.settings.customSoundUrl = dataUrl;
    state.settings.alarmType = 'custom';
    saveState();
    renderAll();
    playAlarmSound();
  });

  els.videoFileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const dataUrl = await fileToDataUrl(file);
    state.settings.alarmVideoUrl = dataUrl;
    saveState();
    renderAll();
    playAlarmVideo();
  });

  els.testAlarmButton.addEventListener('click', () => {
    playAlarmSound();
    notifyUser('アラーム音をテスト再生しました');
  });

  els.clearDataButton.addEventListener('click', clearAllData);
  els.reflectionForm.addEventListener('submit', registerReflection);
  els.closeReflectionButton.addEventListener('click', closeReflection);

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function recoverTimerFromBackground() {
  if (!state.timer.running || !state.timer.lastUpdatedAt) return;

  const diffSeconds = Math.floor((Date.now() - state.timer.lastUpdatedAt) / 1000);
  if (diffSeconds <= 0) return;

  state.timer.remainingSeconds = Math.max(0, state.timer.remainingSeconds - diffSeconds);
  state.timer.lastUpdatedAt = Date.now();

  if (state.timer.remainingSeconds <= 0) {
    state.timer.running = false;
    handleTimerComplete();
  }

  saveState();
  updateTimerDisplay();
}

function initialize() {
  bindEvents();
  registerInstallPrompt();
  registerServiceWorker();
  ensureTimerRemainingMatchesMode();
  renderAll();
  updateTimerDisplay();
  applyModeStyles();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recoverTimerFromBackground();
  });

  window.addEventListener('focus', recoverTimerFromBackground);
  window.addEventListener('beforeunload', saveState);
}

initialize();
