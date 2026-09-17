import type { Clock } from '../../common/clock.js';
import { NotFoundError } from '../../common/errors.js';
import { toUserDto } from './user.mapper.js';
import type { UserRepository } from './user.repository.js';
import type { UpdateMeBody, UserDto } from './user.schemas.js';

export interface UserService {
  getMe(userId: string): Promise<UserDto>;
  updateMe(userId: string, body: UpdateMeBody): Promise<UserDto>;
  setAvatarUrl(userId: string, avatarUrl: string): Promise<UserDto>;
}

export function createUserService(repository: UserRepository, clock: Clock): UserService {
  return {
    async getMe(userId) {
      const user = await repository.findById(userId);
      // A valid token for a deleted account.
      if (!user) throw new NotFoundError('User not found');
      return toUserDto(user);
    },

    async updateMe(userId, body) {
      const user = await repository.updateName(userId, body.name, clock.now());
      return toUserDto(user);
    },

    async setAvatarUrl(userId, avatarUrl) {
      const user = await repository.updateAvatarUrl(userId, avatarUrl, clock.now());
      return toUserDto(user);
    },
  };
}
