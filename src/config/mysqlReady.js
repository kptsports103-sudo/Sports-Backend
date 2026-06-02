const { connectMySQL } = require('./mysql');
const { initializeMySQLSchema } = require('./mysqlSchema');
const { assertMySQLConnectionConfig } = require('./mysqlOptions');

let readyPromise = null;
const shouldInitializeSchema = /^(1|true|yes|on)$/i.test(
  String(process.env.MYSQL_EAGER_SCHEMA_INIT || '').trim()
);

const ensureMySQLReady = async () => {
  if (!readyPromise) {
    readyPromise = (async () => {
      assertMySQLConnectionConfig();
      await connectMySQL();
      if (shouldInitializeSchema) {
        await initializeMySQLSchema();
      }
      return true;
    })().catch((error) => {
      readyPromise = null;
      if (!error.statusCode) {
        error.statusCode = 503;
      }
      if (!error.code) {
        error.code = 'MYSQL_UNAVAILABLE';
      }
      if (!error.retryAfter) {
        error.retryAfter = 5;
      }
      throw error;
    });
  }

  return readyPromise;
};

module.exports = {
  ensureMySQLReady,
};
