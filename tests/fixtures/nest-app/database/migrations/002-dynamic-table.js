'use strict';

const tableName = 'dynamic_orders';
const columnName = 'customerId';
const indexName = 'idx_dynamic_orders_customer_id';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        "id" UUID PRIMARY KEY,
        "${columnName}" UUID NOT NULL
      )
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" ("${columnName}")
    `);
  },
};
