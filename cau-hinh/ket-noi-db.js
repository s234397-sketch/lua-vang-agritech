const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

const dungWindowsAuth = !process.env.DB_USER;

const config = {
  server: process.env.DB_SERVER || 'localhost\\SQLEXPRESS',
  database: process.env.DB_DATABASE || process.env.DB_NAME || 'LuaVangDB',
  driver: process.env.DB_DRIVER || 'ODBC Driver 18 for SQL Server',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustedConnection: dungWindowsAuth,
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    enableArithAbort: true,
    useUTC: false
  },
  ...(dungWindowsAuth
    ? {}
    : { user: process.env.DB_USER, password: process.env.DB_PASSWORD })
};

let poolPromise = null;

async function ketNoiDb() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config);
    poolPromise = pool.connect().catch((error) => {
      poolPromise = null;
      throw error;
    });
  }

  return poolPromise;
}

async function dongDb() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

module.exports = { sql, ketNoiDb, dongDb };