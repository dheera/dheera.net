const debug = process.argv.includes('--debug');
module.exports = require('pino')(debug ? {prettyPrint: true, level: 'debug'} : { prettyPrint: false, level: 'info' });
