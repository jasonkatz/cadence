import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { User } from "../dao/user-dao";
import { createUserService, UserServiceDeps } from "./user-service";

function makeDeps() {
  const mockFindByAuth0Id = mock((_auth0Id: string) =>
    Promise.resolve(null as User | null)
  );
  const mockCreate = mock((_data: { auth0Id: string; email: string; name?: string }) =>
    Promise.resolve({ id: "", auth0_id: "", email: "", name: "", created_at: new Date() } as User)
  );
  const mockFindById = mock((_id: string) => Promise.resolve(null as User | null));
  const mockUpdate = mock((_id: string, _data: { email?: string; name?: string }) =>
    Promise.resolve(null as User | null)
  );

  const deps: UserServiceDeps = {
    userDao: {
      findByAuth0Id: mockFindByAuth0Id,
      create: mockCreate,
      findById: mockFindById,
      update: mockUpdate,
    },
  };

  return { deps, mocks: { findByAuth0Id: mockFindByAuth0Id, create: mockCreate } };
}

describe("userService", () => {
  let service: ReturnType<typeof createUserService>;
  let mocks: ReturnType<typeof makeDeps>["mocks"];

  beforeEach(() => {
    const d = makeDeps();
    service = createUserService(d.deps);
    mocks = d.mocks;
  });

  describe("findOrCreate", () => {
    it("should return existing user if found by auth0Id", async () => {
      const existingUser: User = {
        id: "123",
        auth0_id: "auth0|123",
        email: "test@example.com",
        name: "Test User",
        created_at: new Date(),
      };

      mocks.findByAuth0Id.mockResolvedValue(existingUser);

      const result = await service.findOrCreate({
        auth0Id: "auth0|123",
        email: "test@example.com",
        name: "Test User",
      });

      expect(result).toEqual({
        id: "123",
        email: "test@example.com",
        name: "Test User",
      });
      expect(mocks.create).not.toHaveBeenCalled();
    });

    it("should create new user if not found", async () => {
      const newUser: User = {
        id: "456",
        auth0_id: "auth0|456",
        email: "new@example.com",
        name: "New User",
        created_at: new Date(),
      };

      mocks.findByAuth0Id.mockResolvedValue(null);
      mocks.create.mockResolvedValue(newUser);

      const result = await service.findOrCreate({
        auth0Id: "auth0|456",
        email: "new@example.com",
        name: "New User",
      });

      expect(result).toEqual({
        id: "456",
        email: "new@example.com",
        name: "New User",
      });
      expect(mocks.create).toHaveBeenCalledWith({
        auth0Id: "auth0|456",
        email: "new@example.com",
        name: "New User",
      });
    });
  });
});
