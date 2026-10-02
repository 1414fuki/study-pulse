const STORAGE_KEY = 'study-pulse-state-v1';
let timerInterval = null;
let alarmInterval = null;
let alarmSequenceCount = 0;
let alarmStopRequested = false;
let alarmToneTimers = [];
let alarmAudioElements = [];
let alarmVideoElement = null;

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
  subjects: ['英語', '数学', '国語'],
  logs: [],
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
  timerSubjectSelect: document.getElementById('timerSubjectSelect'),
  statsSummary: document.getElementById('statsSummary'),
  installButton: document.getElementById('installButton'),
  screenFeed: document.getElementById('screenFeed'),
  screenTabs: Array.from(document.querySelectorAll('.screen-tab')),
  featureScreens: Array.from(document.querySelectorAll('.feature-screen')),
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
      subjects: Array.isArray(parsed.subjects) && parsed.subjects.length ? parsed.subjects : defaultState.subjects,
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
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
  if (els.studyMinutesInput) els.studyMinutesInput.value = state.settings.studyMinutes;
  if (els.breakMinutesInput) els.breakMinutesInput.value = state.settings.breakMinutes;
  if (els.alarmType) els.alarmType.value = state.settings.alarmType;
  if (els.customSoundUrl) els.customSoundUrl.value = state.settings.customSoundUrl;
  if (els.videoUrlInput) els.videoUrlInput.value = state.settings.alarmVideoUrl;

  const subjects = [...new Set(state.subjects || [])];
  const renderSelect = (select, selectedValue, includePlaceholder = true) => {
    if (!select) return;
    const currentValue = selectedValue || '';
    const options = includePlaceholder ? ['<option value="">教科を選ぶ</option>'] : [];
    select.innerHTML = options.concat(subjects.map((subject) => `<option value="${escapeHtml(subject)}" ${subject === currentValue ? 'selected' : ''}>${escapeHtml(subject)}</option>`)).join('');
    if (!subjects.includes(currentValue) && currentValue) {
      select.value = currentValue;
    }
  };

  renderSelect(els.timerSubjectSelect, state.subjects[0] || '');

  if (els.alarmPreview) {
    if (state.settings.alarmVideoUrl) {
      els.alarmPreview.src = state.settings.alarmVideoUrl;
      els.alarmPreview.classList.remove('hidden');
    } else {
      els.alarmPreview.classList.add('hidden');
    }
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
  els.alarmStopButton.classList.toggle('hidden', !active);
}

function stopAlarmSequence() {
  alarmStopRequested = true;

  alarmToneTimers.forEach((timer) => clearInterval(timer));
  alarmToneTimers = [];

  alarmAudioElements.forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (error) {
      // no-op
    }
  });
  alarmAudioElements = [];

  if (alarmVideoElement) {
    try {
      alarmVideoElement.pause();
    } catch (error) {
      // no-op
    }
    alarmVideoElement.remove();
    alarmVideoElement = null;
  }

  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  alarmSequenceCount = 0;
  updateAlarmControls();
}

function playAlarmVideo() {
  const videoUrl = state.settings.alarmVideoUrl;
  if (!videoUrl || alarmStopRequested) return;

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

  alarmVideoElement = overlay;
  overlay.play().catch(() => {});
  const timeout = setTimeout(() => {
    if (alarmVideoElement === overlay) {
      overlay.remove();
      alarmVideoElement = null;
    }
  }, 3500);
  alarmToneTimers.push(timeout);
}

function playAlarmSound() {
  if (alarmStopRequested) return;

  const type = state.settings.alarmType;
  if (type === 'custom' && state.settings.customSoundUrl) {
    const audio = new Audio(state.settings.customSoundUrl);
    audio.volume = 1;
    alarmAudioElements.push(audio);
    audio.play().catch(() => {});
  }

  playAlarmVideo();

  const pattern = [880, 660, 880, 660];
  let index = 0;
  const interval = setInterval(() => {
    if (alarmStopRequested) {
      clearInterval(interval);
      return;
    }
    playTone(pattern[index % pattern.length], 220);
    index += 1;
    if (index >= 12) clearInterval(interval);
  }, 260);
  alarmToneTimers.push(interval);
}

function startAlarmSequence() {
  alarmStopRequested = false;
  alarmSequenceCount = 0;
  if (alarmInterval) clearInterval(alarmInterval);

  playAlarmSound();
  updateAlarmControls();

  if (state.timer.mode === 'study') {
    alarmInterval = setInterval(() => {
      if (alarmStopRequested) {
        clearInterval(alarmInterval);
        alarmInterval = null;
        updateAlarmControls();
        return;
      }
      playAlarmSound();
    }, 5000);
    return;
  }

  alarmInterval = setInterval(() => {
    if (alarmStopRequested) {
      clearInterval(alarmInterval);
      alarmInterval = null;
      updateAlarmControls();
      return;
    }
    stopAlarmSequence();
  }, 5000);
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
  notifyUser(state.timer.mode === 'study' ? '勉強時間が終了しました。止めるまで継続中です。' : '休憩時間が終了しました。');

  const mode = state.timer.mode;
  const subject = (els.timerSubjectSelect?.value || '').trim() || '未分類';

  state.logs.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    title: mode === 'study' ? '勉強' : '休憩',
    durationMinutes: mode === 'study' ? state.settings.studyMinutes : state.settings.breakMinutes,
    subject,
    mode,
  });

  saveState();

  if (mode === 'study') {
    state.timer.running = false;
    state.timer.remainingSeconds = state.settings.studyMinutes * 60;
    updateTimerDisplay();
    saveState();
    return;
  }

  setTimerState('study');
  renderAll();
}

function addSubject(subjectName) {
  const subject = subjectName.trim();
  if (!subject) return null;
  const normalized = subject.replace(/\s+/g, '');
  if (!normalized) return null;

  if (!state.subjects.includes(subject)) {
    state.subjects.push(subject);
  }
  saveState();
  return subject;
}

function getDailyStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const studyToday = state.logs.filter((entry) => entry.mode === 'study' && new Date(entry.at) >= today);
  const totalStudy = state.logs.filter((entry) => entry.mode === 'study');

  const bySubject = {};
  totalStudy.forEach((entry) => {
    const subject = entry.subject || '未分類';
    bySubject[subject] = (bySubject[subject] || 0) + Number(entry.durationMinutes || 0);
  });

  const allSubjects = [...new Set([...((state.subjects || []).map((subject) => String(subject).trim()).filter(Boolean)), ...Object.keys(bySubject)])];
  const subjectAverages = allSubjects.map((subject) => {
    const entries = totalStudy.filter((entry) => (entry.subject || '未分類') === subject);
    const totalMinutes = entries.reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
    const dateSet = new Set(entries.map((entry) => new Date(entry.at).toISOString().slice(0, 10)));

    return {
      subject,
      average: Math.round(totalMinutes / Math.max(dateSet.size, 1)),
    };
  });

  return {
    todayMinutes: studyToday.reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0),
    totalMinutes: totalStudy.reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0),
    subjectAverages,
  };
}

function renderStats() {
  if (!els.statsSummary) return;
  const summary = getDailyStats();

  const rows = [
    { label: '今日の勉強時間', value: `${summary.todayMinutes}分` },
    { label: '合計勉強時間', value: `${summary.totalMinutes}分` },
  ];

  const subjectCards = summary.subjectAverages.length
    ? summary.subjectAverages
        .map((item) => `<div class="stat-card"><span>${escapeHtml(item.subject)}</span><strong>${item.average}分</strong></div>`)
        .join('')
    : '<div class="stat-card"><span>教科</span><strong>データなし</strong></div>';

  els.statsSummary.innerHTML = rows
    .map((row) => `<div class="stat-card"><span>${row.label}</span><strong>${row.value}</strong></div>`)
    .join('') + subjectCards;
}

function goToScreen(target) {
  const screenIndex = els.featureScreens.findIndex((screen) => screen.dataset.screen === target);
  if (screenIndex === -1) return;

  const nextScreen = els.featureScreens[screenIndex];
  nextScreen.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });

  els.screenTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.target === target);
  });
}

function renderAll() {
  renderStats();
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
  if (els.studyMinutesInput) state.settings.studyMinutes = Number(els.studyMinutesInput.value) || 25;
  if (els.breakMinutesInput) state.settings.breakMinutes = Number(els.breakMinutesInput.value) || 5;
  if (els.alarmType) state.settings.alarmType = els.alarmType.value;
  if (els.customSoundUrl) state.settings.customSoundUrl = els.customSoundUrl.value.trim();
  if (els.videoUrlInput) state.settings.alarmVideoUrl = els.videoUrlInput.value.trim();

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

  if (els.alarmStopButton) {
    els.alarmStopButton.addEventListener('click', () => {
      stopAlarmSequence();
    });
  }

  els.screenTabs.forEach((tab) => {
    tab.addEventListener('click', () => goToScreen(tab.dataset.target));
  });

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
