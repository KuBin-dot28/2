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
// THUẬT TOÁN DỰ ĐOÁN ỔN ĐỊNH HƠN
// Chỉ sửa thuật toán dự đoán
// ======================
class UnifiedBaccaratPredictor {
    constructor() {
        this.history = [];

        // Giữ thuật toán ổn định hơn nhưng không để bàn nào cũng NEUTRAL
        this.maxLookback = 60;
        this.minNonTie = 5;
        this.bankerBase = 0.506;
    }

    addResult(result) {
        const r = String(result || '').trim().toUpperCase();

        if (!['B', 'P', 'T'].includes(r)) return false;

        this.history.push(r);

        if (this.history.length > 160) {
            this.history = this.history.slice(-160);
        }

        return true;
    }

    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    getNonTieHistory(limit = null) {
        const nonTies = this.history.filter(r => r === 'B' || r === 'P');
        return limit ? nonTies.slice(-limit) : nonTies;
    }

    getLastNonTie() {
        const nonTies = this.getNonTieHistory();

        if (!nonTies.length) return 'B';

        return nonTies[nonTies.length - 1];
    }

    getTieRate(limit = 30) {
        const recent = this.history.slice(-limit);

        if (!recent.length) return 0;

        const ties = recent.filter(r => r === 'T').length;
        return ties / recent.length;
    }

    smoothProbability(bankerCount, totalCount, prior = this.bankerBase, strength = 12) {
        if (totalCount <= 0) return prior;

        return ((prior * strength) + bankerCount) / (strength + totalCount);
    }

    calculateFrequencyScore() {
        const recentLong = this.getNonTieHistory(36);
        const recentShort = this.getNonTieHistory(14);

        const bLong = recentLong.filter(r => r === 'B').length;
        const bShort = recentShort.filter(r => r === 'B').length;

        const longProb = this.smoothProbability(bLong, recentLong.length, this.bankerBase, 14);
        const shortProb = this.smoothProbability(bShort, recentShort.length, this.bankerBase, 18);

        const bankerProb = (longProb * 0.65) + (shortProb * 0.35);

        return {
            B: bankerProb,
            P: 1 - bankerProb
        };
    }

    calculateStreakScore() {
        const nonTies = this.getNonTieHistory(30);

        if (nonTies.length < 3) {
            return {
                B: this.bankerBase,
                P: 1 - this.bankerBase
            };
        }

        const last = nonTies[nonTies.length - 1];
        let streak = 1;

        for (let i = nonTies.length - 2; i >= 0; i--) {
            if (nonTies[i] !== last) break;
            streak++;
        }

        let edge = 0;

        if (streak === 2) edge = 0.025;
        else if (streak === 3) edge = 0.04;
        else if (streak === 4) edge = 0.045;
        else if (streak >= 5) edge = 0.035;

        const bankerProb = last === 'B'
            ? 0.5 + edge
            : 0.5 - edge;

        return {
            B: bankerProb,
            P: 1 - bankerProb
        };
    }

    calculateChopScore() {
        const recent = this.getNonTieHistory(14);

        if (recent.length < 6) {
            return {
                B: this.bankerBase,
                P: 1 - this.bankerBase
            };
        }

        let changes = 0;

        for (let i = 1; i < recent.length; i++) {
            if (recent[i] !== recent[i - 1]) {
                changes++;
            }
        }

        const chopRate = changes / (recent.length - 1);
        const last = recent[recent.length - 1];

        let bankerProb = this.bankerBase;

        if (chopRate >= 0.7) {
            bankerProb = last === 'B' ? 0.465 : 0.535;
        } else if (chopRate <= 0.35) {
            bankerProb = last === 'B' ? 0.53 : 0.47;
        }

        return {
            B: bankerProb,
            P: 1 - bankerProb
        };
    }

    calculateDerivedRoadsScore() {
        const nonTies = this.getNonTieHistory(40);

        if (nonTies.length < 8) {
            return {
                B: this.bankerBase,
                P: 1 - this.bankerBase
            };
        }

        let sameTwoBack = 0;
        let total = 0;

        for (let i = 2; i < nonTies.length; i++) {
            total++;

            if (nonTies[i] === nonTies[i - 2]) {
                sameTwoBack++;
            }
        }

        const rate = total ? sameTwoBack / total : 0.5;
        const last = nonTies[nonTies.length - 1];
        const twoBack = nonTies[nonTies.length - 2];

        let bankerProb = this.bankerBase;

        if (rate >= 0.62) {
            bankerProb = twoBack === 'B' ? 0.54 : 0.46;
        } else if (rate <= 0.38) {
            bankerProb = last === 'B' ? 0.535 : 0.465;
        }

        return {
            B: bankerProb,
            P: 1 - bankerProb
        };
    }

    calculatePatternScore() {
        const nonTies = this.getNonTieHistory(this.maxLookback);

        if (nonTies.length < 12) {
            return {
                B: this.bankerBase,
                P: 1 - this.bankerBase
            };
        }

        const sizes = [4, 3, 2];
        let weightedBanker = 0;
        let totalWeight = 0;

        for (const size of sizes) {
            if (nonTies.length <= size + 2) continue;

            const currentPattern = nonTies.slice(-size).join('');
            let bNext = 0;
            let pNext = 0;

            for (let i = 0; i <= nonTies.length - size - 2; i++) {
                const oldPattern = nonTies.slice(i, i + size).join('');

                if (oldPattern === currentPattern) {
                    const next = nonTies[i + size];

                    if (next === 'B') bNext++;
                    else if (next === 'P') pNext++;
                }
            }

            const total = bNext + pNext;

            if (total >= 2) {
                const smoothProb = this.smoothProbability(bNext, total, this.bankerBase, 8);

                let weight = 1.0;
                if (size === 4) weight = 1.35;
                else if (size === 3) weight = 1.1;
                else if (size === 2) weight = 0.8;

                const sampleWeight = this.clamp(total / 5, 0.4, 1.0);
                const finalWeight = weight * sampleWeight;

                weightedBanker += smoothProb * finalWeight;
                totalWeight += finalWeight;
            }
        }

        if (!totalWeight) {
            return {
                B: this.bankerBase,
                P: 1 - this.bankerBase
            };
        }

        const bankerProb = weightedBanker / totalWeight;

        return {
            B: bankerProb,
            P: 1 - bankerProb
        };
    }

    predict() {
        const nonTies = this.getNonTieHistory();

        if (nonTies.length < this.minNonTie) {
            return {
                recommendation: 'NEUTRAL',
                confidence: 'YẾU',
                bankerProb: 50,
                playerProb: 50,
                scoreB: 0,
                scoreP: 0,
                totalScore: 0,
                reason: `Chưa đủ dữ liệu ổn định (cần >= ${this.minNonTie} kết quả B/P)`
            };
        }

        const signals = [
            {
                name: 'Tần suất',
                value: this.calculateFrequencyScore(),
                weight: 0.32
            },
            {
                name: 'Chuỗi',
                value: this.calculateStreakScore(),
                weight: 0.18
            },
            {
                name: 'Đảo cầu',
                value: this.calculateChopScore(),
                weight: 0.16
            },
            {
                name: 'Nhịp cầu',
                value: this.calculateDerivedRoadsScore(),
                weight: 0.16
            },
            {
                name: 'Mẫu lặp',
                value: this.calculatePatternScore(),
                weight: 0.18
            }
        ];

        let bankerProb = 0;
        let totalWeight = 0;

        for (const signal of signals) {
            bankerProb += signal.value.B * signal.weight;
            totalWeight += signal.weight;
        }

        bankerProb = totalWeight > 0 ? bankerProb / totalWeight : this.bankerBase;

        // Làm mượt xác suất để dự đoán ổn định hơn
        const shrink = 0.72;
        bankerProb = 0.5 + ((bankerProb - 0.5) * shrink);

        // Nếu Hoà gần đây nhiều thì giảm độ lệch, nhưng không kéo quá mạnh về NEUTRAL
        const tieRate = this.getTieRate(30);
        if (tieRate >= 0.1) {
            const tieShrink = this.clamp(1 - tieRate, 0.82, 0.96);
            bankerProb = 0.5 + ((bankerProb - 0.5) * tieShrink);
        }

        // Không cho xác suất quá ảo
        bankerProb = this.clamp(bankerProb, 0.43, 0.57);

        const playerProb = 1 - bankerProb;
        const bankerPercent = Math.round(bankerProb * 100);
        const playerPercent = 100 - bankerPercent;

        const edge = Math.abs(bankerProb - 0.5);

        // Sửa lỗi bàn nào cũng NEUTRAL:
        // Mặc định vẫn chọn BANKER/PLAYER, chỉ NEUTRAL khi cực sát 50/50.
        let recommendation = bankerProb >= playerProb ? 'BANKER' : 'PLAYER';
        let confidence = 'YẾU';

        if (edge < 0.006) {
            recommendation = 'NEUTRAL';
        }

        if (edge >= 0.05) {
            confidence = 'MẠNH';
        } else if (edge >= 0.025) {
            confidence = 'TRUNG BÌNH';
        } else {
            confidence = 'YẾU';
        }

        const scoreB = Math.round(bankerProb * 1000);
        const scoreP = Math.round(playerProb * 1000);

        const reason = signals.map(signal => {
            return `${signal.name}:B${Math.round(signal.value.B * 100)}-P${Math.round(signal.value.P * 100)}`;
        }).join(' | ');

        return {
            recommendation,
            confidence,
            bankerProb: bankerPercent,
            playerProb: playerPercent,
            scoreB,
            scoreP,
            totalScore: scoreB + scoreP,
            reason
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

    // Chỉ thêm "+ Hoà" khi dự đoán là BANKER hoặc PLAYER.
    // Không còn "NEUTRAL + Hoà".
    const dudoanStr = tieFlag && prediction.recommendation !== 'NEUTRAL'
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
