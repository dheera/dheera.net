const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const aws = require('./aws');
const fs = require('fs');
const config_photos = JSON.parse(fs.readFileSync('./config/photos.json', 'utf8'));
const md5 = require('md5');


let getAlbums = () => new Promise((resolve, reject) => {
    aws.listObjects({Bucket: config_photos.bucket, Prefix: config_photos.prefix, Delimiter: "/"})
    .then(
        result => {
            let albumNames = result.CommonPrefixes
		.map(item => item.Prefix.replace(config_photos.prefix, "").replace("/", ""))
		.filter(name => name[0] != "_");
            let albums = [];
            let promises = [];
            for(i in albumNames) {
                promises.push(getAlbum(albumNames[i]));
            }
            Promise.allSettled(promises).then(results => {
                for(i in results) {
                    if(results[i].status === "fulfilled") {
                        album = results[i].value;
                        album.name = albumNames[i];
                        albums.push(album);
                    }
                }
                resolve(albums);
            });
        },
        reason => reject(reason)
    );
});

let getAlbum = (albumName) => new Promise((resolve, reject) => {
    Promise.all([
        aws.listObjects({Bucket: config_photos.bucket, Prefix: config_photos.prefix + albumName}),
        aws.getObject({Bucket: config_photos.bucket, Key: config_photos.prefix + albumName + "/index.json"}),
    ]).then(
        data => {
            let objectList = data[0].Contents;
            let index = {};
            try {
                   index = JSON.parse(data[1].Body.toString('utf-8'));
            } catch(e) {
                index = {
                    "title": "Error",
                    "description": e.toString("utf-8"),
                }
            }

            imageFiles = [];
            for (i in objectList) {
                 filename = objectList[i].Key.replace(config_photos.prefix, "");
                 if(filename.indexOf(".jpg") !== -1) {
                     imageFiles.push(filename);
                 }
            }
            resolve({
                imageFiles: imageFiles || [],
                title: index.title || "",
                description: index.description || "",
                thumbAspectRatio: index.thumbAspectRatio || 1.0,
            });
        },
        reason => reject(reason)
    );
});

let getSignedImageURL = (imageFile, params) => {
    let path = imageFile + "?" + params;
    let checksum = md5(config_photos.imgixSecureToken + "/" + path); // imgix uses MD5, not my choice
    let url = "https://" + config_photos.imgixDomain + "/" + path + "&s=" + checksum;
    return url;
}

router.get('/', (req, res) => {
    getAlbums()
    .then(albums => {
        for(i in albums) {
            albums[i].thumbnail = getSignedImageURL(albums[i].imageFiles[0], "w=250&h=250&fit=crop");
        }
        res.render('photos/index.html', {
            albums: albums,
            userInfo: req.userInfo,
        });
    }, reason => {
        log.error(["photo_index", reason]);
        res.sendStatus(500);
    });
});

router.get('/:albumName', (req, res) => {
    getAlbum(req.params["albumName"])
    .then(
        album => {
            images = [];
            for (i in album.imageFiles) {
                images.push({
                    path: album.imageFiles[i],
                    thumbnail: getSignedImageURL(album.imageFiles[i], "w=250&h=" + Math.floor(album.thumbAspectRatio * 250) + "&fit=crop"),
                    src: album.noWatermark ? getSignedImageURL(album.imageFiles[i], "w=3072&h=3072&fit=fillmax") : getSignedImageURL(album.imageFiles[i], "w=3072&h=3072&fit=fillmax&mark=/_watermark/512.png&mark-w=320&mark-align=bottom,left&mark-pad=50"),
                });
            }
            res.render('photos/album.html', {
                images: images,
                title: album.title,
                description: album.description,
                thumbAspectRatio: album.thumbAspectRatio,
                userInfo: req.userInfo,
            })
        }, 
        reason => {
            if(!reason) return res.sendStatus(500);
            if(reason.code === "NoSuchKey") {
              log.error(["photo_album", reason]);
              return res.sendStatus(404);
            }
            log.error(["photo_album", reason]);
            res.sendStatus(500);
        }
    );
});

module.exports = router;
