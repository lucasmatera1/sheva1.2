// PM2 Ecosystem – gerencia API + Portal em produção
// Uso: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: "sheva-api",
      cwd: "./apps/api",
      script: "dist/src/server.js",
      node_args: "--max-old-space-size=2048 --env-file=../../.env",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 3000,
      watch: false,
      max_memory_restart: "2500M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "sheva-portal",
      cwd: "./apps/portal",
      script: "node_modules/.bin/next",
      args: "start --port 3005",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 3000,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3005,
      },
    },
  ],
};
