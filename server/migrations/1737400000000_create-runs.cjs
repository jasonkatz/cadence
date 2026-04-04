/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("runs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    step_id: {
      type: "uuid",
      notNull: true,
      references: "steps",
      onDelete: "CASCADE",
    },
    workflow_id: {
      type: "uuid",
      notNull: true,
      references: "workflows",
      onDelete: "CASCADE",
    },
    agent_role: {
      type: "text",
      notNull: true,
    },
    iteration: {
      type: "integer",
      notNull: true,
    },
    prompt: {
      type: "text",
      notNull: true,
    },
    response: {
      type: "text",
    },
    exit_code: {
      type: "integer",
    },
    duration_secs: {
      type: "numeric",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex("runs", "step_id");
  pgm.createIndex("runs", "workflow_id");
  pgm.createIndex("runs", ["workflow_id", "iteration"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("runs");
};
