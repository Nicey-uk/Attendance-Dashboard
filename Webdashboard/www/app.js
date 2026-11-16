/* ==========================================================================
   WDC Attendance System — ESP32-CAM RFID Frontend Logic (app.js)
   Vanilla JS, zero external dependencies, <40KB, works offline on hotspot
   ========================================================================== */

const App = (() => {
  // Default fallback data (matches /students.json & /schedule.json on SD card)
  const DEFAULT_STUDENTS = [
    { uid: 'A34F12B8', name: 'Amanda Kherr',       class: 'BSCS 3', section: 'Section A' },
    { uid: 'B29C4410', name: 'Angel Johnson',      class: 'BSCS 3', section: 'Section A' },
    { uid: 'E10A77D2', name: 'Alexander Kherr',    class: 'BSCS 3', section: 'Section A' },
    { uid: 'C41D88F1', name: 'Austin Kherr',       class: 'BSCS 3', section: 'Section A' },
    { uid: 'D52E99A3', name: 'Aada Kherr',         class: 'BSCS 3', section: 'Section A' },
    { uid: 'F63A11B4', name: 'Babak Kherr',        class: 'BSCS 3', section: 'Section A' },
    { uid: '774B22C5', name: 'Baha Johnson',       class: 'BSCS 3', section: 'Section A' },
    { uid: '885C33D6', name: 'Babette Kherr',      class: 'BSCS 3', section: 'Section A' },
    { uid: '996D44E7', name: 'Badan Kherr',        class: 'BSCS 3', section: 'Section B' },
    { uid: '107E55F8', name: 'Bailee Kherr',       class: 'BSCS 3', section: 'Section B' },
    { uid: '218F66A9', name: 'Carlos Mendoza',     class: 'BSIT 2', section: 'Section A' },
    { uid: '329A77B0', name: 'Camille Villanueva', class: 'BSIT 2', section: 'Section A' },
    { uid: '430B88C1', name: 'Juan Dela Cruz',     class: 'BSCS 3', section: 'Section A' },
    { uid: '541C99D2', name: 'Maria Santos',       class: 'BSCS 3', section: 'Section B' },
    { uid: '652D00E3', name: 'Mark Reyes',         class: 'BSIT 2', section: 'Section A' }
  ];

  const DEFAULT_SCHEDULE = [
    { id: 'sched-1', subject: 'Embedded Systems',    class: 'BSCS 3', section: 'Section A', day: 'Mon', start: '08:00', end: '10:00', room: 'Lab 301',   grace: 15, color: '#3F3FD0' },
    { id: 'sched-2', subject: 'IoT Architecture',    class: 'BSCS 3', section: 'Section B', day: 'Mon', start: '10:30', end: '12:30', room: 'Lab 302',   grace: 15, color: '#10C98F' },
    { id: 'sched-3', subject: 'Microcontrollers',    class: 'BSIT 2', section: 'Section A', day: 'Tue', start: '09:00', end: '11:00', room: 'Room 204',  grace: 15, color: '#F5A623' },
    { id: 'sched-4', subject: 'Embedded Systems',    class: 'BSCS 3', section: 'Section A', day: 'Wed', start: '08:00', end: '10:00', room: 'Lab 301',   grace: 15, color: '#3F3FD0' },
    { id: 'sched-5', subject: 'Data Communications', class: 'BSCS 3', section: 'Section A', day: 'Thu', start: '13:00', end: '15:00', room: 'Room 105',  grace: 15, color: '#E64980' },
    { id: 'sched-6', subject: 'Robotics & Sensors',  class: 'BSCS 3', section: 'Section A', day: 'Fri', start: '08:00', end: '11:00', room: 'Eng Lab 1', grace: 15, color: '#0CA678' },
    { id: 'sched-7', subject: 'Capstone Project',    class: 'BSCS 3', section: 'Section A', day: 'Sat', start: '09:00', end: '12:00', room: 'Lab 301',   grace: 15, color: '#7950F2' }
  ];

  const AVATAR_COLORS = [
    '#3F3FD0', '#10C98F', '#E64980', '#7950F2', '#0CA678',
    '#F59F00', '#1C7ED6', '#D6336C', '#4263EB', '#099268'
  ];

  // Application State
  const state = {
    currentPage: 'attendance',
    viewMode: 'grid', // 'grid' | 'list'
    selectedDate: getTodayPHT(),
    filters: {
      class: '',
      subject: '',
      section: ''
    },
    session: {
      active: false,
      class: '',
      subject: '',
      section: '',
      startedAt: ''
    },
    isEsp32Connected: false,
    students: [],
    schedule: [],
    attendanceRecords: [], // Current selected date student list with statuses
    localLogs: [],         // Used when previewing offline without ESP32 backend
    summaryData: null,
    lastUidTapMap: {},     // 60-second duplicate tap guard in demo mode
    refreshTimer: null
  };

  // Helper: Get current date in Philippine Time (GMT+8) as YYYY-MM-DD
  function getTodayPHT() {
    const now = new Date();
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pht = new Date(utcMs + (8 * 3600000));
    const y = pht.getFullYear();
    const m = String(pht.getMonth() + 1).padStart(2, '0');
    const d = String(pht.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getNowTimePHT() {
    const now = new Date();
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    const pht = new Date(utcMs + (8 * 3600000));
    const hh = String(pht.getHours()).padStart(2, '0');
    const mm = String(pht.getMinutes()).padStart(2, '0');
    const ss = String(pht.getSeconds()).padStart(2, '0');
    return {
      clock: `${hh}:${mm}:${ss}`,
      hhmm: `${hh}:${mm}`,
      stamp: `${pht.getFullYear()}${String(pht.getMonth() + 1).padStart(2, '0')}${String(pht.getDate()).padStart(2, '0')}_${hh}${mm}${ss}`,
      dayShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][pht.getDay()],
      dayFull: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][pht.getDay()]
    };
  }

  function timeToMinutes(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return 0;
    const parts = hhmm.split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }

  function formatDatePretty(yyyyMmDd) {
    const parts = yyyyMmDd.split('-');
    if (parts.length !== 3) return yyyyMmDd;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const prefix = (yyyyMmDd === getTodayPHT()) ? 'Today ' : '';
    return `${prefix}${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function getInitials(name) {
    if (!name) return 'ST';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function getAvatarColor(uidOrName) {
    let hash = 0;
    const str = String(uidOrName || 'WDC');
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  // Generate an inline SVG portrait data URI so avatars look rich even offline
  function buildAvatarSvgDataUri(name, uid, photoFile) {
    const bg = getAvatarColor(uid || name);
    const initials = getInitials(name);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${bg}"/>
          <stop offset="100%" stop-color="#1E293B"/>
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="60" fill="url(#g)"/>
      <circle cx="60" cy="46" r="21" fill="rgba(255,255,255,0.22)"/>
      <path d="M22 108c6-22 21-33 38-33s32 11 38 33" fill="rgba(255,255,255,0.22)"/>
      <text x="60" y="67" text-anchor="middle" fill="#FFFFFF" font-family="Montserrat,Arial,sans-serif" font-weight="700" font-size="32">${initials}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // Build simulated QVGA camera capture SVG for modal preview when SD card photo isn't on disk
  function buildSimulatedQvgaSnapshot(student, dateStr, timeStr, photoFile) {
    const bg = getAvatarColor(student.uid || student.name);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">
      <rect width="320" height="240" fill="#0F172A"/>
      <circle cx="160" cy="100" r="44" fill="${bg}"/>
      <circle cx="160" cy="86" r="16" fill="#F8FAFC"/>
      <path d="M126 134c6-17 19-25 34-25s28 8 34 25" fill="#F8FAFC"/>
      <rect x="0" y="0" width="320" height="28" fill="rgba(0,0,0,0.55)"/>
      <text x="10" y="18" fill="#10C98F" font-family="monospace" font-size="11" font-weight="bold">OV2640 QVGA 320x240 &bull; ESP32-CAM</text>
      <rect x="0" y="204" width="320" height="36" fill="rgba(0,0,0,0.68)"/>
      <text x="10" y="220" fill="#FFFFFF" font-family="monospace" font-size="11">UID: ${student.uid} | ${student.name}</text>
      <text x="10" y="234" fill="#F5A623" font-family="monospace" font-size="10">${dateStr || state.selectedDate} ${timeStr || '--:--:--'} PHT | ${photoFile || 'SD_MMC'}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function resolvePhotoUrl(photoPath, name, uid) {
    if (!photoPath) return buildAvatarSvgDataUri(name, uid);
    let clean = photoPath.trim();
    if (clean.startsWith('/photos/')) clean = clean.substring(8);
    else if (clean.startsWith('/')) clean = clean.substring(1);
    if (state.isEsp32Connected) {
      return `/photo?f=${encodeURIComponent(clean)}`;
    }
    return buildAvatarSvgDataUri(name, uid, clean);
  }

  // Seed initial demo attendance logs so offline browser preview matches screenshot immediately
  function initLocalSeedLogs() {
    const today = getTodayPHT();
    state.localLogs = [
      { uid: 'A34F12B8', name: 'Amanda Kherr',    date: today, time: '08:04:12', photo: 'photo_20261116_080412.jpg', status: 'P', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: 'B29C4410', name: 'Angel Johnson',   date: today, time: '08:07:45', photo: 'photo_20261116_080745.jpg', status: 'P', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: 'E10A77D2', name: 'Alexander Kherr', date: today, time: '08:19:30', photo: 'photo_20261116_081930.jpg', status: 'L', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: 'C41D88F1', name: 'Austin Kherr',    date: today, time: '08:00:00', photo: '',                          status: 'A', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: 'D52E99A3', name: 'Aada Kherr',      date: today, time: '08:09:18', photo: 'photo_20261116_080918.jpg', status: 'P', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: 'F63A11B4', name: 'Babak Kherr',     date: today, time: '08:11:02', photo: 'photo_20261116_081102.jpg', status: 'P', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: '774B22C5', name: 'Baha Johnson',    date: today, time: '08:22:10', photo: 'photo_20261116_082210.jpg', status: 'L', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: '885C33D6', name: 'Babette Kherr',   date: today, time: '08:12:50', photo: 'photo_20261116_081250.jpg', status: 'P', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: '996D44E7', name: 'Badan Kherr',     date: today, time: '08:06:14', photo: 'photo_20261116_080614.jpg', status: 'P', class: 'BSCS 3', subject: 'IoT Architecture', section: 'Section B' },
      { uid: '107E55F8', name: 'Bailee Kherr',    date: today, time: '08:08:33', photo: 'photo_20261116_080833.jpg', status: 'P', class: 'BSCS 3', subject: 'IoT Architecture', section: 'Section B' },
      { uid: '430B88C1', name: 'Juan Dela Cruz',  date: today, time: '08:03:21', photo: 'photo_20261116_080321.jpg', status: 'P', class: 'BSCS 3', subject: 'Embedded Systems', section: 'Section A' },
      { uid: '541C99D2', name: 'Maria Santos',    date: today, time: '08:10:09', photo: 'photo_20261116_081009.jpg', status: 'P', class: 'BSCS 3', subject: 'IoT Architecture', section: 'Section B' }
    ];
  }

  // ========================================================================
  // INITIALIZATION & ROUTING
  // ========================================================================
  async function init() {
    initLocalSeedLogs();
    updateClock();
    setInterval(updateClock, 1000);

    // Close notification dropdown on outside click
    document.addEventListener('click', (e) => {
      const dd = document.getElementById('notifDropdown');
      const btn = document.getElementById('notifBtn');
      if (dd && !dd.classList.contains('hidden') && !dd.contains(e.target) && !btn.contains(e.target)) {
        dd.classList.add('hidden');
      }
    });

    // Set initial date display
    const picker = document.getElementById('attendanceDatePicker');
    if (picker) picker.value = state.selectedDate;
    updateDateNavigatorLabel();

    // Load students & schedule
    await loadStudentsAndSchedule();
    populateFilterDropdowns();

    // Bind hash routing (#dashboard, #attendance, #schedule)
    window.addEventListener('hashchange', handleHashChange);
    if (!window.location.hash) {
      window.location.hash = '#attendance';
    } else {
      handleHashChange();
    }

    // Initial data fetch + 5-second auto-refresh
    await refreshAll(false);
    state.refreshTimer = setInterval(() => {
      refreshAll(false);
    }, 5000);
  }

  function updateClock() {
    const pht = getNowTimePHT();
    const el = document.getElementById('sidebarClock');
    if (el) el.textContent = pht.clock;
  }

  function handleHashChange() {
    const raw = (window.location.hash || '#attendance').replace('#', '').toLowerCase();
    const valid = ['dashboard', 'attendance', 'schedule'];
    const page = valid.includes(raw) ? raw : 'attendance';
    state.currentPage = page;

    // Toggle active classes on BOTH sidebars
    document.querySelectorAll('.rail-link, .menu-item').forEach((link) => {
      link.classList.toggle('active', link.getAttribute('data-page') === page);
    });

    // Show active section
    valid.forEach((p) => {
      const sec = document.getElementById(`page-${p}`);
      if (sec) sec.classList.toggle('hidden', p !== page);
    });

    closeMobileSidebar();

    if (page === 'schedule') {
      renderSchedulePage();
    } else if (page === 'dashboard') {
      renderDashboardPage();
    } else {
      renderAttendanceView();
    }
  }

  function navigateTo(page) {
    window.location.hash = `#${page}`;
  }

  function toggleSidebar() {
    const shell = document.getElementById('appShell');
    if (window.innerWidth <= 768) {
      shell.classList.toggle('mobile-nav-open');
    } else {
      shell.classList.toggle('sidebar-collapsed');
    }
  }

  function closeMobileSidebar() {
    const shell = document.getElementById('appShell');
    if (shell) shell.classList.remove('mobile-nav-open');
  }

  // ========================================================================
  // DATA FETCHING (ESP32 WebServer.h Endpoints + Offline Fallback)
  // ========================================================================
  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 2800) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  async function loadStudentsAndSchedule() {
    // 1. Try ESP32 /api/students, then fallback to ../students.json or DEFAULT_STUDENTS
    try {
      const stu = await fetchJsonWithTimeout('/api/students');
      if (Array.isArray(stu)) {
        state.students = stu;
        setConnectionMode(true);
      }
    } catch (_) {
      try {
        const stuLocal = await fetchJsonWithTimeout('../students.json');
        state.students = Array.isArray(stuLocal) ? stuLocal : DEFAULT_STUDENTS.slice();
      } catch (__) {
        state.students = DEFAULT_STUDENTS.slice();
      }
      setConnectionMode(false);
    }

    // 2. Try ESP32 /api/schedule, then fallback to ../schedule.json or DEFAULT_SCHEDULE
    try {
      const sch = await fetchJsonWithTimeout('/api/schedule');
      if (Array.isArray(sch)) {
        state.schedule = sch;
      }
    } catch (_) {
      try {
        const schLocal = await fetchJsonWithTimeout('../schedule.json');
        state.schedule = Array.isArray(schLocal) ? schLocal : DEFAULT_SCHEDULE.slice();
      } catch (__) {
        state.schedule = DEFAULT_SCHEDULE.slice();
      }
    }
  }

  function setConnectionMode(isEsp32) {
    state.isEsp32Connected = isEsp32;
    const badge = document.getElementById('connectionModeBadge');
    const dot = document.getElementById('hwStatusDot');
    if (badge) {
      badge.textContent = isEsp32 ? 'ESP32 Live' : 'Demo / Local';
      badge.classList.toggle('demo', !isEsp32);
    }
    if (dot) {
      dot.classList.toggle('offline', !isEsp32);
    }
  }

  async function refreshAll(manual = false) {
    try {
      const q = new URLSearchParams({
        date: state.selectedDate,
        class: state.filters.class,
        subject: state.filters.subject,
        section: state.filters.section
      });

      const [summary, att] = await Promise.all([
        fetchJsonWithTimeout('/api/summary'),
        fetchJsonWithTimeout(`/api/attendance?${q.toString()}`)
      ]);

      setConnectionMode(true);
      state.summaryData = summary;
      if (att && Array.isArray(att.students)) {
        state.attendanceRecords = att.students;
        if (att.session) {
          state.session = att.session;
        }
      }
    } catch (_) {
      // Offline / Local calculation when not connected to ESP32 HTTP server
      setConnectionMode(false);
      computeLocalAttendanceAndSummary();
    }

    updateSessionUI();
    renderNotifications();
    renderAttendanceView();
    renderDashboardPage();
    if (state.currentPage === 'schedule') {
      renderSchedulePage();
    }

    const syncEl = document.getElementById('lastSyncText');
    if (syncEl) {
      syncEl.textContent = `Synced ${getNowTimePHT().clock}`;
    }
    if (manual) {
      showToast('Attendance data refreshed');
    }
  }

  // Find matching schedule item for Late/Absent calculation
  function findApplicableSchedule(dateStr, classVal, subjectVal, sectionVal) {
    const parts = dateStr.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];

    return state.schedule.find((s) => {
      if (subjectVal && s.subject !== subjectVal) return false;
      if (classVal && s.class !== classVal) return false;
      if (sectionVal && s.section !== sectionVal) return false;
      if (!subjectVal && s.day !== dayName) return false;
      return true;
    }) || state.schedule[0] || { start: '08:00', end: '10:00', grace: 15 };
  }

  function evaluateTapStatus(tapTimeStr, sched) {
    const startMins = timeToMinutes(sched ? sched.start : '08:00');
    const grace = (sched && typeof sched.grace === 'number') ? sched.grace : 15;
    const tapMins = timeToMinutes(tapTimeStr);
    return (tapMins > startMins + grace) ? 'L' : 'P';
  }

  function computeLocalAttendanceAndSummary() {
    const sched = findApplicableSchedule(
      state.selectedDate,
      state.filters.class,
      state.filters.subject,
      state.filters.section
    );
    const nowPht = getNowTimePHT();
    const isPastDate = state.selectedDate < getTodayPHT();
    const isToday = state.selectedDate === getTodayPHT();
    const endMins = timeToMinutes(sched ? sched.end : '10:00');
    const nowMins = timeToMinutes(nowPht.hhmm);
    const classEnded = isPastDate || (isToday && nowMins > endMins);

    // Filter students for Attendance view
    const filteredStudents = state.students.filter((st) => {
      if (state.filters.class && st.class !== state.filters.class) return false;
      if (state.filters.section && st.section !== state.filters.section) return false;
      return true;
    });

    state.attendanceRecords = filteredStudents.map((st) => {
      // Find latest record for this student on selectedDate
      const matchingLogs = state.localLogs.filter((l) =>
        l.uid === st.uid &&
        l.date === state.selectedDate &&
        (!state.filters.subject || !l.subject || l.subject === state.filters.subject)
      );
      const latest = matchingLogs.length > 0 ? matchingLogs[matchingLogs.length - 1] : null;
      // Also find most recent photo across all dates for avatar
      const anyPhotoLog = [...state.localLogs].reverse().find((l) => l.uid === st.uid && l.photo);

      let status = '';
      let timeIn = '';
      if (latest) {
        timeIn = latest.time || '';
        status = latest.status || evaluateTapStatus(timeIn, sched);
      } else if (classEnded) {
        status = 'A';
      }

      return {
        uid: st.uid,
        name: st.name,
        class: st.class,
        section: st.section,
        time: timeIn,
        status: status, // 'P', 'A', 'L', or ''
        photo: (latest && latest.photo) ? latest.photo : (anyPhotoLog ? anyPhotoLog.photo : '')
      };
    });

    // Compute Dashboard Summary for Today
    const today = getTodayPHT();
    const total = state.students.length;
    let presentToday = 0;
    let lateToday = 0;
    let absentToday = 0;

    state.students.forEach((st) => {
      const logs = state.localLogs.filter((l) => l.uid === st.uid && l.date === today);
      const latest = logs.length ? logs[logs.length - 1] : null;
      if (latest) {
        const s = latest.status || evaluateTapStatus(latest.time, sched);
        if (s === 'P') presentToday++;
        else if (s === 'L') lateToday++;
        else if (s === 'A') absentToday++;
      } else if (nowMins > endMins) {
        absentToday++;
      }
    });

    const attended = presentToday + lateToday;
    const rate = total > 0 ? Math.round((attended / total) * 100) : 0;

    // 7-day history for chart
    const days7 = [];
    const baseParts = today.split('-');
    const baseDate = new Date(Number(baseParts[0]), Number(baseParts[1]) - 1, Number(baseParts[2]));
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = `${dayLabels[d.getDay()]} ${d.getDate()}`;
      if (ds === today) {
        days7.push({ date: ds, label, present: presentToday, late: lateToday, absent: absentToday });
      } else {
        // Deterministic realistic 7-day history from logs + baseline
        const seed = (d.getDate() * 7) % 4;
        const p = Math.max(1, total - 3 - seed);
        const l = (seed % 2) + 1;
        const a = Math.max(0, total - p - l);
        days7.push({ date: ds, label, present: p, late: l, absent: a });
      }
    }

    // Recent 10 taps (excluding manual 'A' entries with no photo)
    const recentTaps = [...state.localLogs]
      .filter((l) => l.status !== 'A')
      .slice(-10)
      .reverse();

    state.summaryData = {
      totalStudents: total,
      presentToday,
      absentToday,
      lateToday,
      attendanceRate: rate,
      last7Days: days7,
      recentTaps
    };
  }

  // ========================================================================
  // PAGE 2: ATTENDANCE VIEW & CONTROLS
  // ========================================================================
  function populateFilterDropdowns() {
    const classSel = document.getElementById('filterClass');
    const subjSel = document.getElementById('filterSubject');
    const secSel = document.getElementById('filterSection');
    if (!classSel || !subjSel || !secSel) return;

    const classes = [...new Set([
      ...state.students.map((s) => s.class),
      ...state.schedule.map((s) => s.class)
    ].filter(Boolean))];

    const subjects = [...new Set(state.schedule.map((s) => s.subject).filter(Boolean))];

    const sections = [...new Set([
      ...state.students.map((s) => s.section),
      ...state.schedule.map((s) => s.section)
    ].filter(Boolean))];

    const prevClass = classSel.value;
    const prevSubj = subjSel.value;
    const prevSec = secSel.value;

    classSel.innerHTML = `<option value="">Select Class</option>` +
      classes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

    subjSel.innerHTML = `<option value="">Select Subject</option>` +
      subjects.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

    secSel.innerHTML = `<option value="">Select Section</option>` +
      sections.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

    classSel.value = prevClass;
    subjSel.value = prevSubj;
    secSel.value = prevSec;
  }

  function onFilterChange() {
    state.filters.class = document.getElementById('filterClass').value;
    state.filters.subject = document.getElementById('filterSubject').value;
    state.filters.section = document.getElementById('filterSection').value;
    refreshAll(false);
  }

  function shiftDate(deltaDays) {
    const parts = state.selectedDate.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + deltaDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    state.selectedDate = `${y}-${m}-${day}`;
    const picker = document.getElementById('attendanceDatePicker');
    if (picker) picker.value = state.selectedDate;
    updateDateNavigatorLabel();
    refreshAll(false);
  }

  function onDatePick(val) {
    if (!val) return;
    state.selectedDate = val;
    updateDateNavigatorLabel();
    refreshAll(false);
  }

  function updateDateNavigatorLabel() {
    const el = document.getElementById('dateDisplayLabel');
    if (el) el.textContent = formatDatePretty(state.selectedDate);
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    document.getElementById('viewBtnGrid').classList.toggle('active', mode === 'grid');
    document.getElementById('viewBtnList').classList.toggle('active', mode === 'list');
    document.getElementById('attendanceGridContainer').classList.toggle('hidden', mode !== 'grid');
    document.getElementById('attendanceListContainer').classList.toggle('hidden', mode !== 'list');
    renderAttendanceView();
  }

  function renderAttendanceView() {
    const query = (document.getElementById('studentSearchInput')?.value || '').trim().toLowerCase();
    const records = state.attendanceRecords.filter((r) => {
      if (!query) return true;
      return r.name.toLowerCase().includes(query) || r.uid.toLowerCase().includes(query);
    });

    // Update P / A / L quick counters in strip
    let cP = 0, cA = 0, cL = 0;
    records.forEach((r) => {
      if (r.status === 'P') cP++;
      else if (r.status === 'A') cA++;
      else if (r.status === 'L') cL++;
    });
    const elP = document.getElementById('attCountP');
    const elA = document.getElementById('attCountA');
    const elL = document.getElementById('attCountL');
    if (elP) elP.textContent = cP;
    if (elA) elA.textContent = cA;
    if (elL) elL.textContent = cL;

    // Update schedule grace info in strip
    const sched = findApplicableSchedule(
      state.selectedDate,
      state.filters.class,
      state.filters.subject,
      state.filters.section
    );
    const stripInfo = document.getElementById('stripScheduleInfo');
    if (stripInfo && sched) {
      stripInfo.textContent = `${sched.subject} (${sched.start}–${sched.end}, ${sched.grace || 15}m grace) • Click P / A / L circles to override`;
    }

    // 1. Render Alphabetical Grid View (Matches WDC Screenshot)
    const gridEl = document.getElementById('attendanceGridContainer');
    if (gridEl) {
      if (records.length === 0) {
        gridEl.innerHTML = `<div class="empty-state">No students match the selected filters.</div>`;
      } else {
        const sorted = [...records].sort((a, b) => a.name.localeCompare(b.name));
        const groups = {};
        sorted.forEach((st) => {
          const letter = (st.name.trim()[0] || '#').toUpperCase();
          if (!groups[letter]) groups[letter] = [];
          groups[letter].push(st);
        });

        gridEl.innerHTML = Object.keys(groups).sort().map((letter) => {
          const cardsHtml = groups[letter].map((st) => {
            const avatarUrl = resolvePhotoUrl(st.photo, st.name, st.uid);
            const fallbackUrl = buildAvatarSvgDataUri(st.name, st.uid);
            const hasPhoto = Boolean(st.photo);
            const timeLabel = st.time && st.status !== 'A'
              ? `Tap: ${st.time}`
              : `${st.class} • ${st.section}`;

            return `
              <div class="student-card" data-uid="${escapeHtml(st.uid)}">
                <div class="avatar-wrap" onclick="App.openPhotoModal('${escapeHtml(st.uid)}')" title="Click to view tap snapshot & details">
                  <img class="student-avatar-img" src="${avatarUrl}" alt="${escapeHtml(st.name)}" onerror="this.onerror=null;this.src='${fallbackUrl}';">
                  ${hasPhoto ? `<span class="cam-badge" title="Snapshot saved on SD card">&#128247;</span>` : ''}
                </div>
                <div class="student-card-name" onclick="App.openStudentModal('${escapeHtml(st.uid)}')" title="Click to edit ${escapeHtml(st.name)}" style="cursor:pointer;">${escapeHtml(st.name)}</div>
                <div class="student-card-meta">${escapeHtml(timeLabel)}</div>
                <div class="pal-group">
                  <button type="button" class="pal-btn ${st.status === 'P' ? 'active-P' : ''}" onclick="App.setManualStatus('${escapeHtml(st.uid)}', 'P')" title="Mark Present">P</button>
                  <button type="button" class="pal-btn ${st.status === 'A' ? 'active-A' : ''}" onclick="App.setManualStatus('${escapeHtml(st.uid)}', 'A')" title="Mark Absent">A</button>
                  <button type="button" class="pal-btn ${st.status === 'L' ? 'active-L' : ''}" onclick="App.setManualStatus('${escapeHtml(st.uid)}', 'L')" title="Mark Late">L</button>
                </div>
              </div>
            `;
          }).join('');

          return `
            <div class="alpha-group">
              <div class="alpha-letter">${escapeHtml(letter)}</div>
              <div class="student-cards-grid">${cardsHtml}</div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Render List View Table
    const tbody = document.getElementById('attendanceTableBody');
    if (tbody) {
      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-mini">No students found</td></tr>`;
      } else {
        tbody.innerHTML = records.map((st) => {
          const avatarUrl = resolvePhotoUrl(st.photo, st.name, st.uid);
          const fallbackUrl = buildAvatarSvgDataUri(st.name, st.uid);
          const statusLabel = st.status === 'P' ? 'Present' : st.status === 'A' ? 'Absent' : st.status === 'L' ? 'Late' : 'Unmarked';
          const badgeClass = st.status || 'U';
          return `
            <tr>
              <td>
                <img class="table-avatar" src="${avatarUrl}" alt="${escapeHtml(st.name)}" onclick="App.openPhotoModal('${escapeHtml(st.uid)}')" onerror="this.onerror=null;this.src='${fallbackUrl}';">
              </td>
              <td><span class="uid-code">${escapeHtml(st.uid)}</span></td>
              <td><strong onclick="App.openStudentModal('${escapeHtml(st.uid)}')" title="Click to edit ${escapeHtml(st.name)}" style="cursor:pointer;color:var(--indigo);">${escapeHtml(st.name)}</strong></td>
              <td>${escapeHtml(st.class)} &bull; ${escapeHtml(st.section)}</td>
              <td>${st.time && st.status !== 'A' ? escapeHtml(st.time) : '<span style="color:#A0AEC0">--:--:--</span>'}</td>
              <td><span class="status-badge ${badgeClass}">${statusLabel}</span></td>
              <td>
                <div class="pal-group" style="justify-content:flex-start;">
                  <button type="button" class="pal-btn ${st.status === 'P' ? 'active-P' : ''}" onclick="App.setManualStatus('${escapeHtml(st.uid)}', 'P')">P</button>
                  <button type="button" class="pal-btn ${st.status === 'A' ? 'active-A' : ''}" onclick="App.setManualStatus('${escapeHtml(st.uid)}', 'A')">A</button>
                  <button type="button" class="pal-btn ${st.status === 'L' ? 'active-L' : ''}" onclick="App.setManualStatus('${escapeHtml(st.uid)}', 'L')">L</button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  // Manual P / A / L Override (saved to SD card via POST /api/status)
  async function setManualStatus(uid, newStatus) {
    const st = state.students.find((s) => s.uid === uid) || { uid, name: 'Student', class: state.filters.class || 'BSCS 3', section: state.filters.section || 'Section A' };
    const nowTime = getNowTimePHT().clock;
    const subject = state.filters.subject || state.session.subject || 'Embedded Systems';

    // Optimistic UI update
    const rec = state.attendanceRecords.find((r) => r.uid === uid);
    if (rec) {
      rec.status = newStatus;
      if (!rec.time) rec.time = nowTime;
    }

    try {
      await fetchJsonWithTimeout('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid,
          name: st.name,
          date: state.selectedDate,
          time: nowTime,
          status: newStatus,
          class: st.class,
          subject,
          section: st.section
        })
      });
      setConnectionMode(true);
    } catch (_) {
      // Update local fallback log
      const existingIdx = state.localLogs.findIndex((l) => l.uid === uid && l.date === state.selectedDate);
      if (existingIdx >= 0) {
        state.localLogs[existingIdx].status = newStatus;
      } else {
        state.localLogs.push({
          uid,
          name: st.name,
          date: state.selectedDate,
          time: nowTime,
          photo: '',
          status: newStatus,
          class: st.class,
          subject,
          section: st.section
        });
      }
      computeLocalAttendanceAndSummary();
    }

    renderAttendanceView();
    renderDashboardPage();
    const labelMap = { P: 'Present', A: 'Absent', L: 'Late' };
    showToast(`${st.name} marked ${labelMap[newStatus]}`);

    // If photo modal is open for this student, refresh its buttons
    const modal = document.getElementById('photoModalBackdrop');
    if (modal && !modal.classList.contains('hidden') && modal.getAttribute('data-uid') === uid) {
      openPhotoModal(uid);
    }
  }

  // Open / Close Attendance Session ("Take Attendance" button)
  async function toggleSession() {
    const nextActive = !state.session.active;
    const chosenClass = state.filters.class || 'BSCS 3';
    const chosenSubject = state.filters.subject || 'Embedded Systems';
    const chosenSection = state.filters.section || 'Section A';

    try {
      const res = await fetchJsonWithTimeout('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active: nextActive,
          date: state.selectedDate,
          class: chosenClass,
          subject: chosenSubject,
          section: chosenSection
        })
      });
      if (res && res.session) {
        state.session = res.session;
      }
    } catch (_) {
      state.session = {
        active: nextActive,
        class: chosenClass,
        subject: chosenSubject,
        section: chosenSection,
        startedAt: getNowTimePHT().clock
      };

      // When closing session, automatically mark remaining unmarked students in this class/section as Absent
      if (!nextActive) {
        state.students.forEach((st) => {
          if (chosenClass && st.class !== chosenClass) return;
          if (chosenSection && st.section !== chosenSection) return;
          const hasTap = state.localLogs.some((l) => l.uid === st.uid && l.date === state.selectedDate);
          if (!hasTap) {
            state.localLogs.push({
              uid: st.uid,
              name: st.name,
              date: state.selectedDate,
              time: getNowTimePHT().clock,
              photo: '',
              status: 'A',
              class: st.class,
              subject: chosenSubject,
              section: st.section
            });
          }
        });
      }
    }

    await refreshAll(false);
    if (nextActive) {
      showToast(`Session Open: ${chosenSubject} (${chosenClass} - ${chosenSection})`);
    } else {
      showToast('Session Closed • Remaining students marked Absent');
    }
  }

  function updateSessionUI() {
    const btn = document.getElementById('takeAttendanceBtn');
    const txt = document.getElementById('takeAttendanceBtnText');
    const dot = document.getElementById('takeAttDot');
    const topBanner = document.getElementById('topbarSessionBanner');
    const topText = document.getElementById('topbarSessionText');
    const stripPill = document.getElementById('stripStatusPill');

    const isOpen = Boolean(state.session && state.session.active);
    if (btn && txt && dot) {
      btn.classList.toggle('session-active', isOpen);
      dot.classList.toggle('hidden', !isOpen);
      txt.textContent = isOpen ? 'Session Open (End)' : 'Take Attendance';
    }
    if (topBanner && topText) {
      topBanner.classList.toggle('hidden', !isOpen);
      topText.textContent = isOpen
        ? `Session Open: ${state.session.subject || 'All'} (${state.session.class || 'All'})`
        : 'Session Open';
    }
    if (stripPill) {
      stripPill.classList.toggle('open', isOpen);
      stripPill.textContent = isOpen ? '● Session Open' : 'Standby';
    }
  }

  // ========================================================================
  // PAGE 1: DASHBOARD RENDERING (KPIs + 7-Day SVG Chart + Live Feed)
  // ========================================================================
  function renderDashboardPage() {
    if (!state.summaryData) return;
    const s = state.summaryData;

    const elTotal = document.getElementById('kpiTotalStudents');
    const elPres = document.getElementById('kpiPresentToday');
    const elAbs = document.getElementById('kpiAbsentToday');
    const elLate = document.getElementById('kpiLateToday');
    const elRate = document.getElementById('kpiAttendanceRate');

    if (elTotal) elTotal.textContent = s.totalStudents ?? 0;
    if (elPres)  elPres.textContent  = s.presentToday ?? 0;
    if (elAbs)   elAbs.textContent   = s.absentToday ?? 0;
    if (elLate)  elLate.textContent  = s.lateToday ?? 0;
    if (elRate)  elRate.textContent  = `${s.attendanceRate ?? 0}%`;

    renderSevenDaySvgChart(s.last7Days || []);
    renderRecentTapsFeed(s.recentTaps || []);
  }

  function renderSevenDaySvgChart(days) {
    const container = document.getElementById('sevenDayChart');
    if (!container) return;
    if (!days.length) {
      container.innerHTML = `<div class="empty-mini">No 7-day attendance history yet</div>`;
      return;
    }

    const width = 620;
    const height = 250;
    const padLeft = 38;
    const padRight = 18;
    const padTop = 20;
    const padBottom = 38;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxTotal = Math.max(10, ...days.map((d) => (d.present || 0) + (d.late || 0) + (d.absent || 0)));
    const stepX = plotW / days.length;

    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const y = padTop + (plotH * (i / 4));
      const val = Math.round(maxTotal * (1 - i / 4));
      gridLines += `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#EDF2F7" stroke-width="1"/>
        <text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" fill="#A0AEC0" font-size="10" font-family="Montserrat,sans-serif">${val}</text>
      `;
    }

    let bars = '';
    days.forEach((d, idx) => {
      const groupX = padLeft + idx * stepX + stepX * 0.18;
      const barW = Math.min(14, (stepX * 0.64) / 3);
      const pH = ((d.present || 0) / maxTotal) * plotH;
      const lH = ((d.late || 0) / maxTotal) * plotH;
      const aH = ((d.absent || 0) / maxTotal) * plotH;

      const baseY = padTop + plotH;
      bars += `
        <g>
          <rect x="${groupX}" y="${baseY - pH}" width="${barW}" height="${Math.max(2, pH)}" rx="3" fill="#10C98F">
            <title>${d.label}: ${d.present} Present</title>
          </rect>
          <rect x="${groupX + barW + 3}" y="${baseY - lH}" width="${barW}" height="${Math.max(2, lH)}" rx="3" fill="#F5A623">
            <title>${d.label}: ${d.late} Late</title>
          </rect>
          <rect x="${groupX + (barW + 3) * 2}" y="${baseY - aH}" width="${barW}" height="${Math.max(2, aH)}" rx="3" fill="#F5365C">
            <title>${d.label}: ${d.absent} Absent</title>
          </rect>
          <text x="${groupX + barW * 1.5 + 3}" y="${height - 12}" text-anchor="middle" fill="#718096" font-size="10.5" font-weight="600" font-family="Montserrat,sans-serif">${escapeHtml(d.label)}</text>
        </g>
      `;
    });

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="250" role="img" aria-label="Last 7 Days Attendance Chart">
        ${gridLines}
        ${bars}
      </svg>
    `;
  }

  function renderRecentTapsFeed(taps) {
    const listEl = document.getElementById('recentTapsList');
    if (!listEl) return;

    if (!taps.length) {
      listEl.innerHTML = `<div class="empty-mini">Waiting for RFID card scans...</div>`;
      return;
    }

    if (taps[0] && taps[0].uid) {
      latestScannedUid = taps[0].uid;
    }

    listEl.innerHTML = taps.slice(0, 10).map((t) => {
      const thumb = resolvePhotoUrl(t.photo, t.name, t.uid);
      const fallback = buildAvatarSvgDataUri(t.name, t.uid);
      const stCode = t.status || 'P';
      const stText = stCode === 'L' ? 'Late' : stCode === 'A' ? 'Absent' : 'Present';
      return `
        <div class="tap-feed-item" onclick="App.openPhotoModal('${escapeHtml(t.uid)}')">
          <div class="tap-feed-left">
            <img class="tap-thumb" src="${thumb}" alt="${escapeHtml(t.name)}" onerror="this.onerror=null;this.src='${fallback}';">
            <div class="tap-meta">
              <div class="tap-name">${escapeHtml(t.name)}</div>
              <div class="tap-sub">${escapeHtml(t.uid)} &bull; ${escapeHtml(t.time || '--:--:--')}</div>
            </div>
          </div>
          <span class="status-badge ${stCode}">${stText}</span>
        </div>
      `;
    }).join('');
  }

  function renderNotifications() {
    const taps = (state.summaryData && state.summaryData.recentTaps) || [];
    const badge = document.getElementById('notifCountBadge');
    const list = document.getElementById('notifList');
    if (badge) badge.textContent = taps.length;
    if (list) {
      if (!taps.length) {
        list.innerHTML = `<div class="empty-mini">No recent taps</div>`;
      } else {
        list.innerHTML = taps.slice(0, 6).map((t) => `
          <div class="notif-item">
            <div>
              <strong>${escapeHtml(t.name)}</strong>
              <div style="color:#718096;font-size:11px;">UID: ${escapeHtml(t.uid)} &bull; ${escapeHtml(t.time)}</div>
            </div>
            <span class="status-badge ${t.status || 'P'}">${t.status === 'L' ? 'Late' : 'Present'}</span>
          </div>
        `).join('');
      }
    }
  }

  function toggleNotifDropdown(e) {
    e.stopPropagation();
    const dd = document.getElementById('notifDropdown');
    if (dd) dd.classList.toggle('hidden');
  }

  // ========================================================================
  // PAGE 3: CLASS SCHEDULE TIMETABLE & CRUD (/schedule.json)
  // ========================================================================
  function renderSchedulePage() {
    const nowPht = getNowTimePHT();
    const nowMins = timeToMinutes(nowPht.hhmm);
    const dayEl = document.getElementById('todayDayName');
    if (dayEl) dayEl.textContent = nowPht.dayFull;

    // 1. Render Today's Classes above the grid
    const todayWrap = document.getElementById('todayClassesList');
    if (todayWrap) {
      const todays = state.schedule
        .filter((s) => s.day === nowPht.dayShort)
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

      if (todays.length === 0) {
        todayWrap.innerHTML = `<div class="empty-mini">No classes scheduled for ${nowPht.dayFull}. Click "Add Class Schedule" to add one.</div>`;
      } else {
        todayWrap.innerHTML = todays.map((c) => {
          const sM = timeToMinutes(c.start);
          const eM = timeToMinutes(c.end);
          const isCurrent = nowMins >= sM && nowMins <= eM;
          return `
            <div class="today-class-item ${isCurrent ? 'current-now' : ''}" style="border-left-color: ${escapeHtml(c.color || '#3F3FD0')}">
              <div class="today-class-top">
                <span class="today-class-subj">${escapeHtml(c.subject)}</span>
                ${isCurrent ? `<span class="now-badge">ACTIVE NOW</span>` : ''}
              </div>
              <div class="today-class-meta">
                <strong>${escapeHtml(c.class)} &bull; ${escapeHtml(c.section)}</strong> &bull; ${escapeHtml(c.room)}
              </div>
              <div class="today-class-meta">
                &#128337; ${escapeHtml(c.start)} – ${escapeHtml(c.end)} (Grace: ${c.grace || 15}m)
              </div>
              <div class="today-class-actions">
                <button class="btn btn-primary btn-xs" onclick="App.jumpToClassAttendance('${escapeHtml(c.class)}','${escapeHtml(c.subject)}','${escapeHtml(c.section)}')">Take Attendance</button>
                <button class="btn btn-outline btn-xs" onclick="App.openScheduleModal('${escapeHtml(c.id)}')">Edit</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Render Weekly Timetable Grid (Mon - Sat, 7:00 AM - 6:00 PM)
    const grid = document.getElementById('timetableGrid');
    if (!grid) return;

    const days = [
      { key: 'Mon', label: 'Monday' },
      { key: 'Tue', label: 'Tuesday' },
      { key: 'Wed', label: 'Wednesday' },
      { key: 'Thu', label: 'Thursday' },
      { key: 'Fri', label: 'Friday' },
      { key: 'Sat', label: 'Saturday' }
    ];

    const startHour = 7;
    const endHour = 18; // 7:00 AM to 6:00 PM (11 slots of 54px)
    const pxPerHour = 54;

    let headerHtml = `<div class="tt-head">Time</div>` +
      days.map((d) => `<div class="tt-head ${d.key === nowPht.dayShort ? 'today-col' : ''}">${d.label}</div>`).join('');

    let timeColHtml = `<div class="tt-time-col">`;
    for (let h = startHour; h < endHour; h++) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h > 12 ? h - 12 : h;
      timeColHtml += `<div class="tt-time-slot">${h12}:00 ${ampm}</div>`;
    }
    timeColHtml += `</div>`;

    let dayColsHtml = days.map((d) => {
      const dayItems = state.schedule.filter((s) => s.day === d.key);
      const blocks = dayItems.map((item) => {
        const sM = Math.max(startHour * 60, timeToMinutes(item.start));
        const eM = Math.min(endHour * 60, Math.max(sM + 30, timeToMinutes(item.end)));
        const topPx = ((sM - startHour * 60) / 60) * pxPerHour;
        const heightPx = Math.max(38, ((eM - sM) / 60) * pxPerHour - 2);
        const isCurrent = (d.key === nowPht.dayShort) && (nowMins >= sM && nowMins <= eM);

        return `
          <div class="tt-block ${isCurrent ? 'active-now' : ''}"
               style="top:${topPx}px;height:${heightPx}px;background:${escapeHtml(item.color || '#3F3FD0')};"
               onclick="App.openScheduleModal('${escapeHtml(item.id)}')"
               title="Click to edit ${escapeHtml(item.subject)}">
            <div class="tt-block-subj">${escapeHtml(item.subject)}</div>
            <div class="tt-block-sub">${escapeHtml(item.class)} &bull; ${escapeHtml(item.section)}</div>
            <div class="tt-block-sub">${escapeHtml(item.room)} (${escapeHtml(item.start)}-${escapeHtml(item.end)})</div>
          </div>
        `;
      }).join('');

      return `<div class="tt-day-col ${d.key === nowPht.dayShort ? 'today-col' : ''}">${blocks}</div>`;
    }).join('');

    grid.innerHTML = headerHtml + timeColHtml + dayColsHtml;
  }

  function jumpToClassAttendance(cls, subj, sec) {
    state.filters.class = cls;
    state.filters.subject = subj;
    state.filters.section = sec;
    const cEl = document.getElementById('filterClass');
    const sEl = document.getElementById('filterSubject');
    const secEl = document.getElementById('filterSection');
    if (cEl) cEl.value = cls;
    if (sEl) sEl.value = subj;
    if (secEl) secEl.value = sec;
    navigateTo('attendance');
    refreshAll(false);
  }

  function openScheduleModal(editId = '') {
    const modal = document.getElementById('scheduleModalBackdrop');
    const title = document.getElementById('scheduleModalTitle');
    const delBtn = document.getElementById('deleteScheduleBtn');
    const existing = editId ? state.schedule.find((s) => s.id === editId) : null;

    document.getElementById('schedId').value = existing ? existing.id : '';
    document.getElementById('schedSubject').value = existing ? existing.subject : '';
    document.getElementById('schedClass').value = existing ? existing.class : 'BSCS 3';
    document.getElementById('schedSection').value = existing ? existing.section : 'Section A';
    document.getElementById('schedDay').value = existing ? existing.day : 'Mon';
    document.getElementById('schedRoom').value = existing ? existing.room : 'Lab 301';
    document.getElementById('schedStart').value = existing ? existing.start : '08:00';
    document.getElementById('schedEnd').value = existing ? existing.end : '10:00';
    document.getElementById('schedGrace').value = existing ? (existing.grace ?? 15) : 15;
    document.getElementById('schedColor').value = existing ? (existing.color || '#3F3FD0') : '#3F3FD0';

    if (title) title.textContent = existing ? 'Edit Class Schedule' : 'Add Class Schedule';
    if (delBtn) delBtn.classList.toggle('hidden', !existing);
    if (modal) modal.classList.remove('hidden');
  }

  function closeScheduleModal() {
    const modal = document.getElementById('scheduleModalBackdrop');
    if (modal) modal.classList.add('hidden');
  }

  async function saveScheduleForm(e) {
    e.preventDefault();
    const id = document.getElementById('schedId').value || ('sched-' + Date.now());
    const item = {
      id,
      subject: document.getElementById('schedSubject').value.trim(),
      class: document.getElementById('schedClass').value.trim(),
      section: document.getElementById('schedSection').value.trim(),
      day: document.getElementById('schedDay').value,
      room: document.getElementById('schedRoom').value.trim(),
      start: document.getElementById('schedStart').value,
      end: document.getElementById('schedEnd').value,
      grace: parseInt(document.getElementById('schedGrace').value, 10) || 15,
      color: document.getElementById('schedColor').value
    };

    const idx = state.schedule.findIndex((s) => s.id === id);
    if (idx >= 0) state.schedule[idx] = item;
    else state.schedule.push(item);

    try {
      await fetchJsonWithTimeout('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.schedule)
      });
    } catch (_) {
      // Saved in local state for demo mode
    }

    populateFilterDropdowns();
    renderSchedulePage();
    closeScheduleModal();
    showToast('Class schedule saved to /schedule.json');
  }

  async function deleteCurrentSchedule() {
    const id = document.getElementById('schedId').value;
    if (!id) return;
    state.schedule = state.schedule.filter((s) => s.id !== id);

    try {
      await fetchJsonWithTimeout(`/api/schedule?id=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
    } catch (_) {
      // Removed in local state
    }

    populateFilterDropdowns();
    renderSchedulePage();
    closeScheduleModal();
    showToast('Schedule entry deleted');
  }

  // ========================================================================
  // STUDENT ROSTER MANAGEMENT (/students.json CRUD)
  // ========================================================================
  let latestScannedUid = '';

  function openStudentModal(editUid = '') {
    const modal = document.getElementById('studentModalBackdrop');
    const title = document.getElementById('studentModalTitle');
    const delBtn = document.getElementById('deleteStudentBtn');
    const existing = editUid ? state.students.find((s) => s.uid.toUpperCase() === editUid.toUpperCase()) : null;

    const uidInput = document.getElementById('studentUid');
    uidInput.value = existing ? existing.uid : (latestScannedUid || '');
    uidInput.readOnly = Boolean(existing);
    document.getElementById('studentName').value = existing ? existing.name : '';
    document.getElementById('studentClass').value = existing ? existing.class : (state.filters.class || 'BSCS 3');
    document.getElementById('studentSection').value = existing ? existing.section : (state.filters.section || 'Section A');

    if (title) title.textContent = existing ? `Edit Student: ${existing.name}` : 'Add New Student';
    if (delBtn) delBtn.classList.toggle('hidden', !existing);
    if (modal) modal.classList.remove('hidden');
  }

  function closeStudentModal() {
    const modal = document.getElementById('studentModalBackdrop');
    if (modal) modal.classList.add('hidden');
  }

  function editStudentFromPhotoModal() {
    const modal = document.getElementById('photoModalBackdrop');
    const uid = modal ? modal.getAttribute('data-uid') : '';
    closePhotoModal();
    if (uid) openStudentModal(uid);
  }

  function fillLatestUnregisteredUid() {
    const taps = (state.summaryData && state.summaryData.recentTaps) || [];
    const unreg = taps.find((t) => t.name === 'Unregistered User') || taps[0];
    const uidToFill = unreg ? unreg.uid : (latestScannedUid || 'A34F12B8');
    document.getElementById('studentUid').value = uidToFill;
    showToast(`Pasted UID: ${uidToFill}`);
  }

  async function saveStudentForm(e) {
    e.preventDefault();
    const uid = document.getElementById('studentUid').value.trim().toUpperCase();
    const name = document.getElementById('studentName').value.trim();
    const cls = document.getElementById('studentClass').value.trim();
    const sec = document.getElementById('studentSection').value.trim();

    if (!uid || !name) {
      showToast('UID and Name are required');
      return;
    }

    const item = { uid, name, class: cls, section: sec };
    const idx = state.students.findIndex((s) => s.uid.toUpperCase() === uid);
    if (idx >= 0) {
      state.students[idx] = item;
    } else {
      state.students.push(item);
    }

    try {
      await fetchJsonWithTimeout('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      setConnectionMode(true);
    } catch (_) {
      // Saved in local state
    }

    populateFilterDropdowns();
    await refreshAll(false);
    closeStudentModal();
    showToast(`Student ${name} saved to /students.json`);
  }

  async function deleteCurrentStudent() {
    const uid = document.getElementById('studentUid').value.trim().toUpperCase();
    if (!uid) return;
    if (!confirm(`Are you sure you want to remove student with UID ${uid}?`)) return;

    state.students = state.students.filter((s) => s.uid.toUpperCase() !== uid);

    try {
      await fetchJsonWithTimeout(`/api/students?uid=${encodeURIComponent(uid)}`, {
        method: 'DELETE'
      });
      setConnectionMode(true);
    } catch (_) {
      // Removed from local state
    }

    populateFilterDropdowns();
    await refreshAll(false);
    closeStudentModal();
    showToast(`Student ${uid} removed`);
  }

  // ========================================================================
  // STUDENT PHOTO MODAL & SIMULATED RFID TAP
  // ========================================================================
  function openPhotoModal(uid) {
    const rec = state.attendanceRecords.find((r) => r.uid === uid) ||
                state.students.find((s) => s.uid === uid);
    if (!rec) return;

    const modal = document.getElementById('photoModalBackdrop');
    modal.setAttribute('data-uid', uid);

    document.getElementById('modalStudentName').textContent = rec.name;
    document.getElementById('modalStudentMeta').textContent = `UID: ${rec.uid} • ${rec.class} (${rec.section})`;
    document.getElementById('modalTapDate').textContent = state.selectedDate;
    document.getElementById('modalTapTime').textContent = rec.time || 'No tap yet';
    document.getElementById('modalPhotoPath').textContent = rec.photo || 'None';

    const frame = document.getElementById('modalPhotoFrame');
    const simSnap = buildSimulatedQvgaSnapshot(rec, state.selectedDate, rec.time, rec.photo);
    if (rec.photo && state.isEsp32Connected) {
      let clean = rec.photo.replace(/^\/photos\//, '').replace(/^\//, '');
      frame.innerHTML = `<img src="/photo?f=${encodeURIComponent(clean)}" alt="${escapeHtml(rec.name)}" onerror="this.onerror=null;this.src='${simSnap}';">`;
    } else {
      frame.innerHTML = `<img src="${simSnap}" alt="${escapeHtml(rec.name)}">`;
    }

    const palWrap = document.getElementById('modalPalButtons');
    palWrap.innerHTML = `
      <button type="button" class="pal-btn ${rec.status === 'P' ? 'active-P' : ''}" onclick="App.setManualStatus('${escapeHtml(rec.uid)}', 'P')">P</button>
      <button type="button" class="pal-btn ${rec.status === 'A' ? 'active-A' : ''}" onclick="App.setManualStatus('${escapeHtml(rec.uid)}', 'A')">A</button>
      <button type="button" class="pal-btn ${rec.status === 'L' ? 'active-L' : ''}" onclick="App.setManualStatus('${escapeHtml(rec.uid)}', 'L')">L</button>
    `;

    modal.classList.remove('hidden');
  }

  function closePhotoModal() {
    const modal = document.getElementById('photoModalBackdrop');
    if (modal) modal.classList.add('hidden');
  }

  // Simulate an RFID tap (with 60-second duplicate UID prevention rule)
  function simulateRfidTap() {
    const candidates = state.students;
    if (!candidates.length) return;
    // Prefer unmarked or absent students today so the user sees cards turn Present/Late
    const unmarked = state.attendanceRecords.filter((r) => !r.status || r.status === 'A');
    const chosen = unmarked.length > 0
      ? unmarked[Math.floor(Math.random() * unmarked.length)]
      : candidates[Math.floor(Math.random() * candidates.length)];

    const nowMs = Date.now();
    if (state.lastUidTapMap[chosen.uid] && (nowMs - state.lastUidTapMap[chosen.uid] < 60000)) {
      showToast(`Ignored duplicate tap for ${chosen.name} (<60s cooldown)`);
      return;
    }
    state.lastUidTapMap[chosen.uid] = nowMs;

    const pht = getNowTimePHT();
    const sched = findApplicableSchedule(
      state.selectedDate,
      state.filters.class || chosen.class,
      state.filters.subject,
      state.filters.section || chosen.section
    );
    const autoStatus = evaluateTapStatus(pht.hhmm, sched);
    const photoFile = `photo_${pht.stamp}.jpg`;

    state.localLogs.push({
      uid: chosen.uid,
      name: chosen.name,
      date: getTodayPHT(),
      time: pht.clock,
      photo: `/photos/${photoFile}`,
      status: autoStatus,
      class: chosen.class,
      subject: sched ? sched.subject : 'Embedded Systems',
      section: chosen.section
    });

    if (state.isEsp32Connected) {
      setManualStatus(chosen.uid, autoStatus);
    } else {
      computeLocalAttendanceAndSummary();
      renderNotifications();
      renderAttendanceView();
      renderDashboardPage();
      showToast(`RFID Tap: ${chosen.name} (${chosen.uid}) → ${autoStatus === 'L' ? 'Late' : 'Present'}`);
    }
  }

  // Export CSV Modal & Filtered Download Handler
  function handleExportCSV(e) {
    if (e) e.preventDefault();

    const subjSel = document.getElementById('exportSubject');
    const secSel  = document.getElementById('exportSection');
    const clsSel  = document.getElementById('exportClass');
    const dateOpt = document.getElementById('exportSelectedDateOpt');

    const classes = [...new Set([
      ...state.students.map((s) => s.class),
      ...state.schedule.map((s) => s.class)
    ].filter(Boolean))];

    const subjects = [...new Set(state.schedule.map((s) => s.subject).filter(Boolean))];

    const sections = [...new Set([
      ...state.students.map((s) => s.section),
      ...state.schedule.map((s) => s.section)
    ].filter(Boolean))];

    if (subjSel) {
      subjSel.innerHTML = `<option value="">All Subjects</option>` +
        subjects.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
      subjSel.value = state.filters.subject || '';
    }
    if (secSel) {
      secSel.innerHTML = `<option value="">All Sections</option>` +
        sections.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
      secSel.value = state.filters.section || '';
    }
    if (clsSel) {
      clsSel.innerHTML = `<option value="">All Classes</option>` +
        classes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      clsSel.value = state.filters.class || '';
    }
    if (dateOpt) {
      dateOpt.textContent = `Selected Date Only (${state.selectedDate})`;
    }

    const modal = document.getElementById('exportModalBackdrop');
    if (modal) modal.classList.remove('hidden');
    return false;
  }

  function closeExportModal() {
    const modal = document.getElementById('exportModalBackdrop');
    if (modal) modal.classList.add('hidden');
  }

  function confirmExportCSV(e) {
    e.preventDefault();
    const chosenSubj = document.getElementById('exportSubject')?.value || '';
    const chosenSec  = document.getElementById('exportSection')?.value || '';
    const chosenCls  = document.getElementById('exportClass')?.value || '';
    const dateScope  = document.getElementById('exportDateScope')?.value || 'selected';
    const chosenDate = (dateScope === 'selected') ? state.selectedDate : '';

    // Build descriptive filename: e.g. attendance_Embedded_Systems_Section_A_2026-11-16.csv
    const slugParts = ['attendance'];
    if (chosenSubj) slugParts.push(chosenSubj.replace(/[^a-zA-Z0-9]+/g, '_'));
    if (chosenCls)  slugParts.push(chosenCls.replace(/[^a-zA-Z0-9]+/g, '_'));
    if (chosenSec)  slugParts.push(chosenSec.replace(/[^a-zA-Z0-9]+/g, '_'));
    if (chosenDate) slugParts.push(chosenDate);
    const filename = `${slugParts.join('_')}.csv`;

    if (state.isEsp32Connected) {
      const q = new URLSearchParams();
      if (chosenDate) q.set('date', chosenDate);
      if (chosenCls)  q.set('class', chosenCls);
      if (chosenSubj) q.set('subject', chosenSubj);
      if (chosenSec)  q.set('section', chosenSec);
      const qs = q.toString();
      window.location.href = qs ? `/export?${qs}` : '/export';
      closeExportModal();
      showToast(`Exporting ${filename}...`);
      return;
    }

    // Offline / Local demo mode filtered CSV generation
    const filteredLogs = state.localLogs.filter((l) => {
      if (chosenDate && l.date !== chosenDate) return false;
      if (chosenSubj && l.subject && l.subject !== chosenSubj) return false;
      if (chosenCls && l.class && l.class !== chosenCls) return false;
      if (chosenSec && l.section && l.section !== chosenSec) return false;
      return true;
    });

    const header = 'UID,Name,Date,Time,PhotoPath,Status,Class,Subject,Section\n';
    const rows = filteredLogs.map((l) =>
      `${l.uid},${l.name},${l.date},${l.time},${l.photo || ''},${l.status || 'P'},${l.class || ''},${l.subject || ''},${l.section || ''}`
    ).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    closeExportModal();
    showToast(`Downloaded ${filename} (${filteredLogs.length} rows)`);
  }

  function showToast(msg) {
    const wrap = document.getElementById('toastContainer');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3200);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    navigateTo,
    toggleSidebar,
    closeMobileSidebar,
    refreshAll,
    onFilterChange,
    shiftDate,
    onDatePick,
    setViewMode,
    renderAttendanceView,
    setManualStatus,
    toggleSession,
    openPhotoModal,
    closePhotoModal,
    openScheduleModal,
    closeScheduleModal,
    saveScheduleForm,
    deleteCurrentSchedule,
    jumpToClassAttendance,
    simulateRfidTap,
    toggleNotifDropdown,
    handleExportCSV,
    closeExportModal,
    confirmExportCSV,
    openStudentModal,
    closeStudentModal,
    saveStudentForm,
    deleteCurrentStudent,
    fillLatestUnregisteredUid,
    editStudentFromPhotoModal
  };
})();
