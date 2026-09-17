import type { User } from '../../generated/prisma/client.js';
import type { UserDto, UserSummaryDto } from './user.schemas.js';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

export function toUserSummaryDto(user: Pick<User, 'id' | 'name' | 'avatarUrl'>): UserSummaryDto {
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}
