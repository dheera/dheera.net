const log = require('pino')({prettyPrint: true, level: 'debug'});
const express = require('express');
const routerPhotos = express.Router();

routerPhotos.use('/', (req, res) => res.render('photos.html'));

routerPhotos.get('/:albumName', (req, res) => {}
  res.render('photos.html')
});

routerPhotos.get('/:albumName/:imageName', (req, res) => {}
  res.render('photos.html')
});

class Photo {

}

class PhotoAlbum {

}

class PhotoGallery {

}

module.exports = routerPhotos;
