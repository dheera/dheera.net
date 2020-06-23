#!/usr/bin/env node
const express = require('express');
const nunjucks = require('nunjucks');
const fs = require('fs');
const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('./router');

var app = express();

nunjucks.configure('views', {
    autoescape: true,
    express: app
});


app.use('/', router);

var http = require('http').Server(app);

http.listen(3000, () => {
  log.info(['http_server', 'listening on *:3000']);
});
