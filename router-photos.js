const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const photos = require('./photos');
const aws = require('./aws');
const fs = require('fs');
const config_photos = JSON.parse(fs.readFileSync('./config/photos.json', 'utf8'));
const md5 = require('md5');

let awsPromiseToListObjects = (params) => {
    return new Promise((resolve, reject) => {
	aws.s3.listObjects(params, (err, data) => {
	    if(err) reject(err);
	    else resolve(data);
	});
    });
};

let awsPromiseToGetObject = (params) => {
    return new Promise((resolve, reject) => {
	aws.s3.getObject(params, (err, data) => {
	    if(err) reject(err);
	    else resolve(data);
	});
    });
}

let getAlbum = (albumName) => {
    return new Promise((resolve, reject) => {
	Promise.all([
	    awsPromiseToListObjects({Bucket: config_photos.bucket, Prefix: config_photos.prefix + albumName}),
	    awsPromiseToGetObject({Bucket: config_photos.bucket, Key: config_photos.prefix + albumName + "/index.json"}),
	]).then(data => {
	    let objectList = data[0].Contents;
	    let index = JSON.parse(data[1].Body.toString('utf-8'));

	    console.log(index);
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
	    });
        }, reason => reject(reason));
    });
}

getAlbum("calnight").then(r => console.log(r));

router.get('/', (req, res) => res.render('photos/index.html'));

router.get('/:albumName', (req, res) => {
    getAlbum(req.params["albumName"])
        .then(album => {
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
            })
	}, reason => {
	    if(!reason) return res.send(500);
	    if(reason.code === "NoSuchKey") return res.send(404);
	    log.error(["photo_album", reason]);
	    res.send(500);
	});
});

router.get('/:albumName/:imageName', (req, res) => {
  res.render('photos/image.html')
});

module.exports = router;
