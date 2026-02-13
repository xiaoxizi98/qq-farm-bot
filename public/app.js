const socket = io();

// DOM Elements
// DOM Elements
const logDrawer = document.getElementById('logDrawer');
const userName = document.getElementById('userName');
const userLevel = document.getElementById('userLevel');
const userGold = document.getElementById('userGold');
const userExp = document.getElementById('userExp');
const farmGrid = document.getElementById('farmGrid');
const statusBadgeCompact = document.getElementById('statusBadgeCompact');

// State
let isRunning = false;
let currentLands = [];

// Refresh timer for countdowns
setInterval(() => {
    if (currentLands && currentLands.length > 0) {
        renderLands(currentLands);
    }
}, 1000);

// Check Auth
async function checkAuth() {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    if (!data.authenticated) {
        window.location.href = '/login.html';
    } else {
        fetchStatus();
    }
}

// Fetch Initial Status
async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        if (res.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        const data = await res.json();

        // Update Running State
        setRunningState(data.running);

        // Update User State
        updateUserUI(data.user);

        // Logs are handled by socket
    } catch (e) {
        console.error(e);
    }
}

function setRunningState(running) {
    isRunning = running;
    const badge = document.getElementById('statusBadgeCompact');
    const text = document.getElementById('statusText');
    if (!badge || !text) return;

    if (running) {
        text.innerText = '运行中';
        badge.classList.add('running');
    } else {
        text.innerText = '已停止';
        badge.classList.remove('running');
    }
}

function updateUserUI(user) {
    if (!user || !user.name) return;
    userName.innerText = user.name;
    userLevel.innerText = user.level;
    userGold.innerText = user.gold.toLocaleString(); // Format number

    if (user.expProgress) {
        userExp.innerText = `${user.expProgress.current}/${user.expProgress.needed}`;
    } else {
        userExp.innerText = user.exp;
    }
}

// Socket Events
socket.on('status_change', (data) => {
    setRunningState(data.running);
});

socket.on('user_update', (user) => {
    updateUserUI(user);
});

socket.on('new_log', (msg) => {
    addLog(msg);
});

socket.on('log_history', (logs) => {
    logDrawer.innerHTML = ''; // Clear
    logs.forEach(msg => addLog(msg));
});

// Mocking lands for now as server doesn't push initial lands, only changes.
// We should probably fetch lands on load if running.
// For now, let's render lands when 'lands_changed' event comes.
socket.on('lands_changed', (lands) => {
    currentLands = lands;
    renderLands(lands);
});

function addLog(msg) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerText = msg;
    div.className = 'log-entry';
    div.innerText = msg;
    logDrawer.prepend(div);
}

const PHASE_NAMES = ['未知', '种子', '发芽', '小叶', '大叶', '开花', '成熟', '枯死'];

function getCurrentPhaseIdx(phases) {
    if (!phases || phases.length === 0) return 0;
    const now = Math.floor(Date.now() / 1000);
    for (let i = phases.length - 1; i >= 0; i--) {
        if (parseInt(phases[i].begin_time) <= now) return i;
    }
    return 0;
}

function renderLands(lands) {
    farmGrid.innerHTML = '';

    // Sort: Unlocked first, then by ID
    lands.sort((a, b) => {
        if (a.unlocked !== b.unlocked) return b.unlocked - a.unlocked;
        return parseInt(a.id) - parseInt(b.id);
    });

    const now = Math.floor(Date.now() / 1000);

    lands.forEach(land => {
        const div = document.createElement('div');
        div.className = 'land-slot';

        if (!land.unlocked) {
            div.classList.add('locked');
            div.innerHTML = `<div style="color:#555">Locked</div><div class="plant-timer">#${land.id}</div>`;
            farmGrid.appendChild(div);
            return;
        }

        const plant = land.plant;
        let name = '空闲';
        let phaseText = '';
        let statusHtml = '';
        let timerText = '';
        let icon = '🕳️';
        let stateClass = 'empty';

        if (plant && plant.id > 0) {
            name = plant.name || 'Unknown';
            stateClass = 'growing';
            icon = '🌱'; // Default

            // Lifecycle
            if (plant.phases && plant.phases.length > 0) {
                const idx = getCurrentPhaseIdx(plant.phases);
                const currentPhase = plant.phases[idx];
                const phaseVal = currentPhase.phase;
                phaseText = PHASE_NAMES[phaseVal] || `阶段${phaseVal}`;

                // Icon based on phase
                if (phaseVal === 6) { icon = '🥕'; stateClass = 'mature'; } // Mature
                else if (phaseVal === 7) { icon = '🥀'; stateClass = 'dead'; } // Dead
                else if (phaseVal === 1) icon = '🌰'; // Seed
                else if (phaseVal >= 4) icon = '🌳';

                // Countdown to next
                if (idx < plant.phases.length - 1 && phaseVal < 6) {
                    const nextPhase = plant.phases[idx + 1];
                    const left = parseInt(nextPhase.begin_time) - now;
                    if (left > 0) {
                        const m = Math.floor(left / 60);
                        const s = left % 60;
                        timerText = `${m}:${s < 10 ? '0' : ''}${s}`;
                    }
                } else if (phaseVal === 6) {
                    timerText = '可收获';
                } else if (phaseVal === 7) {
                    timerText = '已枯死';
                }

                // Status Conditions
                // Dry
                if (plant.dry_num > 0 || (currentPhase.dry_time > 0 && currentPhase.dry_time <= now)) {
                    statusHtml += '<span title="缺水">💧</span>';
                    stateClass = 'warn'; // Highlight warning
                }
                // Weed
                let weedsTime = currentPhase.weeds_time || 0;
                if ((plant.weed_owners && plant.weed_owners.length > 0) || (weedsTime > 0 && weedsTime <= now)) {
                    statusHtml += '<span title="杂草">🦟</span>'; // Using mosquito/weed icon surrogate
                    stateClass = 'warn';
                }
                // Insect
                let insectTime = currentPhase.insect_time || 0;
                if ((plant.insect_owners && plant.insect_owners.length > 0) || (insectTime > 0 && insectTime <= now)) {
                    statusHtml += '<span title="害虫">🐛</span>';
                    stateClass = 'warn';
                }
            }
        }

        div.classList.add(stateClass);
        div.innerHTML = `
            <div class="plant-icon">${icon}</div>
            <div class="plant-name">${name}</div>
            <div style="font-size: 0.75rem; color: #888;">${phaseText}</div>
            <div class="plant-status">${statusHtml}</div>
            <div class="plant-timer" style="${timerText === '可收获' ? 'color:#4fce4f' : ''}">${timerText || ('#' + land.id)}</div>
        `;
        farmGrid.appendChild(div);
    });
}



document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
});

// Init
checkAuth();
