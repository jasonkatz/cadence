/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("workflows", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    task: {
      type: "text",
      notNull: true,
    },
    repo: {
      type: "text",
      notNull: true,
    },
    branch: {
      type: "text",
      notNull: true,
    },
    requirements: {
      type: "text",
    },
    proposal: {
      type: "text",
    },
    pr_number: {
      type: "integer",
    },
    status: {
      type: "text",
      notNull: true,
      default: "pending",
    },
    iteration: {
      type: "integer",
      notNull: true,
      default: 0,
    },
    max_iters: {
      type: "integer",
      notNull: true,
      default: 8,
    },
    error: {
      type: "text",
    },
    created_by: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("workflows", "created_by");
  pgm.createIndex("workflows", "status");
  pgm.createIndex("workflows", ["created_by", "created_at"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("workflows");
};
