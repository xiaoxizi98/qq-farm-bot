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

function renderLands(lands) {
    farmGrid.innerHTML = '';
    // Sort by id
    lands.sort((a, b) => parseInt(a.id) - parseInt(b.id));

    lands.forEach(land => {
        const div = document.createElement('div');
        div.className = 'land-slot';

        // Determine Status
        let statusClass = '';
        let icon = '🌱';
        let statusText = '空闲';

        const plant = land.plant;
        if (plant) {
            if (plant.phases && plant.phases.length > 0) {
                // Use a simplified logic or pass phase from backend
                // For visualization let's just look at basic properties
                // In a real app we would replicate the phase logic or send processed view models
                statusText = plant.name || '未知';
                statusClass = 'growing';
            }
        } else {
            icon = '🕳️';
            statusClass = 'empty';
        }

        div.classList.add(statusClass);
        div.innerHTML = `
            <div class="plant-icon">${icon}</div>
            <div class="plant-name">${statusText}</div>
            <div class="plant-timer">#${land.id}</div>
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
