const crypto = require('crypto');

function getNextRandomNumber(seed, sequence) {
  const algorithm = 'aes-256-cbc'; // Alterado para AES-256-CBC
  const key = Buffer.from(seed, 'hex');

  // IV de 16 bytes (128 bits) para AES-256-CBC, preenchido com zeros
  const iv = Buffer.alloc(16, 0);

  // Configurar um Buffer para o número de sequência
  const sequenceBuffer = Buffer.alloc(4);
  sequenceBuffer.writeUInt32LE(sequence, 0);

  // Criptografar o número de sequência usando AES-256-CBC
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(sequenceBuffer),
    cipher.final(),
  ]);

  // Gerar um número a partir do resultado criptografado
  const randomNumber = encrypted.readUInt32LE(0);

  return randomNumber;
}

const seed = '000000000000000000023742dcd85e26c7adf4a7c712cf72cd55e8649e21e7cd'; // Substitua por um hash válido
const sequence = 128; // Você pode variar esse valor para testar
const randomNumber = getNextRandomNumber(seed, sequence);

console.log('Número aleatório gerado:', randomNumber);