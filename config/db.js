const mysql = require('mysql2/promise');
const { getMySQLConnectionConfig } = require('../src/config/mysqlOptions');

const connectDB = async () => {
  const {
    waitForConnections,
    connectionLimit,
    queueLimit,
    ...connectionConfig
  } = getMySQLConnectionConfig();

  const connection = await mysql.createConnection(connectionConfig);

  await connection.ping();
  await connection.end();
  return true;
};

module.exports = connectDB;
