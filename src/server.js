// src/server.js
require('dotenv').config();
const whatsappService = require('./services/whatsapp');
const apiService = require('./services/api');

async function startServer() {
    try {
        // Primero intentamos hacer login
        const loginSuccess = await apiService.login();
        if (!loginSuccess) {
            throw new Error('No se pudo iniciar sesión en la API');
        }
        console.log('Login exitoso en la API');

        // Iniciamos el servicio de WhatsApp
        const whatsappInitialized = await whatsappService.initialize();
        if (!whatsappInitialized) {
            throw new Error('No se pudo iniciar el servicio de WhatsApp');
        }
        console.log('Servicio de WhatsApp iniciado correctamente');

    } catch (error) {
        console.error('Error iniciando el servidor:', error);
        process.exit(1);
    }
}

startServer();