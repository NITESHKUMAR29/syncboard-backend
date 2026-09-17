import type { User } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  updateName(id: string, name: string, now: Date): Promise<User>;
  updateAvatarUrl(id: string, avatarUrl: string, now: Date): Promise<User>;
}

export function createUserRepository(db: Database): UserRepository {
  return {
    findById(id) {
      return db.user.findUnique({ where: { id } });
    },

    updateName(id, name, now) {
      return db.user.update({ where: { id }, data: { name, updatedAt: now } });
    },

    updateAvatarUrl(id, avatarUrl, now) {
      return db.user.update({ where: { id }, data: { avatarUrl, updatedAt: now } });
    },
  };
}
