const mysql = require('mysql2/promise');

const connectDB = async () => {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user: process.env.MYSQL_USER || process.env.DB_USER,
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASS,
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME,
  });

  await connection.ping();
  await connection.end();
  return true;
};

module.exports = connectDB;
