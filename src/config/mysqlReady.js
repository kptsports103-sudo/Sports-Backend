const { connectMySQL } = require('./mysql');
const { initializeMySQLSchema } = require('./mysqlSchema');

let readyPromise = null;

const ensureMySQLReady = async () => {
  if (!readyPromise) {
    readyPromise = (async () => {
      await connectMySQL();
      await initializeMySQLSchema();
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
