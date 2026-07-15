import CryptoJS from 'crypto-js';

const secret = process.env.JWT_SECRET || 'secret';

export const Encrypt = (plainText: string, secret: string) => {
  return CryptoJS.AES.encrypt(JSON.stringify(plainText), secret).toString();
};

export const Decrypt = (cipherText: string, secret: string) => {
  return JSON.parse(
    CryptoJS.AES.decrypt(cipherText, secret).toString(CryptoJS.enc.Utf8),
  );
};
