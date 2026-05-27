#!/usr/bin/env python3
"""
Simulação do Sending Engine — 41 mensagens iniciando às 13:15
VALORES REAIS DA UI DO USUÁRIO (lidos em 27/05/2026)
"""
import math
import random
from datetime import datetime, timedelta

# ============================================================
# CONFIGURAÇÕES ANTI-BAN — VALORES REAIS DA UI
# ============================================================
TYPING_MIN_DELAY_MS = 5100       # 5.1s — da UI
TYPING_MAX_DELAY_MS = 24900      # 24.9s — da UI
MESSAGE_INTERVAL_MIN_S = 59      # 59s — da UI
MESSAGE_INTERVAL_MAX_S = 148     # 148s — da UI
COOLDOWN_MINUTES_MIN = 8         # 8 min — da UI
COOLDOWN_MINUTES_MAX = 13        # 13 min — da UI
COOLDOWN_AFTER_MIN = 5           # 5 msgs — da UI
COOLDOWN_AFTER_MAX = 9           # 9 msgs — da UI
STOP_ON_WARNING = True
SENDING_WINDOW_START = 540       # 9:00 em minutos
SENDING_WINDOW_END = 1020        # 17:00 em minutos
BREAK_WINDOWS = [
    {"start": 720, "end": 795, "label": "Almoço"},  # 12:00-13:15
]
LINK_PREVIEW_ENABLED = False
DAILY_LIMIT_PER_CHIP = 200
HOURLY_LIMIT = 30

# Presença humanizada (constantes do backend, não da UI)
OFFLINE_DELAY_MIN_MS = 3000
OFFLINE_DELAY_MAX_MS = 15000
TYPING_PAUSE_CHANCE = 0.30
TYPING_SPEED_MIN = 6
TYPING_SPEED_MAX = 14

# Chip info — assumindo chip READY (aquecido)
CHIP_PHASE = "ready"

# ============================================================
# GAUSSIAN RANDOM (Box-Muller) — igual ao backend
# ============================================================
def gaussian_random_int(mean, stddev, min_val, max_val):
    u1 = random.random() or 0.0001
    u2 = random.random()
    z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
    value = mean + z0 * stddev
    return max(min_val, min(max_val, round(value)))

def gaussian_random_float(mean, stddev, min_val, max_val):
    u1 = random.random() or 0.0001
    u2 = random.random()
    z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
    value = mean + z0 * stddev
    return max(min_val, min(max_val, value))

def gaussian_delay_seconds(min_s, max_s):
    mean = (min_s + max_s) / 2
    stddev = (max_s - min_s) / 6
    return gaussian_random_int(mean, stddev, min_s, max_s)

# ============================================================
# TYPING DURATION — igual ao backend
# ============================================================
def calculate_typing_duration_ms(text_length=80):
    typing_speed = gaussian_random_float(10, 2.5, TYPING_SPEED_MIN, TYPING_SPEED_MAX)
    duration_ms = (text_length / typing_speed) * 1000
    # DINÂMICO: usa limits da UI
    duration_ms = max(TYPING_MIN_DELAY_MS, min(TYPING_MAX_DELAY_MS, duration_ms))
    # 30% chance of thinking pause
    if random.random() < TYPING_PAUSE_CHANCE:
        duration_ms += random.randint(1000, 4000)
    return round(duration_ms)

# ============================================================
# DELAYED OFFLINE — igual ao backend
# ============================================================
def calculate_offline_delay_ms():
    mean = (OFFLINE_DELAY_MIN_MS + OFFLINE_DELAY_MAX_MS) / 2
    stddev = (OFFLINE_DELAY_MAX_MS - OFFLINE_DELAY_MIN_MS) / 6
    return gaussian_random_int(mean, stddev, OFFLINE_DELAY_MIN_MS, OFFLINE_DELAY_MAX_MS)

# ============================================================
# COOLDOWN TRIGGER — igual ao backend (gaussiano variável)
# ============================================================
def check_cooldown(sent_today):
    if COOLDOWN_AFTER_MIN <= 0 or COOLDOWN_MINUTES_MIN <= 0:
        return None
    
    # Threshold gaussiano variável — igual ao backend
    threshold = gaussian_random_int(
        round((COOLDOWN_AFTER_MIN + COOLDOWN_AFTER_MAX) / 2),
        (COOLDOWN_AFTER_MAX - COOLDOWN_AFTER_MIN) / 6,
        COOLDOWN_AFTER_MIN,
        COOLDOWN_AFTER_MAX
    )
    
    if sent_today > 0 and sent_today % threshold == 0:
        # Duração gaussiana variável — igual ao backend
        duration = gaussian_random_int(
            round((COOLDOWN_MINUTES_MIN + COOLDOWN_MINUTES_MAX) / 2),
            (COOLDOWN_MINUTES_MAX - COOLDOWN_MINUTES_MIN) / 6,
            COOLDOWN_MINUTES_MIN,
            COOLDOWN_MINUTES_MAX
        )
        return duration  # em minutos
    
    return None

# ============================================================
# BREAK WINDOW CHECK
# ============================================================
def get_active_break_window(current_minutes):
    for bw in BREAK_WINDOWS:
        if bw["start"] <= current_minutes < bw["end"]:
            return bw
    return None

def is_within_sending_window(current_minutes):
    if SENDING_WINDOW_START <= SENDING_WINDOW_END:
        return SENDING_WINDOW_START <= current_minutes < SENDING_WINDOW_END
    else:
        return current_minutes >= SENDING_WINDOW_START or current_minutes < SENDING_WINDOW_END

# ============================================================
# SIMULAÇÃO PRINCIPAL
# ============================================================
def simulate(total_messages=41, start_hour=13, start_minute=15, num_simulations=5):
    results = []
    
    for sim in range(num_simulations):
        random.seed(sim * 42 + 7)
        
        # Tempo atual (em segundos desde 00:00)
        current_time_s = start_hour * 3600 + start_minute * 60
        sent_today = 0
        cooldown_until_s = None
        
        log = []
        total_typing_ms = 0
        total_offline_ms = 0
        total_interval_s = 0
        total_cooldown_min = 0
        cooldown_count = 0
        window_closed = False
        
        for msg_num in range(1, total_messages + 1):
            current_minutes = (current_time_s % 86400) // 60
            
            # Checar sending window
            if not is_within_sending_window(current_minutes):
                # Janela fechou! Não pode enviar mais hoje.
                remaining = total_messages - msg_num + 1
                log.append(f"  🛑 JANELA FECHOU às {int(current_minutes//60):02d}:{int(current_minutes%60):02d} — {remaining} mensagens restantes NÃO enviadas!")
                window_closed = True
                break
            
            # Checar break window
            bw = get_active_break_window(current_minutes)
            if bw:
                wait_s = (bw["end"] - current_minutes) * 60
                current_time_s += wait_s
                current_minutes = (current_time_s % 86400) // 60
                log.append(f"  ☕ Break '{bw['label']}' — esperando até {bw['end']//60}:{bw['end']%60:02d}")
            
            # Checar cooldown
            if cooldown_until_s and current_time_s < cooldown_until_s:
                wait_s = cooldown_until_s - current_time_s
                current_time_s = cooldown_until_s
                cooldown_until_s = None
                log.append(f"  🧊 Cooldown — esperando +{wait_s/60:.1f}min")
            
            # --- ENVIAR MENSAGEM ---
            sent_today += 1
            
            # 1. Typing simulation
            typing_ms = calculate_typing_duration_ms(text_length=random.randint(40, 200))
            total_typing_ms += typing_ms
            current_time_s += typing_ms / 1000
            
            # 2. Send (~1s API call)
            current_time_s += 1.0
            
            # 3. Delayed offline
            offline_ms = calculate_offline_delay_ms()
            total_offline_ms += offline_ms
            current_time_s += offline_ms / 1000
            
            # Hora formatada
            h = int((current_time_s % 86400) // 3600)
            m = int((current_time_s % 3600) // 60)
            s = int(current_time_s % 60)
            
            # 4. Check cooldown (pós-envio)
            cooldown_duration = check_cooldown(sent_today)
            if cooldown_duration:
                cooldown_until_s = current_time_s + cooldown_duration * 60
                cooldown_count += 1
                total_cooldown_min += cooldown_duration
                log.append(f"  Msg #{msg_num:2d} às {h:02d}:{m:02d}:{s:02d} | 🧊 Cooldown: {cooldown_duration}min (após {sent_today} msgs)")
            else:
                log.append(f"  Msg #{msg_num:2d} às {h:02d}:{m:02d}:{s:02d}")
            
            # 5. Calcular intervalo para próxima
            if msg_num < total_messages:
                interval_s = gaussian_delay_seconds(MESSAGE_INTERVAL_MIN_S, MESSAGE_INTERVAL_MAX_S)
                interval_s = max(interval_s, MESSAGE_INTERVAL_MIN_S)  # Floor = UI min
                total_interval_s += interval_s
                current_time_s += interval_s
        
        # Hora final
        end_h = int((current_time_s % 86400) // 3600)
        end_m = int((current_time_s % 3600) // 60)
        end_s = int(current_time_s % 60)
        
        total_time_min = (current_time_s - (start_hour * 3600 + start_minute * 60)) / 60
        
        msgs_sent = msg_num if not window_closed else msg_num - 1
        
        results.append({
            "sim": sim + 1,
            "end_h": end_h,
            "end_m": end_m,
            "end_s": end_s,
            "total_min": total_time_min,
            "cooldown_count": cooldown_count,
            "total_cooldown_min": total_cooldown_min,
            "avg_typing_ms": total_typing_ms / max(msgs_sent, 1),
            "avg_offline_ms": total_offline_ms / max(msgs_sent, 1),
            "avg_interval_s": total_interval_s / max(total_messages - 1, 1),
            "msgs_sent": msgs_sent,
            "window_closed": window_closed,
            "log": log,
        })
    
    return results

# ============================================================
# EXECUTAR
# ============================================================
if __name__ == "__main__":
    print("=" * 80)
    print("SIMULAÇÃO — 41 MENSAGENS INICIANDO ÀS 13:15")
    print("VALORES REAIS DA UI (lidos pelo usuário)")
    print("=" * 80)
    print()
    print("CONFIGURAÇÕES ANTI-BAN (DA UI):")
    print(f"  Simulação de digitação:    {TYPING_MIN_DELAY_MS/1000:.1f}s – {TYPING_MAX_DELAY_MS/1000:.1f}s")
    print(f"  Intervalo entre mensagens: {MESSAGE_INTERVAL_MIN_S}s – {MESSAGE_INTERVAL_MAX_S}s (Gaussiano)")
    print(f"  Cooldown após:             {COOLDOWN_AFTER_MIN}-{COOLDOWN_AFTER_MAX} mensagens")
    print(f"  Duração do cooldown:       {COOLDOWN_MINUTES_MIN}-{COOLDOWN_MINUTES_MAX} min")
    print(f"  Janela de envio:           {SENDING_WINDOW_START//60}:{SENDING_WINDOW_START%60:02d} – {SENDING_WINDOW_END//60}:{SENDING_WINDOW_END%60:02d}")
    print(f"  Break windows:             ", end="")
    for bw in BREAK_WINDOWS:
        print(f"{bw['label']} ({bw['start']//60}:{bw['start']%60:02d}–{bw['end']//60}:{bw['end']%60:02d})", end="  ")
    print()
    print(f"  Chip:                      READY (aquecido)")
    print(f"  Presença offline:          {OFFLINE_DELAY_MIN_MS/1000:.0f}–{OFFLINE_DELAY_MAX_MS/1000:.0f}s")
    print(f"  ⚠️  Janela de envio: 9:00–17:00 = apenas 3h45 restantes a partir das 13:15!")
    print()
    
    results = simulate(total_messages=41, start_hour=13, start_minute=15, num_simulations=5)
    
    print("=" * 80)
    print("RESULTADOS DAS 5 SIMULAÇÕES")
    print("=" * 80)
    print()
    
    for r in results:
        status = "🛑 JANELA FECHOU" if r["window_closed"] else "✅ Completo"
        print(f"  Sim #{r['sim']}: {r['msgs_sent']}/41 msgs | Término {r['end_h']:02d}:{r['end_m']:02d} | "
              f"Duração {r['total_min']:.1f}min ({r['total_min']/60:.1f}h) | "
              f"Cooldowns: {r['cooldown_count']} ({r['total_cooldown_min']:.0f}min) | "
              f"Intervalo médio: {r['avg_interval_s']:.1f}s | {status}")
    
    print()
    
    # Verificar se alguma simulação completou
    completed = [r for r in results if not r["window_closed"]]
    window_closed = [r for r in results if r["window_closed"]]
    
    if completed:
        avg_min = sum(r["total_min"] for r in completed) / len(completed)
        print(f"  ✅ Simulações que completaram: {len(completed)}/5 — média {avg_min:.0f}min ({avg_min/60:.1f}h)")
    if window_closed:
        print(f"  🛑 Simulações que NÃO completaram (janela 17:00): {len(window_closed)}/5")
        for r in window_closed:
            print(f"     — Parou às {r['end_h']:02d}:{r['end_m']:02d} com {r['msgs_sent']}/41 mensagens enviadas")
    
    print()
    print("-" * 80)
    print("ANÁLISE CRÍTICA:")
    print("-" * 80)
    
    # Cálculo teórico
    avg_interval = (MESSAGE_INTERVAL_MIN_S + MESSAGE_INTERVAL_MAX_S) / 2
    avg_typing = (TYPING_MIN_DELAY_MS + TYPING_MAX_DELAY_MS) / 2 / 1000
    avg_offline = (OFFLINE_DELAY_MIN_MS + OFFLINE_DELAY_MAX_MS) / 2 / 1000
    avg_per_msg = avg_interval + avg_typing + 1 + avg_offline
    
    # Cooldown: a cada avg_cooldown_after msgs, pausa avg_cooldown_min
    avg_cooldown_after = (COOLDOWN_AFTER_MIN + COOLDOWN_AFTER_MAX) / 2  # 7 msgs
    avg_cooldown_dur = (COOLDOWN_MINUTES_MIN + COOLDOWN_MINUTES_MAX) / 2  # 10.5 min
    num_cooldowns = 41 / avg_cooldown_after  # ~5.9 cooldowns
    
    total_theoretical_min = (41 * avg_per_msg + num_cooldowns * avg_cooldown_dur * 60) / 60
    
    window_remaining_min = (SENDING_WINDOW_END - (13 * 60 + 15))  # 17:00 - 13:15 = 225 min
    
    print(f"  Tempo médio por mensagem: {avg_per_msg:.0f}s ({avg_interval:.0f}s intervalo + {avg_typing:.0f}s typing + {1:.0f}s API + {avg_offline:.0f}s offline)")
    print(f"  41 msgs × {avg_per_msg:.0f}s = {41*avg_per_msg/60:.0f} min (sem cooldown)")
    print(f"  ~{num_cooldowns:.0f} cooldowns × {avg_cooldown_dur:.0f} min = {num_cooldowns*avg_cooldown_dur:.0f} min de pausa")
    print(f"  Total estimado: ~{total_theoretical_min:.0f} min ({total_theoretical_min/60:.1f}h)")
    print(f"  Janela restante: {window_remaining_min} min ({window_remaining_min/60:.1f}h) até 17:00")
    print()
    
    if total_theoretical_min > window_remaining_min:
        overflow = total_theoretical_min - window_remaining_min
        print(f"  ⚠️  PROBLEMA: 41 mensagens NÃO CABEM na janela 13:15–17:00!")
        print(f"  Estimado: {total_theoretical_min:.0f} min | Disponível: {window_remaining_min} min")
        print(f"  Excesso: {overflow:.0f} min — mensagens restantes continuam no dia seguinte a partir das 09:00")
        msgs_fit = int(window_remaining_min * 60 / avg_per_msg)
        # Descontar cooldowns
        cooldowns_fit = msgs_fit / avg_cooldown_after
        msgs_fit = int((window_remaining_min * 60 - cooldowns_fit * avg_cooldown_dur * 60) / avg_per_msg)
        print(f"  Estimativa: ~{msgs_fit} mensagens cabem antes das 17:00")
        print(f"  Restantes: ~{41 - msgs_fit} mensagens ficam para o dia seguinte (09:00)")
    else:
        print(f"  ✅ Todas as 41 mensagens cabem na janela 13:15–17:00!")
    
    print()
    
    # Log detalhado da simulação 1
    print("=" * 80)
    print("LOG DETALHADO — Simulação 1")
    print("=" * 80)
    for line in results[0]["log"]:
        print(line)
    
    print()
    
    # Timeline visual
    print("=" * 80)
    print("TIMELINE — Simulação 1")
    print("=" * 80)
    r = results[0]
    print(f"  13:15 ──── Início do disparo")
    for line in r["log"]:
        if "🧊" in line:
            time_part = line.split("às")[1].split("|")[0].strip() if "às" in line else ""
            detail = line.split("|")[1].strip() if "|" in line else ""
            print(f"  {time_part} ──── 🧊 {detail}")
        if "🛑" in line:
            print(f"  {'─'*20} 🛑 JANELA FECHOU")
    if not r["window_closed"]:
        print(f"  {r['end_h']:02d}:{r['end_m']:02d} ──── Fim ({r['total_min']:.0f} min total)")
    print()
