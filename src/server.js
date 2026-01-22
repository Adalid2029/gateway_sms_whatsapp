// src/server.js
require('dotenv').config();
const whatsappService = require('./services/whatsapp');
const apiService = require('./services/api');
const telegramService = require('./services/telegram');

// Configuración de manejo de memoria
process.on('warning', (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') {
        console.warn('⚠️  MaxListenersExceededWarning:', warning.message);
    }
});

// Manejo graceful de cierre
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('SIGUSR2', gracefulShutdown); // Para nodemon

async function gracefulShutdown(signal) {
    console.log(`\n🛑 Recibida señal ${signal}. Cerrando aplicación...`);
    
    try {
        // Limpiar recursos de WhatsApp
        await whatsappService.cleanup();
        console.log('✅ Recursos limpiados correctamente');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error durante el cierre:', error);
        process.exit(1);
    }
}

// Manejo de errores no capturados
process.on('uncaughtException', async (error) => {
    console.error('❌ Excepción no capturada:', error);
    await telegramService.sendCritical(`Excepción no capturada: ${error.message}`);
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
    await telegramService.sendCritical(`Promesa rechazada: ${reason}`);
    process.exit(1);
});

async function startServer() {
    try {
        console.log('🚀 Iniciando Gateway SMS WhatsApp...');
        console.log('📊 Límite de memoria Node.js:', process.env.NODE_OPTIONS);
        
        // Verificar variables de entorno críticas
        if (!process.env.API_BASE_URL) {
            throw new Error('❌ API_BASE_URL no está definida en las variables de entorno');
        }
        
        console.log('🔗 API Base URL:', process.env.API_BASE_URL);
        
        // Intentar login en la API
        console.log('🔐 Intentando autenticación...');
        const loginSuccess = await apiService.login();
        if (!loginSuccess) {
            await telegramService.sendCritical('No se pudo iniciar sesión en la API');
            throw new Error('❌ No se pudo iniciar sesión en la API');
        }
        console.log('✅ Autenticación exitosa');

        // Inicializar WhatsApp
        console.log('📱 Inicializando WhatsApp...');
        const whatsappInitialized = await whatsappService.initialize();
        if (!whatsappInitialized) {
            throw new Error('❌ No se pudo inicializar WhatsApp');
        }
        console.log('✅ WhatsApp inicializado correctamente');

        // Mostrar información del sistema
        const memoryUsage = process.memoryUsage();
        console.log('📊 Uso inicial de memoria:', {
            rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
        });

        console.log('🎉 Gateway SMS WhatsApp iniciado exitosamente');
        console.log('⏰ Interval de verificación:', (process.env.CHECK_MESSAGES_INTERVAL || 15000) + 'ms');

        await telegramService.sendSuccess('Gateway SMS WhatsApp iniciado correctamente');

    } catch (error) {
        console.error('❌ Error iniciando el servidor:', error);
        process.exit(1);
    }
}

// Iniciar el servidor
startServer();