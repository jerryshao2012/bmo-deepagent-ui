function runtimeConfig(env = process.env) {
  return {
    dev: env.NODE_ENV !== "production",
    hostname: env.HOST || "0.0.0.0",
    port: env.PORT || 3000,
  };
}

module.exports = { runtimeConfig };
