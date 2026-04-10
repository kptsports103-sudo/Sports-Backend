const mysql = require('mysql2/promise');
const { getMySQLConnectionConfig } = require('./mysqlOptions');

const pool = mysql.createPool(getMySQLConnectionConfig());

async function connectMySQL() {
  const conn = await pool.getConnection();
  conn.release();
  return pool;
}

module.exports = {
  pool,
  connectMySQL,
};
