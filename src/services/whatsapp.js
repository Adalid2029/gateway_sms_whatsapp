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

            // FIX #1: Logger personalizado que filtra los errores ruidosos de
            // Signal protocol (decrypt de grupos) y transactions de Baileys.
            // Estos NO son errores de tu aplicación; Baileys los maneja internamente.
            const IGNORED_MSGS = [
                'No session found to decrypt message',
                'transaction failed, rolling back',
                'Closing open session in favor of incoming prekey bundle',
            ];

            const logger = pino({
                level: process.env.BAILEYS_LOG_LEVEL || 'error',
            }).child({});

            // Interceptar el método error del logger para filtrar mensajes conocidos
            const originalError = logger.error.bind(logger);
            logger.error = (obj, msg, ...args) => {
                const message = typeof obj === 'string' ? obj : (msg || obj?.msg || obj?.err?.message || '');
                if (IGNORED_MSGS.some(ignored => message.includes(ignored))) return;
                // También filtrar por el campo msg del objeto JSON
                if (obj?.msg && IGNORED_MSGS.some(ignored => obj.msg.includes(ignored))) return;
                originalError(obj, msg, ...args);
            };

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

                    // FIX #2: Retardo entre reintentos de mensajes fallidos (decrypt, etc.)
                    // Evita saturar el servidor de WhatsApp con reintentos inmediatos
                    retryRequestDelayMs: 2000,

                    // FIX #3: No descargar historial completo al reconectar.
                    // Evita recibir una avalancha de mensajes viejos sin sender keys
                    syncFullHistory: false,

                    // FIX #4: getMessage debe devolver undefined correctamente.
                    // Baileys lo usa internamente para reintentos; retornar undefined
                    // le indica que no tenemos el mensaje en cache (comportamiento correcto)
                    getMessage: async () => undefined,

                    printQRInTerminal: false,
                });

                this.sock.ev.on('creds.update', saveCreds);

                // FIX #5: Capturar errores de mensajes entrantes de grupos
                // Los errores de decrypt de sender keys son normales al reconectar;
                // Baileys re-solicitará las claves automáticamente en el siguiente ciclo
                this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
                    // Solo loguear para debug si necesitas, pero no hacer nada más.
                    // Baileys maneja internamente la re-solicitud de sender keys.
                    for (const msg of messages) {
                        if (msg.messageStubType) {
                            // Mensajes de sistema/stub (cambios de grupo, etc.), ignorar
                            continue;
                        }
                    }
                });

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

                        // FIX #6: El statusCode 428 es connectionClosed (servidor cerró
                        // la conexión, puede ser por inactividad o mantenimiento de WA).
                        // Ya está manejado correctamente por el bloque de reconexión abajo.
                        if (statusCode === 428) {
                            console.log('⚠️ Conexión cerrada por servidor WhatsApp (428), reconectando...');
                        }

                        if (this.reconnectAttempts < this.maxReconnectAttempts) {
                            this.reconnectAttempts++;
                            const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
                            console.log(
                                `🔄 Reconectando (${this.reconnectAttempts}/${this.maxReconnectAttempts}) en ${delay / 1000}s...`
                            );
                            telegramService.sendWarning(
                                `WhatsApp desconectado (${statusCode}). Reconectando ${this.reconnectAttempts}/${this.maxReconnectAttempts}`
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
                    // FIX #7: Diferenciar error de API (socket hang up) de otros errores
                    if (error.message?.includes('socket hang up') || error.code === 'ECONNRESET') {
                        console.warn('⚠️ API SMS no disponible temporalmente (socket hang up), reintentando en próximo ciclo...');
                    } else {
                        console.error('❌ Error en polling:', error.message);
                    }
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
                console.warn('⚠️ Timeout enviando mensaje, forzando reconexión del socket...');
                this.isConnected = false;
                try { this.sock?.end(undefined); } catch (_) { }
                reject(new Error('Timeout: mensaje tardó más de 30s'));
            }, 30000);
        });

        try {
            const result = await Promise.race([
                this.sock.sendMessage(jid, { text: message }),
                timeoutPromise,
            ]);
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
            } catch (e) { /* ignorar */ }
            this.sock = null;
        }
        this.isConnected = false;
    }
}

module.exports = new WhatsAppService();