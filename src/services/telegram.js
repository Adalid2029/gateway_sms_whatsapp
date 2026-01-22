// src/services/telegram.js
const fetch = require('node-fetch');

class TelegramService {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.enabled = process.env.TELEGRAM_ENABLED === 'true';
        this.deviceName = process.env.API_DEVICE_NAME || 'Gateway';

        // Rate limiting: evitar spam
        this.lastSent = {};
        this.rateLimitMs = 60000; // 1 minuto entre mensajes del mismo tipo

        // Estadísticas para resumen
        this.stats = {
            sent: 0,
            failed: 0,
            lastReset: Date.now()
        };
    }

    isConfigured() {
        return this.enabled && this.botToken && this.chatId &&
               this.botToken !== 'tu_token_aqui' &&
               this.chatId !== 'tu_chat_id_aqui';
    }

    canSend(type) {
        const now = Date.now();
        const lastTime = this.lastSent[type] || 0;
        return (now - lastTime) >= this.rateLimitMs;
    }

    async send(message, type = 'info') {
        if (!this.isConfigured()) {
            return false;
        }

        // Rate limiting por tipo
        if (!this.canSend(type)) {
            console.log(`[Telegram] Rate limited: ${type}`);
            return false;
        }

        try {
            const timestamp = new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' });
            const fullMessage = `[${this.deviceName}] ${timestamp}\n${message}`;

            const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    text: fullMessage,
                    parse_mode: 'HTML'
                })
            });

            const data = await response.json();

            if (data.ok) {
                this.lastSent[type] = Date.now();
                return true;
            } else {
                console.error('[Telegram] Error:', data.description);
                return false;
            }
        } catch (error) {
            console.error('[Telegram] Error enviando:', error.message);
            return false;
        }
    }

    async sendCritical(message) {
        return this.send(`🔴 <b>CRÍTICO</b>\n${message}`, 'critical');
    }

    async sendWarning(message) {
        return this.send(`🟡 <b>Advertencia</b>\n${message}`, 'warning');
    }

    async sendInfo(message) {
        return this.send(`🔵 <b>Info</b>\n${message}`, 'info');
    }

    async sendSuccess(message) {
        return this.send(`🟢 <b>OK</b>\n${message}`, 'success');
    }

    // Estadísticas
    incrementSent() {
        this.stats.sent++;
    }

    incrementFailed() {
        this.stats.failed++;
    }

    async sendSummary(isConnected) {
        const now = Date.now();
        const hourMs = 60 * 60 * 1000;

        // Solo enviar si pasó 1 hora desde el último reset
        if ((now - this.stats.lastReset) < hourMs) {
            return;
        }

        const status = isConnected ? '✅ Conectado' : '❌ Desconectado';
        const message = `📊 <b>Resumen última hora</b>\n` +
            `✅ Enviados: ${this.stats.sent}\n` +
            `❌ Fallidos: ${this.stats.failed}\n` +
            `📡 Estado: ${status}`;

        await this.send(message, 'summary');

        // Reset estadísticas
        this.stats.sent = 0;
        this.stats.failed = 0;
        this.stats.lastReset = now;
    }
}

module.exports = new TelegramService();
