import * as bcrypt from 'bcrypt';

export const Hash = (
  plainText: string,
  saltRounds = process.env.SALT_ROUNDS ? parseInt(process.env.SALT_ROUNDS) : 10,
): string => {
  return bcrypt.hashSync(plainText, saltRounds);
};

export const CompareHash = (plainText: string, hashedText: string): boolean => {
  return bcrypt.compareSync(plainText, hashedText);
};
