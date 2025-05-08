# efi_api_request.py
import sys
import requests
from requests_pkcs12 import Pkcs12Adapter
import json
import os
import base64 # Para autenticação Basic Auth se necessária no script

# --- LOG DE DEBUG IMEDIATO PARA STDERR ---
# Isto deve aparecer nos logs do Node.js no STDERR se o script Python iniciar
print("PYTHON SCRIPT: Script started.", file=sys.stderr)
# Opcional: Logar o executável Python que está rodando
print(f"PYTHON SCRIPT: Python Executable: {sys.executable}", file=sys.stderr)

# --- CONFIGURAÇÕES (Obtidas via variáveis de ambiente ou argumentos) ---
# A senha e o caminho do certificado P12 devem ser passados de forma segura (ENV VARS são uma opção melhor que args)
CERT_PATH = os.environ.get("EFI_CERT_PATH")
CERT_PASSWORD = os.environ.get("EFI_CERT_PASSWORD", "") # Default empty string if env var not set

# --- LOG DOS CAMINHOS E VARS RECEBIDAS VIA ENV ---
print(f"PYTHON SCRIPT: EFI_CERT_PATH from ENV: {CERT_PATH}", file=sys.stderr)
# Logar a senha de forma segura (não imprima o valor real)
print(f"PYTHON SCRIPT: EFI_CERT_PASSWORD from ENV: {'***' if CERT_PASSWORD else '<<empty>>'}", file=sys.stderr)


# --- RECEBER DADOS DA REQUISIÇÃO VIA STDIN ---
# É mais seguro e robusto passar o corpo da requisição e configs via STDIN do que linha de comando.
# A primeira linha do STDIN pode ser um JSON com os detalhes da requisição.
print("PYTHON SCRIPT: Attempting to read STDIN...", file=sys.stderr)
try:
    request_config_json = sys.stdin.readline()
    # Log o que foi lido (remova newline para log mais limpo)
    print(f"PYTHON SCRIPT: Read from STDIN: {request_config_json.strip()}", file=sys.stderr)
    request_config = json.loads(request_config_json)
    # Log o JSON parseado (pode ser grande, cuidado em produção)
    print(f"PYTHON SCRIPT: Parsed STDIN config: {request_config}", file=sys.stderr)

    method = request_config['method']
    url_path = request_config['url_path'] # A parte da URL após a base (ex: /v2/cob)
    base_url = request_config['base_url'] # A URL base completa (ex: https://pix.api.efipay.com.br)
    data = request_config.get('data') # Pode não ter body (GET, DELETE)
    token = request_config.get('token') # Token Bearer
    extra_headers = request_config.get('headers', {}) # Headers adicionais (ex: x-skip-mtls-checking)

except Exception as e:
    # Imprime erro formatado para que Node.js consiga capturar e parsear
    # ESTE ERRO INDICA FALHA ANTES DE TENTAR CONECTAR/USAR CERTIFICADO, VAI PARA STDOUT PARA SER CAPTURADO PELO NODE
    # Também loga para STDERR para debug no caso de EPIPE ou outros problemas de startup
    print(f"PYTHON SCRIPT: Error reading or parsing STDIN: {e}", file=sys.stderr) # Log para STDERR
    print(json.dumps({"success": False, "error": {"message": f"Failed to read or parse input: {e}"}}), file=sys.stdout)
    sys.exit(1)

print("PYTHON SCRIPT: STDIN processed. Proceeding with setup...", file=sys.stderr)


# --- PREPARAÇÃO ---
session = requests.Session()

# Configura o certificado P12 na sessão, se o caminho e o arquivo existirem
print(f"PYTHON SCRIPT: Checking certificate path: {CERT_PATH}", file=sys.stderr)
if CERT_PATH:
    if os.path.exists(CERT_PATH):
        print(f"PYTHON SCRIPT: Certificate file found at {CERT_PATH}. Attempting to mount Pkcs12Adapter...", file=sys.stderr)
        try:
            # Certifique-se de que base_url é o esquema+host (ex: https://pix.api.efipay.com.br)
            # O mount associa a adaptador a um prefixo de URL
            print(f"PYTHON SCRIPT: Attempting to mount Pkcs12Adapter for base_url: {base_url}", file=sys.stderr)
            session.mount(base_url, Pkcs12Adapter(pkcs12_filename=CERT_PATH, pkcs12_password=CERT_PASSWORD))
            print("PYTHON SCRIPT: Pkcs12Adapter mounted successfully.", file=sys.stderr)
        except Exception as e:
            # ESTE ERRO INDICA FALHA CRÍTICA NA CONFIGURAÇÃO TLS/CERTIFICADO, VAI PARA STDOUT
            # Também loga para STDERR
            print(f"PYTHON SCRIPT: Error mounting Pkcs12Adapter: {e}", file=sys.stderr) # Log para STDERR
            print(json.dumps({"success": False, "error": {"message": f"Failed to mount P12 adapter for {base_url}: {e}"}}), file=sys.stdout)
            sys.exit(1)
    else: # Caminho especificado mas arquivo não encontrado
         # ESTE ERRO INDICA FALHA CRÍTICA NA CONFIGURAÇÃO, VAI PARA STDOUT
         # Também loga para STDERR
         print(f"PYTHON SCRIPT: Certificate file NOT found at {CERT_PATH}.", file=sys.stderr) # Log para STDERR
         print(json.dumps({"success": False, "error": {"message": f"Certificate file not found at {CERT_PATH}"}}), file=sys.stdout)
         sys.exit(1)
else:
     # ESTE ERRO INDICA FALHA CRÍTICA NA CONFIGURAÇÃO (ENV VAR AUSENTE), VAI PARA STDOUT
     # Também loga para STDERR
     print("PYTHON SCRIPT: Certificate path (EFI_CERT_PATH) not provided as environment variable.", file=sys.stderr) # Log para STDERR
     print(json.dumps({"success": False, "error": {"message": "Certificate path (EFI_CERT_PATH) not provided as environment variable"}}), file=sys.stdout)
     sys.exit(1)

print("PYTHON SCRIPT: Certificate setup completed.", file=sys.stderr)


# --- PREPARA HEADERS ---
headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    **extra_headers # Adiciona headers extras recebidos (incluindo Authorization Bearer)
}

# Se o token foi passado, ele já estará no extra_headers['Authorization']


# --- FAZ A REQUISIÇÃO ---
print("PYTHON SCRIPT: Preparing for API request...", file=sys.stderr)
try:
    full_url = f"{base_url}{url_path}"
    # Log de debug da requisição AGORA VAI PARA STDERR
    print(f"PYTHON SCRIPT: Making {method} request to {full_url} with headers {headers}", file=sys.stderr)
    if data:
        # Logar o corpo da requisição (cuidado com dados sensíveis em produção)
        print(f"PYTHON SCRIPT: Request body: {json.dumps(data)}", file=sys.stderr)

    response = session.request(method, full_url, json=data, headers=headers)
    print(f"PYTHON SCRIPT: Received response status code: {response.status_code}", file=sys.stderr)
    response.raise_for_status() # Lança exceção para status de erro (4xx ou 5xx)
    print("PYTHON SCRIPT: Response status is successful (2xx).", file=sys.stderr)


    # Tenta parsear a resposta como JSON
    try:
        response_data = response.json()
        print("PYTHON SCRIPT: Response parsed as JSON.", file=sys.stderr)
    except json.JSONDecodeError:
        # Se não for JSON, retorna o texto da resposta
        response_data = response.text
        # Log parcial agora vai para STDERR
        print(f"PYTHON SCRIPT: Response is not JSON, returning text: {response_data[:200]}...", file=sys.stderr) # Log um pouco mais de texto

    # Imprime a resposta de sucesso formatada como JSON para stdout
    # ESTE É O RESULTADO FINAL DE SUCESSO, MANTÉM NO STDOUT PARA SER PARSEADO PELO NODE
    print(json.dumps({"success": True, "data": response_data}), file=sys.stdout)

except requests.exceptions.RequestException as e:
    # Captura erros da requisição (conexão, timeout, status 4xx/5xx)
    error_details = {"message": str(e)}
    print(f"PYTHON SCRIPT: Caught RequestException: {e}", file=sys.stderr) # Log da exceção

    if e.response is not None:
        error_details["status"] = e.response.status_code
        print(f"PYTHON SCRIPT: Error Response Status: {e.response.status_code}", file=sys.stderr)
        try:
            error_details["data"] = e.response.json()
            print(f"PYTHON SCRIPT: Error Response Body (JSON): {error_details['data']}", file=sys.stderr)
        except json.JSONDecodeError:
            error_details["text"] = e.response.text
            print(f"PYTHON SCRIPT: Error Response Body (Text): {error_details['text'][:200]}...", file=sys.stderr)
        # Log formatado do erro da resposta
        print(f"PYTHON SCRIPT: Received error response details: {error_details}", file=sys.stderr)
    else:
        # Log de erro sem resposta (conexão, TLS, etc.)
        print(f"PYTHON SCRIPT: Request failed with no response: {error_details}", file=sys.stderr)

    # Imprime a resposta de erro formatada como JSON para stdout
    # ESTE É O RESULTADO FINAL DE ERRO DA REQUISIÇÃO, MANTÉM NO STDOUT PARA SER PARSEADO PELO NODE
    print(json.dumps({"success": False, "error": error_details}), file=sys.stdout)

except Exception as e:
    # Captura quaisquer outros erros inesperados no script
    # Log do erro inesperado agora vai para STDERR
    print(f"PYTHON SCRIPT: An unexpected error occurred during API call or processing: {e}", file=sys.stderr)
    # Imprime a resposta de erro formatada como JSON para stdout
    # ESTE É O RESULTADO FINAL DE ERRO DO SCRIPT, MANTÉM NO STDOUT PARA SER PARSEADO PELO NODE
    print(json.dumps({"success": False, "error": {"message": f"An unexpected script error occurred: {e}"}}), file=sys.stdout)

finally:
    session.close() # Fecha a sessão requests
    sys.stdout.flush() # Garante que a saída seja escrita antes de sair
    sys.stderr.flush() # Garante que a saída de erro seja escrita antes de sair
    print("PYTHON SCRIPT: Script finished.", file=sys.stderr) # Final log para STDERR
    sys.exit() # Sai do script Python