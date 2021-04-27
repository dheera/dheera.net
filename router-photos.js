const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const contentFetcher = require('./content-fetcher');

router.get('/', (req, res) => {
    Promise.all([
      contentFetcher.getAlbumsIndex(),
      contentFetcher.getAlbums(),
    ])
    .then((data) => {
        let index = data[0];
	let albums = data[1];

        let featured = index["featured"] || [];

        let albumsUnfeatured = [];
	let albumsFeatured = [];

	console.log(index);

        for(i in albums) {
            albums[i].thumbnail = contentFetcher.getSignedImageURL(albums[i].imageFiles[0], "w=250&h=250&fit=crop&q=50");
            if(featured.includes(albums[i].name)) albumsFeatured.push(albums[i]);
            else albumsUnfeatured.push(albums[i]);
        }

        res.render('photos/index.html', {
            albums: albums,
            albumsFeatured,
            albumsUnfeatured,
            userInfo: req.userInfo,
        });
    }, reason => {
        log.error(["photo_index", reason]);
        res.sendStatus(500);
    });
});

function JSONtoString() { return JSON.stringify(this); }

router.get('/:albumName', (req, res) => {
    contentFetcher.getAlbum(req.params["albumName"])
    .then(
        album => {
            images = [];
            for (i in album.imageFiles) {
                images.push({
                    path: album.imageFiles[i],
                    thumbnail: contentFetcher.getSignedImageURL(album.imageFiles[i], "w=256&h=" + Math.floor(256 * album.thumbAspectRatio) + "&fit=crop&q=40"),
                    src: (album.watermark === false) ? contentFetcher.getSignedImageURL(album.imageFiles[i], "w=2048&h=2048&fit=fillmax&q=90") : contentFetcher.getSignedImageURL(album.imageFiles[i], "w=2048&h=2048&fit=fillmax&mark=/photos/_watermark/512.png&mark-w=200&mark-align=bottom,left&mark-pad=50&q=95"),
                    srcInfo: contentFetcher.getSignedImageURL(album.imageFiles[i], "fm=json"),
                });
            }

	    images.toString = JSONtoString;

            res.render('photos/album.html', {
                images: images,
                title: album.title,
                subtitle: album.subtitle,
                description: album.description,
                license: album.license,
                thumbAspectRatio: album.thumbAspectRatio,
                userInfo: req.userInfo,
            })
        }, 
        reason => {
            if(!reason) return res.sendStatus(500);
            if(reason.code === "NoSuchKey") {
              return res.sendStatus(404);
            }
            log.error(["photo_album", reason]);
            res.sendStatus(500);
        }
    );
});

module.exports = router;
