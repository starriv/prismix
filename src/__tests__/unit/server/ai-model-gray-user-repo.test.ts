import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiModelGrayUserRepo } from "@/server/repos/ai-model-gray-user-repo";

const {
  mockQueryAll,
  mockQueryOne,
  mockTxDelete,
  mockTxDeleteWhere,
  mockTxInsert,
  mockTxInsertValues,
  mockTxInsertOnConflict,
} = vi.hoisted(() => {
  const mockTxInsertOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockTxInsertValues = vi.fn().mockReturnValue({
    onConflictDoNothing: (...args: unknown[]) => mockTxInsertOnConflict(...args),
  });
  const mockTxInsert = vi.fn().mockReturnValue({
    values: (...args: unknown[]) => mockTxInsertValues(...args),
  });
  const mockTxDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockTxDelete = vi.fn().mockReturnValue({
    where: (...args: unknown[]) => mockTxDeleteWhere(...args),
  });
  return {
    mockQueryAll: vi.fn(),
    mockQueryOne: vi.fn(),
    mockTxDelete,
    mockTxDeleteWhere,
    mockTxInsert,
    mockTxInsertValues,
    mockTxInsertOnConflict,
  };
});

vi.mock("@/server/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit", "select"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  return {
    db: {
      ...chain,
      select: vi.fn().mockReturnValue(chain),
      transaction: vi
        .fn()
        .mockImplementation(
          async (
            fn: (tx: { delete: typeof mockTxDelete; insert: typeof mockTxInsert }) => Promise<void>,
          ) => fn({ delete: mockTxDelete, insert: mockTxInsert }),
        ),
    },
    queryAll: (...args: unknown[]) => mockQueryAll(...args),
    queryOne: (...args: unknown[]) => mockQueryOne(...args),
    aiModelGrayUsers: { modelId: {}, userId: {}, id: {} },
    users: { id: {}, uuid: {}, name: {}, email: {}, address: {}, status: {} },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
}));

const USER_FIXTURE = {
  id: 1,
  uuid: "u1",
  name: "Alice",
  email: "a@x.com",
  address: null,
  status: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTxInsertValues.mockReturnValue({ onConflictDoNothing: mockTxInsertOnConflict });
  mockTxInsert.mockReturnValue({ values: (...args: unknown[]) => mockTxInsertValues(...args) });
  mockTxDeleteWhere.mockResolvedValue(undefined);
  mockTxDelete.mockReturnValue({ where: (...args: unknown[]) => mockTxDeleteWhere(...args) });
  mockTxInsertOnConflict.mockResolvedValue(undefined);
});

describe("aiModelGrayUserRepo.findUsersByModelId", () => {
  it("returns the users returned by queryAll", async () => {
    mockQueryAll.mockResolvedValueOnce([USER_FIXTURE]);
    const result = await aiModelGrayUserRepo.findUsersByModelId(42);
    expect(result).toEqual([USER_FIXTURE]);
    expect(mockQueryAll).toHaveBeenCalledOnce();
  });

  it("returns empty array when there are no gray users", async () => {
    mockQueryAll.mockResolvedValueOnce([]);
    const result = await aiModelGrayUserRepo.findUsersByModelId(42);
    expect(result).toEqual([]);
  });
});

describe("aiModelGrayUserRepo.findModelIdsForUser", () => {
  it("extracts model IDs from query rows", async () => {
    mockQueryAll.mockResolvedValueOnce([{ modelId: 7 }, { modelId: 13 }]);
    const result = await aiModelGrayUserRepo.findModelIdsForUser(10);
    expect(result).toEqual([7, 13]);
  });
});

describe("aiModelGrayUserRepo.findUserModelIds", () => {
  it("returns empty set when modelIds is empty (no DB call)", async () => {
    const result = await aiModelGrayUserRepo.findUserModelIds(10, []);
    expect(result).toEqual(new Set());
    expect(mockQueryAll).not.toHaveBeenCalled();
  });

  it("returns a set of model IDs the user has access to", async () => {
    mockQueryAll.mockResolvedValueOnce([{ modelId: 2 }, { modelId: 5 }]);
    const result = await aiModelGrayUserRepo.findUserModelIds(10, [2, 3, 5]);
    expect(result).toEqual(new Set([2, 5]));
    expect(mockQueryAll).toHaveBeenCalledOnce();
  });
});

describe("aiModelGrayUserRepo.findUsersByModelIds", () => {
  it("returns an empty Map when modelIds is empty (no DB call)", async () => {
    const result = await aiModelGrayUserRepo.findUsersByModelIds([]);
    expect(result).toEqual(new Map());
    expect(mockQueryAll).not.toHaveBeenCalled();
  });

  it("groups users by model ID", async () => {
    mockQueryAll.mockResolvedValueOnce([
      { modelId: 1, ...USER_FIXTURE, id: 10 },
      { modelId: 2, ...USER_FIXTURE, id: 20 },
      { modelId: 1, ...USER_FIXTURE, id: 11 },
    ]);
    const result = await aiModelGrayUserRepo.findUsersByModelIds([1, 2]);
    expect(result.get(1)).toHaveLength(2);
    expect(result.get(2)).toHaveLength(1);
    expect(result.get(1)!.map((u) => u.id)).toEqual([10, 11]);
  });
});

describe("aiModelGrayUserRepo.isUserAllowedForModel", () => {
  it("returns true when a row exists", async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 99 });
    expect(await aiModelGrayUserRepo.isUserAllowedForModel(1, 10)).toBe(true);
  });

  it("returns false when no row exists", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await aiModelGrayUserRepo.isUserAllowedForModel(1, 10)).toBe(false);
  });
});

describe("aiModelGrayUserRepo.replaceForModel", () => {
  it("deletes existing rows then inserts new ones", async () => {
    await aiModelGrayUserRepo.replaceForModel(7, [1, 2, 3]);

    expect(mockTxDelete).toHaveBeenCalledOnce();
    expect(mockTxDeleteWhere).toHaveBeenCalledOnce();
    expect(mockTxInsert).toHaveBeenCalledOnce();
    expect(mockTxInsertValues).toHaveBeenCalledWith([
      { modelId: 7, userId: 1 },
      { modelId: 7, userId: 2 },
      { modelId: 7, userId: 3 },
    ]);
  });

  it("deduplicates user IDs before inserting", async () => {
    await aiModelGrayUserRepo.replaceForModel(7, [1, 2, 1, 3, 2]);

    expect(mockTxInsertValues).toHaveBeenCalledWith([
      { modelId: 7, userId: 1 },
      { modelId: 7, userId: 2 },
      { modelId: 7, userId: 3 },
    ]);
  });

  it("only deletes when given an empty user ID list", async () => {
    await aiModelGrayUserRepo.replaceForModel(7, []);

    expect(mockTxDelete).toHaveBeenCalledOnce();
    expect(mockTxInsert).not.toHaveBeenCalled();
  });
});
