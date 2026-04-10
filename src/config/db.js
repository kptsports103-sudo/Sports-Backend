const mysql = require('mysql2/promise');
const { getMySQLConnectionConfig } = require('./mysqlOptions');

const db = mysql.createPool(getMySQLConnectionConfig());

module.exports = db;
