import { config } from 'dotenv';
config();

function formatPhoneNumber(phone: string | number): string {
  if (!phone) {
    throw new Error('Número de telefone não pode ser vazio');
  }
  // Converte para string caso seja número
  const phoneStr = phone.toString();
  const numbers = phoneStr.replace(/\D/g, '');
  if (!numbers.startsWith('55')) {
    return `55${numbers}`;
  }
  return numbers;
}

export async function sendMessage(numero: string | number, codigo: string): Promise<any> {
  if (!numero || !codigo) {
    throw new Error('Número de telefone e código são obrigatórios');
  }

  const instanceId = process.env.INSTANCE_ID;
  const apiKey = process.env.API_KEY;

  if (!instanceId || !apiKey) {
    throw new Error('INSTANCE_ID ou API_KEY não configurados nas variáveis de ambiente.');
  }

  try {
    const phoneFormatted = formatPhoneNumber(numero);
    if (phoneFormatted.length < 12 || phoneFormatted.length > 13) {
      throw new Error('Número de telefone inválido. Use o formato: DDD + número');
    }

    const url = `https://api.w-api.app/v1/message/send-text?instanceId=${instanceId}`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    // Primeira mensagem
    const firstMessage = {
      phone: phoneFormatted,
      message: `Cadastro concluído com sucesso! 🎉\n\nVocê agora faz parte da Loto Jack, uma plataforma divertida onde você pode indicar amigos e participar de experiências premiadas com eles.\n\nAqui está o seu código de indicação: ${codigo}\n\n💬 Ao compartilhar com seus amigos, vocês criam uma rede de participação — e todos se beneficiam juntos.\n\n📲 Copie e envie este link com seu código:\n👉 https://lotojack.netlify.app/?code=${codigo}\n\nFica tranquilo… é apenas uma plataforma de prêmios, não é spam.`,
      delayMessage: 3,
    };

    const firstResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(firstMessage),
    });

    if (!firstResponse.ok) {
      const errorData = await firstResponse.json();
      throw new Error(`Erro na API do WhatsApp: ${errorData.message || firstResponse.statusText}`);
    }

    // Segunda mensagem
    const secondMessage = {
      phone: phoneFormatted,
      message: `Ei! Tudo bem? 😄\nQuero te mostrar algo legal que comecei a usar: a Loto Jack — uma plataforma de prêmios onde a gente participa juntos e se indica.\n\nFica tranquilo… não é spam. Só estou compartilhando porque confio em você. 🤝\n\nSe quiser conhecer, é só clicar aqui:\n👉 https://lotojack.netlify.app/?code=${codigo}\n\nSe curtir, me avisa pra gente participar juntos! ✨`,
      delayMessage: 5,
    };

    const secondResponse = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(secondMessage),
    });

    if (!secondResponse.ok) {
      const errorData = await secondResponse.json();
      throw new Error(`Erro na API do WhatsApp: ${errorData.message || secondResponse.statusText}`);
    }

    const result = await secondResponse.json();
    console.log('Mensagens enviadas com sucesso:', result);
    return result;
  } catch (err: any) {
    console.error('Erro ao enviar mensagens:', err.message);
    throw new Error(`Falha ao enviar mensagens: ${err.message}`);
  }
}

export async function sendMessageMass(numbers: (string | number)[], hour: string): Promise<void> {
  if (!numbers || !numbers.length || !hour) {
    throw new Error('Lista de números e horário são obrigatórios');
  }

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
