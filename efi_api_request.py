# efi_api_request.py
import sys
import requests
from requests_pkcs12 import Pkcs12Adapter
import json
import os
import base64 # Para autenticação Basic Auth se necessária no script

# --- CONFIGURAÇÕES (Obtidas via variáveis de ambiente ou argumentos) ---
# A senha e o caminho do certificado P12 devem ser passados de forma segura (ENV VARS são uma opção melhor que args)
CERT_PATH = os.environ.get("EFI_CERT_PATH")
CERT_PASSWORD = os.environ.get("EFI_CERT_PASSWORD", "") # Default empty string if env var not set

# Credenciais para Basic Auth (se o script precisar obter o token)
# Neste workaround, o Node.js vai obter o token e passar.
# Mas se o script precisasse, ele as leria de ENV VARS também.
# EFI_CLIENT_ID = os.environ.get("EFI_CLIENT_ID")
# EFI_CLIENT_SECRET = os.environ.get("EFI_CLIENT_SECRET")


# URL base da API da Efí (passada como argumento)
# EFI_BASE_URL = os.environ.get("EFI_BASE_URL") # Ou passado como arg

# --- RECEBER DADOS DA REQUISIÇÃO VIA STDIN ---
# É mais seguro e robusto passar o corpo da requisição e configs via STDIN do que linha de comando.
# A primeira linha do STDIN pode ser um JSON com os detalhes da requisição.
try:
    request_config_json = sys.stdin.readline()
    request_config = json.loads(request_config_json)
    method = request_config['method']
    url_path = request_config['url_path'] # A parte da URL após a base (ex: /v2/cob)
    base_url = request_config['base_url'] # A URL base completa (ex: https://pix.api.efipay.com.br)
    data = request_config.get('data') # Pode não ter body (GET, DELETE)
    token = request_config.get('token') # Token Bearer
    extra_headers = request_config.get('headers', {}) # Headers adicionais (ex: x-skip-mtls-checking)

except Exception as e:
    # Imprime erro formatado para que Node.js consiga capturar e parsear
    # ESTE ERRO INDICA FALHA ANTES DE TENTAR CONECTAR/USAR CERTIFICADO, VAI PARA STDOUT PARA SER CAPTURADO PELO NODE
    print(json.dumps({"success": False, "error": {"message": f"Failed to read or parse input: {e}"}}), file=sys.stdout)
    sys.exit(1)


# --- PREPARAÇÃO ---
session = requests.Session()

# Configura o certificado P12 na sessão, se o caminho e o arquivo existirem
if CERT_PATH and os.path.exists(CERT_PATH):
    try:
        session.mount(base_url, Pkcs12Adapter(pkcs12_filename=CERT_PATH, pkcs12_password=CERT_PASSWORD))
    except Exception as e:
        # ESTE ERRO INDICA FALHA CRÍTICA NA CONFIGURAÇÃO TLS, VAI PARA STDOUT
        print(json.dumps({"success": False, "error": {"message": f"Failed to mount P12 adapter for {base_url}: {e}"}}), file=sys.stdout)
        sys.exit(1)
elif CERT_PATH: # Caminho especificado mas arquivo não encontrado
     # ESTE ERRO INDICA FALHA CRÍTICA NA CONFIGURAÇÃO, VAI PARA STDOUT
     print(json.dumps({"success": False, "error": {"message": f"Certificate file not found at {CERT_PATH}"}}), file=sys.stdout)
     sys.exit(1)
else:
     # ESTE ERRO INDICA FALHA CRÍTICA NA CONFIGURAÇÃO, VAI PARA STDOUT
     print(json.dumps({"success": False, "error": {"message": "Certificate path (EFI_CERT_PATH) not provided as environment variable"}}), file=sys.stdout)
     sys.exit(1)


# --- PREPARA HEADERS ---
headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    **extra_headers # Adiciona headers extras recebidos (incluindo Authorization Bearer)
}

# Se o token foi passado, ele já estará no extra_headers['Authorization']


# --- FAZ A REQUISIÇÃO ---
try:
    full_url = f"{base_url}{url_path}"
    # --- MUDANÇA: Log de debug da requisição AGORA VAI PARA STDERR ---
    print(f"PYTHON SCRIPT: Making {method} request to {full_url} with headers {headers}", file=sys.stderr)

    response = session.request(method, full_url, json=data, headers=headers)
    response.raise_for_status() # Lança exceção para status de erro (4xx ou 5xx)

    # Tenta parsear a resposta como JSON
    try:
        response_data = response.json()
    except json.JSONDecodeError:
        # Se não for JSON, retorna o texto da resposta
        response_data = response.text
        # --- MUDANÇA: Log parcial de resposta não JSON AGORA VAI PARA STDERR ---
        print(f"PYTHON SCRIPT: Response is not JSON, returning text: {response_data[:100]}...", file=sys.stderr)

    # Imprime a resposta de sucesso formatada como JSON para stdout
    # ESTE É O RESULTADO FINAL DE SUCESSO, MANTÉM NO STDOUT PARA SER PARSEADO PELO NODE
    print(json.dumps({"success": True, "data": response_data}), file=sys.stdout)

except requests.exceptions.RequestException as e:
    # Captura erros da requisição (conexão, timeout, status 4xx/5xx)
    error_details = {"message": str(e)}
    if e.response is not None:
        error_details["status"] = e.response.status_code
        try:
            error_details["data"] = e.response.json()
        except json.JSONDecodeError:
            error_details["text"] = e.response.text
        # --- MUDANÇA: Log do erro da resposta AGORA VAI PARA STDERR ---
        print(f"PYTHON SCRIPT: Received error response: {error_details}", file=sys.stderr)
    else:
        # --- MUDANÇA: Log de erro sem resposta (conexão, TLS, etc.) AGORA VAI PARA STDERR ---
        print(f"PYTHON SCRIPT: Request failed: {error_details}", file=sys.stderr)

    # Imprime a resposta de erro formatada como JSON para stdout
    # ESTE É O RESULTADO FINAL DE ERRO DA REQUISIÇÃO, MANTÉM NO STDOUT PARA SER PARSEADO PELO NODE
    print(json.dumps({"success": False, "error": error_details}), file=sys.stdout)

except Exception as e:
    # Captura quaisquer outros erros inesperados no script
    # --- MUDANÇA: Log do erro inesperado AGORA VAI PARA STDERR ---
    print(f"PYTHON SCRIPT: An unexpected error occurred: {e}", file=sys.stderr)
    # Imprime a resposta de erro formatada como JSON para stdout
    # ESTE É O RESULTADO FINAL DE ERRO DO SCRIPT, MANTÉM NO STDOUT PARA SER PARSEADO PELO NODE
    print(json.dumps({"success": False, "error": {"message": f"An unexpected script error occurred: {e}"}}), file=sys.stdout)

finally:
    session.close() # Fecha a sessão requests
    sys.stdout.flush() # Garante que a saída seja escrita antes de sair
    sys.stderr.flush() # Garante que a saída de erro seja escrita antes de sair
    sys.exit() # Sai do script Python