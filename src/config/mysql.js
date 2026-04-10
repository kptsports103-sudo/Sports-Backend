const mysql = require('mysql2/promise');

const connectTimeout = Math.max(
  1000,
  Number(process.env.MYSQL_CONNECT_TIMEOUT || process.env.DB_CONNECT_TIMEOUT || 10000)
);

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
  user: process.env.MYSQL_USER || process.env.DB_USER,
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASS,
  database: process.env.MYSQL_DATABASE || process.env.DB_NAME,
  connectTimeout,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function connectMySQL() {
  const conn = await pool.getConnection();
  conn.release();
  return pool;
}

module.exports = {
  pool,
  connectMySQL,
};
