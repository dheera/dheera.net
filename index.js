#!/usr/bin/env node
const express = require('express');
const minifyHTML = require('express-minify-html');
const nunjucks = require('nunjucks');
const fs = require('fs');
const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('./router');

var app = express();
var http = require('http').Server(app);

nunjucks.configure('views', {
    autoescape: true,
    express: app
});

app.use(minifyHTML({
    override: true,
    exception_url: false,
    htmlMinifier: {
        removeComments: true,
        collapseWhitespace: true,
        collapseBolleanAttributes: true,
        removeAttributeQuotes: false,
        removeEmptyAttributes: false,
        minifyJS: true,
    },
}));

app.use('/', router);

http.listen(3000, () => {
  log.info(['http_server', 'listening on *:3000']);
});
