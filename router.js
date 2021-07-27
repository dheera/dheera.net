const log = require('./log');
const express = require('express');
const router = express.Router();
const routerPhotos = require('./router-photos');
const routerPosts = require('./router-posts');
const routerProjects = require('./router-projects');
const routerRedirects = require('./router-redirects');
const geoip = require('geoip-lite');
const path = require('path');
const lang = require('./lang');
const contentFetcher = require('./content-fetcher');
const memoize = require('memoizee');

let geoip_lookup_memoized = memoize(geoip.lookup, { max: 10000, preFetch: false, maxAge: 10000000 });

router.use(lang);

router.use((req, res, next) => {
  // realIp gives real client's IP address even when app is run behind nginx or other forwarding proxy
  req.realIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress;

  // block FLoC
  res.setHeader("Permissions-Policy", "interest-cohort=()");

  if(req.realIp === "::1") req.realIp = '107.3.166.67';

  try {
    req.geo = geoip_lookup_memoized(req.realIp) || {};
  } catch(e) {
    log.error(["geoip", e]);
    req.geo = {};
  }

  delete(req.geo["range"]);
  delete(req.geo["eu"]);

  res.on("finish", () => {
    const log_item = {
      'status': res.statusCode,
      'ip': req.realIp,
      'hostname': req.hostname,
      'query': req.query,
      'body': req.body,
      'path': req.path,
      'user_agent': req.headers['user-agent'],
      'accept-language': req.headers['accept-language'],
      'referer': req.headers['referer'],
      'geo': req.geo,
    };
    if(res.statusCode <= 399) {
      log.info(["http_log", log_item]);
    } else if(res.statusCode >= 400 && res.statusCode < 500) {
      log.warn(["http_log", log_item]);
    } else {
      log.error(["http_log", log_item]);
    }
  });

  req.userInfo = {"groups": {}};

  if(req.geo && req.geo.country && req.geo.region) {
    req.userInfo.groups.aa = (req.geo.country === "US" && req.geo.region === "NJ") || (req.geo.country === "IN");
    req.userInfo.groups.cn = (req.geo.country === "CN");
  } else {
    req.userInfo.groups.aa = false;
    req.userInfo.groups.cn = false;
  }
  
  if(req.query.aa) req.userInfo.groups.aa = true;
  if(req.query.cn) req.userInfo.groups.cn = true;

  return next();
});

router.use('/', routerRedirects);
router.use('/css', express.static(path.join(__dirname, 'static/css'), {maxAge: 10000}));
router.use('/js', express.static(path.join(__dirname, 'static/js'), {maxAge: 10000}));
router.use('/fa', express.static(path.join(__dirname, 'static/fa'), {maxAge: 86400000 * 365}));
router.use('/fonts', express.static(path.join(__dirname, 'static/fonts'), {maxAge: 86400000 * 365}));
router.use('/', express.static(path.join(__dirname, 'static'), {maxAge: 86400000}));
router.get('/about', (req, res) => res.render('about.html', { userInfo: req.userInfo }));
router.use('/photos', routerPhotos);
router.use('/projects', routerProjects);
router.use('/posts', routerPosts);

router.get('/', (req, res) => {
  contentFetcher.getIndex().then(
    index => {
      for(i in index.featured) {
        index.featured[i].backgroundImageURL = contentFetcher.getSignedImageURL(index.featured[i].image, "w=1024&h=1024&fit=crop&crop=entropy&q=40");
      }
      res.render('index.html', { index: index, userInfo: req.userInfo });
    },
    reason => {
      log.error(["index", reason]);
      res.sendStatus(500);
    }
  );
});

router.get('/api/geo', (req, res) => res.json(req.geo));
router.get('/api/headers', (req, res) => res.json(req.headers));

router.get('/resume', (req, res) => res.redirect("https://d2ycs4ofblah20.cloudfront.net/files/dheera-venkatraman-resume.pdf"));
router.get('/resume.pdf', (req, res) => res.redirect("https://d2ycs4ofblah20.cloudfront.net/files/dheera-venkatraman-resume.pdf"));

router.all('*', (req, res) => {
  res.sendStatus(404);
});

module.exports = router;
