// src/services/whatsapp.js - Baileys (WebSockets, sin navegador)
const apiService = require('./api');
const telegramService = require('./telegram');
const path = require('path');

class WhatsAppService {
    constructor() {
        this.sock = null;
        this.isProcessingMessages = false;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.authPath = path.join(process.cwd(), 'tokens', 'baileys_auth');
        this._pollingStarted = false;
    }

    async initialize() {
        try {
            console.log('📱 Iniciando WhatsApp con Baileys (sin navegador)...');

            // Import dinámico (Baileys es ESM)
            const {
                default: makeWASocket,
                useMultiFileAuthState,
                fetchLatestBaileysVersion,
                makeCacheableSignalKeyStore,
                DisconnectReason,
            } = await import('@whiskeysockets/baileys');
            const NodeCache = (await import('@cacheable/node-cache')).default;
            const pino = (await import('pino')).default;
            const QRCode = (await import('qrcode')).default;

            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);

            const { version } = await fetchLatestBaileysVersion();
            console.log('📌 Versión WhatsApp Web:', version.join('.'));

            const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'error' });
            const msgRetryCounterCache = new NodeCache();

            const startSock = async () => {
                this.sock = makeWASocket({
                    version,
                    auth: {
                        creds: state.creds,
                        keys: makeCacheableSignalKeyStore(state.keys, logger),
                    },
                    logger,
                    msgRetryCounterCache,
                    getMessage: async () => undefined,

                    printQRInTerminal: false,
                });

                // Guardar credenciales cuando se actualicen
                this.sock.ev.on('creds.update', saveCreds);

                // Eventos de conexión
                this.sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;

                    if (qr) {
                        console.log('\n=============================');
                        console.log('Escanea el código QR con WhatsApp:');
                        console.log('=============================\n');
                        try {
                            const qrTerminal = await QRCode.toString(qr, {
                                type: 'terminal',
                                small: true,
                            });
                            console.log(qrTerminal);
                        } catch (e) {
                            console.log('QR (raw):', qr.substring(0, 50) + '...');
                        }
                        console.log('=============================\n');
                    }

                    if (connection === 'open') {
                        this.isConnected = true;
                        this.reconnectAttempts = 0;
                        console.log('✅ WhatsApp conectado exitosamente!');
                        telegramService.sendSuccess('WhatsApp conectado exitosamente');
                    }

                    if (connection === 'close') {
                        this.isConnected = false;
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        const reason = lastDisconnect?.error?.output?.connectionReason;

                        console.log('Estado WhatsApp: desconectado', { statusCode, reason });

                        if (statusCode === DisconnectReason.loggedOut) {
                            console.log('❌ Sesión cerrada. Escanea QR de nuevo.');
                            telegramService.sendCritical('WhatsApp: sesión cerrada. Reinicia y escanea el QR.');
                            return;
                        }

                        if (this.reconnectAttempts < this.maxReconnectAttempts) {
                            this.reconnectAttempts++;
                            const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
                            console.log(
                                `🔄 Reconectando (${this.reconnectAttempts}/${this.maxReconnectAttempts}) en ${delay / 1000}s...`
                            );
                            telegramService.sendWarning(
                                `WhatsApp desconectado. Reconectando ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
                            );
                            setTimeout(() => startSock(), delay);
                        } else {
                            console.log('❌ Máximo de intentos de reconexión alcanzado');
                            telegramService.sendCritical(
                                'Máximo de intentos de reconexión alcanzado. El servicio se detendrá.'
                            );
                            process.exit(1);
                        }
                    }
                });
            };

            await startSock();
            this.startMessagePolling();
            return true;
        } catch (error) {
            console.error('❌ Error iniciando WhatsApp:', error.message);
            telegramService.sendCritical(`Error iniciando WhatsApp: ${error.message}`);
            await this.handleReconnect();
            return false;
        }
    }

    async handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Máximo de intentos de reconexión alcanzado');
            telegramService.sendCritical('Máximo de intentos de reconexión alcanzado.');
            process.exit(1);
        }
        this.reconnectAttempts++;
        console.log(`🔄 Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        telegramService.sendWarning(`Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        setTimeout(() => this.initialize(), 10000);
    }

    startMessagePolling() {
        if (this._pollingStarted) return;
        this._pollingStarted = true;

        const interval = parseInt(process.env.CHECK_MESSAGES_INTERVAL, 10) || 15000;

        setInterval(async () => {
            if (!this.isProcessingMessages && this.isConnected && this.sock) {
                this.isProcessingMessages = true;

                try {
                    const response = await apiService.getPendingMessages();
                    let messagesToProcess = [];

                    if (response?.type === 'success' && response.data) {
                        messagesToProcess = Array.isArray(response.data)
                            ? response.data
                            : [response.data];
                    }

                    if (messagesToProcess.length > 0) {
                        console.log(`📨 Procesando ${messagesToProcess.length} mensajes`);

                        for (const message of messagesToProcess) {
                            if (!this.isConnected || !this.sock) break;

                            try {
                                await this.sendMessage(message.numero_destino, message.mensaje);
                                await apiService.confirmMessage(
                                    message.id_proveedor_envio_sms,
                                    'COMPLETADO'
                                );
                                console.log(`✅ Mensaje ${message.id_proveedor_envio_sms} enviado`);
                                telegramService.incrementSent();
                            } catch (error) {
                                console.error(
                                    `❌ Error con mensaje ${message.id_proveedor_envio_sms}:`,
                                    error.message
                                );
                                await apiService.confirmMessage(
                                    message.id_proveedor_envio_sms,
                                    'ERROR',
                                    error.message
                                );
                                telegramService.incrementFailed();
                                telegramService.sendWarning(
                                    `Error enviando mensaje #${message.id_proveedor_envio_sms}: ${error.message}`
                                );
                            }
                            await new Promise((r) => setTimeout(r, 1000));
                        }
                    }
                } catch (error) {
                    console.error('❌ Error en polling:', error.message);
                } finally {
                    this.isProcessingMessages = false;
                }
            }

            telegramService.sendSummary(this.isConnected);
        }, interval);
    }

    formatBolivianNumber(number) {
        let cleaned = number.replace(/\D/g, '');
        if (cleaned.startsWith('591')) {
            cleaned = cleaned.substring(3);
        }
        if (cleaned.length !== 8) {
            throw new Error(`Número inválido: ${number} (debe tener 8 dígitos sin código de país)`);
        }
        if (!cleaned.startsWith('6') && !cleaned.startsWith('7')) {
            throw new Error(`Número inválido: ${number} (debe empezar con 6 o 7)`);
        }
        return '591' + cleaned;
    }

    async sendMessage(number, message) {
        if (!this.sock || !this.isConnected) {
            throw new Error('Cliente WhatsApp no disponible');
        }

        const formattedNumber = this.formatBolivianNumber(number);
        const jid = `${formattedNumber}@s.whatsapp.net`;

        console.log(`📤 Enviando a: ${jid} (original: ${number})`);

        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                // El socket está colgado → marcarlo como desconectado y forzar cierre
                // para que connection.update dispare y Baileys reconecte
                console.warn('⚠️ Timeout enviando mensaje, forzando reconexión del socket...');
                this.isConnected = false;
                try { this.sock?.end(undefined); } catch (_) {}
                reject(new Error('Timeout: mensaje tardó más de 30s'));
            }, 30000);
        });

        try {
            const result = await Promise.race([this.sock.sendMessage(jid, { text: message }), timeoutPromise]);
            clearTimeout(timeoutId);
            return result;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    async cleanup() {
        console.log('🧹 Cerrando conexión WhatsApp...');
        if (this.sock) {
            try {
                if (typeof this.sock.end === 'function') {
                    this.sock.end(undefined);
                } else if (this.sock.ws && typeof this.sock.ws.close === 'function') {
                    this.sock.ws.close();
                }
            } catch (e) {
                // ignorar
            }
            this.sock = null;
        }
        this.isConnected = false;
    }
}

module.exports = new WhatsAppService();
