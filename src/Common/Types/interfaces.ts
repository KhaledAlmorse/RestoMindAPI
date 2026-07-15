import { UserType } from 'src/DB/Models';

export interface IAuthUser {
  user: UserType;
  token: object;
}
