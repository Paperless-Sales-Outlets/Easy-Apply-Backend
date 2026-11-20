// PM2 process file for the EasyApply backend.
//
// The Backup Dashboard keeps its job lock, restore maintenance mode and download
// tokens in this process's memory, so the backend MUST run as ONE instance in
// fork mode. Do not raise `instances` or switch to cluster mode.
//
//   pm2 start ecosystem.config.cjs      (first time)
//   pm2 reload ecosystem.config.cjs --update-env
//   pm2 save
//
// The name matches the one used by .github/workflows/deploy.yml.
module.exports = {
  apps: [
    {
      name: 'easy-apply-backend-backup',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'production' },
    },
  ],
};
