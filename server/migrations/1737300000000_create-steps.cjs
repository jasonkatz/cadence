/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("steps", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    workflow_id: {
      type: "uuid",
      notNull: true,
      references: "workflows",
      onDelete: "CASCADE",
    },
    iteration: {
      type: "integer",
      notNull: true,
    },
    type: {
      type: "text",
      notNull: true,
    },
    status: {
      type: "text",
      notNull: true,
      default: "pending",
    },
    started_at: {
      type: "timestamptz",
    },
    finished_at: {
      type: "timestamptz",
    },
    detail: {
      type: "text",
    },
  });

  pgm.createIndex("steps", "workflow_id");
  pgm.createIndex("steps", ["workflow_id", "iteration"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("steps");
};
