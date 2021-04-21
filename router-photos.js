const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const photos = require('./photos');
const aws = require('./aws');
const fs = require('fs');
const config_photos = JSON.parse(fs.readFileSync('./config/photos.json', 'utf8'));
const md5 = require('md5');

let getAlbums = () => new Promise((resolve, reject) => {
    aws.listObjects({Bucket: config_photos.bucket, Prefix: config_photos.prefix, Delimiter: "/"})
    .then(
        result => {
            let albumNames = result.CommonPrefixes.map(item => item.Prefix.replace(config_photos.prefix, "").replace("/", ""));
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

router.get('/', (req, res) => {
    getAlbums()
    .then(albums => {
        for(i in albums) {
            thumbnail = albums[i].imageFiles[0] + "?w=250";
            checksum = md5(config_photos.imgixSecureToken + "/" + thumbnail);
            thumbnail = "https://" + config_photos.imgixDomain + "/" + thumbnail + "&s=" + checksum;
            albums[i].thumbnail = thumbnail;
        }
        res.render('photos/index.html', {
            albums: albums,
        });
    }, reason => {
        log.error(["photo_index", reason]);
        res.send(500);
    });
});

router.get('/:albumName', (req, res) => {
    getAlbum(req.params["albumName"])
    .then(
        album => {
            images = [];
            for (i in album.imageFiles) {
                src = album.imageFiles[i] + "?w=3072";
                checksum = md5(config_photos.imgixSecureToken + "/" + src);
                src = "https://" + config_photos.imgixDomain + "/" + src + "&s=" + checksum;
                thumbnail = album.imageFiles[i] + "?w=250";
                checksum = md5(config_photos.imgixSecureToken + "/" + thumbnail);
                thumbnail = "https://" + config_photos.imgixDomain + "/" + thumbnail + "&s=" + checksum;
                images.push({
                    path: album.imageFiles[i],
                    thumbnail: thumbnail,
                    src: src,
                });
            }
            res.render('photos/album.html', {
                images: images,
                title: album.title,
                description: album.description,
                thumbAspectRatio: album.thumbAspectRatio,
            })
        }, 
        reason => {
            if(!reason) return res.send(500);
            if(reason.code === "NoSuchKey") {
              log.error(["photo_album", reason]);
              return res.send(404);
            }
            log.error(["photo_album", reason]);
            res.send(500);
        }
    );
});

module.exports = router;
