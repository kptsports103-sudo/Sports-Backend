require('dotenv').config();

const app = require('./src/app');
const { ensureMySQLReady } = require('./src/config/mysqlReady');

const PORT = process.env.PORT || 4000;

async function startServer() {
  try {
    await ensureMySQLReady();
    console.log('MySQL connected successfully');
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📝 API available at http://localhost:${PORT}/api/v1`);
      console.log(`🔗 Home CMS API: http://localhost:${PORT}/api/v1/home`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
