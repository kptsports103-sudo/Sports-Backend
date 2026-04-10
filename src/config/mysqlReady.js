const { connectMySQL } = require('./mysql');
const { initializeMySQLSchema } = require('./mysqlSchema');

let readyPromise = null;
const shouldInitializeSchema = /^(1|true|yes|on)$/i.test(
  String(process.env.MYSQL_EAGER_SCHEMA_INIT || '').trim()
);

const ensureMySQLReady = async () => {
  if (!readyPromise) {
    readyPromise = (async () => {
      await connectMySQL();
      if (shouldInitializeSchema) {
        await initializeMySQLSchema();
      }
      return true;
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }

  return readyPromise;
};

module.exports = {
  ensureMySQLReady,
};
