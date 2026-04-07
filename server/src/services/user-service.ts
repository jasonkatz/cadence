import { userDao as defaultUserDao, User } from "../dao/user-dao";

export interface UserServiceDeps {
  userDao: Pick<typeof defaultUserDao, "findByEmail" | "findById" | "create" | "update">;
}

const defaultDeps: UserServiceDeps = { userDao: defaultUserDao };

export function createUserService(deps: UserServiceDeps = defaultDeps) {
  return {
    async findOrCreate(data: {
      email: string;
      name?: string;
    }): Promise<{ id: string; email: string; name?: string }> {
      let user = await deps.userDao.findByEmail(data.email);

      if (!user) {
        user = await deps.userDao.create(data);
      } else if (data.name && user.name !== data.name) {
        user = (await deps.userDao.update(user.id, { name: data.name })) || user;
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name || undefined,
      };
    },

    async findById(id: string): Promise<User | null> {
      return deps.userDao.findById(id);
    },
  };
}

export const userService = createUserService();
