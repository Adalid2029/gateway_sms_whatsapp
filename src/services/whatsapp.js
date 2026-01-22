// src/services/whatsapp.js
const wppconnect = require('@wppconnect-team/wppconnect');
const apiService = require('./api');
const telegramService = require('./telegram');
const path = require('path');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.isProcessingMessages = false;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.sessionPath = path.join(process.cwd(), 'tokens');
    }

    async initialize() {
        try {
            console.log('Iniciando cliente de WhatsApp optimizado...');

            // Limpiar sesión anterior si existe conflicto
            await this.cleanupSession();

            this.client = await wppconnect.create({
                session: 'mySession',
                headless: true,
                devtools: false,
                debug: false,
                logQR: true,
                createTimeout: 180000,
                protocolTimeout: 90000,

                puppeteerOptions: {
                    timeout: 30000,
                    args: [
                        '--no-sandbox',
                        '--disable-dev-shm-usage',
                        '--single-process',
                        '--disable-gpu',
                        '--disable-web-security',
                        '--no-first-run'
                    ],
                    executablePath: '/usr/bin/chromium'
                },

                catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
                    console.log('\n=============================');
                    console.log('Código QR - Intento:', attempts);
                    console.log(asciiQR);
                    console.log('=============================\n');
                },

                statusFind: (statusSession, session) => {
                    console.log('Estado de la sesión:', statusSession);

                    // ✅ Estados que indican conexión exitosa
                    if (statusSession === 'inChat' || statusSession === 'isLogged' || statusSession === 'qrReadSuccess') {
                        this.isConnected = true;
                        this.reconnectAttempts = 0;
                        console.log('WhatsApp conectado exitosamente!');
                        telegramService.sendSuccess('WhatsApp conectado exitosamente');

                    } else if (statusSession === 'browserSessionConfigured' || statusSession === 'waitForLogin') {
                        console.log('Configurando sesión, esperando...');

                    } else if (statusSession === 'notLogged' || statusSession === 'browserClose' || statusSession === 'desconnectedMobile') {
                        if (this.isConnected) {
                            this.isConnected = false;
                            console.log('WhatsApp desconectado. Intentando reconectar...');
                            telegramService.sendCritical(`WhatsApp desconectado (${statusSession}). Intentando reconectar...`);
                            this.handleReconnect();
                        }
                    }
                }
            });

            // Configurar eventos de estado
            this.client.onStateChange((state) => {
                console.log('Estado WhatsApp:', state);
                this.isConnected = state === 'CONNECTED';
            });

            // Iniciar polling con intervalo optimizado
            this.startMessagePolling();
            return true;

        } catch (error) {
            console.error('❌ Error iniciando WhatsApp:', error.message);
            telegramService.sendCritical(`Error iniciando WhatsApp: ${error.message}`);
            await this.handleReconnect();
            return false;
        }
    }

    async cleanupSession() {
        try {
            const fs = require('fs').promises;
            const sessionDir = path.join(this.sessionPath, 'mySession');

            if (this.client) {
                try {
                    await this.client.close();
                } catch (e) {
                    // Ignorar errores de cierre
                }
                this.client = null;
            }

            const lockFiles = [
                'SingletonLock',
                'SingletonSocket',
                'SingletonCookie'
            ];

            for (const lockFile of lockFiles) {
                try {
                    await fs.unlink(path.join(sessionDir, lockFile));
                    console.log(`🧹 ${lockFile} eliminado`);
                } catch (e) {
                    // No existe, está bien
                }
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            console.log('Limpieza de sesión completada');
        }
    }

    async handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Máximo de intentos de reconexión alcanzado');
            telegramService.sendCritical('Máximo de intentos de reconexión alcanzado. El servicio se detendrá.');
            process.exit(1);
        }

        this.reconnectAttempts++;
        console.log(`🔄 Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        telegramService.sendWarning(`Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

        await this.cleanupSession();
        setTimeout(() => this.initialize(), 15000);
    }

    async startMessagePolling() {
        const interval = parseInt(process.env.CHECK_MESSAGES_INTERVAL) || 15000;

        setInterval(async () => {
            if (!this.isProcessingMessages && this.isConnected) {
                this.isProcessingMessages = true;

                try {
                    const response = await apiService.getPendingMessages();
                    let messagesToProcess = [];

                    if (response?.type === 'success' && response.data) {
                        messagesToProcess = Array.isArray(response.data) ? response.data : [response.data];
                    }

                    if (messagesToProcess.length > 0) {
                        console.log(`📨 Procesando ${messagesToProcess.length} mensajes`);

                        for (const message of messagesToProcess) {
                            if (!this.isConnected) break;

                            try {
                                // 🔧 FIX: Intentar enviar mensaje
                                await this.sendMessage(message.numero_destino, message.mensaje);

                                // ✅ Si llegamos aquí, el mensaje se envió correctamente
                                await apiService.confirmMessage(message.id_proveedor_envio_sms, 'COMPLETADO');
                                console.log(`✅ Mensaje ${message.id_proveedor_envio_sms} enviado`);
                                telegramService.incrementSent();

                            } catch (error) {
                                // ⚠️ FIX CRÍTICO: Marcar como ERROR para que no se repita infinitamente
                                console.error(`❌ Error con mensaje ${message.id_proveedor_envio_sms}:`, error.message);

                                // 🔧 Reportar error a la API
                                await apiService.confirmMessage(message.id_proveedor_envio_sms, 'ERROR', error.message);
                                telegramService.incrementFailed();

                                // Verificar si el error es crítico de conexión
                                if (error.message.includes('detached') || error.message.includes('Target closed')) {
                                    this.isConnected = false;
                                    telegramService.sendCritical(`Error crítico de conexión: ${error.message}`);
                                    break;
                                } else {
                                    telegramService.sendWarning(`Error enviando mensaje #${message.id_proveedor_envio_sms}: ${error.message}`);
                                }
                            }

                            // Pequeña pausa para no sobrecargar
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                } catch (error) {
                    console.error('❌ Error en polling:', error.message);
                } finally {
                    this.isProcessingMessages = false;
                }
            }

            // Enviar resumen periódico (cada hora)
            telegramService.sendSummary(this.isConnected);
        }, interval);
    }

    formatBolivianNumber(number) {
        // 🔧 Limpiar: solo dígitos
        let cleaned = number.replace(/\D/g, '');

        // 🔧 Remover 591 si ya está al inicio
        if (cleaned.startsWith('591')) {
            cleaned = cleaned.substring(3);
        }

        // 🔧 Validar que tenga 8 dígitos (números bolivianos de celular)
        if (cleaned.length !== 8) {
            throw new Error(`Número inválido: ${number} (debe tener 8 dígitos sin código de país)`);
        }

        // 🔧 Validar que empiece con 6 o 7 (operadoras bolivianas)
        if (!cleaned.startsWith('6') && !cleaned.startsWith('7')) {
            throw new Error(`Número inválido: ${number} (debe empezar con 6 o 7)`);
        }

        // ✅ Retornar con código de país
        return '591' + cleaned;
    }

    async sendMessage(number, message) {
        if (!this.client || !this.isConnected) {
            throw new Error('Cliente WhatsApp no disponible');
        }

        try {
            // 🔧 FIX: Formatear número correctamente
            const formattedNumber = this.formatBolivianNumber(number);
            const to = `${formattedNumber}@c.us`;

            console.log(`📤 Enviando a: ${to} (original: ${number})`);

            // 🔧 FIX CRÍTICO: Timeout de 30 segundos para evitar cuelgue
            const sendPromise = this.client.sendText(to, message);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout: mensaje tardó más de 30s')), 30000)
            );

            const result = await Promise.race([sendPromise, timeoutPromise]);
            return result;

        } catch (error) {
            // 🔧 Extraer SOLO el mensaje para evitar referencias circulares
            const errorMsg = error?.message || String(error);

            // 🔧 Crear un error simple sin referencias circulares
            const simpleError = new Error(errorMsg);
            throw simpleError;
        }
    }

    async cleanup() {
        console.log('🧹 Limpiando recursos...');
        if (this.client) {
            try {
                await this.client.close();
            } catch (error) {
                console.error('Error cerrando cliente:', error.message);
            }
        }
    }
}

module.exports = new WhatsAppService();