function log(level, msg) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} [${level.toUpperCase()}] ${msg}`);
}

module.exports = { log };
