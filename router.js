const log = require('pino')({prettyPrint: true, level: 'debug'});
const express = require('express');
const router = express.Router();
const routerPhotos = require('./router-photos');
const routerRedirects = require('./router-redirects');
const geoip = require('geoip-lite');
const path = require('path');

router.use((req, res, next) => {
  req.realIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress;

  if(req.realIp === "::1") req.realIp = '107.3.166.67';
  req.geo = geoip.lookup(req.realIp);

  log.info(['http_log', {
    'ip': req.realIp,
    'hostname': req.hostname,
    'query': req.query,
    'body': req.body,
    'path': req.path,
    'user_agent': req.headers['user-agent'],
    'accept-language': req.headers['accept-language'],
    'referer': req.headers['referer'],
    'geo': req.geo,
  }]);

  if(req.geo && req.geo.country && req.geo.region) {
    req.isH = (req.geo.country === "US" && req.geo.region === "NJ") || (req.geo.country === "IN");
    req.isC = (req.geo.country === "CN");
  } else {
    req.isH = false;
    req.isC = false;
  }

  return next();
});

router.use('/photos', routerRedirects);

router.use('/', express.static(path.join(__dirname, 'static'), {maxage: 1}));

router.get('/about', (req, res) => res.render('about.html'));
router.use('/photos', routerPhotos);
router.get('/projects', (req, res) => res.render('projects.html'));
router.get('/posts', (req, res) => res.render('posts.html'));
router.get('/contact', (req, res) => res.render('contact.html'));
router.get('/', (req, res) => res.render('index.html'));

router.all('*', (req, res) => {
  res.status(404).send({msg: "not found"});
});

module.exports = router;
