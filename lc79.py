#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LC79 Tài/Xỉu Auto JSON - Fixed AI (Full)
- Giữ nguyên Flask, polling, lưu JSON...
- Sửa/ổn định thuật toán dự đoán:
    * Markov cấp-2 đúng chiều thời gian (oldest->newest)
    * Update bias chính xác theo phiên dự đoán
    * Ensemble weights ổn định, scale hợp lý
    * Triple (BỆT) được xử lý thận trọng
    * Trả về Du_doan giống tiền sử (TÀI/XỈU), in debug
- Tương thích Python 3.13+
"""

import os, time, json, requests, random, math
from collections import deque, Counter
from datetime import datetime
from flask import Flask, send_file, jsonify
from threading import Thread, Lock

# ---------- Cấu hình ----------
API_URL = "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=1cc145815dbbe5007e9ce49a8cf0c95f"
POLL_INTERVAL = 6        # seconds between polls
HISTORY_LEN = 200        # lưu đủ dài để Markov có dữ liệu
LC79_FILE = "lc79.json"
PORT = int(os.environ.get("PORT", 5000))

app = Flask(__name__)
lock = Lock()
history = deque(maxlen=HISTORY_LEN)  # newest-first: history[0] là phiên gần nhất

# ---------- Bias learning store ----------
# bias[pred] = {"wins":int, "losses":int, "bias":float}
bias = {"TÀI": {"wins": 0, "losses": 0, "bias": 0.0},
        "XỈU": {"wins": 0, "losses": 0, "bias": 0.0}}

# store last prediction target phien
last_pred = None
last_pred_for_phien = None

# ---------- Utilities ----------
def atomic_write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=4)
    os.replace(tmp, path)

def compute_ket_qua(dice):
    """Trả về 'TÀI', 'XỈU' hoặc 'BỆT'"""
    s = sum(dice)
    if dice[0] == dice[1] == dice[2]:
        return "BỆT"
    return "XỈU" if s <= 10 else "TÀI"

def extract_latest(resp_json):
    """Extract latest item from API response"""
    lst = resp_json.get("list") or resp_json.get("data") or []
    if not lst:
        return None
    latest = lst[0]
    # đảm bảo dices tuple of ints (xuc_xac_1..3)
    dices = latest.get("dices") or latest.get("dice") or latest.get("values") or [0,0,0]
    # normalize dice: sometimes API có kiểu khác
    try:
        dice_tuple = tuple(int(d) for d in dices[:3])
    except Exception:
        dice_tuple = (0,0,0)
    return {"phien": latest.get("id", 0), "dice": dice_tuple}

def apply_bias_additive(pred, score):
    """Trả về score đã cộng thêm bias (bias có thể dương/âm)"""
    b = bias.get(pred, {}).get("bias", 0.0)
    return score + b

# ---------- Fix update_bias: học theo đúng phiên dự đoán ----------
def update_bias_for_prediction(pred, actual):
    """
    pred: "TÀI" or "XỈU" (prediction made earlier)
    actual: "TÀI" or "XỈU" (actual result now)
    Cập nhật wins/losses và bias value.
    """
    if pred not in bias or actual not in ("TÀI","XỈU"):
        return
    s = bias[pred]
    if pred == actual:
        s["wins"] += 1
    else:
        s["losses"] += 1
    total = s["wins"] + s["losses"]
    # smoothing + target bias in [-0.5,0.5]
    win_rate = (s["wins"] + 1.0) / (total + 2.0)
    target = (win_rate - 0.5)  # -0.5..+0.5
    # update bias with momentum
    s["bias"] = 0.85 * s["bias"] + 0.15 * target
    # clamp to avoid extreme influence
    s["bias"] = max(min(s["bias"], 0.5), -0.5)

# ---------- Predict function (fixed and stable) ----------
def predict_tai_xiu_ai(hist, lookback=120):
    """
    predict_tai_xiu_ai - bản sửa chữa chính
    - hist: list newest-first (history[0] là mới nhất)
    - lookback: số phiên cũ tối đa xem xét (oldest->newest sẽ được dùng cho Markov)
    Trả về: prediction string "TÀI" hoặc "XỈU"
    """
    # sanity
    if not hist:
        return random.choice(["TÀI","XỈU"])

    # build results list in chronological order: oldest -> newest
    # take most recent 'lookback' entries but then reverse to oldest-first
    sliced = list(hist)[:lookback]          # newest-first slice
    chrono = list(reversed(sliced))         # now oldest-first
    results = [compute_ket_qua(h["dice"]) for h in chrono if compute_ket_qua(h["dice"]) in ("TÀI","XỈU","BỆT")]

    # if too few T/X observations, fallback to random
    tx_only = [r for r in results if r in ("TÀI","XỈU")]
    if len(tx_only) < 6:
        return random.choice(["TÀI","XỈU"])

    # --- detect last non-BET result (newest) ---
    # get last element in chrono that is TÀI/XỈU (newest)
    last = None
    for r in reversed(results):
        if r in ("TÀI","XỈU"):
            last = r
            break
    if last is None:
        return random.choice(["TÀI","XỈU"])

    # compute streak (on newest side)
    streak = 0
    for r in reversed(results):
        if r == last:
            streak += 1
        elif r == "BỆT":
            break
        else:
            break

    # --- streak rule (short follow, long reverse) ---
    if streak <= 3:
        streak_pred = last
        streak_conf = 0.55 + 0.03 * streak   # e.g. 0.58..0.64
    else:
        streak_pred = "XỈU" if last == "TÀI" else "TÀI"
        streak_conf = 0.55 + 0.02 * (streak - 3)

    # --- Markov bậc-2 (oldest->newest) ---
    # Build counts: (prev1, prev2) -> next where prev1 is earlier than prev2
    markov_counts = {}
    # results list contains possibly "BỆT" entries; we skip those when building TX sequences
    tx_seq = [r for r in results if r in ("TÀI","XỈU")]
    for i in range(len(tx_seq) - 2):
        prev2 = tx_seq[i]     # older
        prev1 = tx_seq[i+1]   # middle
        nxt   = tx_seq[i+2]   # newer
        key = (prev2, prev1)
        if key not in markov_counts:
            markov_counts[key] = {"TÀI": 0, "XỈU": 0}
        markov_counts[key][nxt] += 1

    # context is the two most recent TX in chronological order
    if len(tx_seq) >= 2:
        ctx = (tx_seq[-2], tx_seq[-1])
        ctx_counts = markov_counts.get(ctx)
        if ctx_counts:
            t = ctx_counts["TÀI"] + ctx_counts["XỈU"]
            p_tai = (ctx_counts["TÀI"] + 1) / (t + 2)
            p_xiu = (ctx_counts["XỈU"] + 1) / (t + 2)
        else:
            # fallback to global freq with smoothing
            cnt = Counter(tx_seq)
            p_tai = (cnt["TÀI"] + 1) / (len(tx_seq) + 2)
            p_xiu = (cnt["XỈU"] + 1) / (len(tx_seq) + 2)
    else:
        cnt = Counter(tx_seq)
        p_tai = (cnt["TÀI"] + 1) / (len(tx_seq) + 2)
        p_xiu = (cnt["XỈU"] + 1) / (len(tx_seq) + 2)

    markov_pred = "TÀI" if p_tai > p_xiu else "XỈU"
    # confidence from markov: difference scaled
    markov_conf = 0.5 + abs(p_tai - p_xiu) * 0.8  # [0.5 .. 1.3] but will be normalized later

    # --- pair / triple signal from most recent actual roll (newest hist[0]) ---
    recent_dice = hist[0]["dice"]
    is_triple = (recent_dice[0] == recent_dice[1] == recent_dice[2])
    has_pair = (recent_dice[0]==recent_dice[1]!=recent_dice[2]) or (recent_dice[0]==recent_dice[2]!=recent_dice[1]) or (recent_dice[1]==recent_dice[2]!=recent_dice[0])

    pair_pred = None
    pair_conf = 0.0
    if is_triple:
        # penalize strong TX prediction (we'll reduce confidence later)
        pass
    elif has_pair:
        a,b,c = recent_dice
        # heuristic: if two numbers >=5 lean TÀI; two numbers <=2 lean XỈU else lean to last
        high_count = sum(1 for v in (a,b,c) if v >= 5)
        low_count  = sum(1 for v in (a,b,c) if v <= 2)
        if high_count >= 2:
            pair_pred, pair_conf = "TÀI", 0.58
        elif low_count >= 2:
            pair_pred, pair_conf = "XỈU", 0.58
        else:
            pair_pred, pair_conf = last, 0.52

    # --- Ensemble combine (stable scaling) ---
    # We'll compute normalized scores in [0,1] then apply bias additively
    # components: streak_conf (mapped to [0,1]), markov_diff (abs diff), pair_conf
    # Normalize streak_conf roughly to [0.5..0.8]
    def norm_conf(c):
        return max(0.0, min(1.0, (c - 0.45) / 0.55))  # maps 0.45->0, 1.0->1

    s_conf = norm_conf(streak_conf)
    m_strength = abs(p_tai - p_xiu)  # 0..1
    m_conf = norm_conf(markov_conf)  # roughly correlated to m_strength

    # base scores
    score_T = 0.0
    score_X = 0.0

    # streak votes
    if streak_pred == "TÀI":
        score_T += 0.45 * s_conf
    else:
        score_X += 0.45 * s_conf

    # markov votes (use p_tai/p_xiu directly)
    score_T += 0.4 * p_tai
    score_X += 0.4 * p_xiu

    # pair votes
    if pair_pred == "TÀI":
        score_T += 0.12 * pair_conf
    elif pair_pred == "XỈU":
        score_X += 0.12 * pair_conf

    # apply learned bias additively but scaled small
    score_T = apply_bias_additive("TÀI", score_T)
    score_X = apply_bias_additive("XỈU", score_X)

    # avoid zeros
    score_T = max(score_T, 1e-6)
    score_X = max(score_X, 1e-6)

    # normalize to probabilities
    total = score_T + score_X
    prob_T = score_T / total
    prob_X = score_X / total

    # final pick
    final_pred = "TÀI" if prob_T > prob_X else "XỈU"
    final_conf = max(prob_T, prob_X)  # in (0.5,1.0)

    # reduce confidence if recent was triple (BỆT)
    if is_triple:
        final_conf *= 0.6

    # safety: if final_conf low, fallback to markov_pred if markov was stronger
    if final_conf < 0.53:
        # compare markov strength
        if abs(p_tai - p_xiu) >= 0.12:
            final_pred = markov_pred
            final_conf = 0.52 + abs(p_tai - p_xiu) * 0.4
        else:
            final_pred = random.choice(["TÀI","XỈU"])
            final_conf = 0.51

    # debug print (you can remove later)
    print(f"[AI-FIX] last={last} streak={streak} markov_ctx={ ('NA' if len(tx_seq)<2 else (tx_seq[-2], tx_seq[-1])) } pT={prob_T:.3f} pX={prob_X:.3f} -> {final_pred} conf={final_conf:.3f} biasT={bias['TÀI']['bias']:.3f} biasX={bias['XỈU']['bias']:.3f}")
    return final_pred

# ---------- Poll loop (with corrected bias update timing) ----------
def poll_loop():
    global last_pred, last_pred_for_phien
    last_seen_phien = None

    while True:
        try:
            r = requests.get(API_URL, timeout=8)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"[{datetime.now()}] API Error: {e}")
            time.sleep(POLL_INTERVAL)
            continue

        latest = extract_latest(data)
        if not latest:
            time.sleep(POLL_INTERVAL)
            continue

        phien, dice = latest["phien"], latest["dice"]

        # Nếu phiên mới đến (different phien)
        if phien != last_seen_phien:
            # Nếu trước đây ta đã có 1 dự đoán cho phien này (last_pred_for_phien == phien)
            # thì dùng dice hiện tại (kết quả thực) để update bias cho last_pred.
            if last_pred is not None and last_pred_for_phien is not None and last_pred_for_phien == phien:
                actual = compute_ket_qua(dice)
                if actual in ("TÀI","XỈU"):
                    update_bias_for_prediction(last_pred, actual)
                    print(f"[BIAS] Updated bias for pred={last_pred} with actual={actual} | bias now: {bias}")

            # Append latest into history (newest-first)
            history.appendleft({"phien": phien, "dice": dice})
            ket_qua = compute_ket_qua(dice)

            # Now produce a prediction for the next phien (phien+1)
            du_doan = predict_tai_xiu_ai(list(history))
            # store last_pred and target phien
            last_pred = du_doan
            last_pred_for_phien = phien + 1
            last_seen_phien = phien

            info = {
                "id":KuBinDev,
                "Phien": phien,
                "Xuc_xac_1": dice[0],
                "Xuc_xac_2": dice[1],
                "Xuc_xac_3": dice[2],
                "Tong": sum(dice),
                "Ket_qua": ket_qua,
                "Phien_hien_tai": phien + 1,
                "Du_doan": du_doan
            }

            with lock:
                atomic_write_json(LC79_FILE, info)

            print(f"[{datetime.now()}] Phien {phien} | Ket_qua {ket_qua} | Du_doan {du_doan} | last_pred_for_phien={last_pred_for_phien}")

        time.sleep(POLL_INTERVAL)

# ---------- Flask API ----------
thread_started = False
def ensure_thread():
    global thread_started
    if not thread_started:
        Thread(target=poll_loop, daemon=True).start()
        thread_started = True
        print("[LC79-FIX] Background thread started")

@app.route("/lc79")
def serve_lc79():
    ensure_thread()
    if not os.path.exists(LC79_FILE):
        return jsonify({
            "Phien": 0, "Xuc_xac_1": 0, "Xuc_xac_2": 0, "Xuc_xac_3": 0,
            "Tong": 0, "Ket_qua": "", "Phien_hien_tai": 0, "Du_doan": ""
        })
    return send_file(LC79_FILE)

# ---------- Init ----------
if not os.path.exists(LC79_FILE):
    atomic_write_json(LC79_FILE, {
        "Phien": 0, "Xuc_xac_1": 0, "Xuc_xac_2": 0, "Xuc_xac_3": 0,
        "Tong": 0, "Ket_qua": "", "Phien_hien_tai": 0, "Du_doan": ""
    })

ensure_thread()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
