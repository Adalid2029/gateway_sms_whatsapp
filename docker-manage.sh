#!/bin/bash

# Colores para la salida
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function show_help {
    echo -e "${YELLOW}==== Gateway SMS WhatsApp - Gestor Docker ====${NC}"
    echo -e "Uso: $0 [comando]"
    echo
    echo -e "Comandos disponibles:"
    echo -e "  ${GREEN}build${NC}       - Construir la imagen Docker"
    echo -e "  ${GREEN}start${NC}       - Iniciar el contenedor"
    echo -e "  ${GREEN}stop${NC}        - Detener el contenedor"
    echo -e "  ${GREEN}restart${NC}     - Reiniciar el contenedor"
    echo -e "  ${GREEN}logs${NC}        - Ver los logs (use Ctrl+C para salir)"
    echo -e "  ${GREEN}shell${NC}       - Abrir una terminal bash en el contenedor"
    echo -e "  ${GREEN}status${NC}      - Verificar el estado del contenedor"
    echo -e "  ${GREEN}rebuild${NC}     - Reconstruir la imagen y reiniciar (útil al actualizar)"
}

function build_image {
    echo -e "${YELLOW}Construyendo imagen Docker...${NC}"
    docker-compose build --progress=plain
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Error al construir la imagen. Verificando problemas comunes...${NC}"
        
        # Verificar si existe package-lock.json
        if [ ! -f "package-lock.json" ]; then
            echo -e "${YELLOW}No se encontró package-lock.json. Intentando generarlo...${NC}"
            npm install --package-lock-only
            echo -e "${GREEN}package-lock.json generado. Intenta construir de nuevo.${NC}"
        fi
    else
        echo -e "${GREEN}Imagen construida exitosamente.${NC}"
    fi
}

function start_container {
    echo -e "${YELLOW}Iniciando contenedor...${NC}"
    docker-compose up -d
    echo -e "${GREEN}Contenedor iniciado en segundo plano.${NC}"
    echo -e "Para ver los logs, ejecute: $0 logs"
}

function stop_container {
    echo -e "${YELLOW}Deteniendo contenedor...${NC}"
    docker-compose down
}

function restart_container {
    echo -e "${YELLOW}Reiniciando contenedor...${NC}"
    docker-compose restart
}

function show_logs {
    echo -e "${YELLOW}Mostrando logs (use Ctrl+C para salir)...${NC}"
    docker-compose logs -f
}

function open_shell {
    echo -e "${YELLOW}Abriendo terminal bash en el contenedor...${NC}"
    docker-compose exec whatsapp-gateway /bin/bash || docker-compose exec whatsapp-gateway /bin/sh
}

function check_status {
    echo -e "${YELLOW}Estado del contenedor:${NC}"
    docker-compose ps
    echo
    echo -e "${YELLOW}Información del contenedor:${NC}"
    docker inspect --format='{{.State.Status}}' whatsapp-gateway 2>/dev/null || echo -e "${RED}El contenedor no existe o no está en ejecución.${NC}"
}

function rebuild {
    echo -e "${YELLOW}Reconstruyendo imagen y reiniciando contenedor...${NC}"
    docker-compose down
    docker-compose build
    docker-compose up -d
    echo -e "${GREEN}Proceso completado.${NC}"
}

# Verificar que Docker está instalado
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker no está instalado. Por favor, instale Docker primero.${NC}"
    exit 1
fi

# Verificar que Docker Compose está instalado
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose no está instalado. Por favor, instale Docker Compose primero.${NC}"
    exit 1
fi

# Procesar comandos
case "$1" in
    build)
        build_image
        ;;
    start)
        start_container
        ;;
    stop)
        stop_container
        ;;
    restart)
        restart_container
        ;;
    logs)
        show_logs
        ;;
    shell)
        open_shell
        ;;
    status)
        check_status
        ;;
    rebuild)
        rebuild
        ;;
    *)
        show_help
        ;;
esac
