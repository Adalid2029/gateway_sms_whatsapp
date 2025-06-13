// src/services/whatsapp.js
const wppconnect = require('@wppconnect-team/wppconnect');
const apiService = require('./api');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.isProcessingMessages = false;
        this.messageQueue = [];
        this.isConnected = false;
    }

    async initialize() {
        try {
            console.log('Iniciando cliente de WhatsApp...');
            
            this.client = await wppconnect.create({
                session: 'mySession',
                catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
                    console.log('\n\n=============================');
                    console.log('Por favor, escanea este código QR:');
                    console.log(asciiQR);
                    console.log('Intento número:', attempts);
                    console.log('=============================\n\n');
                },
                statusFind: (statusSession, session) => {
                    console.log('Estado de la sesión:', statusSession);
                    if (statusSession === 'inChat' || statusSession === 'isLogged') {
                        this.isConnected = true;
                        console.log('WhatsApp conectado exitosamente!');
                    } else if (statusSession === 'notLogged' || statusSession === 'browserClose') {
                        this.isConnected = false;
                        console.log('WhatsApp desconectado. Intentando reconectar...');
                        this.reconnect();
                    }
                },
                headless: true,
                devtools: false,
                useChrome: false,
                debug: false,
                logQR: true,
                browserArgs: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ],
                puppeteerOptions: {
                    args: ['--no-sandbox']
                },
                tokenStore: 'file',
                folderNameToken: './tokens'
            });

            this.client.onStateChange((state) => {
                console.log('Estado de WhatsApp cambió a:', state);
                this.isConnected = state === 'CONNECTED';
            });

            this.startMessagePolling();
            return true;
        } catch (error) {
            console.error('Error iniciando WhatsApp:', error);
            return false;
        }
    }

    async reconnect() {
        console.log('Intentando reconectar WhatsApp...');
        try {
            await this.initialize();
        } catch (error) {
            console.error('Error en la reconexión:', error);
        }
    }

    async startMessagePolling() {
        setInterval(async () => {
            if (!this.isProcessingMessages && this.isConnected) {
                this.isProcessingMessages = true;
                try {
                    const response = await apiService.getPendingMessages();
                    let messagesToProcess = [];

                    if (response && response.type === 'success' && response.data) {
                        messagesToProcess = Array.isArray(response.data) ? response.data : [response.data];
                    }

                    console.log(`Procesando ${messagesToProcess.length} mensajes`);

                    for (const message of messagesToProcess) {
                        try {
                            if (!this.isConnected) {
                                console.log('WhatsApp desconectado. Esperando reconexión...');
                                break;
                            }

                            console.log('Enviando mensaje a:', message.numero_destino);
                            await this.sendMessage(message.numero_destino, message.mensaje);
                            await apiService.confirmMessage(message.id_proveedor_envio_sms);
                            console.log(`Mensaje ${message.id_proveedor_envio_sms} enviado y confirmado`);
                        } catch (error) {
                            console.error(`Error procesando mensaje ${message.id_proveedor_envio_sms}:`, error);
                            if (error.message.includes('detached Frame')) {
                                this.isConnected = false;
                                await this.reconnect();
                                break;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error en el polling de mensajes:', error);
                } finally {
                    this.isProcessingMessages = false;
                }
            }
        }, parseInt(process.env.CHECK_MESSAGES_INTERVAL) || 10000);
    }

    async sendMessage(number, message) {
        if (!this.client || !this.isConnected) {
            throw new Error('Cliente WhatsApp no inicializado o desconectado');
        }

        try {
            const formattedNumber = number.replace(/\D/g, '');
            const to = `591${formattedNumber}@c.us`;

            console.log('Enviando mensaje a:', to);
            const result = await this.client.sendText(to, message);
            console.log('Mensaje enviado exitosamente:', result);
            return result;
        } catch (error) {
            console.error('Error enviando mensaje:', error);
            throw error;
        }
    }
}

module.exports = new WhatsAppService();