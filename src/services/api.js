// src/services/api.js
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

class ApiService {
    constructor() {
        this.baseUrl = process.env.API_BASE_URL;
        this.token = null;
    }

    async login() {
        try {
            console.log('Intentando login en:', `${this.baseUrl}/v1/auth/generate-token`);

            const response = await fetch(`${this.baseUrl}/v1/auth/generate-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: process.env.API_EMAIL,
                    password: process.env.API_PASSWORD,
                    device_name: process.env.API_DEVICE_NAME
                })
            });

            const data = await response.json();
            
            if (data.token) {
                this.token = data.token;
                console.log('Token obtenido exitosamente');
                return true;
            }
            
            console.error('No se encontró token en la respuesta:', data);
            return false;
        } catch (error) {
            console.error('Error completo en login:', error);
            return false;
        }
    }

    async getPendingMessages() {
        if (!this.token) {
            await this.login();
        }

        try {
            const response = await fetch(`${this.baseUrl}/v1/gateway/sms/supplier/pending-messages`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            const data = await response.json();
            console.log('Mensajes pendientes recibidos:', data);
            return data;
        } catch (error) {
            console.error('Error completo obteniendo mensajes pendientes:', error);
            return { type: 'error', data: [] };
        }
    }

    async confirmMessage(messageId, status = 'COMPLETADO') {
        if (!this.token) {
            await this.login();
        }

        try {
            const response = await fetch(`${this.baseUrl}/v1/gateway/sms/supplier/confirm-sent-message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    id_proveedor_envio_sms: messageId,
                    estado_envio: status
                })
            });

            const data = await response.json();
            console.log('Respuesta de confirmación:', data);
            return data.type === 'success';
        } catch (error) {
            console.error('Error completo confirmando mensaje:', error);
            return false;
        }
    }
}

module.exports = new ApiService();