/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.dropIndex("users", "auth0_id");
  pgm.dropColumn("users", "auth0_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.addColumn("users", {
    auth0_id: {
      type: "text",
      notNull: true,
      unique: true,
      default: "legacy",
    },
  });
  pgm.createIndex("users", "auth0_id");
};
