module.exports = {
  apps : [{
    name: 'archie-chatbot',
    script: 'server/index.js',
    env: {
      NODE_ENV: 'production',
      PORT: 4008
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
