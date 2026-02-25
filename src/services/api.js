// src/services/api.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();

// FIX #1: Helper con timeout usando AbortController
const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
            throw new Error(`Timeout (${timeoutMs}ms): ${url} no respondió`);
        }
        throw err;
    }
};

class ApiService {
    constructor() {
        this.baseUrl = process.env.API_BASE_URL;
        this.token = null;
        // FIX #2: Evitar múltiples logins simultáneos (race condition)
        this._loginPromise = null;
    }

    async login() {
        // FIX #3: Si ya hay un login en curso, esperar ese en lugar de lanzar otro
        if (this._loginPromise) return this._loginPromise;

        this._loginPromise = (async () => {
            try {
                console.log('🔐 Login en:', `${this.baseUrl}/v1/auth/generate-token`);
                const response = await fetchWithTimeout(
                    `${this.baseUrl}/v1/auth/generate-token`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: process.env.API_EMAIL,
                            password: process.env.API_PASSWORD,
                            device_name: process.env.API_DEVICE_NAME,
                        }),
                    },
                    10000 // 10s timeout para login
                );

                // FIX #4: Verificar HTTP status antes de parsear JSON
                if (!response.ok) {
                    console.error(`❌ Login fallido: HTTP ${response.status}`);
                    return false;
                }

                const data = await response.json();
                if (data.token) {
                    this.token = data.token;
                    console.log('✅ Token obtenido exitosamente');
                    return true;
                }
                console.error('❌ No se encontró token en la respuesta');
                return false;
            } catch (error) {
                console.error('❌ Error en login:', error.message);
                return false;
            } finally {
                // Liberar el lock después de 1s para evitar loops inmediatos
                setTimeout(() => { this._loginPromise = null; }, 1000);
            }
        })();

        return this._loginPromise;
    }

    // FIX #5: Helper que renueva token automáticamente si recibe 401
    async _fetchWithAuth(url, options = {}, timeoutMs = 10000) {
        if (!this.token) {
            const ok = await this.login();
            if (!ok) throw new Error('No se pudo autenticar con la API');
        }

        let response = await fetchWithTimeout(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${this.token}`,
            },
        }, timeoutMs);

        // Token expirado → renovar y reintentar UNA vez
        if (response.status === 401) {
            console.warn('⚠️ Token expirado, renovando...');
            this.token = null;
            const ok = await this.login();
            if (!ok) throw new Error('No se pudo renovar el token');

            response = await fetchWithTimeout(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'Authorization': `Bearer ${this.token}`,
                },
            }, timeoutMs);
        }

        return response;
    }

    async getPendingMessages() {
        try {
            const response = await this._fetchWithAuth(
                `${this.baseUrl}/v1/gateway/sms/supplier/pending-messages`,
                {},
                10000 // 10s timeout
            );

            if (!response.ok) {
                console.error(`❌ Error HTTP ${response.status} obteniendo mensajes`);
                return { type: 'error', data: [] };
            }

            const data = await response.json();
            // Solo loguear cuando hay mensajes reales
            if (data.type === 'success' && data.data?.length > 0) {
                console.log(`📬 ${data.data.length} mensaje(s) pendiente(s) recibido(s)`);
            }
            return data;
        } catch (error) {
            // FIX #6: Diferenciar timeout de otros errores de red
            if (error.message.includes('Timeout') || error.code === 'ECONNRESET') {
                console.warn('⚠️ API SMS no disponible temporalmente:', error.message);
            } else {
                console.error('❌ Error obteniendo mensajes pendientes:', error.message);
            }
            return { type: 'error', data: [] };
        }
    }

    async confirmMessage(messageId, status = 'COMPLETADO', errorMessage = null) {
        try {
            const body = {
                id_proveedor_envio_sms: messageId,
                estado_envio: status,
            };
            if (errorMessage && status === 'ERROR') {
                body.mensaje_error = errorMessage.substring(0, 255);
            }

            const response = await this._fetchWithAuth(
                `${this.baseUrl}/v1/gateway/sms/supplier/confirm-sent-message`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                },
                10000 // 10s timeout
            );

            if (!response.ok) {
                console.error(`❌ Error HTTP ${response.status} confirmando mensaje ${messageId}`);
                return false;
            }

            const data = await response.json();
            if (status === 'ERROR') {
                console.log(`⚠️  Mensaje ${messageId} marcado como ERROR: ${errorMessage}`);
            }
            return data.type === 'success';
        } catch (error) {
            console.error(`❌ Error confirmando mensaje ${messageId}:`, error.message);
            return false;
        }
    }
}

module.exports = new ApiService();