import { UserType } from 'src/DB/Models';

export interface IAuthUser {
  user: UserType;
  token: object;
}

export interface AuthOptions {
  roles?: string[];
  tokenType?: 'access' | 'refresh';
}
