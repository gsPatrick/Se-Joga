    #!/bin/bash

    # --- Script para instalar dependências Node.js e Python ---

    # Nome do script
    SCRIPT_NAME="install_dependencies.sh"

    echo "[$SCRIPT_NAME] Starting dependency installation..."

    # --- Instalar dependências Node.js ---
    echo "[$SCRIPT_NAME] Installing Node.js dependencies (npm install)..."
    # Verifique se package.json existe
    if [ -f package.json ]; then
    # Instale as dependências
    npm install

    # Verifique o código de saída do npm install
    if [ $? -eq 0 ]; then
        echo "[$SCRIPT_NAME] Node.js dependencies installed successfully."
    else
        echo "[$SCRIPT_NAME] ERROR: Failed to install Node.js dependencies."
        exit 1 # Saia com erro se npm install falhar
    fi
    else
    echo "[$SCRIPT_NAME] WARNING: package.json not found. Skipping npm install."
    fi

    echo "" # Linha em branco para melhor legibilidade

    # --- Instalar dependências Python ---
    echo "[$SCRIPT_NAME] Installing Python dependencies (pip install)..."
    # Verifique se requirements.txt existe
    if [ -f requirements.txt ]; then
    # Instale as dependências Python usando pip
    # Use o caminho completo para o pip se necessário (ex: /usr/local/bin/pip)
    # Se PYTHON_PATH estiver configurado, talvez pip também esteja no PATH ou próximo a ele.
    # Vamos tentar apenas 'pip' primeiro. Se falhar, talvez precise do caminho completo.
    pip install -r requirements.txt

    # Verifique o código de saída do pip install
    if [ $? -eq 0 ]; then
        echo "[$SCRIPT_NAME] Python dependencies installed successfully."
    else
        echo "[$SCRIPT_NAME] ERROR: Failed to install Python dependencies using pip."
        # Tente com python -m pip se pip direto não funcionar
        echo "[$SCRIPT_NAME] Attempting to install Python dependencies using 'python -m pip'..."
        python -m pip install -r requirements.txt
        if [ $? -eq 0 ]; then
        echo "[$SCRIPT_NAME] Python dependencies installed successfully using 'python -m pip'."
        else
        echo "[$SCRIPT_NAME] ERROR: Failed to install Python dependencies using 'python -m pip'."
        echo "[$SCRIPT_NAME] Please ensure Python and pip are installed and accessible in your environment."
        exit 1 # Saia com erro se a instalação Python falhar
        fi
    fi
    else
    echo "[$SCRIPT_NAME] WARNING: requirements.txt not found. Skipping pip install."
    fi

    echo "" # Linha em branco

    echo "[$SCRIPT_NAME] Dependency installation finished."
    exit 0 # Saída com sucesso