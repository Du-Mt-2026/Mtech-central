#!/usr/bin/env python3
"""
Simulação do Sending Engine — 41 mensagens iniciando às 13:15
Usa o MESMO algoritmo do backend: Box-Muller Gaussian, cooldown variável,
typing duration, break windows, delayed offline.
"""
import math
import random
from datetime import datetime, timedelta

# ============================================================
# CONFIGURAÇÕES ANTI-BAN (da UI do usuário)
# ============================================================
TYPING_MIN_DELAY_MS = 500       # 0.5s — typingMinDelay da UI
TYPING_MAX_DELAY_MS = 4500      # 4.5s — typingMaxDelay da UI
MESSAGE_INTERVAL_MIN_S = 45     # 45s — messageIntervalMin da UI
MESSAGE_INTERVAL_MAX_S = 90     # 90s — messageIntervalMax da UI
COOLDOWN_MINUTES_MIN = 19       # 19 min — cooldownMinutes da UI
COOLDOWN_MINUTES_MAX = 30       # 30 min — cooldownMinutesMax da UI
COOLDOWN_AFTER_MIN = 5          # 5 msgs — cooldownAfterMessages da UI
COOLDOWN_AFTER_MAX = 15         # 15 msgs — cooldownAfterMessagesMax da UI
STOP_ON_WARNING = True
SENDING_WINDOW_START = 480      # 8:00 em minutos
SENDING_WINDOW_END = 1260       # 21:00 em minutos
BREAK_WINDOWS = [
    {"start": 720, "end": 780, "label": "Almoço"},  # 12:00-13:00
]
LINK_PREVIEW_ENABLED = False
DAILY_LIMIT_PER_CHIP = 200
HOURLY_LIMIT = 30

# Presença humanizada
OFFLINE_DELAY_MIN_MS = 3000
OFFLINE_DELAY_MAX_MS = 15000
TYPING_PAUSE_CHANCE = 0.30

# Chip info — assumindo chip READY (aquecido)
CHIP_PHASE = "ready"
WARMING_ENABLED = True

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
    """Calcula duração de digitação baseada no tamanho da mensagem."""
    typing_speed = gaussian_random_float(10, 2.5, 6, 14)  # chars/s
    duration_ms = (text_length / typing_speed) * 1000
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
# COOLDOWN TRIGGER — igual ao backend
# ============================================================
def check_cooldown(sent_today):
    """Verifica se cooldown deve ser acionado (pós-envio)."""
    if COOLDOWN_AFTER_MIN <= 0 or COOLDOWN_MINUTES_MIN <= 0:
        return None
    
    # Threshold gaussiano variável
    threshold = gaussian_random_int(
        round((COOLDOWN_AFTER_MIN + COOLDOWN_AFTER_MAX) / 2),
        (COOLDOWN_AFTER_MAX - COOLDOWN_AFTER_MIN) / 6,
        COOLDOWN_AFTER_MIN,
        COOLDOWN_AFTER_MAX
    )
    
    if sent_today > 0 and sent_today % threshold == 0:
        # Duração gaussiana variável
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
        random.seed(sim * 42 + 7)  # Reprodutível por simulação, mas variado entre elas
        
        # Tempo atual (em segundos desde 00:00)
        current_time_s = start_hour * 3600 + start_minute * 60
        sent_today = 0
        cooldown_until_s = None  # Timestamp em segundos
        
        log = []
        total_typing_ms = 0
        total_offline_ms = 0
        total_interval_s = 0
        total_cooldown_min = 0
        cooldown_count = 0
        break_waits = 0
        
        for msg_num in range(1, total_messages + 1):
            # Converter para minutos para checar janelas
            current_minutes = (current_time_s % 86400) // 60
            
            # Checar sending window
            if not is_within_sending_window(current_minutes):
                # Esperar até o início da janela (8:00 do dia seguinte)
                next_day_start_s = ((current_time_s // 86400) + 1) * 86400 + SENDING_WINDOW_START * 60
                wait_s = next_day_start_s - current_time_s
                current_time_s += wait_s
                log.append(f"  ⏸ Fora da janela de envio, esperando até 8:00 (+{wait_s/60:.0f}min)")
            
            # Checar break window
            bw = get_active_break_window(current_minutes)
            while bw:
                # Esperar até o fim do break
                wait_s = (bw["end"] - current_minutes) * 60
                current_time_s += wait_s
                current_minutes = (current_time_s % 86400) // 60
                bw = get_active_break_window(current_minutes)
                break_waits += 1
                log.append(f"  ☕ Break window '{bw['label']}', esperando até {bw['end']//60}:{bw['end']%60:02d}")
            
            # Checar cooldown
            if cooldown_until_s and current_time_s < cooldown_until_s:
                wait_s = cooldown_until_s - current_time_s
                current_time_s = cooldown_until_s
                cooldown_until_s = None
                log.append(f"  🧊 Em cooldown, esperando +{wait_s/60:.1f}min")
            
            # --- ENVIAR MENSAGEM ---
            sent_today += 1
            
            # 1. Typing simulation
            typing_ms = calculate_typing_duration_ms(text_length=random.randint(40, 200))
            total_typing_ms += typing_ms
            current_time_s += typing_ms / 1000  # Avança o relógio pelo tempo de digitação
            
            # 2. Send (assumindo ~1s para API call)
            current_time_s += 1.0
            
            # 3. Delayed offline
            offline_ms = calculate_offline_delay_ms()
            total_offline_ms += offline_ms
            current_time_s += offline_ms / 1000
            
            # Hora formatada do envio
            h = int((current_time_s % 86400) // 3600)
            m = int((current_time_s % 3600) // 60)
            s = int(current_time_s % 60)
            
            # 4. Check cooldown (pós-envio) — igual ao backend
            cooldown_duration = check_cooldown(sent_today)
            if cooldown_duration:
                cooldown_until_s = current_time_s + cooldown_duration * 60
                cooldown_count += 1
                total_cooldown_min += cooldown_duration
                log.append(f"  Msg #{msg_num:2d} enviada às {h:02d}:{m:02d}:{s:02d} | Cooldown acionado: {cooldown_duration}min (após {sent_today} msgs, threshold={COOLDOWN_AFTER_MIN}-{COOLDOWN_AFTER_MAX})")
            else:
                log.append(f"  Msg #{msg_num:2d} enviada às {h:02d}:{m:02d}:{s:02d}")
            
            # 5. Calcular intervalo para próxima mensagem (NÃO para a última)
            if msg_num < total_messages:
                interval_s = gaussian_delay_seconds(MESSAGE_INTERVAL_MIN_S, MESSAGE_INTERVAL_MAX_S)
                # Floor: nunca menor que messageIntervalMin
                interval_s = max(interval_s, MESSAGE_INTERVAL_MIN_S)
                
                # Para chips ready, usar intervalo normal (sem multiplier de warming)
                # Warming mode = normal (multiplier = 1)
                
                total_interval_s += interval_s
                current_time_s += interval_s
        
        # Hora final
        end_h = int((current_time_s % 86400) // 3600)
        end_m = int((current_time_s % 3600) // 60)
        end_s = int(current_time_s % 60)
        
        total_time_min = (current_time_s - (start_hour * 3600 + start_minute * 60)) / 60
        
        results.append({
            "sim": sim + 1,
            "end_h": end_h,
            "end_m": end_m,
            "end_s": end_s,
            "total_min": total_time_min,
            "cooldown_count": cooldown_count,
            "total_cooldown_min": total_cooldown_min,
            "avg_typing_ms": total_typing_ms / total_messages,
            "avg_offline_ms": total_offline_ms / total_messages,
            "avg_interval_s": total_interval_s / (total_messages - 1),
            "log": log,
        })
    
    return results

# ============================================================
# EXECUTAR
# ============================================================
if __name__ == "__main__":
    print("=" * 80)
    print("SIMULAÇÃO DO SENDING ENGINE — 41 MENSAGENS INICIANDO ÀS 13:15")
    print("=" * 80)
    print()
    print("CONFIGURAÇÕES ANTI-BAN (da UI):")
    print(f"  Intervalo entre mensagens: {MESSAGE_INTERVAL_MIN_S}-{MESSAGE_INTERVAL_MAX_S}s (Gaussiano)")
    print(f"  Simulação de digitação:     {TYPING_MIN_DELAY_MS/1000:.1f}-{TYPING_MAX_DELAY_MS/1000:.1f}s")
    print(f"  Cooldown após:              {COOLDOWN_AFTER_MIN}-{COOLDOWN_AFTER_MAX} mensagens")
    print(f"  Duração do cooldown:        {COOLDOWN_MINUTES_MIN}-{COOLDOWN_MINUTES_MAX} min")
    print(f"  Janela de envio:            {SENDING_WINDOW_START//60}:{SENDING_WINDOW_START%60:02d} - {SENDING_WINDOW_END//60}:{SENDING_WINDOW_END%60:02d}")
    print(f"  Break windows:              ", end="")
    for bw in BREAK_WINDOWS:
        print(f"{bw['label']} ({bw['start']//60}:{bw['start']%60:02d}-{bw['end']//60}:{bw['end']%60:02d})", end="  ")
    print()
    print(f"  Chip:                       READY (aquecido)")
    print(f"  Delayed offline:            {OFFLINE_DELAY_MIN_MS/1000:.0f}-{OFFLINE_DELAY_MAX_MS/1000:.0f}s (presença)")
    print()
    
    results = simulate(total_messages=41, start_hour=13, start_minute=15, num_simulations=5)
    
    print("=" * 80)
    print("RESULTADOS DAS 5 SIMULAÇÕES (distribuição Gaussiana = resultados variam)")
    print("=" * 80)
    print()
    
    end_times = []
    for r in results:
        print(f"  Simulação {r['sim']}: Término às {r['end_h']:02d}:{r['end_m']:02d}:{r['end_s']:02d} "
              f"(duração total: {r['total_min']:.1f} min = {r['total_min']/60:.1f}h) | "
              f"Cooldowns: {r['cooldown_count']} ({r['total_cooldown_min']:.0f}min total) | "
              f"Intervalo médio: {r['avg_interval_s']:.1f}s | "
              f"Typing médio: {r['avg_typing_ms']:.0f}ms | "
              f"Offline médio: {r['avg_offline_ms']:.0f}ms")
        end_times.append(r['total_min'])
    
    avg_min = sum(end_times) / len(end_times)
    min_min = min(end_times)
    max_min = max(end_times)
    
    print()
    print("-" * 80)
    print(f"  MÉDIA:  {avg_min:.1f} min ({avg_min/60:.1f}h) → término às {13 + int((15 + avg_min) // 60):02d}:{int((15 + avg_min) % 60):02d}")
    print(f"  MÍNIMO: {min_min:.1f} min ({min_min/60:.1f}h) → término às {13 + int((15 + min_min) // 60):02d}:{int((15 + min_min) % 60):02d}")
    print(f"  MÁXIMO: {max_min:.1f} min ({max_min/60:.1f}h) → término às {13 + int((15 + max_min) // 60):02d}:{int((15 + max_min) % 60):02d}")
    print()
    
    # Mostrar log detalhado da simulação 1
    print("=" * 80)
    print("LOG DETALHADO — Simulação 1")
    print("=" * 80)
    for line in results[0]["log"]:
        print(line)
    
    print()
    print("=" * 80)
    print("RESUMO VISUAL")
    print("=" * 80)
    print()
    print(f"  Início:  13:15")
    avg_h = int(avg_min // 60)
    avg_m = int(avg_min % 60)
    print(f"  Término: ~{13 + avg_h}:{15 + avg_m:02d} (média de {avg_min:.0f} minutos)")
    print()
    
    # Timeline visual
    r = results[0]
    print("  Timeline (Simulação 1):")
    print(f"  13:15 ──── Início do disparo")
    
    # Encontrar cooldowns no log
    for line in r["log"]:
        if "Cooldown acionado" in line:
            time_part = line.split("às")[1].split("|")[0].strip() if "às" in line else "?"
            detail = line.split("|")[1].strip() if "|" in line else ""
            print(f"  {time_part} ──── 🧊 {detail}")
    
    end_str = f"{r['end_h']:02d}:{r['end_m']:02d}"
    print(f"  {end_str} ──── Fim do disparo ({r['total_min']:.0f} min total)")
    print()
