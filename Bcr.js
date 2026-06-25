const axios = require('axios');
const express = require('express');
const https = require('https');

// ======================
// APP CONFIG
// ======================
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    next();
});
// ======================
// CẤU HÌNH TÀI KHOẢN
// ======================
const USERNAME = "6tyghujkm";
const PASSWORD = "6tyghujkm";

const BASE = "https://aibcr.me";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GET_RESULT_URL = `${BASE}/baccarat/getnewresult`;

const agent = new https.Agent({ rejectUnauthorized: false });

let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;
let isLoggedIn = false;

// ======================
// SESSION AXIOS
// ======================
const session = axios.create({
    baseURL: BASE,
    timeout: 30000,
    httpsAgent: agent,
    maxRedirects: 5,
    validateStatus: status => status >= 200 && status < 400,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
});

// Tự gắn cookie vào request
session.interceptors.request.use(config => {
    if (cookieJar) {
        config.headers.Cookie = cookieJar;
    }
    return config;
});

// Tự lưu cookie từ response
session.interceptors.response.use(res => {
    const setCookie = res.headers['set-cookie'];

    if (setCookie) {
        for (const cookie of setCookie) {
            const firstPart = cookie.split(';')[0];
            const eqIndex = firstPart.indexOf('=');

            if (eqIndex === -1) continue;

            const name = firstPart.substring(0, eqIndex);
            const value = firstPart.substring(eqIndex + 1);

            const regex = new RegExp(`${name}=[^;]*;?\\s*`, 'g');
            cookieJar = cookieJar.replace(regex, '');
            cookieJar += `${name}=${value}; `;
        }
    }

    return res;
});

// ======================
// HÀM LẤY CSRF TOKEN
// ======================
function getCsrfToken(html) {
    if (!html || typeof html !== 'string') return null;

    let match = html.match(/<input[^>]*name=["']_token["'][^>]*value=["']([^"']+)["']/i);
    if (match) return match[1];

    match = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
    if (match) return match[1];

    match = html.match(/name=["']_token["'][\s\S]*?value=["']([^"']+)["']/i);
    if (match) return match[1];

    return null;
}

// ======================
// ĐĂNG NHẬP
// ======================
async function login() {
    try {
        console.log('[LOGIN] Đang lấy trang đăng nhập...');

        const getResp = await session.get(LOGIN_URL);
        const token = getCsrfToken(getResp.data);

        if (!token) {
            console.error('[LOGIN] Không tìm thấy CSRF token!');
            return false;
        }

        console.log(`[LOGIN] CSRF token: ${token}`);

        const formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        formData.append('_token', token);
        formData.append('action', 'Login');

        const headers = {
            'Referer': LOGIN_URL,
            'Origin': BASE,
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        console.log('[LOGIN] Đang gửi request đăng nhập...');

        const loginResp = await session.post(LOGIN_URL, formData.toString(), { headers });

        if (loginResp.status === 200 || loginResp.status === 302) {
            console.log('[LOGIN] Thành công!');
            isLoggedIn = true;
            return true;
        }

        console.error(`[LOGIN] Thất bại, status: ${loginResp.status}`);
        return false;

    } catch (error) {
        console.error('[LOGIN] Lỗi:', error.message);
        return false;
    }
}

// ======================
// VÀO LOBBY
// ======================
async function goToLobby() {
    try {
        console.log('[LOBBY] Đang vào lobby...');
        await session.get(LOBBY_URL);
        console.log('[LOBBY] OK');
        return true;
    } catch (error) {
        console.error('[LOBBY] Lỗi:', error.message);
        return false;
    }
}

// ======================
// LẤY DATA BACCARAT
// ======================
async function fetchBaccaratData() {
    try {
        let xsrfToken = '';
        const xsrfMatch = cookieJar.match(/XSRF-TOKEN=([^;]+)/);

        if (xsrfMatch) {
            xsrfToken = decodeURIComponent(xsrfMatch[1]);
        }

        const headers = {
            'Referer': LOBBY_URL,
            'Origin': BASE,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
        };

        if (xsrfToken) {
            headers['X-XSRF-TOKEN'] = xsrfToken;
        }

        const formData = new URLSearchParams();
        formData.append('gameCode', 'ae');

        const resp = await session.post(GET_RESULT_URL, formData.toString(), { headers });

        if (resp.data && resp.data.code === 200 && Array.isArray(resp.data.data)) {
            baccaratData = resp.data.data.map(item => ({
                table: String(item.table_name),
                table_name: String(item.table_name),
                table_id: item.table_id,
                result: item.result || '',
                goodRoad: item.goodRoad || '',
                cards: item.cards || '',
                game_code: item.game_code || '',
                time: item.time || '',
                raw_source: item
            }));

            lastUpdate = new Date().toISOString();

            console.log(`[FETCH] Lấy thành công ${baccaratData.length} bàn lúc ${lastUpdate}`);
            return baccaratData;
        }

        console.warn('[FETCH] Dữ liệu không đúng format:', resp.data);
        return baccaratData;

    } catch (error) {
        const status = error.response ? error.response.status : 'NO_RESPONSE';
        console.error(`[FETCH] Lỗi: ${error.message} | status: ${status}`);

        // Nếu session hết hạn thì login lại
        if (status === 401 || status === 419 || status === 403) {
            console.log('[FETCH] Có thể session hết hạn, đang login lại...');
            isLoggedIn = false;
            await login();
            await goToLobby();
        }

        return baccaratData;
    }
}

// ======================
// AUTO UPDATE 2 GIÂY
// ======================
async function autoUpdate() {
    while (true) {
        await fetchBaccaratData();
        await sleep(2000);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ======================
// THUẬT TOÁN DỰ ĐOÁN GIỐNG BẢN PYTHON CŨ
// ======================
class UnifiedBaccaratPredictor {
    constructor() {
        this.history = [];
    }

    addResult(result) {
        if (!['B', 'P', 'T'].includes(result)) return false;
        this.history.push(result);
        return true;
    }

    getLastNonTie() {
        for (let i = this.history.length - 1; i >= 0; i--) {
            if (this.history[i] !== 'T') return this.history[i];
        }
        return 'B';
    }

    calculateStreakScore() {
        let bStreak = 0;
        let pStreak = 0;

        for (let i = this.history.length - 1; i >= 0; i--) {
            const r = this.history[i];

            if (r === 'B') bStreak++;
            else if (r === 'P') pStreak++;
            else break;
        }

        const maxStreak = Math.max(bStreak, pStreak);
        const score = Math.min(maxStreak * 0.25, 1.0);
        const last = this.history.length ? this.history[this.history.length - 1] : 'B';

        return {
            B: last === 'B' ? score : 0,
            P: last === 'P' ? score : 0
        };
    }

    calculateChopScore() {
        let chopCount = 0;

        for (let i = this.history.length - 1; i > 0; i--) {
            const curr = this.history[i];
            const prev = this.history[i - 1];

            if (curr !== 'T' && prev !== 'T' && curr !== prev) {
                chopCount++;
            } else {
                break;
            }
        }

        const score = Math.min(chopCount * 0.3, 1.0);
        const lastNonTie = this.getLastNonTie();

        return {
            B: lastNonTie === 'P' ? score : 0,
            P: lastNonTie === 'B' ? score : 0
        };
    }

    calculateDerivedRoadsScore() {
        const nonTies = this.history.filter(r => r !== 'T');
        let regularity = 0.0;

        for (let i = 2; i < nonTies.length; i++) {
            if (nonTies[i] === nonTies[i - 2]) {
                regularity += 0.5;
            }
        }

        const regScore = nonTies.length
            ? Math.min(regularity / (nonTies.length * 0.4), 1.0)
            : 0.0;

        const last = this.getLastNonTie();

        if (last === 'B') {
            return {
                B: regScore,
                P: (1 - regScore) * 0.6
            };
        }

        if (last === 'P') {
            return {
                B: (1 - regScore) * 0.6,
                P: regScore
            };
        }

        return {
            B: regScore,
            P: (1 - regScore) * 0.6
        };
    }

    calculatePatternScore() {
        const last = this.getLastNonTie();

        let scoreB = last === 'B' ? 0.6 : 0.4;
        let scoreP = last === 'P' ? 0.6 : 0.4;

        const recentTies = this.history.slice(-8).filter(r => r === 'T').length;

        if (recentTies >= 2) {
            scoreB += 0.15;
            scoreP += 0.15;
        }

        return {
            B: scoreB,
            P: scoreP
        };
    }

    predict() {
        if (this.history.length < 5) {
            return {
                recommendation: 'NEUTRAL',
                confidence: 'YẾU',
                bankerProb: 50,
                playerProb: 50,
                scoreB: 0,
                scoreP: 0,
                totalScore: 0,
                reason: 'Chưa đủ dữ liệu (cần >= 5 kết quả)'
            };
        }

        const weight = 25;
        let scoreB = 0.0;
        let scoreP = 0.0;

        const streak = this.calculateStreakScore();
        scoreB += streak.B * weight;
        scoreP += streak.P * weight;

        const chop = this.calculateChopScore();
        scoreB += chop.B * weight;
        scoreP += chop.P * weight;

        const derived = this.calculateDerivedRoadsScore();
        scoreB += derived.B * weight;
        scoreP += derived.P * weight;

        const pattern = this.calculatePatternScore();
        scoreB += pattern.B * weight;
        scoreP += pattern.P * weight;

        scoreB += 8;

        const total = scoreB + scoreP;
        const bankerProb = total > 0 ? Math.round((scoreB / total) * 100) : 50;
        const playerProb = 100 - bankerProb;

        const diff = Math.abs(scoreB - scoreP);

        let confidence = 'YẾU';
        if (diff > 80) confidence = 'RẤT MẠNH';
        else if (diff > 50) confidence = 'MẠNH';
        else if (diff > 25) confidence = 'TRUNG BÌNH';

        const recommendation = bankerProb > playerProb ? 'BANKER' : 'PLAYER';

        return {
            recommendation,
            confidence,
            bankerProb,
            playerProb,
            scoreB: Math.round(scoreB),
            scoreP: Math.round(scoreP),
            totalScore: Math.round(total)
        };
    }
}

// ======================
// HÀM PHỤ
// ======================
function sortTables(list) {
    return [...list].sort((a, b) => {
        const ta = String(a.table || a.table_name || '');
        const tb = String(b.table || b.table_name || '');

        const na = /^\d+$/.test(ta);
        const nb = /^\d+$/.test(tb);

        if (na && nb) return Number(ta) - Number(tb);
        if (na) return -1;
        if (nb) return 1;

        return ta.localeCompare(tb);
    });
}

function findTableLocal(tableId) {
    return baccaratData.find(item => String(item.table) === String(tableId));
}

function extractPhienInfoLocal(target) {
    const resultStr = target.result || '';

    const possibleKeys = [
        'phien',
        'Phien',
        'session',
        'session_id',
        'sessionId',
        'round',
        'round_id',
        'roundId',
        'game',
        'game_id',
        'gameId',
        'game_no',
        'gameNo',
        'gameNumber',
        'issue',
        'issueNo',
        'shoe',
        'shoe_id',
        'shoeId',
        'id',
        'table_round',
        'current_round'
    ];

    const found = {};
    let phienValue = null;
    let phienKey = null;

    const raw = target.raw_source || target;

    for (const key of possibleKeys) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) {
            found[key] = raw[key];

            if (phienValue === null && raw[key] !== null && raw[key] !== '') {
                phienValue = raw[key];
                phienKey = key;
            }
        }
    }

    return {
        Phien: phienValue,
        Truong_phien: phienKey,
        Tat_ca_field_nghi_la_phien: found,
        So_van_da_co: resultStr ? resultStr.length : 0
    };
}

function makePredictionForLocalTable(tableId) {
    const target = findTableLocal(tableId);

    if (!target) {
        return {
            statusCode: 404,
            body: {
                error: `Không tìm thấy bàn ${tableId}`,
                lastUpdate,
                totalTables: baccaratData.length
            }
        };
    }

    const resultStr = target.result || '';

    if (!resultStr) {
        return {
            statusCode: 500,
            body: {
                error: 'Result rỗng',
                raw: target
            }
        };
    }

    const predictor = new UnifiedBaccaratPredictor();

    for (const ch of resultStr) {
        predictor.addResult(ch);
    }

    const prediction = predictor.predict();

    const recent = resultStr.slice(-30);
    const tieRecent = [...recent].filter(ch => ch === 'T').length;
    const tieFlag = recent.length > 0 && tieRecent / recent.length >= 0.1 && resultStr.length >= 10;

    const dudoanStr = tieFlag
        ? `${prediction.recommendation} + Hoà`
        : prediction.recommendation;

    const phienInfo = extractPhienInfoLocal(target);

    const body = {
        'Trạng thái': 'OK',
        status: 'OK',

        table_name: String(tableId),
        'Bàn': String(tableId),

        'Thời gian': target.time || '',
        time: target.time || '',
        lastUpdate,

        'Phiên': phienInfo.Phien,
        Phien: phienInfo.Phien,
        Truong_phien: phienInfo.Truong_phien,
        So_van_da_co: phienInfo.So_van_da_co,

        'Dự đoán': resultStr,
        Predict: resultStr,

        Dudoan: dudoanStr,
        'Dự đoán tiếp theo': dudoanStr,

        Hoa: tieFlag ? 'Có' : 'Không',
        'Hoà': tieFlag ? 'Có' : 'Không',

        BankerProb: prediction.bankerProb,
        PlayerProb: prediction.playerProb,

        'Sự tự tin': prediction.confidence,
        Confidence: prediction.confidence,

        'Điểm B': prediction.scoreB || 0,
        'Điểm sốP': prediction.scoreP || 0,
        'Tổng điểm': prediction.totalScore || 0,

        goodRoad: target.goodRoad || '',
        cards: target.cards || '',
        game_code: target.game_code || '',
        table_id: target.table_id || '',

        field_phien_tim_duoc: phienInfo.Tat_ca_field_nghi_la_phien,

        raw: target
    };

    if (prediction.reason) {
        body['Lý do'] = prediction.reason;
        body.Reason = prediction.reason;
    }

    return {
        statusCode: 200,
        body
    };
}

// ======================
// ROUTE WEB HOME
// ======================
app.get('/', (req, res) => {
    let tables = sortTables(baccaratData).map(item => String(item.table));

    if (!tables.length) {
        tables = [
            '1', '2', '3', '4', '5',
            '6', '7', '8', '9', '10',
            'C01', 'C02', 'C03', 'C04', 'C05',
            'C06', 'C07', 'C08', 'C09', 'C10'
        ];
    }

    const buttonsHtml = tables.map(table => `
        <a class="btn" href="/sexy/${table}">
            <span>Bàn ${table}</span>
            <small>/sexy/${table}</small>
        </a>
    `).join('');

    res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Baccarat API</title>
    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: Arial, sans-serif;
            background:
                radial-gradient(circle at top left, rgba(0, 255, 170, 0.22), transparent 35%),
                radial-gradient(circle at bottom right, rgba(80, 160, 255, 0.22), transparent 35%),
                linear-gradient(135deg, #07070c, #151526, #050508);
            color: white;
            padding: 24px;
        }

        .wrap {
            width: 100%;
            max-width: 980px;
            margin: 0 auto;
            padding: 30px 0;
        }

        .card {
            width: 100%;
            padding: 32px;
            border-radius: 26px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.14);
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(14px);
        }

        .top {
            text-align: center;
            margin-bottom: 28px;
        }

        .badge {
            display: inline-block;
            padding: 8px 14px;
            border-radius: 999px;
            background: rgba(0, 255, 170, 0.14);
            color: #00ffaa;
            font-size: 13px;
            font-weight: 700;
            margin-bottom: 16px;
        }

        h1 {
            margin: 0;
            font-size: 36px;
            letter-spacing: 0.5px;
        }

        .sub {
            color: #cfcfe6;
            line-height: 1.6;
            margin: 14px 0 0;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 14px;
            margin-top: 24px;
        }

        .btn {
            display: block;
            padding: 16px;
            border-radius: 16px;
            text-decoration: none;
            color: #07120d;
            background: linear-gradient(135deg, #00ffaa, #00d084);
            font-weight: 800;
            transition: 0.2s ease;
        }

        .btn:hover {
            transform: translateY(-2px);
            filter: brightness(1.08);
        }

        .btn small {
            display: block;
            margin-top: 6px;
            color: rgba(0, 0, 0, 0.58);
            font-weight: 700;
        }

        .api {
            margin-top: 24px;
            padding: 18px;
            border-radius: 18px;
            background: rgba(0, 0, 0, 0.24);
            color: #cfcfe6;
            line-height: 1.7;
            font-size: 14px;
        }

        code {
            color: #00ffaa;
        }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="card">
            <div class="top">
                <div class="badge">SERVER ONLINE</div>
                <h1>Baccarat API</h1>
                <p class="sub">Chọn bàn bên dưới để xem JSON dự đoán, dữ liệu lấy trực tiếp từ aibcr.me.</p>
            </div>

            <div class="grid">
                ${buttonsHtml}
            </div>

            <div class="api">
                API chính: <code>/sexy/&lt;table_id&gt;</code><br>
                Alias: <code>/sesy/&lt;table_id&gt;</code><br>
                Danh sách endpoint: <code>/api</code><br>
                Danh sách bàn: <code>/tables</code><br>
                Raw data: <code>/raw/&lt;table_id&gt;</code><br>
                API cũ: <code>/api/baccarat</code>, <code>/api/latest</code><br>
                Last update: <code>${lastUpdate || 'chưa có dữ liệu'}</code>
            </div>
        </div>
    </div>
</body>
</html>
    `);
});

// ======================
// API FORM PYTHON CŨ
// ======================
app.get('/api', (req, res) => {
    res.json({
        status: 'OK',
        name: 'Baccarat API',
        source: BASE,
        loggedIn: isLoggedIn,
        lastUpdate,
        totalTables: baccaratData.length,
        home: '/',
        tables: '/tables',
        endpoint: '/sexy/<table_id>',
        alias: '/sesy/<table_id>',
        raw: '/raw/<table_id>',
        old_api_all: '/api/baccarat',
        old_api_latest: '/api/latest',
        examples: [
            '/sexy/1',
            '/sexy/5',
            '/sexy/10',
            '/sexy/C01',
            '/raw/C01'
        ]
    });
});

app.get('/tables', (req, res) => {
    const tables = sortTables(baccaratData).map(item => String(item.table));

    res.json({
        status: 'OK',
        total: tables.length,
        lastUpdate,
        tables,
        endpoints: tables.map(table => `/sexy/${table}`)
    });
});

app.get('/sexy/:tableId', (req, res) => {
    const result = makePredictionForLocalTable(req.params.tableId);
    res.status(result.statusCode).json(result.body);
});

app.get('/sesy/:tableId', (req, res) => {
    const result = makePredictionForLocalTable(req.params.tableId);
    res.status(result.statusCode).json(result.body);
});

app.get('/raw/:tableId', (req, res) => {
    const target = findTableLocal(req.params.tableId);

    if (!target) {
        return res.status(404).json({
            error: `Không tìm thấy bàn ${req.params.tableId}`,
            lastUpdate,
            totalTables: baccaratData.length
        });
    }

    res.json({
        status: 'OK',
        table_name: req.params.tableId,
        raw: target,
        raw_source: target.raw_source || null,
        keys: Object.keys(target),
        source_keys: target.raw_source ? Object.keys(target.raw_source) : []
    });
});

// ======================
// API CŨ GIỮ NGUYÊN
// ======================
app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate,
        total: baccaratData.length
    });
});

app.get('/api/baccarat/:table', (req, res) => {
    const tableName = req.params.table;
    const found = baccaratData.find(item => String(item.table) === String(tableName));

    if (found) {
        res.json({
            success: true,
            data: found,
            lastUpdate
        });
    } else {
        res.status(404).json({
            success: false,
            message: `Không tìm thấy bàn ${tableName}`,
            lastUpdate,
            totalTables: baccaratData.length
        });
    }
});

app.get('/api/latest', (req, res) => {
    const latest = sortTables(baccaratData).slice(0, 10);

    res.json({
        success: true,
        data: latest,
        lastUpdate
    });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT API SERVER - FULL VERSION');
    console.log(`Tài khoản: ${USERNAME}`);
    console.log('========================================');

    console.log('[1] Đăng nhập...');
    const loginOk = await login();

    if (!loginOk) {
        console.error('[ERROR] Đăng nhập thất bại! Kiểm tra lại tài khoản, captcha hoặc web đổi form login.');
        process.exit(1);
    }

    console.log('[2] Vào lobby...');
    await goToLobby();

    console.log('[3] Lấy dữ liệu lần đầu...');
    await fetchBaccaratData();

    if (baccaratData.length === 0) {
        console.warn('[CẢNH BÁO] Không lấy được bàn nào, có thể API yêu cầu thêm token hoặc session đã hết hạn.');
    } else {
        console.log('\n📊 DANH SÁCH BÀN HIỆN TẠI:');

        sortTables(baccaratData).forEach(item => {
            const resultShort = (item.result || '').substring(0, 20) + ((item.result || '').length > 20 ? '...' : '');
            console.log(`   ${String(item.table).padEnd(5)} : ${resultShort.padEnd(25)} | ${item.goodRoad}`);
        });
    }

    autoUpdate();

    app.listen(PORT, '0.0.0.0', () => {
        console.log('\n🚀 API SERVER ĐANG CHẠY:');
        console.log(`   Home:          http://localhost:${PORT}/`);
        console.log(`   API info:      http://localhost:${PORT}/api`);
        console.log(`   Tables:        http://localhost:${PORT}/tables`);
        console.log(`   Sexy bàn 1:    http://localhost:${PORT}/sexy/1`);
        console.log(`   Sexy bàn C01:  http://localhost:${PORT}/sexy/C01`);
        console.log(`   Raw bàn 1:     http://localhost:${PORT}/raw/1`);
        console.log(`   API cũ all:    http://localhost:${PORT}/api/baccarat`);
        console.log(`   API cũ latest: http://localhost:${PORT}/api/latest`);
        console.log('\n⏰ Auto update mỗi 2 giây.');
    });
}

start();
