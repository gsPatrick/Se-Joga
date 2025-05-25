import { config } from 'dotenv';
config();

function formatPhoneNumber(phone: string): string {
  const numbers = phone.replace(/\D/g, '');
  if (!numbers.startsWith('55')) {
    return `55${numbers}`;
  }
  return numbers;
}

export async function sendMessage(numero: string, codigo: string): Promise<any> {
  const instanceId = process.env.INSTANCE_ID;
  const apiKey = process.env.API_KEY;

  if (!instanceId || !apiKey) {
    throw new Error('INSTANCE_ID ou API_KEY não configurados nas variáveis de ambiente.');
  }

  const phoneFormatted = formatPhoneNumber(numero);
  if (phoneFormatted.length < 12 || phoneFormatted.length > 13) {
    throw new Error('Número de telefone inválido. Use o formato: DDD + número');
  }

  const url = `https://api.w-api.app/v1/message/send-text?instanceId=${instanceId}`;

  const payload = {
    phone: phoneFormatted,
    message: `Escolha seu número da sorte e use meu código ${codigo}. Se você ganhar, eu ganho junto!`,
    delayMessage: 3,
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Erro na API do WhatsApp: ${errorData.message || response.statusText}`);
    }

    const result = await response.json();
    console.log('Mensagem enviada com sucesso:', result);
    return result;
  } catch (err: any) {
    console.error('Erro ao enviar mensagem:', err.message);
    throw new Error(`Falha ao enviar mensagem: ${err.message}`);
  }
}

export async function sendMessageMass(numbers: string[], hour: string): Promise<void> {
  const instanceId = process.env.INSTANCE_ID;
  const apiKey = process.env.API_KEY;

  if (!instanceId || !apiKey) {
    throw new Error('INSTANCE_ID ou API_KEY não configurados nas variáveis de ambiente.');
  }

  const url = `https://api.w-api.app/v1/message/send-text?instanceId=${instanceId}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  const formattedNumbers = numbers.map(formatPhoneNumber);

  for (const phone of formattedNumbers) {
    if (phone.length < 12 || phone.length > 13) {
      console.warn(`Número inválido ignorado: ${phone}`);
      continue;
    }

    const payload = {
      phone,
      message: `Sua rifa fechou! Às ${hour} será o sorteio.`,
      delayMessage: 3,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`Erro ao enviar para ${phone}:`, errorData.message || response.statusText);
        continue;
      }

      const result = await response.json();
      console.log(`Mensagem enviada para ${phone}:`, result);
    } catch (err: any) {
      console.error(`Erro ao enviar para ${phone}:`, err.message);
    }
  }
}
