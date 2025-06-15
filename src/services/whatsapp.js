// src/services/whatsapp.js
const wppconnect = require('@wppconnect-team/wppconnect');
const apiService = require('./api');
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
                        this.reconnectAttempts = 0; // ✅ Reset contador
                        console.log('WhatsApp conectado exitosamente!');

                        // ✅ Estados que requieren espera (NO desconectar)
                    } else if (statusSession === 'browserSessionConfigured' || statusSession === 'waitForLogin') {
                        console.log('Configurando sesión, esperando...');
                        // NO cambiar isConnected aquí

                        // ❌ Estados que indican desconexión real
                    } else if (statusSession === 'notLogged' || statusSession === 'browserClose' || statusSession === 'desconnectedMobile') {
                        // Solo reconectar si realmente estaba conectado antes
                        if (this.isConnected) {
                            this.isConnected = false;
                            console.log('WhatsApp desconectado. Intentando reconectar...');
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
            await this.handleReconnect();
            return false;
        }
    }

    async cleanupSession() {
        try {
            const fs = require('fs').promises;
            const sessionDir = path.join(this.sessionPath, 'mySession');

            // ✅ Cerrar cliente primero
            if (this.client) {
                try {
                    await this.client.close();
                } catch (e) {
                    // Ignorar errores de cierre
                }
                this.client = null;
            }

            // ✅ Limpiar TODOS los archivos de lock
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

            // ✅ Pequeña pausa para que el sistema libere recursos
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            console.log('Limpieza de sesión completada');
        }
    }

    async handleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('❌ Máximo de intentos de reconexión alcanzado');
            process.exit(1);
        }

        this.reconnectAttempts++;
        console.log(`🔄 Intento de reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

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
                                await this.sendMessage(message.numero_destino, message.mensaje);
                                await apiService.confirmMessage(message.id_proveedor_envio_sms);
                                console.log(`✅ Mensaje ${message.id_proveedor_envio_sms} enviado`);

                                // Pequeña pausa para no sobrecargar
                                await new Promise(resolve => setTimeout(resolve, 1000));

                            } catch (error) {
                                console.error(`❌ Error con mensaje ${message.id_proveedor_envio_sms}:`, error.message);

                                if (error.message.includes('detached') || error.message.includes('Target closed')) {
                                    this.isConnected = false;
                                    break;
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error('❌ Error en polling:', error.message);
                } finally {
                    this.isProcessingMessages = false;
                }
            }
        }, interval);
    }

    async sendMessage(number, message) {
        if (!this.client || !this.isConnected) {
            throw new Error('Cliente WhatsApp no disponible');
        }

        try {
            const formattedNumber = number.replace(/\D/g, '');
            const to = `591${formattedNumber}@c.us`;

            const result = await this.client.sendText(to, message);
            return result;

        } catch (error) {
            console.error('❌ Error enviando mensaje:', error.message);
            throw error;
        }
    }
}

module.exports = new WhatsAppService();