const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const { CONFIG, updateConfig } = require('./src/config');
const client = require('./client');
const { addLogListener, removeLogListener } = require('./src/utils');
const { getUserState, networkEvents } = require('./src/network');
const { checkFarm } = require('./src/farm'); // To manually trigger farm check if needed
const { MiniProgramLoginSession } = require('./src/qrlib_session');
const { getLevelExpProgress } = require('./src/gameConfig');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const PASSWORD = 'Gongxi123.'; // Default password, simple protection

// State
let isRunning = false;
let logBuffer = [];
const MAX_LOG_BUFFER = 100;

// Middleware
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Logging Hook
addLogListener((msg) => {
    // Keep buffer limited
    if (logBuffer.length >= MAX_LOG_BUFFER) {
        logBuffer.shift();
    }
    logBuffer.push(msg);

    // Broadcast to UI
    io.emit('new_log', msg);
});

// Network Event Hooks
networkEvents.on('landsChanged', (lands) => {
    io.emit('lands_changed', lands);
});

networkEvents.on('landsUpdate', (lands) => {
    io.emit('lands_changed', lands);
});

networkEvents.on('friendApplicationReceived', (apps) => {
    io.emit('friend_request', apps);
});

// Periodic Status Update (since we don't have a direct event for all user state changes)
setInterval(() => {
    if (isRunning) {
        const state = getUserState();
        const progress = getLevelExpProgress(state.level, state.exp);
        io.emit('user_update', {
            ...state,
            expProgress: progress
        });
    }
}, 2000);

// Auth Middleware
const authMiddleware = (req, res, next) => {
    if (req.cookies.auth_token === PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Routes

// Get QR Code (MiniProgram)
app.post('/api/qr/get', authMiddleware, async (req, res) => {
    try {
        const result = await MiniProgramLoginSession.requestLoginCode();
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Query QR Code Status
app.post('/api/qr/query', authMiddleware, async (req, res) => {
    try {
        const { code } = req.body;
        const result = await MiniProgramLoginSession.queryStatus(code);
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'Error', msg: e.message });
    }
});

// Get Auth Code
app.post('/api/qr/auth', authMiddleware, async (req, res) => {
    try {
        const { ticket } = req.body;
        // 使用 Farm 的 AppID
        const appid = MiniProgramLoginSession.Presets.farm.appid;
        const code = await MiniProgramLoginSession.getAuthCode(ticket, appid);
        if (code) {
            res.json({ success: true, code });
        } else {
            res.json({ success: false, message: '获取 Code 失败' });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Check Auth Status
app.get('/api/auth/check', (req, res) => {
    if (req.cookies.auth_token === PASSWORD) {
        res.json({ authenticated: true });
    } else {
        res.json({ authenticated: false });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === PASSWORD) {
        res.cookie('auth_token', PASSWORD, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.json({ success: true });
});

// Get Status (Protected)
app.get('/api/status', authMiddleware, (req, res) => {
    const userState = getUserState();
    res.json({
        running: isRunning,
        user: userState,
        logs: logBuffer
    });
});

// Get Config (Protected)
app.get('/api/config', authMiddleware, (req, res) => {
    res.json(CONFIG);
});

// Update Config (Protected)
app.post('/api/config', authMiddleware, (req, res) => {
    updateConfig(req.body);
    // If running, some configs in client modules might need explicit update if they cached it, 
    // but our modification to friend.js uses direct property access, so it should work.
    // farmCheckInterval updates will take effect on next loop.
    res.json({ success: true, config: CONFIG });
});

// Start Bot (Protected)
app.post('/api/start', authMiddleware, async (req, res) => {
    if (isRunning) {
        return res.json({ success: false, message: 'Already running' });
    }

    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ success: false, message: 'Code is required' });
    }

    try {
        await client.startClient({ code });
        isRunning = true;
        io.emit('status_change', { running: true });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Stop Bot (Protected)
app.post('/api/stop', authMiddleware, async (req, res) => {
    if (!isRunning) {
        return res.json({ success: false, message: 'Not running' });
    }

    try {
        await client.stopClient();
        isRunning = false;
        io.emit('status_change', { running: false });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// Socket Connection
io.on('connection', (socket) => {
    // Send initial logs
    socket.emit('log_history', logBuffer);
});

// Start Server
server.listen(PORT, () => {
    console.log(`Web Control Panel running at http://localhost:${PORT}`);
});
